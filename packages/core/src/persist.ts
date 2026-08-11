/**
 * Atomic JSON persistence — the durability primitive shared by the Hub, Runner and core.
 *
 * The problem it fixes: the codebase persisted state with bare `writeFileSync(path, JSON…)`.
 * A crash mid-write leaves a truncated file; the next load JSON.parse-throws, falls back to
 * "empty", and the following write overwrites the file with that empty — silent, total data
 * loss with no recovery. This module makes every write **crash-safe**:
 *
 *   1. write to `path.tmp`, flush it to disk (fsync),
 *   2. keep the last good file as `path.bak` (optional, on by default),
 *   3. atomically `rename(tmp -> path)` — on the same volume this is all-or-nothing, so a
 *      reader ever only sees the complete old file or the complete new one, never a partial.
 *
 * `readJson` mirrors it: on a corrupt/missing primary it transparently falls back to `.bak`,
 * then to the caller's default — so a single bad file can't wipe state.
 *
 * No new dependencies (Node fs only) and drop-in: `writeJsonAtomic(path, obj)` replaces
 * `writeFileSync(path, JSON.stringify(obj))` one-for-one.
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  fsyncSync,
  openSync,
  closeSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * Windows-hardened atomic rename. `rename(tmp -> path)` maps to MoveFileEx-with-replace, which on
 * Windows fails with a TRANSIENT EPERM/EACCES/EBUSY when antivirus (Defender), Search indexer, a
 * backup agent, or a file watcher is holding a momentary handle on `path` — exactly what was seen
 * corrupting the Hub's session persistence ("erro ao processar send - EPERM ... rename"). A bare
 * `renameSync` throws on the first collision and loses the write. We retry with a short synchronous
 * backoff (Atomics.wait — real sleep, no CPU spin); the handle is virtually always released within a
 * few ms. Non-transient errors (e.g. ENOENT, cross-device) rethrow immediately.
 */
function renameSyncWithRetry(tmp: string, path: string, tries = 12, delayMs = 15): void {
  const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (attempt >= tries || !code || !TRANSIENT.has(code)) throw err;
      Atomics.wait(sleeper, 0, 0, delayMs); // synchronous, interrupt-free backoff
    }
  }
}

export interface WriteJsonOpts {
  /** pretty-print with 2-space indent (matches the old `JSON.stringify(x, null, 2)` calls) */
  pretty?: boolean;
  /** keep a `.bak` copy of the previous good file before replacing (default true) */
  backup?: boolean;
}

/**
 * Último conteúdo que ESTE processo escreveu com sucesso, por caminho. O `.bak` é promovido a partir
 * daqui em vez de copiar o primário às cegas: se algo externo (antivírus, indexador, edição manual —
 * a mesma classe de interferência que motivou o retry de rename acima) corromper o primário, a
 * escrita seguinte copiaria o lixo POR CIMA do último backup bom, destruindo a rede de segurança
 * justamente quando ela é necessária. Limitado por tamanho para não segurar arquivos grandes na RAM.
 */
const lastGood = new Map<string, string>();
const LAST_GOOD_MAX_BYTES = 512 * 1024;

/** Grava o `.bak` sem confiar no primário: usa o último conteúdo bom conhecido; na falta dele (1ª
 *  escrita após o boot) copia o primário apenas se ele ainda for JSON legível. */
function backupPrevious(path: string, validate: boolean): void {
  const cached = lastGood.get(path);
  if (cached !== undefined) {
    try { writeFileSync(path + ".bak", cached); } catch { /* best-effort backup */ }
    return;
  }
  if (!existsSync(path)) return;
  if (validate) {
    try { JSON.parse(readFileSync(path, "utf8")); }
    catch { return; } // primário ilegível → preserva o .bak anterior em vez de envenená-lo
  }
  try { copyFileSync(path, path + ".bak"); } catch { /* best-effort backup */ }
}
function rememberGood(path: string, content: string): void {
  if (content.length <= LAST_GOOD_MAX_BYTES) lastGood.set(path, content);
  else lastGood.delete(path);
}

export interface WriteTextOpts {
  /** keep a `.bak` copy of the previous good file before replacing (default true) */
  backup?: boolean;
}

/** Crash-safe UTF-8 text write with the same durability guarantees as writeJsonAtomic. */
export function writeTextAtomic(path: string, text: string, opts?: WriteTextOpts): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (opts?.backup !== false) backupPrevious(path, false); // texto livre: não dá para validar por parse
  renameSyncWithRetry(tmp, path);
  if (opts?.backup !== false) rememberGood(path, text);
}

