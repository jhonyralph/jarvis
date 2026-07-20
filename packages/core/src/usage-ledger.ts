import { readJson, writeJsonAtomic } from "./persist.js";
import type { CostKind, UsageRecord } from "./agent-contract.js";

export interface UsageLedgerEntry extends UsageRecord {
  sessionId: string;
  agent: string;
  at: number;
}

export interface UsageRollup {
  costUsd: number;
  billableUsd: number;
  estimatedUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  contextTokens?: number;
  contextWindowTokens?: number;
  model?: string;
  byKind: Partial<Record<CostKind, number>>;
}

const emptyRollup = (): UsageRollup => ({ costUsd: 0, billableUsd: 0, estimatedUsd: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, byKind: {} });

/** Typed, append-only usage ledger. Cost classes never collapse into a single billable number. */
export class UsageLedger {
  private entries: UsageLedgerEntry[] = [];
  constructor(private readonly file: string, private readonly maxEntries = 5000, private readonly ttlMs = 30 * 24 * 3600_000) {
    const raw = readJson<unknown>(file, []);
    const now = Date.now();
    if (Array.isArray(raw)) this.entries = raw.filter((e): e is UsageLedgerEntry => !!e && typeof e === "object" && typeof (e as any).sessionId === "string" && now - Number((e as any).at || 0) < ttlMs);
    else if (raw && typeof raw === "object") {
      // v1 migration: { sessionId:{cost,ts} }. Classification was unknowable, so preserve it as
      // unavailable rather than rewriting historical estimates as billed spend.
      for (const [sessionId, value] of Object.entries(raw as Record<string, any>)) if (Number(value?.cost) > 0) this.entries.push({ sessionId, agent: "unknown", at: Number(value.ts || now), costUsd: Number(value.cost), costKind: "unavailable", source: "legacy session-cost.json" });
    }
    // Before the canonical Codex telemetry fix, `turn.completed.usage` was cumulative for the
    // whole native thread and every snapshot was appended as a new turn. Convert repeated
    // snapshots to deltas in memory so totals are not multiplied. The first observed snapshot is
    // retained as the historical baseline; subsequent entries become non-negative differences.
    const codexTotals = new Map<string, { cost: number; input: number; cached: number; output: number }>();
    for (const e of this.entries) if (e.agent === "codex" && /codex exec --json tokens ×/i.test(e.source || "")) {
      const current = { cost: e.costUsd || 0, input: e.inputTokens || 0, cached: e.cachedInputTokens || 0, output: e.outputTokens || 0 }, prev = codexTotals.get(e.sessionId);
      codexTotals.set(e.sessionId, current);
      if (prev) { e.costUsd = Math.max(0, current.cost - prev.cost); e.inputTokens = Math.max(0, current.input - prev.input); e.cachedInputTokens = Math.max(0, current.cached - prev.cached); e.outputTokens = Math.max(0, current.output - prev.output); }
      e.contextTokens = undefined; e.contextWindowTokens = undefined; e.source = "migrated Codex cumulative snapshot → delta";
    }
    this.trim(now);
  }
  record(sessionId: string, agent: string, usage?: Partial<UsageRecord>): void {
    if (!usage) return;
    const hasValue = [usage.costUsd, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens].some((v) => Number(v) > 0);
    if (!hasValue) return;
    this.entries.push({ sessionId, agent, at: Date.now(), costKind: usage.costKind || "unavailable", source: usage.source || "adapter did not declare source", model: usage.model, costUsd: finite(usage.costUsd), inputTokens: finite(usage.inputTokens), cachedInputTokens: finite(usage.cachedInputTokens), outputTokens: finite(usage.outputTokens), contextTokens: finite(usage.contextTokens), contextWindowTokens: finite(usage.contextWindowTokens) });
    this.trim(Date.now()); this.flush();
  }
  session(sessionId: string): UsageRollup { return roll(this.entries.filter((e) => e.sessionId === sessionId)); }
  total(): UsageRollup { return roll(this.entries); }
  byAgent(resolveAgent: (sessionId: string, recordedAgent: string) => string = (_sessionId, agent) => agent): Record<string, UsageRollup> {
    const grouped: Record<string, UsageLedgerEntry[]> = {};
    for (const entry of this.entries) (grouped[resolveAgent(entry.sessionId, entry.agent)] ||= []).push(entry);
    return Object.fromEntries(Object.entries(grouped).map(([agent, values]) => [agent, roll(values)]));
  }
  topSessions(limit = 6, resolveAgent: (sessionId: string, recordedAgent: string) => string = (_sessionId, agent) => agent): Array<{ id: string; agent: string; usage: UsageRollup }> {
    const grouped = new Map<string, UsageLedgerEntry[]>();
    for (const e of this.entries) { const list = grouped.get(e.sessionId) || []; list.push(e); grouped.set(e.sessionId, list); }
    return [...grouped.entries()].map(([id, values]) => ({ id, agent: resolveAgent(id, values.at(-1)?.agent || "unknown"), usage: roll(values) })).sort((a, b) => b.usage.costUsd - a.usage.costUsd).slice(0, limit);
  }
  private trim(now: number): void { this.entries = this.entries.filter((e) => now - e.at < this.ttlMs).slice(-this.maxEntries); }
  private flush(): void { writeJsonAtomic(this.file, this.entries); }
}

function finite(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : undefined; }
function roll(entries: UsageLedgerEntry[]): UsageRollup {
  const out = emptyRollup();
  for (const e of entries) {
    out.inputTokens += e.inputTokens || 0; out.cachedInputTokens += e.cachedInputTokens || 0; out.outputTokens += e.outputTokens || 0;
    const cost = e.costUsd || 0; out.costUsd += cost; out.byKind[e.costKind] = (out.byKind[e.costKind] || 0) + cost;
    if (e.costKind === "billed") out.billableUsd += cost;
    else if (e.costKind === "estimated_api_equivalent") out.estimatedUsd += cost;
  }
  const latest = entries.at(-1); if (latest) { out.contextTokens = latest.contextTokens; out.contextWindowTokens = latest.contextWindowTokens; out.model = latest.model; }
  return out;
}
