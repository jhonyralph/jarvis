/**
 * Single source of truth for the app version: the root package.json `version`. Read once at import
 * (the repo runs from source via tsx, so the file is always on disk next to us). `scripts/release`
 * bumps that one field and everything — /health, the runner register info, the MCP server banner —
 * follows. Falls back to "0.0.0" if the file can't be read, so it never throws at boot.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const VERSION: string = (() => {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."); // packages/core/src -> repo root
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
