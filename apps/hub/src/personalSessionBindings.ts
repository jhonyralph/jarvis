import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeJsonAtomic, type WriteJsonOpts } from "@jarvis/core";

export interface PersonalSessionBinding {
  runnerId: string;
  sessionId: string;
  principalId: string;
  boundAt: number;
  generation: number;
}

export interface PersonalSessionGeneration {
  runnerId: string;
  sessionId: string;
  generation: number;
  principalId?: string;
}

interface PersistedBindingsV1 {
  version: 1;
  bindings: Array<Omit<PersonalSessionBinding, "generation"> & { generation?: number }>;
}

interface PersistedBindingsV2 {
  version: 2;
  bindings: PersonalSessionBinding[];
  generations: Array<{ runnerId: string; sessionId: string; generation: number }>;
}

type PersistedBindings = PersistedBindingsV1 | PersistedBindingsV2;
type BindingWriter = (path: string, data: unknown, opts?: WriteJsonOpts) => void;

function keyOf(runnerId: string, sessionId: string): string {
  return `${runnerId}\u0000${sessionId}`;
}

function validId(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\u0000");
}

function parsePersisted(text: string): PersistedBindings {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !Array.isArray((value as any).bindings)) throw new Error("invalid personal session binding store");
  if ((value as any).version === 1) return value as PersistedBindingsV1;
  if ((value as any).version === 2 && Array.isArray((value as any).generations)) return value as PersistedBindingsV2;
  throw new Error("unsupported personal session binding store");
}

function loadPersisted(file: string): PersistedBindingsV2 {
  const paths = [file, `${file}.bak`];
  let found = false;
  let lastError: unknown;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    found = true;
    try {
      const persisted = parsePersisted(readFileSync(path, "utf8"));
      const generations = new Map<string, { runnerId: string; sessionId: string; generation: number }>();
      if (persisted.version === 2) {
        for (const candidate of persisted.generations) {
          if (!validId(candidate?.runnerId, 200) || !validId(candidate?.sessionId) || !Number.isSafeInteger(candidate?.generation) || candidate.generation < 0) {
            throw new Error("invalid personal session generation");
          }
          generations.set(keyOf(candidate.runnerId, candidate.sessionId), { ...candidate });
        }
      }
      const bindings: PersonalSessionBinding[] = [];
      for (const candidate of persisted.bindings) {
        if (!validId(candidate?.runnerId, 200) || !validId(candidate?.sessionId) || !validId(candidate?.principalId, 200)) {
          throw new Error("invalid personal session binding row");
        }
        const generation = Number.isSafeInteger(candidate.generation) && Number(candidate.generation) > 0
          ? Number(candidate.generation)
          : Math.max(1, generations.get(keyOf(candidate.runnerId, candidate.sessionId))?.generation || 0);
        const row: PersonalSessionBinding = {
          runnerId: candidate.runnerId,
          sessionId: candidate.sessionId,
          principalId: candidate.principalId,
          boundAt: Number.isFinite(candidate.boundAt) && candidate.boundAt > 0 ? candidate.boundAt : Date.now(),
          generation,
        };
        bindings.push(row);
        generations.set(keyOf(row.runnerId, row.sessionId), { runnerId: row.runnerId, sessionId: row.sessionId, generation });
      }
      return { version: 2, bindings, generations: [...generations.values()] };
    } catch (error) {
      lastError = error;
    }
  }
  if (found) throw new Error(`personal session binding store is corrupt: ${String((lastError as Error)?.message || lastError)}`);
  return { version: 2, bindings: [], generations: [] };
}

