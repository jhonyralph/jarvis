/**
 * Bounded "have I already seen this id?" set — the primitive behind idempotent turn execution.
 *
 * The Runner's concurrency guard (`activeRuns`) only stops a duplicate that arrives WHILE a turn is
 * running (it answers "busy"). It has no memory, so the SAME `{t:"send"}` re-delivered AFTER the
 * first finished (a client resend on reconnect, a queue re-flush, a WS-level redelivery) would run
 * the command a SECOND time. Tagging each send with a `turnId` and running it through this set makes
 * execution at-most-once: a turnId already seen is skipped.
 *
 * Insertion-ordered (Map) so it evicts the OLDEST id past the cap — a real LRU window, not a wipe.
 */
export interface SeenSet {
  /** Record `id`; returns true if it was NEW (process it), false if already seen (skip — duplicate). */
  add(id: string): boolean;
  has(id: string): boolean;
  readonly size: number;
}

export function createSeenSet(cap = 500): SeenSet {
  const seen = new Map<string, true>();
  return {
    add(id: string): boolean {
      if (seen.has(id)) return false;
      seen.set(id, true);
      if (seen.size > cap) {
        const oldest = seen.keys().next().value; // Map keeps insertion order → this is the oldest id
        if (oldest !== undefined) seen.delete(oldest);
      }
      return true;
    },
    has(id: string): boolean { return seen.has(id); },
    get size(): number { return seen.size; },
  };
}
