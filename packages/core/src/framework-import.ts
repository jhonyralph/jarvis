/**
 * Import orchestration for Framework Jarvis. `buildImportPreview` is pure: it takes an extracted file
 * set and the current framework, and returns everything the owner needs to decide BEFORE anything
 * touches disk — the security scan, the structural validation, the token inventory, and the set of
 * files that would be overwritten. `applyFrameworkImport` is the only side-effecting step and runs
 * only after the owner confirms. Nothing here fetches from the network (see framework-github.ts).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { frameworkRoot, writeFrameworkFile, assertSafeRelPath, hashFrameworkFiles, type FrameworkFile } from "./framework.js";
import { scanFramework, type ScanReport } from "./framework-scan.js";
import { validateFramework, type ValidationReport } from "./framework-validate.js";
import { buildInventory, type Inventory } from "./framework-inventory.js";

export interface ImportPreview {
  /** the in-scope files that would be imported (already anchored, path-guarded, deduped). */
  files: FrameworkFile[];
  /** archive members rejected during extraction, with reasons. */
  skipped: string[];
  scan: ScanReport;
  validation: ValidationReport;
  /** token/size view of the incoming set (all reported `new` — it's a preview of what arrives). */
  inventory: Inventory;
  /** incoming paths that already exist in the current framework (overwritten in `overwrite` mode). */
  conflicts: string[];
  /** content hash of the incoming set — stored as source provenance for later update checks. */
  hash: string;
}

export function buildImportPreview(imported: FrameworkFile[], skipped: string[], current: FrameworkFile[]): ImportPreview {
  const curPaths = new Set(current.map((f) => f.path));
  const conflicts = imported.filter((f) => curPaths.has(f.path)).map((f) => f.path).sort();
  return {
    files: imported,
    skipped,
    scan: scanFramework(imported),
    validation: validateFramework(imported),
    inventory: buildInventory(imported),
    conflicts,
    hash: hashFrameworkFiles(imported),
  };
}

export type ImportMode = "overwrite" | "keep";
export interface ApplyResult { written: string[]; skippedExisting: string[] }

/**
 * Write imported files into the framework root. `keep` never clobbers an existing file (additive
 * merge); `overwrite` replaces on conflict (used by "update from source"). Path-guarded per file.
 */
export function applyFrameworkImport(files: FrameworkFile[], opts: { mode?: ImportMode; root?: string } = {}): ApplyResult {
  const mode = opts.mode ?? "overwrite";
  const root = opts.root ?? frameworkRoot();
  const written: string[] = [], skippedExisting: string[] = [];
  for (const f of files) {
    const safe = assertSafeRelPath(f.path);
    const abs = join(root, ...safe.split("/"));
    if (mode === "keep" && existsSync(abs)) { skippedExisting.push(safe); continue; }
    writeFrameworkFile(safe, f.content, root);
    written.push(safe);
  }
  return { written, skippedExisting };
}
