/**
 * Semantic memory — a tiny local vector store over your sessions, so "onde mexi no refresh de token
 * mês passado?" finds the session by MEANING, not just keywords. Fully local (embeddings come from a
 * local model in services/voice/embed.py). This module is the PURE store + cosine search + atomic
 * persistence; the embedding vectors are supplied by the caller (the Hub), so it's fully unit-testable
 * with no model.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, readJson } from "./persist.js";

export type MemoryScope = "project" | "personal" | "general";

export interface MemoryClassification {
  scope: MemoryScope;
  topic: string;
  namespaces: string[];
  projectKey?: string;
}

export interface MemoryEntry {
  /** stable id (e.g. the session id) — upsert replaces by id */
  id: string;
  sessionId: string;
  agent?: string;
  cwd?: string;
  title?: string;
  /** the text that was embedded (a digest of the session) — kept for snippet display */
  text: string;
  ts: number;
  /** the embedding vector */
  vec: number[];
  /** Queryable partitions, e.g. project:c:/repo, topic:recipe. */
  namespaces?: string[];
  /** Coarse partition used to avoid mixing project and personal memories. */
  scope?: MemoryScope;
  /** Deterministic topic hint such as project, recipe, sports, finance. */
  topic?: string;
  /** Normalized cwd-derived key for project and monorepo memories. */
  projectKey?: string;
}

export interface MemoryHit extends MemoryEntry { score: number; }

/** Cosine similarity in [-1, 1]. 0 when either vector is empty/zero. */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface MemorySearchOpts {
  topK?: number;
  /** minimum cosine score to include (default 0) */
  minScore?: number;
  /** restrict to entries whose cwd matches (exact) */
  cwd?: string;
  /** restrict to entries of this agent */
  agent?: string;
  /** restrict to entries that share at least one namespace */
  namespaces?: string[];
  /** restrict to a coarse scope */
  scope?: MemoryScope;
  /** restrict to a deterministic topic */
  topic?: string;
  /** restrict to a normalized project key */
  projectKey?: string;
}

const PROJECT_WORDS = [
  "repo", "repository", "monorepo", "branch", "commit", "pr", "pull request", "issue",
  "bug", "fix", "test", "typecheck", "deploy", "api", "endpoint", "schema", "migration",
  "typescript", "javascript", "python", "docker", "kubernetes", "frontend", "backend",
  "component", "function", "class", "module", "package", "workspace", "jarvis",
];
const TOPIC_WORDS: Array<[string, string[]]> = [
  ["recipe", ["receita", "cozinha", "ingrediente", "assar", "cozinhar", "panela", "forno", "bolo", "massa", "comida", "almoço", "jantar"]],
  ["sports", ["esporte", "futebol", "basquete", "jogo", "time", "campeonato", "placar", "gol", "nba", "nfl", "brasileirão"]],
  ["finance", ["finança", "investimento", "ação", "ações", "crypto", "cripto", "bitcoin", "preço", "mercado", "receita recorrente"]],
  ["travel", ["viagem", "hotel", "voo", "passagem", "roteiro", "aeroporto", "cidade", "restaurante"]],
  ["health", ["saúde", "médico", "remédio", "sintoma", "exame", "treino", "dieta"]],
];

export function normalizeMemoryNamespace(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\s+/g, " ").toLowerCase();
}

export function projectMemoryKey(cwd?: string): string | undefined {
  const key = normalizeMemoryNamespace(cwd || "");
  return key ? key.replace(/\/+$/, "") : undefined;
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function classifyMemoryText(input: { text: string; cwd?: string; namespaces?: string[] }): MemoryClassification {
  const text = normalizeMemoryNamespace(input.text);
  const explicit = (input.namespaces || []).map(normalizeMemoryNamespace).filter(Boolean);
  const projectKey = projectMemoryKey(input.cwd);
  const topic = TOPIC_WORDS.find(([, words]) => includesAny(text, words))?.[0] || (includesAny(text, PROJECT_WORDS) ? "project" : "general");
  const scope: MemoryScope = topic === "project" ? "project" : topic === "general" ? "general" : "personal";
  const namespaces = new Set<string>(explicit);
  namespaces.add(`scope:${scope}`);
  namespaces.add(`topic:${topic}`);
  if (projectKey && scope === "project") namespaces.add(`project:${projectKey}`);
  return { scope, topic, namespaces: [...namespaces], projectKey: scope === "project" ? projectKey : undefined };
}

function normalizeEntry(e: MemoryEntry): MemoryEntry {
  const classification = classifyMemoryText({ text: e.text || "", cwd: e.cwd, namespaces: e.namespaces });
  return {
    ...e,
    namespaces: classification.namespaces,
    scope: e.scope || classification.scope,
    topic: e.topic || classification.topic,
    projectKey: e.projectKey || classification.projectKey,
  };
}

export class MemoryStore {
  private data: MemoryEntry[] = [];
  private readonly file: string;
  constructor(dir?: string) {
    this.file = join(dir || join(process.env.JARVIS_HOME || homedir(), ".jarvis"), "memory.json");
    this.data = readJson<MemoryEntry[]>(this.file, []).filter((e) => e && Array.isArray(e.vec)).map(normalizeEntry);
  }

  /** Add or replace an entry by id. */
  upsert(e: MemoryEntry): void {
    e = normalizeEntry(e);
    const i = this.data.findIndex((x) => x.id === e.id);
    if (i >= 0) this.data[i] = e; else this.data.push(e);
    this.flush();
  }
  /** Bulk upsert (single flush) — used by a reindex. */
  upsertMany(entries: MemoryEntry[]): void {
    for (const raw of entries) { const e = normalizeEntry(raw); const i = this.data.findIndex((x) => x.id === e.id); if (i >= 0) this.data[i] = e; else this.data.push(e); }
    this.flush();
  }
  removeSession(sessionId: string): void {
    const before = this.data.length;
    this.data = this.data.filter((e) => e.sessionId !== sessionId);
    if (this.data.length !== before) this.flush();
  }
  has(id: string): boolean { return this.data.some((e) => e.id === id); }
  size(): number { return this.data.length; }
  ids(): Set<string> { return new Set(this.data.map((e) => e.id)); }

  /** Cosine top-K over the query vector, newest-first as the tiebreak, with optional filters. */
  search(vec: number[], opts: MemorySearchOpts = {}): MemoryHit[] {
    const topK = opts.topK ?? 8, minScore = opts.minScore ?? 0;
    const namespaces = (opts.namespaces || []).map(normalizeMemoryNamespace).filter(Boolean);
    const hits: MemoryHit[] = [];
    for (const e of this.data) {
      if (opts.cwd && e.cwd !== opts.cwd) continue;
      if (opts.agent && e.agent !== opts.agent) continue;
      if (opts.scope && e.scope !== opts.scope) continue;
      if (opts.topic && e.topic !== opts.topic) continue;
      if (opts.projectKey && e.projectKey !== projectMemoryKey(opts.projectKey)) continue;
      if (namespaces.length && !namespaces.some((ns) => (e.namespaces || []).includes(ns))) continue;
      const score = cosine(vec, e.vec);
      if (score >= minScore) hits.push({ ...e, score });
    }
    hits.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
    return hits.slice(0, topK);
  }

  private flush(): void { writeJsonAtomic(this.file, this.data); }
}
