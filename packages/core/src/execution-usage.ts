import type { UsageRecord } from "@jarvis/protocol";

const DELTA_FIELDS = ["inputTokens", "cachedInputTokens", "outputTokens", "costUsd"] as const;

/** Convert a provider snapshot into a non-negative delta suitable for additive ledgers. Metadata
 * remains the current sample; an unchanged cumulative sample returns undefined. */
export function cumulativeUsageDelta(current: UsageRecord, previous?: UsageRecord): UsageRecord | undefined {
  const delta: UsageRecord = {
    costKind: current.costKind, source: current.source, model: current.model, effort: current.effort,
    contextTokens: current.contextTokens, contextWindowTokens: current.contextWindowTokens,
  };
  let nonZero = false;
  for (const key of DELTA_FIELDS) {
    const value = Math.max(0, Number(current[key] || 0) - Number(previous?.[key] || 0));
    if (value) { delta[key] = value; nonZero = true; }
  }
  return nonZero ? delta : undefined;
}
