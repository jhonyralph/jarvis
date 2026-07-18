/**
 * A bounded FIFO ring buffer for "send it when the link is back" messages. Extracted from the runner's
 * turn-resume path (apps/runner) so the drop-oldest-on-overflow behavior is unit-tested rather than
 * inline: when the socket is down a long turn could emit thousands of events, so the buffer is capped
 * and drops the OLDEST — which preserves the most recent tail, including the terminal 'done'/'error'
 * that most needs to survive. `drain()` empties it for replay on reconnect.
 */
export class Outbox<T> {
  private buf: T[] = [];
  constructor(private cap = 3000) {
    if (cap < 1) this.cap = 1;
  }
  /** Append; if at capacity, drop the oldest first (ring behavior). */
  push(item: T): void {
    if (this.buf.length >= this.cap) this.buf.shift();
    this.buf.push(item);
  }
  /** Return everything in FIFO order and empty the buffer (for replay on reconnect). */
  drain(): T[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }
  get size(): number {
    return this.buf.length;
  }
}
