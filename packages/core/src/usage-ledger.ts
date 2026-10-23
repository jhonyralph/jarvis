import { readJson, writeJsonAtomic } from "./persist.js";
import type { CostKind, UsageRecord } from "./agent-contract.js";

export interface UsageLedgerEntry extends UsageRecord {
  sessionId: string;
  runnerId?: string;
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
  effort?: string;
  byKind: Partial<Record<CostKind, number>>;
}

/** `source` que o adaptador do Claude gravava antes de JRV-42, quando o custo era o acumulado da sessão. */
const CLAUDE_LEGACY_CUMULATIVE_SOURCE = "Claude Code result.total_cost_usd";
/** Id de sessão de conversa do Jarvis (uuid, ou `claude:<uuid>` para sessão nativa importada). */
const CONVERSATION_SESSION_ID = /^(?:claude:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const key = `${e.runnerId || "legacy"}\0${e.sessionId}`;
      const current = { cost: e.costUsd || 0, input: e.inputTokens || 0, cached: e.cachedInputTokens || 0, output: e.outputTokens || 0 }, prev = codexTotals.get(key);
      codexTotals.set(key, current);
      if (prev) { e.costUsd = Math.max(0, current.cost - prev.cost); e.inputTokens = Math.max(0, current.input - prev.input); e.cachedInputTokens = Math.max(0, current.cached - prev.cached); e.outputTokens = Math.max(0, current.output - prev.output); }
      e.contextTokens = undefined; e.contextWindowTokens = undefined; e.source = "migrated Codex cumulative snapshot → delta";
    }
    // Mesmo defeito no Claude, até JRV-42: o adaptador gravava `result.total_cost_usd` como custo do
    // turno, mas a CLI RESTAURA o custo da sessão nativa no `--resume` — o número é acumulado. Medido
    // na sessão 9ecf7b75 (2026-10-19): 1,47 → 4,99 → 15,67 → 36,97 → 36,97, somados como US$ 96,07
    // para uma sessão que custou US$ 36,97. Converte os registros ANTIGOS (pela `source` antiga, que o
    // adaptador não grava mais) em diferenças por sessão. Total que CAI é sessão nativa nova (a CLI
    // começou do zero): o próprio total é o turno. Só sessões de conversa (id uuid) entram — os
    // pseudo-ids (`__summary__`, `voice`, `__debate__:…`) são one-shots independentes, não acumulados.
    const claudeTotals = new Map<string, number>();
    for (const e of this.entries) if (e.agent === "claude-code" && e.source === CLAUDE_LEGACY_CUMULATIVE_SOURCE && CONVERSATION_SESSION_ID.test(e.sessionId) && e.costUsd !== undefined) {
      const key = `${e.runnerId || "legacy"}\0${e.sessionId}`;
      const current = Number(e.costUsd) || 0, prev = claudeTotals.get(key);
      claudeTotals.set(key, current);
      if (prev !== undefined) e.costUsd = current >= prev ? current - prev : current;
      e.source = "migrated Claude cumulative total_cost_usd → delta";
    }
    this.trim(now);
  }
  record(sessionId: string, agent: string, usage?: Partial<UsageRecord>, runnerId?: string): void {
    if (!usage) return;
    const hasValue = [usage.costUsd, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens].some((v) => Number(v) > 0);
    if (!hasValue) return;
    this.entries.push({ sessionId, runnerId, agent, at: Date.now(), costKind: usage.costKind || "unavailable", source: usage.source || "adapter did not declare source", model: usage.model, effort: usage.effort, costUsd: finite(usage.costUsd), inputTokens: finite(usage.inputTokens), cachedInputTokens: finite(usage.cachedInputTokens), outputTokens: finite(usage.outputTokens), contextTokens: finite(usage.contextTokens), contextWindowTokens: finite(usage.contextWindowTokens) });
    this.trim(Date.now()); this.flush();
  }
  session(sessionId: string, runnerId?: string): UsageRollup {
    return roll(this.entries.filter((e) => e.sessionId === sessionId && (runnerId === undefined || e.runnerId === runnerId)));
  }
  total(): UsageRollup { return roll(this.entries); }
  byAgent(resolveAgent: (sessionId: string, recordedAgent: string, runnerId?: string) => string = (_sessionId, agent) => agent): Record<string, UsageRollup> {
    const grouped: Record<string, UsageLedgerEntry[]> = {};
    for (const entry of this.entries) (grouped[resolveAgent(entry.sessionId, entry.agent, entry.runnerId)] ||= []).push(entry);
    return Object.fromEntries(Object.entries(grouped).map(([agent, values]) => [agent, roll(values)]));
  }
  topSessions(limit = 6, resolveAgent: (sessionId: string, recordedAgent: string, runnerId?: string) => string = (_sessionId, agent) => agent): Array<{ id: string; runnerId: string; agent: string; usage: UsageRollup }> {
    const grouped = new Map<string, UsageLedgerEntry[]>();
    for (const e of this.entries) { const key = `${e.runnerId || "legacy"}\0${e.sessionId}`, list = grouped.get(key) || []; list.push(e); grouped.set(key, list); }
    return [...grouped.values()].map((values) => {
      const latest = values.at(-1)!;
      return { id: latest.sessionId, runnerId: latest.runnerId || "legacy", agent: resolveAgent(latest.sessionId, latest.agent || "unknown", latest.runnerId), usage: roll(values) };
    }).sort((a, b) => b.usage.costUsd - a.usage.costUsd).slice(0, limit);
  }
  private trim(now: number): void { this.entries = this.entries.filter((e) => now - e.at < this.ttlMs).slice(-this.maxEntries); }
  // Sem `.bak`: este arquivo é reescrito INTEIRO a cada registro de uso (todo turno) e chega a MBs —
  // a cópia integral síncrona do backup dobrava o I/O e travava o event loop. A escrita já é atômica
  // (tmp+fsync+rename), e o ledger é histórico de custo aparado: perder a última escrita é aceitável.
  private flush(): void { writeJsonAtomic(this.file, this.entries, { backup: false }); }
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
  const latest = entries.at(-1); if (latest) { out.contextTokens = latest.contextTokens; out.contextWindowTokens = latest.contextWindowTokens; out.model = latest.model; out.effort = latest.effort; }
  return out;
}
