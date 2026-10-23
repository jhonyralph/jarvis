/**
 * Busca de CONTEÚDO no projeto (BRW-IDE-00 F3) — a caixa "Buscar no projeto" da árvore de arquivos.
 *
 * Regra que manda neste arquivo: NÃO bloquear o event loop. Na máquina do Hub isto roda dentro do
 * processo do Hub, e loop travado já derrubou o serviço três vezes (INC-01..03). Por isso:
 *   - com ripgrep: processo filho assíncrono, saída lida em streaming, morto no teto de resultados
 *     ou de tempo (o motor de regex do rg é linear — sem regex catastrófica);
 *   - sem ripgrep: worker thread (`file-search-worker.mjs`) com teto de arquivos, bytes, tamanho de
 *     arquivo e tempo; no estouro de tempo a thread é encerrada à força.
 * E no máximo `MAX_CONCURRENT` buscas por processo: digitar rápido não vira N varreduras paralelas.
 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { Worker } from "node:worker_threads";

export interface FileSearchHit {
  /** caminho absoluto (abre direto no viewer) */
  path: string;
  /** relativo à raiz da busca, com `/` (o que a lista mostra) */
  rel: string;
  /** 1-based */
  line: number;
  /** 1-based, em caracteres da linha */
  col: number;
  /** a linha (ou um recorte dela, com "…") */
  preview: string;
  /** [início, fim) do trecho casado DENTRO de `preview` */
  hl: [number, number];
}

export interface FileSearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  /** teto de resultados (padrão 200, máx 1000) */
  max?: number;
  /** teto de tempo de parede (padrão 10 s) */
  timeoutMs?: number;
  /** arquivos maiores que isso são pulados (padrão 1 MB) */
  maxFileSize?: number;
  /** só no caminho sem rg: total de bytes lidos (padrão 64 MB) */
  maxBytes?: number;
  /** só no caminho sem rg: total de arquivos visitados (padrão 50 000) */
  maxFiles?: number;
  /** "auto" (padrão) usa rg se existir; "node" força a worker; "rg" exige rg */
  engine?: "auto" | "rg" | "node";
  /** binário do ripgrep (padrão: `JARVIS_RG` ou `rg` no PATH) */
  rgPath?: string;
  /** argumentos ANTES dos do rg (testes: `node fake-rg.mjs …`) */
  rgPrefixArgs?: string[];
}

export interface FileSearchResult {
  results: FileSearchHit[];
  truncated: boolean;
  engine?: "rg" | "node";
  error?: string;
}

export const SEARCH_IGNORE_DIRS = [
  ".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt", ".svelte-kit", ".turbo",
  ".cache", ".parcel-cache", ".vite", "target", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache",
  ".pytest_cache", ".gradle", ".idea", "obj", ".terraform",
];
const BINARY_EXT = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "tif", "tiff", "psd", "pdf", "zip", "gz", "tgz",
  "bz2", "xz", "7z", "rar", "jar", "war", "exe", "dll", "so", "dylib", "bin", "dat", "woff", "woff2", "ttf",
  "otf", "eot", "mp3", "mp4", "m4a", "mov", "avi", "mkv", "wav", "flac", "ogg", "webm", "pyc", "class", "o",
  "a", "lib", "obj", "node", "wasm", "sqlite", "sqlite3", "db", "pdb", "iso", "dmg", "msi", "pmtiles",
];
const MAX_CONCURRENT = 2;
const MAX_QUERY = 500;
let active = 0;

function clampInt(v: unknown, def: number, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
}

function makePreview(line: string, s: number, e: number): { preview: string; hl: [number, number] } {
  const LIMIT = 240;
  if (line.length <= LIMIT) return { preview: line, hl: [s, e] };
  const start = Math.max(0, Math.min(s - 80, line.length - LIMIT));
  const pre = start > 0 ? "…" : "", post = start + LIMIT < line.length ? "…" : "";
  return { preview: pre + line.slice(start, start + LIMIT) + post, hl: [s - start + pre.length, Math.min(e - start, LIMIT) + pre.length] };
}

