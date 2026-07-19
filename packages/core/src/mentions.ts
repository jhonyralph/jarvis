/**
 * "@" file-mention search — a bounded fuzzy file finder rooted at the session's cwd, so the composer
 * can offer paths to reference (inserted as text; the agent reads them with its own Read tool). Runs
 * on the machine that owns the session. Deliberately bounded (depth + total files scanned) so a huge
 * repo can't stall the walk, and skips the usual heavy/uninteresting dirs.
 */
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".venv", "venv", "__pycache__",
  ".next", ".turbo", ".cache", "coverage", ".idea", ".vscode", "vendor", "target",
]);

/** Relative (forward-slash) paths under `cwd` whose path contains `query` (case-insensitive). Bounded
 *  to `limit` hits and a hard scan cap; basename matches and shorter paths rank first. */
export function listMentionFiles(cwd: string, query = "", limit = 40): string[] {
  if (!cwd) return [];
  const q = query.toLowerCase();
  const out: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: cwd, depth: 0 }];
  let scanned = 0;
  while (stack.length && out.length < limit && scanned < 10000) {
    const { dir, depth } = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth < 8 && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) stack.push({ dir: join(dir, e.name), depth: depth + 1 });
        continue;
      }
      if (!e.isFile()) continue;
      scanned++;
      const rel = relative(cwd, join(dir, e.name)).split(sep).join("/");
      if (!q || rel.toLowerCase().includes(q)) out.push(rel);
      if (out.length >= limit) break;
    }
  }
  out.sort((a, b) => {
    const ab = (a.split("/").pop() || "").toLowerCase().includes(q) ? 0 : 1;
    const bb = (b.split("/").pop() || "").toLowerCase().includes(q) ? 0 : 1;
    return ab - bb || a.length - b.length || a.localeCompare(b);
  });
  return out.slice(0, limit);
}
