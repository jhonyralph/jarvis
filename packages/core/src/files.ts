/**
 * Read a project file for the "view before you run it" viewer — shared by the Hub
 * (machine 0) and Runners. Resolves relative paths against the session cwd, caps
 * size, and refuses binary. Access is not restricted beyond that: anyone who can
 * drive an agent on this machine can already read its files.
 *
 * BRW-IDE-00 F3 — o mesmo módulo grava (`writeProjectFile`) para o editor leve. A escrita usa a
 * MESMA resolução de caminho da leitura e só aceita o que a leitura entregou íntegro: nada de
 * imagem, binário, arquivo truncado ou fora de UTF-8 (editar um buffer com perda destruiria o resto).
 */
import { readFileSync, statSync } from "node:fs";
import { link, open, readFile, rename, stat, unlink, realpath, chmod } from "node:fs/promises";
import { isAbsolute, join, basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { isUtf8 } from "node:buffer";

export interface FileContent {
  path: string;
  name: string;
  content?: string;
  size?: number;
  mtimeMs?: number;
  truncated?: boolean;
  error?: string;
  image?: boolean; // content é base64 da imagem (não texto) — o viewer renderiza <img>
  mime?: string;
  /** F3 — por que o editor NÃO pode abrir este arquivo para edição (ausente = editável). O cliente
   *  mostra o motivo no botão "Editar" em vez de deixar o usuário descobrir só ao salvar. */
  readOnlyReason?: string;
}

const MAX = 512 * 1024; // 512KB (texto)
/** Teto do editor: o mesmo da leitura — só se edita o que foi lido inteiro. */
export const FILE_EDIT_MAX_BYTES = MAX;
const IMG_MAX = 8 * 1024 * 1024; // 8MB (imagem; base64 infla ~33%, cabe no cap de payload do hub)
const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", avif: "image/avif",
};
const TEXT_EXT = new Set([
  "txt", "md", "mdx", "markdown", "json", "jsonl", "yaml", "yml", "toml", "ini", "env",
  "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "html", "htm", "css", "scss",
  "xml", "svg", "sql", "sh", "bash", "zsh", "ps1", "bat", "cmd", "py", "rb", "go",
  "rs", "java", "kt", "kts", "c", "h", "cpp", "hpp", "cs", "php", "swift", "dart",
  "dockerfile", "gitignore", "gitattributes", "editorconfig",
]);

function textExtension(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith("dockerfile")) return true;
  return TEXT_EXT.has((lower.split(".").pop() || ""));
}

function shouldTreatAsBinary(slice: Buffer, name: string): boolean {
  let nul = 0;
  for (const b of slice) if (b === 0) nul++;
  if (!nul) return false;
  if (textExtension(name)) return false;
  return nul / Math.max(1, slice.length) > 0.01;
}

/** Resolução ÚNICA de caminho, compartilhada por leitura e escrita: relativo vale contra a pasta da
 *  sessão (ou a home, como sempre foi na leitura). */
export function resolveProjectPath(p: string, cwd?: string): string {
  return isAbsolute(p) ? p : join(cwd || homedir(), p);
}

function imageMime(name: string): string | undefined {
  return IMG_MIME[(name.split(".").pop() || "").toLowerCase()];
}

/** Motivo pelo qual um texto lido NÃO pode ser editado sem perda (ou undefined se pode). */
function textEditBlock(buf: Buffer, size: number, mode: number): string | undefined {
  if (size > MAX) return "arquivo maior que 512 KB — só o começo foi lido, editar destruiria o resto";
  if (buf.includes(0)) return "contém bytes nulos (\\0) — editar aqui os corromperia";
  if (!isUtf8(buf)) return "não está em UTF-8 — editar aqui trocaria caracteres";
  if (!(mode & 0o200)) return "arquivo somente leitura no disco";
  return undefined;
}

