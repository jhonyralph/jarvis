/**
 * Availability cache for AIs that hit a credit/usage limit. When a primary AI runs out of quota, the
 * turn falls back to a configured secondary AI; without a memory of "this AI is exhausted" every
 * subsequent turn would pay a full failing round-trip to the primary before falling back. This store
 * records a `blockedUntil` per agent so the Hub can go straight to the secondary until the primary's
 * quota is expected back (default: next local midnight — "tenta de novo no próximo dia"), or until the
 * owner clears it manually. Persisted atomically so it survives a Hub restart.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./persist.js";

export interface AgentBlock {
  agent: string;
  /** epoch ms after which the agent is retried again. */
  blockedUntil: number;
  /** epoch ms the block was recorded. */
  since: number;
  /** short, truncated error text that triggered the block (diagnostic only). */
  reason?: string;
}

/** Next local midnight after `now` — the default "try again tomorrow" reset window. */
export function nextLocalMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0); // rolls into the next day at 00:00 local
  return d.getTime();
}

export class AgentAvailabilityStore {
  readonly path: string;
  private cache: Record<string, AgentBlock>;
  constructor(dir = join(process.env.JARVIS_HOME || homedir(), ".jarvis")) {
    this.path = join(dir, "agent-availability.json");
    this.cache = readJson<Record<string, AgentBlock>>(this.path, {}) || {};
  }
  private save(): void { try { writeJsonAtomic(this.path, this.cache, { pretty: true }); } catch { /* best effort */ } }

  isBlocked(agent: string, now: number): boolean {
    const b = this.cache[agent];
    return !!b && b.blockedUntil > now;
  }
  /** Remaining block deadline for `agent`, or null when it is available. */
  blockedUntil(agent: string, now: number): number | null {
    const b = this.cache[agent];
    return b && b.blockedUntil > now ? b.blockedUntil : null;
  }
  /** Record that `agent` is out of credit until `until`. Idempotent per agent (latest wins). */
  markExhausted(agent: string, until: number, reason: string | undefined, now: number): AgentBlock {
    const block: AgentBlock = { agent, blockedUntil: until, since: now, reason: reason ? String(reason).replace(/\s+/g, " ").trim().slice(0, 300) : undefined };
    this.cache[agent] = block;
    this.save();
    return block;
  }
  /** Manually lift a block ("tentar a primária agora"). */
  clear(agent: string): boolean {
    if (!this.cache[agent]) return false;
    delete this.cache[agent];
    this.save();
    return true;
  }
  /** Drop expired blocks. Returns true when something was removed. */
  sweep(now: number): boolean {
    let changed = false;
    for (const [k, b] of Object.entries(this.cache)) if (b.blockedUntil <= now) { delete this.cache[k]; changed = true; }
    if (changed) this.save();
    return changed;
  }
  /** Currently-active blocks, soonest reset first. */
  list(now: number): AgentBlock[] {
    return Object.values(this.cache).filter((b) => b.blockedUntil > now).sort((a, b) => a.blockedUntil - b.blockedUntil);
  }
}
