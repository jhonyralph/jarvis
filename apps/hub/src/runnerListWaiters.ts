/**
 * Waiters for a runner's next `{t:"sessions"}` frame.
 *
 * Why this exists as its own module: the Hub asks a machine for its session list from three unrelated
 * places (the unified "all machines" view, cross-session search/summary, and the admin "ok" purge), but
 * `{t:"list"}` carries no reqId and the Runner ALSO pushes `sessions` spontaneously whenever its store
 * changes. A single callback slot per runner therefore let a second request overwrite the first: the
 * first caller then waited out its 6s timeout and resolved `[]`, so the machine silently vanished from
 * the unified view — sessions "disappearing" and the ordering looking scrambled when it came back.
 *
 * A session list is the runner's ENTIRE state, not a per-request result, so the fix is to keep every
 * waiter and serve them all from the next frame. That also keeps older runners working unchanged —
 * no reqId on the wire, no protocol bump (which would quarantine every machine until it updated).
 */
export type RunnerListWaiter = (sessions: any[]) => void;

export class RunnerListWaiters {
  private readonly waiters = new Map<string, RunnerListWaiter[]>();

  /** Queue `waiter` for `runnerId`'s next list. Returns a canceller (timeout / send failure path). */
  add(runnerId: string, waiter: RunnerListWaiter): () => void {
    const queue = this.waiters.get(runnerId) || [];
    queue.push(waiter);
    this.waiters.set(runnerId, queue);
    return () => this.remove(runnerId, waiter);
  }

  /** Serve every waiter queued for this runner. Returns how many were served. */
  resolve(runnerId: string, sessions: any[]): number {
    const queue = this.waiters.get(runnerId);
    if (!queue?.length) return 0;
    this.waiters.delete(runnerId);
    // Snapshot first: a waiter is free to queue a fresh request from inside its own callback.
    for (const waiter of [...queue]) waiter(sessions);
    return queue.length;
  }

  /** Drop a single waiter without serving it. */
  remove(runnerId: string, waiter: RunnerListWaiter): void {
    const queue = this.waiters.get(runnerId);
    if (!queue) return;
    const i = queue.indexOf(waiter);
    if (i >= 0) queue.splice(i, 1);
    if (!queue.length) this.waiters.delete(runnerId);
  }

  /** How many callers are currently waiting on this runner (tests / diagnostics). */
  pending(runnerId: string): number {
    return this.waiters.get(runnerId)?.length ?? 0;
  }
}
