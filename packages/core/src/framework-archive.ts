/**
 * Archive readers for Framework Jarvis imports — a minimal, dependency-free ZIP reader (store +
 * deflate via node:zlib) and a tar.gz reader (gunzip + tar blocks). We avoid a zip/tar npm dep to
 * keep the heterogeneous runner fleet lean. Both feed `extractFrameworkFiles`, which is the trust
 * boundary for untrusted archives: it anchors each entry into the framework scope (commands/, skills/,
 * instructions.md), reuses `assertSafeRelPath` to reject traversal, drops binaries, and enforces hard
 * size/count caps + a decompression-bomb guard.
 */
import { gunzipSync, inflateRawSync } from "node:zlib";
import { assertSafeRelPath, type FrameworkFile } from "./framework.js";
import { isPackManifestPath, parsePackManifest, type PackManifest } from "./framework-pack.js";

export interface ArchiveEntry { path: string; data: Buffer }

export interface ExtractResult {
  files: FrameworkFile[];
  skipped: string[];
  /** quantos arquivos do pacote ficaram FORA do escopo do framework (nem skills/commands/flows/reference). */
  outOfScope: number;
  /** amostra desses caminhos, para a prévia explicar o que não vai entrar. */
  outOfScopeSample: string[];
  /** identidade declarada em `jarvis.pack.json`, quando o pacote traz uma. `null` = pacote sem
   *  identidade: importa do mesmo jeito, mas a origem dos arquivos fica inferida da fonte. */
  manifest: PackManifest | null;
}
const OUT_OF_SCOPE_SAMPLE = 15;

/** Hard limits — a framework pack is small; anything past these is treated as hostile/misdirected. */
export const MAX_FILE_BYTES = 512 * 1024;        // 512 KB per file (uncompressed)
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;  // 8 MB total across the pack
export const MAX_ENTRIES = 20000;                // total archive members scanned
export const MAX_FRAMEWORK_FILES = 1000;         // framework files kept

const ZIP_EOCD = 0x06054b50;
const ZIP_CEN = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

/** Minimal ZIP reader. Uses the central directory (authoritative sizes), supports store (0) and
 *  deflate (8). No Zip64 (framework packs are tiny). Throws on a structurally invalid archive. */