/** Uma linha do `rg --json` → acerto (ou null). Exportada para teste: o formato do rg é contrato externo. */
export function parseRgJsonLine(line: string, root: string): FileSearchHit | null {
  if (!line || line.charCodeAt(0) !== 123 /* { */) return null;
  let msg: any;
  try { msg = JSON.parse(line); } catch { return null; }
  if (msg?.type !== "match") return null;
  const d = msg.data || {};
  const relRaw = typeof d.path?.text === "string" ? d.path.text : null; // caminho não-UTF-8 vem em `bytes`: pula
  const text = typeof d.lines?.text === "string" ? d.lines.text : null;
  if (!relRaw || text === null || typeof d.line_number !== "number") return null;
  const rel0 = relRaw.replace(/^\.[\\/]/, "");
  const abs = isAbsolute(rel0) ? rel0 : join(root, rel0);
  const lineText = text.replace(/\r?\n$/, "");
  const sub = Array.isArray(d.submatches) && d.submatches[0] ? d.submatches[0] : { start: 0, end: 0 };
  // rg dá offsets em BYTES; o cliente precisa de caracteres.
  const buf = Buffer.from(lineText, "utf8");
  const s = buf.subarray(0, Math.max(0, Math.min(buf.length, Number(sub.start) || 0))).toString("utf8").length;
  const e = buf.subarray(0, Math.max(0, Math.min(buf.length, Number(sub.end) || 0))).toString("utf8").length;
  const p = makePreview(lineText, s, Math.max(e, s));
  return { path: abs, rel: relative(root, abs).split(sep).join("/"), line: d.line_number, col: s + 1, preview: p.preview, hl: p.hl };
}

const rgProbe = new Map<string, Promise<boolean>>();
/** `rg --version` uma vez por binário. Sem rg no PATH (caso comum no Windows) → worker. */
function rgAvailable(cmd: string, prefix: string[]): Promise<boolean> {
  const key = [cmd, ...prefix].join("\0");
  let probe = rgProbe.get(key);
  if (!probe) {
    probe = new Promise<boolean>((resolve) => {
      try {
        const child = spawn(cmd, [...prefix, "--version"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
        let out = "";
        const timer = setTimeout(() => { child.kill(); resolve(false); }, 3000);
        child.stdout?.on("data", (b: Buffer) => { out += b.toString(); });
        child.on("error", () => { clearTimeout(timer); resolve(false); });
        child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 && /ripgrep/i.test(out)); });
      } catch { resolve(false); }
    });
    rgProbe.set(key, probe);
  }
  return probe;
}

function searchWithRg(root: string, query: string, o: Required<Pick<FileSearchOptions, "regex" | "caseSensitive" | "max" | "timeoutMs" | "maxFileSize">>, cmd: string, prefix: string[]): Promise<FileSearchResult> {
  const args = [
    ...prefix, "--json", "--max-count", "50", "--max-filesize", String(o.maxFileSize),
    o.caseSensitive ? "--case-sensitive" : "--ignore-case",
    ...(o.regex ? [] : ["--fixed-strings"]),
    ...SEARCH_IGNORE_DIRS.flatMap((d) => ["--glob", "!" + d]),
    // Mesmas extensões que a worker pula: os dois motores devem achar as mesmas coisas.
    "--glob", "!*.{" + BINARY_EXT.join(",") + "}",
    "--", query, ".",
  ];
  return new Promise<FileSearchResult>((resolve) => {
    const results: FileSearchHit[] = [];
    let truncated = false, settled = false, buf = "", stderr = "";
    const child = spawn(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const finish = (extra: Partial<FileSearchResult> = {}): void => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      resolve({ results, truncated, engine: "rg", ...extra });
    };
    const timer = setTimeout(() => { truncated = true; finish(); }, o.timeoutMs);
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (settled) return;
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const hit = parseRgJsonLine(line, root);
        if (!hit) continue;
        results.push(hit);
        if (results.length >= o.max) { truncated = true; finish(); return; }
      }
    });
    child.stderr!.on("data", (b: Buffer) => { if (stderr.length < 2000) stderr += b.toString(); });
    child.on("error", (e) => finish({ error: "ripgrep falhou: " + String(e?.message ?? e).slice(0, 160) }));
    child.on("close", (code) => {
      if (settled) return;
      const tail = parseRgJsonLine(buf, root); if (tail && results.length < o.max) results.push(tail);
      // 1 = nenhum acerto (não é erro). 2 = erro: regex inválida, pasta ilegível… Só vira erro sem acertos.
      if (code === 2 && !results.length && stderr.trim()) finish({ error: stderr.trim().split(/\r?\n/)[0].slice(0, 200) });
      else finish();
    });
  });
}

