import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeJsonAtomic, type WriteJsonOpts } from "@jarvis/core";

export interface ExecutionOwnership {
  runnerId: string;
  rootExecutionId: string;
  principalId: string;
  claimedAt: number;
}

interface PersistedExecutionOwnership {
  version: 1;
  roots: ExecutionOwnership[];
}

type OwnershipWriter = (path: string, data: unknown, opts?: WriteJsonOpts) => void;

function keyOf(runnerId: string, rootExecutionId: string): string {
  return `${runnerId}\u0000${rootExecutionId}`;
}

function validId(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\u0000");
}

function load(file: string): PersistedExecutionOwnership {
  let found = false;
  let lastError: unknown;
  for (const path of [file, `${file}.bak`]) {
    if (!existsSync(path)) continue;
    found = true;
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!value || typeof value !== "object" || (value as any).version !== 1 || !Array.isArray((value as any).roots)) throw new Error("invalid execution ownership store");
      const roots = (value as any).roots.map((row: any): ExecutionOwnership => {
        if (!validId(row?.runnerId, 200) || !validId(row?.rootExecutionId) || !validId(row?.principalId, 200) || !Number.isFinite(row?.claimedAt) || row.claimedAt <= 0) {
          throw new Error("invalid execution ownership row");
        }
        return { runnerId: row.runnerId, rootExecutionId: row.rootExecutionId, principalId: row.principalId, claimedAt: row.claimedAt };
      });
      return { version: 1, roots };
    } catch (error) {
      lastError = error;
    }
  }
  if (found) throw new Error(`execution ownership store is corrupt: ${String((lastError as Error)?.message || lastError)}`);
  return { version: 1, roots: [] };
}

/** Persisted principal boundary for execution roots; missing ownership deliberately denies access. */
export class ExecutionOwnershipStore {
  private readonly roots = new Map<string, ExecutionOwnership>();

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    private readonly writer: OwnershipWriter = writeJsonAtomic,
  ) {
    for (const row of load(file).roots) {
      const key = keyOf(row.runnerId, row.rootExecutionId);
      const prior = this.roots.get(key);
      if (prior && prior.principalId !== row.principalId) throw new Error("conflicting persisted execution ownership");
      this.roots.set(key, row);
    }
    this.protectFiles();
  }

  get(runnerId: string, rootExecutionId: string): ExecutionOwnership | undefined {
    const row = this.roots.get(keyOf(runnerId, rootExecutionId));
    return row ? structuredClone(row) : undefined;
  }

  allows(runnerId: string, rootExecutionId: string, principalId: string): boolean {
    return this.roots.get(keyOf(runnerId, rootExecutionId))?.principalId === principalId;
  }

  hasOnRunner(runnerId: string, principalId: string): boolean {
    return [...this.roots.values()].some((row) => row.runnerId === runnerId && row.principalId === principalId);
  }

  claim(runnerId: string, rootExecutionId: string, principalId: string): ExecutionOwnership {
    if (!validId(runnerId, 200) || !validId(rootExecutionId) || !validId(principalId, 200)) throw new Error("invalid execution ownership");
    const key = keyOf(runnerId, rootExecutionId), existing = this.roots.get(key);
    if (existing) {
      if (existing.principalId !== principalId) throw new Error("execution belongs to another principal");
      return structuredClone(existing);
    }
    const row = { runnerId, rootExecutionId, principalId, claimedAt: this.now() };
    this.roots.set(key, row);
    try { this.save(); }
    catch (error) { this.roots.delete(key); throw error; }
    return structuredClone(row);
  }

  remove(runnerId: string, rootExecutionId: string): boolean {
    const key = keyOf(runnerId, rootExecutionId), row = this.roots.get(key);
    if (!row) return false;
    this.roots.delete(key);
    try { this.save(); }
    catch (error) { this.roots.set(key, row); throw error; }
    return true;
  }

  private save(): void {
    const roots = [...this.roots.values()].sort((left, right) => left.claimedAt - right.claimedAt);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    this.writer(this.file, { version: 1, roots } satisfies PersistedExecutionOwnership, { pretty: true });
    this.protectFiles();
  }

  private protectFiles(): void {
    try { chmodSync(dirname(this.file), 0o700); } catch { /* Windows and missing paths are best effort. */ }
    for (const path of [this.file, `${this.file}.bak`]) {
      try { chmodSync(path, 0o600); } catch { /* best effort */ }
    }
  }
}