export function unzip(buf: Buffer): ArchiveEntry[] {
  if (buf.length < 22) throw new Error("zip inválido (muito pequeno)");
  // EOCD may be followed by a comment; scan backward for its signature.
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === ZIP_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("zip inválido (EOCD não encontrado)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ArchiveEntry[] = [];
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== ZIP_CEN) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;                 // directory entry
    if (uncompSize > MAX_FILE_BYTES || compSize > MAX_FILE_BYTES) continue; // skip oversized member
    if (buf.readUInt32LE(localOff) !== ZIP_LOCAL) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    let data: Buffer;
    try {
      data = method === 0 ? comp : method === 8 ? inflateRawSync(comp, { maxOutputLength: MAX_FILE_BYTES }) : Buffer.alloc(0);
    } catch { continue; }                              // corrupt/oversized member → skip it, not the pack
    if (data.length === 0 && method !== 0) continue;
    out.push({ path: name, data });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

function octal(buf: Buffer): number {
  const s = buf.toString("ascii").replace(/\0.*$/, "").trim();
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

/** Minimal tar reader (ustar/GNU). Handles the `prefix` field, GNU long names ('L') and pax extended
 *  headers ('x' → path=). Stops at the zero-block terminator. */
export function untar(buf: Buffer): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let off = 0, longName = "";
  while (off + 512 <= buf.length) {
    const block = buf.slice(off, off + 512);
    if (block.every((b) => b === 0)) break;            // end-of-archive
    const rawName = block.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = octal(block.slice(124, 136));
    const type = String.fromCharCode(block[156]);
    const prefix = block.slice(345, 500).toString("utf8").replace(/\0.*$/, "");
    const dataStart = off + 512;
    const data = buf.slice(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = data.toString("utf8").replace(/\0.*$/, ""); continue; }        // GNU long name
    if (type === "x" || type === "g") {                                                            // pax header
      const m = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(data.toString("utf8"));
      if (m) longName = m[1];
      continue;
    }
    let name = longName || (prefix ? `${prefix}/${rawName}` : rawName);
    longName = "";
    if (type !== "0" && type !== "\0" && type !== "") continue; // only regular files
    if (name.endsWith("/")) continue;
    if (size > MAX_FILE_BYTES) continue;
    out.push({ path: name, data });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export function untargz(buf: Buffer): ArchiveEntry[] {
  return untar(gunzipSync(buf, { maxOutputLength: MAX_TOTAL_BYTES * 4 }));
}

/** Anchor an arbitrary archive path into the framework scope, or null if it isn't a framework file.
 *  Strips any wrapper/prefix dirs (e.g. GitHub's `repo-<sha>/…`) by locating the first commands/,
 *  skills/ segment or a top `instructions.md`. */
export function toFrameworkPath(entryPath: string): string | null {
  const segs = String(entryPath).replace(/\\/g, "/").split("/").filter((s) => s !== "");
  // Pastas OCULTAS são ferramental, não conteúdo de framework — mesma regra do coletor em disco. Sem
  // isto, `.github/workflows/ci.yml` entraria como definição de fluxo só pelo nome da pasta.
  // `.`/`..` NÃO entram aqui: precisam seguir para assertSafeRelPath, que os REPORTA como tentativa
  // de escapar do escopo — engoli-los silenciosamente esconderia justamente o caso perigoso.
  if (segs.some((s) => s.startsWith(".") && s !== "." && s !== "..")) return null;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === "commands" || segs[i] === "skills" || segs[i] === "flows" || segs[i] === "reference") return segs.slice(i).join("/");
    if (segs[i] === "instructions.md") return "instructions.md";
  }
  return null;
}

/**
 * Turn raw archive entries into framework files. THE trust boundary: anchors to scope, re-validates
 * the path (traversal/scope) via assertSafeRelPath, rejects binaries (NUL byte), dedupes, and enforces
 * the total-size and file-count caps. Anything rejected is reported in `skipped` with a reason.
 */
export function extractFrameworkFiles(entries: ArchiveEntry[], opts: { subdir?: string } = {}): ExtractResult {
  const files: FrameworkFile[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let outOfScope = 0;
  const outOfScopeSample: string[] = [];
  let manifest: PackManifest | null = null;
  const subdir = (opts.subdir || "").replace(/^\/+|\/+$/g, "");
  let total = 0;
  for (const e of entries) {
    let ep = String(e.path).replace(/\\/g, "/");
    if (subdir) {
      // Match the subdir after any single wrapper prefix (GitHub tarball root).
      const idx = ep.indexOf(`/${subdir}/`);
      const top = ep.startsWith(`${subdir}/`) ? subdir.length + 1 : idx >= 0 ? idx + subdir.length + 2 : -1;
      if (top < 0) continue;                            // outside the requested subdir → ignore silently
      ep = ep.slice(top);
    }
    // A IDENTIDADE do pacote. Não é arquivo de framework (não vai para o disco nem para o manifesto
    // de publicação): é lida aqui e devolvida à parte, para atribuir origem ao que veio junto. Sem o
    // `continue` ela seria contada como "fora do escopo" e apareceria como ruído na prévia.
    if (isPackManifestPath(ep)) {
      if (!manifest && !e.data.includes(0) && e.data.length <= MAX_FILE_BYTES) manifest = parsePackManifest(e.data.toString("utf8"));
      continue;
    }
    const rel = toFrameworkPath(ep);
    // FORA do escopo do framework. Antes isto era descartado em SILÊNCIO: quem importava um pacote com
    // a própria estrutura (ex.: `core/flow/*.md`) via a maior parte sumir sem explicação. Agora conta e
    // devolve uma amostra, para a prévia mostrar o que NÃO vai entrar antes de aplicar.
    if (!rel) {
      outOfScope++;
      if (outOfScopeSample.length < OUT_OF_SCOPE_SAMPLE) outOfScopeSample.push(ep);
      continue;
    }
    let safe: string;
    try { safe = assertSafeRelPath(rel); } catch (err: any) { skipped.push(`${e.path} (${err?.message || "caminho inválido"})`); continue; }
    if (seen.has(safe)) { skipped.push(`${safe} (duplicado no arquivo)`); continue; }
    if (e.data.includes(0)) { skipped.push(`${safe} (binário ignorado)`); continue; }
    if (e.data.length > MAX_FILE_BYTES) { skipped.push(`${safe} (excede ${MAX_FILE_BYTES} bytes)`); continue; }
    if (total + e.data.length > MAX_TOTAL_BYTES) { skipped.push(`${safe} (excede o total permitido do pacote)`); continue; }
    if (files.length >= MAX_FRAMEWORK_FILES) { skipped.push(`${safe} (excede o número máximo de arquivos)`); continue; }
    seen.add(safe);
    total += e.data.length;
    files.push({ path: safe, content: e.data.toString("utf8") });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped, outOfScope, outOfScopeSample, manifest };
}

/* ── escrita de zip ──────────────────────────────────────────────────────────────────────────────
 * O caminho inverso do leitor acima, usado por uma coisa só: entregar o pacote-modelo pelo botão
 * "Baixar modelo". Método `store` (sem compressão) de propósito — o modelo tem poucos KB, e sem
 * deflate o escritor cabe em uma tela e não tem estado. Datas fixas em 1980-01-01, então o mesmo
 * conteúdo sempre gera os mesmos bytes (o teste de ida-e-volta depende disso).
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE_1980 = 0x0021;
const UTF8_NAMES = 0x0800;

/** Monta um zip a partir de arquivos de texto. Lido de volta por `unzip` sem perda. */
export function zipStore(files: { path: string; content: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(String(f.path).replace(/\\/g, "/"), "utf8");
    const data = Buffer.from(String(f.content), "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(ZIP_LOCAL, 0);
    local.writeUInt16LE(20, 4);            // versão necessária
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(0, 8);             // método: store
    local.writeUInt16LE(0, 10);            // hora
    local.writeUInt16LE(DOS_DATE_1980, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);  // comprimido
    local.writeUInt32LE(data.length, 22);  // original
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);            // extra
    locals.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(ZIP_CEN, 0);
    cen.writeUInt16LE(20, 4);              // versão de origem
    cen.writeUInt16LE(20, 6);              // versão necessária
    cen.writeUInt16LE(UTF8_NAMES, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(DOS_DATE_1980, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);              // extra
    cen.writeUInt16LE(0, 32);              // comentário
    cen.writeUInt16LE(0, 34);              // disco
    cen.writeUInt16LE(0, 36);              // atributos internos
    cen.writeUInt32LE(0, 38);              // atributos externos
    cen.writeUInt32LE(offset, 42);         // deslocamento do cabeçalho local
    centrals.push(cen, name);

    offset += 30 + name.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);               // comentário
  return Buffer.concat([...locals, central, eocd]);
}
