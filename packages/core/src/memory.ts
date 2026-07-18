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
}

export class MemoryStore {
  private data: MemoryEntry[] = [];
  private readonly file: string;
  constructor(dir?: string) {
    this.file = join(dir || join(process.env.JARVIS_HOME || homedir(), ".jarvis"), "memory.json");
    this.data = readJson<MemoryEntry[]>(this.file, []).filter((e) => e && Array.isArray(e.vec));
  }

  /** Add or replace an entry by id. */
  upsert(e: MemoryEntry): void {
    const i = this.data.findIndex((x) => x.id === e.id);
    if (i >= 0) this.data[i] = e; else this.data.push(e);
    this.flush();
  }
  /** Bulk upsert (single flush) — used by a reindex. */
  upsertMany(entries: MemoryEntry[]): void {
    for (const e of entries) { const i = this.data.findIndex((x) => x.id === e.id); if (i >= 0) this.data[i] = e; else this.data.push(e); }
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
    const hits: MemoryHit[] = [];
    for (const e of this.data) {
      if (opts.cwd && e.cwd !== opts.cwd) continue;
      if (opts.agent && e.agent !== opts.agent) continue;
      const score = cosine(vec, e.vec);
      if (score >= minScore) hits.push({ ...e, score });
    }
    hits.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
    return hits.slice(0, topK);
  }

  private flush(): void { writeJsonAtomic(this.file, this.data); }
}
