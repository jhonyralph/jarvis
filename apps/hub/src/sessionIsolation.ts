import { randomUUID } from "node:crypto";

export interface PendingRequest<Socket, Metadata = unknown> {
  socket: Socket;
  runnerId: string;
  sessionIds: string[];
  principalId: string;
  operation: string;
  createdAt: number;
  metadata?: Metadata;
}

export interface PendingResponseScope<Socket, Metadata = unknown> {
  runnerId: string;
  operations: ReadonlySet<string>;
  sessionId?: string;
  authorize(request: PendingRequest<Socket, Metadata>): boolean;
}

/** Correlates delayed runner replies to the exact principal, runner, session and operation. */
export class PendingRequestRegistry<Socket, Metadata = unknown> {
  private readonly requests = new Map<string, PendingRequest<Socket, Metadata>>();

  constructor(private readonly now: () => number = Date.now) {}

  set(id: string, request: Omit<PendingRequest<Socket, Metadata>, "createdAt" | "sessionIds"> & { sessionIds?: Iterable<string> }): PendingRequest<Socket, Metadata> {
    if (!id || !request.runnerId || !request.principalId || !request.operation) throw new Error("invalid pending request");
    if (this.requests.has(id)) throw new Error("duplicate pending request id");
    const row: PendingRequest<Socket, Metadata> = {
      ...request,
      sessionIds: [...new Set(request.sessionIds || [])],
      createdAt: this.now(),
    };
    this.requests.set(id, row);
    return row;
  }

  get(id: string): PendingRequest<Socket, Metadata> | undefined {
    return this.requests.get(id);
  }

  delete(id: string): boolean {
    return this.requests.delete(id);
  }

  /** A matching response is one-shot even when authorization has since been revoked. */
  take(id: string, scope: PendingResponseScope<Socket, Metadata>): PendingRequest<Socket, Metadata> | undefined {
    const request = this.requests.get(id);
    if (!request || request.runnerId !== scope.runnerId || !scope.operations.has(request.operation)) return undefined;
    this.requests.delete(id);
    if (scope.sessionId !== undefined && request.sessionIds.length && !request.sessionIds.includes(scope.sessionId)) return undefined;
    return scope.authorize(request) ? request : undefined;
  }
}

export type RemoteErrorRoute =
  | { scope: "request"; requestId: string; sessionId?: string }
  | { scope: "session"; sessionId: string }
  | { scope: "discard" };

/** Extracts only routing data from an untrusted runner error; the runner's message is never retained. */
export function remoteErrorRoute(frame: { reqId?: unknown; sessionId?: unknown; [key: string]: unknown }): RemoteErrorRoute {
  if (typeof frame.reqId === "string" && frame.reqId) {
    return { scope: "request", requestId: frame.reqId, ...(typeof frame.sessionId === "string" && frame.sessionId ? { sessionId: frame.sessionId } : {}) };
  }
  if (typeof frame.sessionId === "string" && frame.sessionId) return { scope: "session", sessionId: frame.sessionId };
  return { scope: "discard" };
}

export interface SessionDispatchLease {
  runnerId: string;
  sessionId: string;
  principalId: string;
  operation: string;
  token: string;
}

function dispatchKey(runnerId: string, sessionId: string): string {
  return `${runnerId}\u0000${sessionId}`;
}

/** Non-blocking per-session mutex used before any routing/history/personal-context await. */
export class SessionDispatchReservations {
  private readonly leases = new Map<string, SessionDispatchLease>();

  tryAcquire(runnerId: string, sessionId: string, principalId: string, operation: string): SessionDispatchLease | undefined {
    const key = dispatchKey(runnerId, sessionId);
    if (!runnerId || !sessionId || !principalId || !operation || this.leases.has(key)) return undefined;
    const lease = { runnerId, sessionId, principalId, operation, token: randomUUID() };
    this.leases.set(key, lease);
    return lease;
  }

  current(runnerId: string, sessionId: string): SessionDispatchLease | undefined {
    return this.leases.get(dispatchKey(runnerId, sessionId));
  }

  isCurrent(lease: SessionDispatchLease): boolean {
    return this.leases.get(dispatchKey(lease.runnerId, lease.sessionId))?.token === lease.token;
  }

  isHeld(runnerId: string, sessionId: string): boolean {
    return this.leases.has(dispatchKey(runnerId, sessionId));
  }

  release(lease: SessionDispatchLease): boolean {
    if (!this.isCurrent(lease)) return false;
    return this.leases.delete(dispatchKey(lease.runnerId, lease.sessionId));
  }
}