/** Durable ownership boundary for conversations that have consumed personal context. */
export class PersonalSessionBindings {
  private readonly rows = new Map<string, PersonalSessionBinding>();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    private readonly writer: BindingWriter = writeJsonAtomic,
  ) {
    const persisted = loadPersisted(file);
    for (const candidate of persisted.generations) this.generations.set(keyOf(candidate.runnerId, candidate.sessionId), candidate.generation);
    for (const row of persisted.bindings) this.rows.set(keyOf(row.runnerId, row.sessionId), { ...row, boundAt: row.boundAt || this.now() });
    this.protectFiles();
  }

  get(runnerId: string, sessionId: string): PersonalSessionBinding | undefined {
    const row = this.rows.get(keyOf(runnerId, sessionId));
    return row ? structuredClone(row) : undefined;
  }

  capture(runnerId: string, sessionId: string): PersonalSessionGeneration {
    const key = keyOf(runnerId, sessionId), row = this.rows.get(key);
    return { runnerId, sessionId, generation: this.generations.get(key) || 0, principalId: row?.principalId };
  }

  matches(snapshot: PersonalSessionGeneration): boolean {
    const current = this.capture(snapshot.runnerId, snapshot.sessionId);
    return current.generation === snapshot.generation && current.principalId === snapshot.principalId;
  }

  allows(runnerId: string, sessionId: string, principalId: string): boolean {
    const row = this.rows.get(keyOf(runnerId, sessionId));
    return !row || row.principalId === principalId;
  }

  /** First claimant wins. A different principal can never rebind the same transcript. */
  claim(runnerId: string, sessionId: string, principalId: string): PersonalSessionBinding {
    return this.claimMany(runnerId, [sessionId], principalId)[0];
  }

  /** Atomically bind a managed session and every known native alias to one principal. */
  claimMany(runnerId: string, sessionIds: Iterable<string>, principalId: string): PersonalSessionBinding[] {
    if (!validId(runnerId, 200) || !validId(principalId, 200)) throw new Error("invalid personal session binding");
    const ids = [...new Set(sessionIds)];
    if (!ids.length || ids.some((sessionId) => !validId(sessionId))) throw new Error("invalid personal session binding");
    for (const sessionId of ids) {
      const existing = this.rows.get(keyOf(runnerId, sessionId));
      if (existing && existing.principalId !== principalId) throw new Error("personal session belongs to another user");
    }

    const previousRows = new Map(this.rows), previousGenerations = new Map(this.generations);
    let changed = false;
    try {
      for (const sessionId of ids) {
        const key = keyOf(runnerId, sessionId);
        if (this.rows.has(key)) continue;
        const generation = (this.generations.get(key) || 0) + 1;
        this.generations.set(key, generation);
        this.rows.set(key, { runnerId, sessionId, principalId, boundAt: this.now(), generation });
        changed = true;
      }
      if (changed) this.save();
    } catch (error) {
      this.restore(previousRows, previousGenerations);
      throw error;
    }
    return ids.map((sessionId) => structuredClone(this.rows.get(keyOf(runnerId, sessionId))!));
  }

  /** Invalidate a deleted session even when it was unbound, so stale async work cannot republish it. */
  remove(runnerId: string, sessionId: string): boolean {
    const key = keyOf(runnerId, sessionId), existed = this.rows.has(key);
    this.invalidateKeys([{ runnerId, sessionId, generation: this.generations.get(key) || 0, principalId: this.rows.get(key)?.principalId }]);
    return existed;
  }

  /** Apply a remote delete only if the ownership generation observed when it was requested still owns the key. */
  invalidateIfCurrent(snapshot: PersonalSessionGeneration): boolean {
    return this.invalidateManyIfCurrent([snapshot]).length === 1;
  }

  invalidateManyIfCurrent(snapshots: Iterable<PersonalSessionGeneration>): PersonalSessionGeneration[] {
    const current = [...new Map([...snapshots].map((snapshot) => [keyOf(snapshot.runnerId, snapshot.sessionId), snapshot])).values()]
      .filter((snapshot) => this.matches(snapshot));
    if (!current.length) return [];
    this.invalidateKeys(current);
    return current.map((snapshot) => ({ ...snapshot }));
  }

  private invalidateKeys(snapshots: PersonalSessionGeneration[]): void {
    for (const snapshot of snapshots) {
      if (!validId(snapshot.runnerId, 200) || !validId(snapshot.sessionId)) throw new Error("invalid personal session binding");
    }
    const previousRows = new Map(this.rows), previousGenerations = new Map(this.generations);
    try {
      for (const snapshot of snapshots) {
        const key = keyOf(snapshot.runnerId, snapshot.sessionId);
        this.rows.delete(key);
        this.generations.set(key, (this.generations.get(key) || 0) + 1);
      }
      this.save();
    } catch (error) {
      this.restore(previousRows, previousGenerations);
      throw error;
    }
  }

  private restore(rows: Map<string, PersonalSessionBinding>, generations: Map<string, number>): void {
    this.rows.clear();
    this.generations.clear();
    for (const [key, row] of rows) this.rows.set(key, row);
    for (const [key, generation] of generations) this.generations.set(key, generation);
  }

  private save(): void {
    const bindings = [...this.rows.values()].sort((left, right) => left.boundAt - right.boundAt);
    const generations = [...this.generations].map(([key, generation]) => {
      const separator = key.indexOf("\u0000");
      return { runnerId: key.slice(0, separator), sessionId: key.slice(separator + 1), generation };
    }).sort((left, right) => left.runnerId.localeCompare(right.runnerId) || left.sessionId.localeCompare(right.sessionId));
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    this.writer(this.file, { version: 2, bindings, generations } satisfies PersistedBindingsV2, { pretty: true });
    this.protectFiles();
  }

  private protectFiles(): void {
    try { chmodSync(dirname(this.file), 0o700); } catch { /* Windows and missing paths are best effort. */ }
    for (const path of [this.file, `${this.file}.bak`]) {
      try { chmodSync(path, 0o600); } catch { /* best effort */ }
    }
  }
}
