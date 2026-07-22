import {
  AGENT_EVENT_SCHEMA_VERSION,
  type AgentEvent,
  type AgentEventKind,
  type ExecutionState,
} from "@jarvis/protocol";
import type { ExecutionStore } from "./execution-store.js";

export interface ReplayMessage {
  role: string;
  ts?: number;
  contextManifest?: { turnId?: string };
}

export interface PendingActivityReplay {
  turnId: string;
  rootExecutionId: string;
  state: ExecutionState;
  events: AgentEvent[];
  updatedAt: number;
  truncated: boolean;
}

const TERMINAL_AGENT_EVENTS = new Set<AgentEventKind>(["completed", "failed", "cancelled"]);

function syntheticEvent(turnId: string, seq: number, at: number, kind: AgentEventKind, text?: string): AgentEvent {
  return { schemaVersion: AGENT_EVENT_SCHEMA_VERSION, turnId, eventId: `${turnId}:${seq}`, seq, at, kind, text };
}

function pendingUser(messages: ReplayMessage[]): ReplayMessage | undefined {
  let userIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") { userIndex = i; break; }
  if (userIndex < 0) return undefined;
  if (messages.slice(userIndex + 1).some((message) => message?.role === "assistant")) return undefined;
  return messages[userIndex];
}

/**
 * Rebuild the canonical chat activity for the latest user turn that still has no persisted
 * assistant message. The append-only execution journal is authoritative; synthetic lifecycle
 * edges only cover journals written by older builds that did not retain accepted/started.
 */
export function pendingActivityReplay(
  store: ExecutionStore,
  sessionId: string,
  messages: ReplayMessage[],
  limit = 1_200,
): PendingActivityReplay | undefined {
  const user = pendingUser(messages);
  if (!user) return undefined;
  const declaredTurnId = user.contextManifest?.turnId;
  const roots = store.rootsForSession(sessionId);
  const snapshot = declaredTurnId
    ? roots.find((root) => root.rootTurnId === declaredTurnId)
    : roots.find((root) => {
        const node = root.nodes.find((candidate) => candidate.executionId === root.rootExecutionId);
        const startedAt = node?.startedAt || node?.queuedAt || 0;
        return !user.ts || startedAt >= user.ts - 2_000;
      });
  if (!snapshot) return undefined;
  const root = snapshot.nodes.find((node) => node.executionId === snapshot.rootExecutionId);
  if (!root) return undefined;

  const journalEvents = [] as AgentEvent[];
  const seen = new Set<string>();
  let updatedAt = Math.max(root.endedAt || 0, root.startedAt || 0, root.queuedAt || 0);
  let afterSeq = 0;
  while (true) {
    const page = store.events(snapshot.rootExecutionId, afterSeq, 1_000);
    for (const event of page.events) {
      updatedAt = Math.max(updatedAt, event.at);
      if (event.kind !== "agent_event" || seen.has(event.event.eventId)) continue;
      seen.add(event.event.eventId);
      journalEvents.push(event.event);
    }
    if (!page.nextSeq || page.nextSeq <= afterSeq) break;
    afterSeq = page.nextSeq;
  }

  const turnId = snapshot.rootTurnId;
  const startedAt = root.startedAt || root.queuedAt || snapshot.generatedAt;
  if (!journalEvents.some((event) => event.kind === "accepted")) {
    journalEvents.unshift(syntheticEvent(turnId, 1, root.queuedAt || startedAt, "accepted"));
  }
  if (root.state !== "queued" && !journalEvents.some((event) => event.kind === "started")) {
    const acceptedIndex = journalEvents.findIndex((event) => event.kind === "accepted");
    journalEvents.splice(acceptedIndex + 1, 0, syntheticEvent(turnId, 2, startedAt, "started"));
  }

  if (!journalEvents.some((event) => TERMINAL_AGENT_EVENTS.has(event.kind))) {
    const lastSeq = Math.max(2, ...journalEvents.map((event) => event.seq));
    if (root.state === "succeeded") journalEvents.push(syntheticEvent(turnId, lastSeq + 1, updatedAt, "completed", root.summary));
    else if (root.state === "cancelled") journalEvents.push(syntheticEvent(turnId, lastSeq + 1, updatedAt, "cancelled", root.summary || "Execução cancelada antes de concluir."));
    else if (root.state === "failed" || root.state === "orphaned" || root.state === "unknown") {
      const reason = root.summary || (root.state === "orphaned"
        ? "Execução interrompida: o processo perdeu o vínculo após o reinício."
        : "Execução encerrada sem um estado terminal verificável.");
      journalEvents.push({ ...syntheticEvent(turnId, lastSeq + 1, updatedAt, "failed", reason), errorCode: root.state === "orphaned" ? "PROCESS_BINDING_LOST" : "RECOVERY_STATE" });
    }
  }

  const max = Math.max(10, limit);
  const truncated = snapshot.truncated || journalEvents.length > max;
  const events = journalEvents.length <= max ? journalEvents : [
    ...journalEvents.filter((event) => event.kind === "accepted" || event.kind === "started").slice(0, 2),
    ...journalEvents.slice(-(max - 2)),
  ];
  return { turnId, rootExecutionId: snapshot.rootExecutionId, state: root.state, events, updatedAt, truncated };
}