/**
 * Crash-safe JSON write: temp file + fsync + atomic rename, with an optional `.bak` of the
 * previous good contents. Creates the parent directory if missing. Throws only on a real IO
 * failure the caller should know about (the old bare writes swallowed everything in a `catch {}`;
 * prefer wrapping the call if best-effort semantics are wanted, but at least the *file* is safe).
 */
export function writeJsonAtomic(path: string, data: unknown, opts?: WriteJsonOpts): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(data, null, opts?.pretty ? 2 : undefined);
  const tmp = path + ".tmp";
  // Write the temp file and force it to physical disk before we swap it in. Without the fsync a
  // power loss right after rename could leave the directory entry pointing at still-buffered
  // (zero-length) data on some filesystems.
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Preserve the last good file. Done BEFORE the rename so a crash here still leaves `path` intact.
  if (opts?.backup !== false) backupPrevious(path, true);
  renameSyncWithRetry(tmp, path); // atomic replace (Node maps this to MoveFileEx replace on Windows), retried on transient Windows locks
  if (opts?.backup !== false) rememberGood(path, json);
}

/**
 * Read + parse JSON with layered fallback: primary file → `.bak` → caller default. A truncated or
 * hand-corrupted primary therefore degrades to the last good snapshot instead of to "empty",
 * which is the whole point — losing one write is survivable, losing the file is not.
 */
export interface ReadJsonOpts {
  /** aceitar o `.bak` quando o primário falha (default true). Passe false onde estado VELHO é pior
   *  que vazio — ex.: turnos pendentes, que reentregues rodariam de novo (crédito/ação duplicada). */
  allowStale?: boolean;
  /** chamado quando o `.bak` foi (ou seria) usado — o fallback era 100% silencioso antes. */
  onFallback?: (info: { path: string; used: boolean }) => void;
}

export function readJson<T>(path: string, fallback: T, opts?: ReadJsonOpts): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    const bak = path + ".bak";
    if (existsSync(bak)) {
      const allow = opts?.allowStale !== false;
      try {
        const parsed = allow ? (JSON.parse(readFileSync(bak, "utf8")) as T) : undefined;
        const used = allow;
        try { (opts?.onFallback ?? defaultFallbackNotice)({ path, used }); } catch { /* nunca quebrar a leitura */ }
        if (used) return parsed as T;
      } catch { /* .bak também ruim → default */ }
    }
    return fallback;
  }
}
/** Sem isto o fallback é invisível: ninguém descobre que rodou com um snapshot antigo. */
function defaultFallbackNotice(info: { path: string; used: boolean }): void {
  console.warn(info.used
    ? `[persist] ${info.path} ilegível — recuperado do .bak (estado pode estar defasado)`
    : `[persist] ${info.path} ilegível — .bak IGNORADO por política (estado velho seria pior); seguindo com o padrão`);
}

/**
 * Faxina de resíduos: remove `.bak`/`.tmp` ÓRFÃOS (cujo arquivo principal não existe mais) e `.tmp`
 * esquecidos por uma escrita interrompida. Nunca toca num `.bak` cujo primário existe — esse é a
 * própria rede de segurança. Retorna os caminhos removidos.
 */
export function cleanupOrphanBackups(dir: string, opts: { minAgeMs?: number; now?: () => number } = {}): string[] {
  const minAge = opts.minAgeMs ?? 24 * 60 * 60 * 1000;
  const now = (opts.now ?? Date.now)();
  const removed: string[] = [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    const isBak = name.endsWith(".bak"), isTmp = name.endsWith(".tmp");
    if (!isBak && !isTmp) continue;
    const full = join(dir, name);
    const primary = full.slice(0, -4);
    if (existsSync(primary)) { if (!isTmp) continue; }        // .bak com primário vivo = rede de segurança
    try {
      // Idade com piso em 0: no Windows o mtime de um arquivo recém-criado pode vir alguns décimos de
      // ms À FRENTE do relógio lido depois, e uma idade negativa faria o arquivo ser pulado para sempre.
      const age = Math.max(0, now - statSync(full).mtimeMs);
      if (age < minAge) continue;                              // recém-escrito: pode ser escrita em curso
      rmSync(full, { force: true });
      removed.push(full);
    } catch { /* best effort */ }
  }
  return removed;
}

/** True if a usable JSON snapshot (primary or backup) exists on disk for `path`. */
export function jsonExists(path: string): boolean {
  return existsSync(path) || existsSync(path + ".bak");
}
