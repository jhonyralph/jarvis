/**
 * Update watchdog — pure decision for the Hub's stuck-update blind spot.
 *
 * When a machine applies an update and reports ok, the Hub moves its pending record to
 * "awaiting_restart": the machine is expected to restart and reconnect on the new commit within a
 * normal restart window. If the restart/updater hangs (a real incident that took a machine offline
 * for ~30 min before), the machine NEVER reconnects, so the reconnect-driven recovery path never
 * fires and the self-heal loop deliberately skips awaiting_restart — the record sits there forever
 * with no signal to the owner ("não vejo a máquina").
 *
 * This function is the one-line decision the Hub polls: is a pending update stalled and worth an
 * alert? Pure (no clock, no sockets) so it unit-tests. The Hub owns the side effects (notify once).
 */
export interface UpdateStallInput {
  state: "queued" | "sent" | "awaiting_restart" | "blocked" | string;
  /** epoch ms the record entered awaiting_restart (preferred). */
  awaitingSince?: number;
  lastAttemptAt?: number;
  requestedAt?: number;
  /** already flagged stalled → don't re-alert. */
  stalled?: boolean;
}

/**
 * True when a machine that reported an applied update has been offline past the stall window — i.e.
 * the restart didn't bring it back. Fires only for `awaiting_restart` + offline + not-already-stalled,
 * so the caller alerts exactly once. An online machine (even on the old commit) is NOT stalled — that
 * case self-heals via re-delivery on its reconnect.
 */
export function updateStalled(p: UpdateStallInput, opts: { online: boolean; now: number; stallMs: number }): boolean {
  if (p.state !== "awaiting_restart" || opts.online || p.stalled) return false;
  const since = p.awaitingSince || p.lastAttemptAt || p.requestedAt || opts.now;
  return opts.now - since > opts.stallMs;
}