export function readProjectFile(p: string, cwd?: string): FileContent {
  let abs = p;
  try {
    abs = resolveProjectPath(p, cwd);
    const st = statSync(abs);
    if (!st.isFile()) return { path: abs, name: basename(abs), error: "não é um arquivo" };
    // Imagem: NÃO recusar como "binário" — devolve base64 pra exibir no viewer/modal.
    const mime = imageMime(basename(abs));
    if (mime) {
      if (st.size > IMG_MAX) return { path: abs, name: basename(abs), size: st.size, mtimeMs: st.mtimeMs, error: "imagem grande demais para exibir (>8MB)" };
      return { path: abs, name: basename(abs), image: true, mime, content: readFileSync(abs).toString("base64"), size: st.size, mtimeMs: st.mtimeMs, readOnlyReason: "imagem não é editável aqui" };
    }
    const buf = readFileSync(abs);
    const slice = buf.subarray(0, Math.min(buf.length, MAX));
    const name = basename(abs);
    if (shouldTreatAsBinary(slice, name)) return { path: abs, name, size: st.size, mtimeMs: st.mtimeMs, error: "arquivo binário (não dá para exibir)" };
    const readOnlyReason = textEditBlock(buf, st.size, st.mode);
    return { path: abs, name, content: slice.toString("utf8").replace(/\0/g, "\\0"), size: st.size, mtimeMs: st.mtimeMs, truncated: st.size > MAX, ...(readOnlyReason ? { readOnlyReason } : {}) };
  } catch (e: any) {
    return { path: abs, name: basename(abs || p), error: String(e?.message ?? e).slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------------------------
// Escrita segura (F3)
// ---------------------------------------------------------------------------------------------

export interface FileWriteOptions {
  /** `mtimeMs` que a leitura devolveu. Obrigatório para sobrescrever um arquivo existente (salvo `force`). */
  expectedMtimeMs?: number;
  /** `size` que a leitura devolveu — reforça o mtime em sistemas de arquivo de relógio grosso. */
  expectedSize?: number;
  /** "Sobrescrever mesmo assim": pula SÓ a detecção de conflito (nunca as guardas de caminho). */
  force?: boolean;
  /** Criar arquivo novo. Só vale SEM `expectedMtimeMs`; se o arquivo já existir é conflito. */
  create?: boolean;
}

export interface FileWriteConflict {
  /** Versão que está no disco AGORA (ausente quando o arquivo sumiu). */
  mtimeMs?: number;
  size?: number;
  /** O arquivo foi apagado/movido desde a leitura. */
  missing?: boolean;
  /** Pedido de criação, mas o arquivo já existe. */
  exists?: boolean;
}

export interface FileWriteResult {
  path: string;
  name: string;
  ok: boolean;
  mtimeMs?: number;
  size?: number;
  created?: boolean;
  conflict?: FileWriteConflict;
  error?: string;
}

const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** No Windows, trocar um arquivo aberto por outro processo (antivírus, indexador, um editor sem
 *  FILE_SHARE_DELETE) falha com EPERM/EBUSY por instantes. Tenta de novo com recuo curto em vez de
 *  cair para uma escrita no lugar — que não é atômica e poderia deixar o arquivo pela metade. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let delay = 15;
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (e: any) {
      if (!RENAME_RETRY_CODES.has(e?.code) || attempt >= 7) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 400);
    }
  }
}

function tempNameFor(target: string): string {
  return join(dirname(target), `.${basename(target)}.jarvis-${randomBytes(5).toString("hex")}.tmp`);
}

function insideGitDir(p: string): boolean {
  return p.split(/[\\/]+/).some((seg) => seg.toLowerCase() === ".git");
}

async function statOrNull(p: string): Promise<import("node:fs").Stats | null> {
  try { return await stat(p); } catch (e: any) { if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null; throw e; }
}

/** Cria um arquivo NOVO sem nunca sobrescrever: grava num temporário e o liga com `link` (atômico e
 *  exclusivo — falha com EEXIST se alguém criou antes). Sistemas sem hard link caem para `wx`. */
async function createExclusive(abs: string, bytes: Buffer): Promise<"created" | "exists"> {
  const dir = await statOrNull(dirname(abs));
  if (!dir || !dir.isDirectory()) throw new Error("a pasta do arquivo não existe");
  const tmp = tempNameFor(abs);
  try {
    const fh = await open(tmp, "wx");
    try { await fh.writeFile(bytes); await fh.sync(); } finally { await fh.close(); }
    try { await link(tmp, abs); return "created"; }
    catch (e: any) {
      if (e?.code === "EEXIST") return "exists";
      if (!["EPERM", "ENOTSUP", "EXDEV", "ENOSYS", "EINVAL"].includes(e?.code)) throw e;
      try { const out = await open(abs, "wx"); try { await out.writeFile(bytes); await out.sync(); } finally { await out.close(); } return "created"; }
      catch (e2: any) { if (e2?.code === "EEXIST") return "exists"; throw e2; }
    }
  } finally {
    await unlink(tmp).catch(() => { /* já foi */ });
  }
}

/**
 * Grava `content` (UTF-8, exatamente como veio — CRLF preservado) no arquivo do projeto.
 *
 * - Conflito: se o arquivo no disco não é mais a versão lida (`expectedMtimeMs`/`expectedSize`),
 *   devolve `conflict` com a versão atual e NÃO grava. Sem `expectedMtimeMs` não se sobrescreve nada.
 * - `force`: grava mesmo assim (o usuário viu o conflito e escolheu). Não pula as guardas.
 * - Atômico: temporário na mesma pasta + rename (com retentativa no Windows). Link simbólico é
 *   seguido: grava-se o alvo e o link continua link.
 * - Recusa: imagem, conteúdo > 512 KB, arquivo atual > 512 KB/binário/não-UTF-8 (a leitura foi com
 *   perda), somente leitura, qualquer coisa dentro de `.git`, caminho relativo sem pasta.
 * - Criar: só com `create:true` e sem `expectedMtimeMs`; arquivo existente vira conflito `exists`.
 */
