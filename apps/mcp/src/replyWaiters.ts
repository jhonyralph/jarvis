export interface PendingHubReply<T = unknown> {
  promise: Promise<T>;
  cancel(error: Error): void;
}

interface Entry {
  type: string;
  match?: (message: unknown) => boolean;
  resolve: (message: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class HubReplyTimeoutError extends Error {
  readonly replyType: string;
  constructor(replyType: string) {
    super(`timeout esperando "${replyType}" do Hub`);
    this.name = "HubReplyTimeoutError";
    this.replyType = replyType;
  }
}

/** FIFO for legacy uncorrelated replies; predicates provide exact correlation for new frames. */
export class HubReplyWaiters {
  private entries: Entry[] = [];

  add<T = unknown>(type: string, timeoutMs: number, match?: (message: T) => boolean): PendingHubReply<T> {
    let entry!: Entry;
    const promise = new Promise<T>((resolve, reject) => {
      entry = { type, match: match ? (message) => match(message as T) : undefined,
        resolve: (message) => resolve(message as T), reject, timer: undefined as unknown as NodeJS.Timeout };
      this.entries.push(entry);
      entry.timer = setTimeout(() => this.cancelEntry(entry, new HubReplyTimeoutError(type)), timeoutMs);
    });
    return { promise, cancel: (error) => this.cancelEntry(entry, error) };
  }

  resolve(message: unknown): boolean {
    const type = message && typeof message === "object" && !Array.isArray(message) ? (message as Record<string, unknown>).t : undefined;
    const index = this.entries.findIndex((entry) => {
      if (entry.type !== type || !entry.match) return entry.type === type;
      try { return entry.match(message); } catch { return false; }
    });
    if (index < 0) return false;
    const entry = this.entries.splice(index, 1)[0];
    clearTimeout(entry.timer); entry.resolve(message); return true;
  }

  rejectAll(error: Error): void {
    for (const entry of this.entries.splice(0)) { clearTimeout(entry.timer); entry.reject(error); }
  }

  get size(): number { return this.entries.length; }

  private cancelEntry(entry: Entry, error: Error): void {
    const index = this.entries.indexOf(entry);
    if (index < 0) return;
    this.entries.splice(index, 1); clearTimeout(entry.timer); entry.reject(error);
  }
}
