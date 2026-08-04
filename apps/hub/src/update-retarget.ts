/**
 * UPD-01 Fase 2 — pure policy: should a pending runner update be RE-AIMED at a newer commit?
 *
 * The Hub pins a deployment target per machine so deploys are idempotent (a runner reconnecting after
 * a newer push still finishes and proves the EXACT commit the Hub queued). But that same pinning is
 * why "manual actions bring back the SAME update": if the pinned target isn't landing (a runner
 * flapping/crash-looping) and a NEWER commit lands — presumably WITH the fix — the Hub keeps
 * re-sending the old target forever. This decides when to chase the newer commit instead.
 *
 * Pure (no clock/sockets/state) so it unit-tests; the Hub owns the side effects (re-deliver + notify).
 */

/** Two git shas name the same commit even when one is short and one is full (`+dirty` ignored). */
export function commitPrefixMatch(a: string, b: string): boolean {
  const x = (a || "").replace("+dirty", ""), y = (b || "").replace("+dirty", "");
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
}

export interface RetargetInput {
  state: "queued" | "sent" | "awaiting_restart" | "blocked" | string;
  targetCommit: string;
}

/**
 * The new commit to re-aim a pending update at, or `null` to keep the current target.
 *
 * Retargets only when: the update is NOT blocked (a blocked one needs the owner, not a new target),
 * the Hub has a known commit, and that commit is genuinely different from the pinned target. A dirty
 * Hub tree ("abc+dirty") still retargets to its committed sha `abc` — the uncommitted changes aren't
 * in git and were never deployable anyway.
 */
export function retargetTarget(pending: RetargetInput, hubCommit: string): string | null {
  if (pending.state === "blocked") return null;
  const target = (hubCommit || "").replace("+dirty", "");
  if (!target) return null;
  if (commitPrefixMatch(pending.targetCommit, target)) return null;
  return target;
}
