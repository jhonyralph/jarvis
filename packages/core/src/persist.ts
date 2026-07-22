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
} from "node:fs";
import { dirname } from "node:path";

export interface WriteJsonOpts {
  /** pretty-print with 2-space indent (matches the old `JSON.stringify(x, null, 2)` calls) */
  pretty?: boolean;
  /** keep a `.bak` copy of the previous good file before replacing (default true) */
  backup?: boolean;
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
  if (opts?.backup !== false && existsSync(path)) {
    try { copyFileSync(path, path + ".bak"); } catch { /* best-effort backup */ }
  }
  renameSync(tmp, path);
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
  if (opts?.backup !== false && existsSync(path)) {
    try { copyFileSync(path, path + ".bak"); } catch { /* best-effort backup */ }
  }
  renameSync(tmp, path); // atomic replace (Node maps this to MoveFileEx replace on Windows)
}

/**
 * Read + parse JSON with layered fallback: primary file → `.bak` → caller default. A truncated or
 * hand-corrupted primary therefore degrades to the last good snapshot instead of to "empty",
 * which is the whole point — losing one write is survivable, losing the file is not.
 */
export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    try {
      if (existsSync(path + ".bak")) return JSON.parse(readFileSync(path + ".bak", "utf8")) as T;
    } catch { /* fall through to default */ }
    return fallback;
  }
}

/** True if a usable JSON snapshot (primary or backup) exists on disk for `path`. */
export function jsonExists(path: string): boolean {
  return existsSync(path) || existsSync(path + ".bak");
}
