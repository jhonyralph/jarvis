/**
 * Provenance of imported Framework Jarvis packs, so the owner can later "buscar atualização" against
 * the same GitHub source and see exactly what drifted. One record per source, keyed stably by origin.
 * Stored as atomic JSON under ~/.jarvis (same durability as the rest of the Hub state).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./persist.js";

export type FrameworkSourceType = "github" | "zip" | "native";

export interface FrameworkSource {
  id: string;
  type: FrameworkSourceType;
  owner?: string;
  repo?: string;
  ref?: string;
  subdir?: string;
  /** commit sha of the last import (github). */
  commit?: string;
  /** native: the provider the skill/command came from (claude, codex, cursor…). */
  provider?: string;
  /** native: whether the origin is a provider skill or a command file. */
  kind?: "skill" | "command";
  /** native: the catalog entry id (`${provider}:${kind}:${name}`) used to re-collect on drift check. */
  entryId?: string;
  /** human label for the UI (native skill/command name; zip filename). */
  label?: string;
  /** whether the daily job re-checks this source for drift and raises an "update available" alert. */
  autoUpdate?: boolean;
  /** content hash of the file set last imported from this source (drift detection). */
  hash: string;
  /** framework paths this source contributed at last import. */
  files: string[];
  importedAt: number;
  updatedAt: number;
}

/** Stable id so re-importing the same repo/subdir updates the record instead of duplicating it. */
export function githubSourceId(owner: string, repo: string, subdir?: string): string {
  return `gh:${owner}/${repo}${subdir ? `/${subdir}` : ""}`.toLowerCase();
}
export function zipSourceId(name: string): string {
  return `zip:${name}`.toLowerCase();
}
/** Stable id for a native provider skill/command imported into the universal framework. `entryId` is
 *  the catalog id (`${provider}:${kind}:${name}`), so re-importing the same skill updates the record. */
export function nativeSourceId(entryId: string): string {
  return `native:${entryId}`.toLowerCase();
}

export class FrameworkSourceStore {
  readonly path: string;
  constructor(dir = join(process.env.JARVIS_HOME || homedir(), ".jarvis")) {
    this.path = join(dir, "framework-sources.json");
  }
  all(): Record<string, FrameworkSource> {
    return readJson<Record<string, FrameworkSource>>(this.path, {});
  }
  list(): FrameworkSource[] {
    return Object.values(this.all()).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  get(id: string): FrameworkSource | null {
    return this.all()[id] ?? null;
  }
  upsert(src: FrameworkSource): void {
    const all = this.all();
    all[src.id] = src;
    writeJsonAtomic(this.path, all, { pretty: true });
  }
  remove(id: string): boolean {
    const all = this.all();
    if (!all[id]) return false;
    delete all[id];
    writeJsonAtomic(this.path, all, { pretty: true });
    return true;
  }
}
