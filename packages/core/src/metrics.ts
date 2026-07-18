/**
 * In-memory rolling telemetry for turn latency + error rate, per runner and overall. It is a LIVE
 * dashboard signal (a bounded window, oldest dropped), NOT durable history — it resets on restart,
 * which is fine: the fleet view wants "how are turns doing right now", not an audit trail. Kept pure
 * (no I/O, no clock of its own — the caller passes ts) so it's trivially unit-testable.
 */
export interface TurnSample {
  runnerId: string;
  /** wall-clock duration of the turn in ms */
  ms: number;
  /** true = completed, false = errored (cancelled turns are NOT recorded — a user abort is neither) */
  ok: boolean;
  ts: number;
}

export interface RunnerMetric {
  runnerId: string;
  turns: number;
  errors: number;
  errorRate: number; // 0..1
  avgMs: number;
  p50ms: number;
  p95ms: number;
  lastTs: number;
}

/** Nearest-rank percentile over an ASCENDING-sorted array (p in 0..1). Empty → 0. */
export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.ceil(p * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, idx))];
}

export class Metrics {
  private samples: TurnSample[] = [];
  constructor(private cap = 500) {}

  record(s: TurnSample): void {
    this.samples.push(s);
    if (this.samples.length > this.cap) this.samples.shift();
  }

  private stat(list: TurnSample[], runnerId: string): RunnerMetric {
    const turns = list.length;
    const errors = list.reduce((n, s) => n + (s.ok ? 0 : 1), 0);
    const durs = list.map((s) => s.ms).sort((a, b) => a - b);
    const avgMs = turns ? Math.round(durs.reduce((a, b) => a + b, 0) / turns) : 0;
    const lastTs = list.reduce((m, s) => Math.max(m, s.ts), 0);
    return { runnerId, turns, errors, errorRate: turns ? errors / turns : 0, avgMs, p50ms: percentile(durs, 0.5), p95ms: percentile(durs, 0.95), lastTs };
  }

  /** Per-runner rollup, most-recently-active first. */
  byRunner(): RunnerMetric[] {
    const ids = [...new Set(this.samples.map((s) => s.runnerId))];
    return ids.map((id) => this.stat(this.samples.filter((s) => s.runnerId === id), id)).sort((a, b) => b.lastTs - a.lastTs);
  }

  /** Fleet-wide rollup across every runner (runnerId "*"). */
  overall(): RunnerMetric {
    return this.stat(this.samples, "*");
  }

  size(): number {
    return this.samples.length;
  }
}