function searchWithWorker(root: string, query: string, o: Required<Omit<FileSearchOptions, "engine" | "rgPath" | "rgPrefixArgs">>): Promise<FileSearchResult> {
  return new Promise<FileSearchResult>((resolve) => {
    const results: FileSearchHit[] = [];
    let settled = false;
    // execArgv vazio: a worker é JS puro e não precisa (nem deve pagar) o loader do tsx.
    const worker = new Worker(new URL("./file-search-worker.mjs", import.meta.url), {
      execArgv: [],
      workerData: { root, query, regex: o.regex, caseSensitive: o.caseSensitive, max: o.max, maxFileSize: o.maxFileSize, maxBytes: o.maxBytes, maxFiles: o.maxFiles, ignoreDirs: SEARCH_IGNORE_DIRS, binaryExt: BINARY_EXT },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const finish = (extra: Partial<FileSearchResult>): void => {
      if (settled) return; settled = true; clearTimeout(timer);
      void worker.terminate();
      resolve({ results: results.slice(0, o.max), truncated: false, engine: "node", ...extra });
    };
    const timer = setTimeout(() => finish({ truncated: true }), o.timeoutMs);
    worker.on("message", (m: any) => {
      if (m?.type === "hits" && Array.isArray(m.hits)) { results.push(...m.hits); if (results.length >= o.max) finish({ truncated: true }); }
      else if (m?.type === "done") finish({ truncated: !!m.truncated || results.length > o.max, ...(m.error ? { error: String(m.error) } : {}) });
    });
    worker.on("error", (e) => finish({ error: "busca falhou: " + String((e as any)?.message ?? e).slice(0, 160) }));
    worker.on("exit", () => finish({}));
  });
}

/**
 * Procura `query` nos arquivos de texto sob `root`. Nunca lança: erro volta em `error`.
 * Resultado ordenado por arquivo e linha; `truncated` quando algum teto cortou a busca.
 */
export async function searchProjectFiles(root: string, query: string, opts: FileSearchOptions = {}): Promise<FileSearchResult> {
  const q = typeof query === "string" ? query : "";
  if (!q.trim()) return { results: [], truncated: false, error: "digite o que procurar" };
  if (q.length > MAX_QUERY) return { results: [], truncated: false, error: `busca longa demais (máx. ${MAX_QUERY} caracteres)` };
  if (typeof root !== "string" || !root || !isAbsolute(root)) return { results: [], truncated: false, error: "pasta do projeto inválida" };
  try { if (!(await stat(root)).isDirectory()) return { results: [], truncated: false, error: "a pasta do projeto não é uma pasta" }; }
  catch { return { results: [], truncated: false, error: "a pasta do projeto não existe nesta máquina" }; }
  if (active >= MAX_CONCURRENT) return { results: [], truncated: false, error: "já há buscas em andamento nesta máquina — tente de novo em instantes" };
  const o = {
    regex: opts.regex === true,
    caseSensitive: opts.caseSensitive === true,
    max: clampInt(opts.max, 200, 1, 1000),
    timeoutMs: clampInt(opts.timeoutMs, 10_000, 100, 60_000),
    maxFileSize: clampInt(opts.maxFileSize, 1024 * 1024, 1024, 16 * 1024 * 1024),
    maxBytes: clampInt(opts.maxBytes, 64 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    maxFiles: clampInt(opts.maxFiles, 50_000, 1, 1_000_000),
  };
  active++;
  try {
    const engine = opts.engine || "auto";
    const cmd = opts.rgPath || process.env.JARVIS_RG || "rg";
    const prefix = opts.rgPrefixArgs || [];
    const useRg = engine === "rg" || (engine === "auto" && await rgAvailable(cmd, prefix));
    if (engine === "rg" && !(await rgAvailable(cmd, prefix))) return { results: [], truncated: false, error: "ripgrep não encontrado nesta máquina" };
    const out = useRg ? await searchWithRg(root, q, o, cmd, prefix) : await searchWithWorker(root, q, o);
    out.results.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : a.line - b.line));
    return out;
  } finally {
    active--;
  }
}
