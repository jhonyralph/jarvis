/**
 * The ONE managed-session turn lifecycle. Before this, the sequence
 *   store user msg → broadcast → pushSessions → run the agent → store assistant msg → pushSessions
 * was copy-pasted across four call sites in index.ts (the normal send path, `sendTo`, the queue
 * flush, and the voice `deliverTurn`) and they had already DRIFTED — `sendTo` silently failed to
 * persist the assistant's `activity` (sub-agent/tool trace), so a reload of a session driven that
 * way lost its tool blocks. Collapsing them here fixes that by construction and gives one place to
 * evolve the turn (hooks, cost caps, …).
 *
 * Everything it touches is injected via `TurnCtx`, so the whole lifecycle is unit-testable with a
 * mock agent and an in-memory store — no server, no real CLI. index.ts builds the real ctx.
 */

export interface TurnSessionRef { agent: string; cwd: string; }

export interface TurnStoredMessage {
  role: "user" | "assistant";
  text: string;
  ts: number;
  agent: string;
  speaker?: string;
  images?: string[];
  files?: Array<{ name: string; content?: string }>;
  activity?: unknown[];
}

export interface TurnReply {
  text: string;
  activity?: unknown[];
  usage?: { costUsd?: number; inputTokens?: number; outputTokens?: number };
}

export interface TurnCtx {
  /** Create-if-missing and return the session's locked agent + cwd. */
  ensure(sid: string): TurnSessionRef;
  /** Resolve a stored agent name to the registry's actual adapter name (handles fallback to default). */
  resolveAgentName(name: string): string;
  /** Persist a message (user or assistant) to the store. */
  add(sid: string, msg: TurnStoredMessage): void;
  /** Fan a protocol message out to every client viewing this session. */
  broadcast(sid: string, msg: unknown): void;
  /** Re-push the session list (title/last-message/order changed). */
  pushSessions(): void;
  /** Current epoch ms (injected so tests are deterministic). */
  now(): number;
  /** Run one streaming agent turn; resolves with the final reply + its buffered activity. */
  runAgentTurn(sid: string, agentName: string, agentText: string, cwd: string, opts: { model?: string; effort?: string }): Promise<TurnReply>;
  /** Speak the reply (TTS) to session listeners. Only called when the input asked for speech. */
  speak(sid: string, replyText: string): Promise<void>;
  /** Optional cost guard-rail: if it blocks, the turn is refused BEFORE the agent runs (and before
   *  the user message is stored) so an accidental runaway can't keep spending. Off unless configured. */
  checkBudget?(sid: string): { blocked: boolean; message?: string };
  /** Optional idempotency: record a turnId; returns true if NEW, false if already seen (dup → skip).
   *  Makes LOCAL turns at-most-once too (mirrors the runner's turnId dedup). */
  seen?(turnId: string): boolean;
  /** Optional post-turn hook (fire-and-forget) — e.g. index the session into semantic memory. */
  afterTurn?(sid: string): void;
}

export interface ManagedTurnInput {
  /** Text stored/shown as the user's message. */
  showText: string;
  /** Text actually sent to the agent (defaults to showText). Differs when attachments inline file bodies. */
  agentText?: string;
  model?: string;
  effort?: string;
  speaker?: string;
  images?: string[];
  files?: Array<{ name: string; content?: string }>;
  speak?: boolean;
  /** idempotency key (client msgId) — a re-delivered turnId is skipped (mirrors the runner). */
  turnId?: string;
  /** How to deliver a failure — callers differ: some broadcast to the session, some reply to the sender. */
  onError(message: string, limit: boolean): void;
}

/** Matches the message-substring test the old inline catches used to flag plan/usage-limit errors. */
export function isLimitError(message: string): boolean {
  return /limit|rate|quota|exceeded|usage/i.test(message);
}

/** Run one full turn against a managed session. Behavior-preserving unification of the four old paths. */
export async function runManagedTurn(ctx: TurnCtx, sid: string, o: ManagedTurnInput): Promise<void> {
  // Idempotency (opt-in): a re-delivered turnId runs at most once — nothing stored, nothing run.
  if (o.turnId && ctx.seen && !ctx.seen(o.turnId)) return;
  // Cost guard-rail (opt-in): refuse the turn before spending anything if the session is over budget.
  const budget = ctx.checkBudget?.(sid);
  if (budget?.blocked) { o.onError(budget.message || "limite de custo desta sessão atingido", true); return; }
  const session = ctx.ensure(sid);
  const agentName = ctx.resolveAgentName(session.agent);
  const now = ctx.now();
  const userMsg: TurnStoredMessage = { role: "user", text: o.showText, ts: now, agent: agentName, speaker: o.speaker, images: o.images, files: o.files };
  ctx.add(sid, userMsg);
  ctx.broadcast(sid, { t: "message", message: { sessionId: sid, ...userMsg } });
  ctx.pushSessions();
  try {
    const reply = await ctx.runAgentTurn(sid, session.agent, o.agentText ?? o.showText, session.cwd, { model: o.model, effort: o.effort });
    ctx.add(sid, { role: "assistant", text: reply.text, ts: ctx.now(), agent: agentName, activity: reply.activity });
    ctx.pushSessions();
    ctx.afterTurn?.(sid);
    if (o.speak) await ctx.speak(sid, reply.text);
  } catch (e: unknown) {
    const message = String((e as { message?: unknown } | null)?.message ?? e);
    o.onError(message, isLimitError(message));
  }
}
