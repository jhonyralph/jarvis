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
  /** identidade declarada em `jarvis.pack.json` no pacote importado. Ausente = pacote sem manifesto:
   *  a origem ainda é conhecida (esta fonte), só não é auto-declarada pelo pacote. */
  pack?: { name: string; title?: string; version?: string };
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

/**
 * Origem de um arquivo do framework, do jeito que a interface mostra. A atribuição é por METADADO:
 * o disco continua plano (`skills/<nome>/SKILL.md`), e quem sabe de onde cada caminho veio é o
 * registro de fontes. Foi a escolha sobre namespear em disco (`skills/<pacote>/<nome>/`), que daria
 * origem definitiva mas quebraria a exportação nativa — a descoberta das IAs é de um nível só.
 */
export interface PackRef {
  /** slug do pacote (do manifesto) ou rótulo da fonte, quando não há manifesto. */
  name: string;
  title?: string;
  version?: string;
  /** true = o pacote se identificou via `jarvis.pack.json`; false = inferimos da fonte. */
  declared: boolean;
  sourceId: string;
  sourceType: FrameworkSourceType;
}

export function packOfSource(src: FrameworkSource): PackRef {
  if (src.pack?.name) {
    return { name: src.pack.name, title: src.pack.title, version: src.pack.version, declared: true, sourceId: src.id, sourceType: src.type };
  }
  return { name: src.label || src.id, declared: false, sourceId: src.id, sourceType: src.type };
}

/**
 * Índice reverso caminho → pacote. Um mesmo caminho pode ter sido contribuído por mais de uma fonte
 * (reimportou de outro lugar por cima); vence a importação MAIS RECENTE, que é o que está no disco.
 * Arquivo criado à mão no próprio Jarvis não aparece aqui — e é assim que a UI sabe dizer "local".
 */
export function buildPackIndex(sources: FrameworkSource[]): Record<string, PackRef> {
  const out: Record<string, PackRef> = {};
  for (const src of [...sources].sort((a, b) => a.updatedAt - b.updatedAt)) {
    const ref = packOfSource(src);
    for (const p of src.files ?? []) out[p] = ref;
  }
  return out;
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