export async function writeProjectFile(p: string, cwd: string | undefined, content: string, opts: FileWriteOptions = {}): Promise<FileWriteResult> {
  const raw = typeof p === "string" ? p.trim() : "";
  const fail = (path: string, error: string): FileWriteResult => ({ path, name: basename(path || raw), ok: false, error });
  if (!raw) return fail("", "caminho vazio");
  if (typeof content !== "string") return fail(raw, "conteúdo inválido");
  if (!isAbsolute(raw) && !cwd) return fail(raw, "caminho relativo sem pasta de trabalho");
  const abs = resolve(resolveProjectPath(raw, cwd));
  const name = basename(abs);
  if (insideGitDir(abs)) return fail(abs, "o editor não grava dentro de .git");
  if (imageMime(name)) return fail(abs, "imagem não é editável aqui");
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX) return fail(abs, "conteúdo maior que 512 KB — o editor não grava arquivos desse tamanho");
  const wantsCreate = opts.create === true && opts.expectedMtimeMs === undefined;
  const force = opts.force === true;
  try {
    const st = await statOrNull(abs);
    if (!st) {
      // Sumiu (apagado/movido pela IA?) ou é criação. Só recria com pedido explícito.
      if (!wantsCreate && !force) return { path: abs, name, ok: false, conflict: { missing: true } };
      const outcome = await createExclusive(abs, bytes);
      if (outcome === "exists") {
        const now = await statOrNull(abs);
        return { path: abs, name, ok: false, conflict: { exists: true, mtimeMs: now?.mtimeMs, size: now?.size } };
      }
      const after = await stat(abs);
      return { path: abs, name, ok: true, created: true, mtimeMs: after.mtimeMs, size: after.size };
    }
    if (!st.isFile()) return fail(abs, "não é um arquivo");
    if (wantsCreate && !force) return { path: abs, name, ok: false, conflict: { exists: true, mtimeMs: st.mtimeMs, size: st.size } };
    if (!force) {
      if (typeof opts.expectedMtimeMs !== "number" || !Number.isFinite(opts.expectedMtimeMs)) return fail(abs, "falta a versão lida (expectedMtimeMs) — releia o arquivo antes de salvar");
      const sizeChanged = typeof opts.expectedSize === "number" && opts.expectedSize !== st.size;
      if (st.mtimeMs !== opts.expectedMtimeMs || sizeChanged) return { path: abs, name, ok: false, conflict: { mtimeMs: st.mtimeMs, size: st.size } };
    }
    // Link simbólico: grava no ALVO (trocar o link por um arquivo comum quebraria o link).
    const target = await realpath(abs);
    if (insideGitDir(target)) return fail(abs, "o editor não grava dentro de .git");
    if (!(st.mode & 0o200)) return fail(abs, "arquivo somente leitura no disco");
    if (!force) {
      // Defesa em profundidade: mesmo com a versão certa, só se edita o que a leitura entregou íntegro.
      const current = await readFile(target);
      const block = textEditBlock(current, st.size, st.mode);
      if (block) return fail(abs, block);
    }
    const tmp = tempNameFor(target);
    try {
      const fh = await open(tmp, "wx", st.mode & 0o777);
      try { await fh.writeFile(bytes); await fh.sync(); } finally { await fh.close(); }
      // O `mode` do open passa pelo umask; um script 0755 não pode virar 0644 ao ser salvo.
      if (process.platform !== "win32") await chmod(tmp, st.mode & 0o7777);
      if (!force) {
        // Janela entre a checagem e a troca: se a IA gravou neste meio-tempo, é conflito — não perda.
        const again = await statOrNull(target);
        if (!again || again.mtimeMs !== st.mtimeMs || again.size !== st.size) {
          return { path: abs, name, ok: false, conflict: again ? { mtimeMs: again.mtimeMs, size: again.size } : { missing: true } };
        }
      }
      await renameWithRetry(tmp, target);
    } finally {
      await unlink(tmp).catch(() => { /* renomeado = já não existe */ });
    }
    const after = await stat(target);
    return { path: abs, name, ok: true, mtimeMs: after.mtimeMs, size: after.size };
  } catch (e: any) {
    const code = e?.code ? ` (${e.code})` : "";
    const busy = RENAME_RETRY_CODES.has(e?.code) ? "arquivo em uso por outro programa — tente de novo" : String(e?.message ?? e).slice(0, 200);
    return fail(abs, busy + (busy.includes(code) ? "" : code));
  }
}
