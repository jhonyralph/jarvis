import { lstatSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Crash leftovers only: never recurse, follow links or remove a clip still being processed. */
export function cleanVoiceTemps(dir: string, now = Date.now()): number {
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!/^jarvis_(?:stt_\d+_\d+|spk_[a-f0-9-]{36}|wake_\d+_[a-f0-9]+)\.[a-z0-9]{1,5}$/i.test(name)) continue;
    try {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isFile() && !stat.isSymbolicLink() && now - stat.mtimeMs > 3_600_000) { unlinkSync(path); removed++; }
    } catch { /* a concurrent cleanup/process may have removed it */ }
  }
  return removed;
}
