/** Provider-neutral managed-turn lifecycle shared by the embedded Hub and every remote Runner. */

export interface TurnSessionRef { agent: string; cwd: string; }

export interface TurnUsage {
  costUsd?: number;
  costKind?: "billed" | "estimated_api_equivalent" | "subscription_included" | "tokens_only" | "unavailable";
  source?: string;
  model?: string;
  effort?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  contextTokens?: number;
  contextWindowTokens?: number;
}

export interface TurnTouchedFile { path: string; action: "read" | "edit" | "write"; adds: number; dels: number; }

/** Rebuild the Files menu from persisted canonical/legacy activity for every adapter. */
export function touchedFilesFromMessages(messages: Array<{ activity?: unknown[] }>): TurnTouchedFile[] {
  const calls = new Map<string, any>(); let anonymous = 0;
  for (const message of messages) for (const raw of (Array.isArray(message.activity) ? message.activity : [])) {
    const e: any = raw, t = e?.tool || e; if (!t?.path) continue;
    const key = String(t.callId || t.toolId || e.eventId || `anon:${++anonymous}`);
    const prior = calls.get(key); if (!prior || e.kind === "tool_completed" || e.kind === "tool_failed" || t.status === "completed" || t.status === "failed") calls.set(key, t);
  }
  const files = new Map<string, TurnTouchedFile>();
  for (const t of calls.values()) { const name = String(t.name || ""), action: TurnTouchedFile["action"] = name === "Write" ? "write" : /Edit$|Patch|Write/.test(name) ? "edit" : "read"; const f = files.get(t.path) || { path: t.path, action, adds: 0, dels: 0 }; if (action === "edit" || action === "write") f.action = action; f.adds += Number(t.adds) || 0; f.dels += Number(t.dels) || 0; files.set(t.path, f); }
  return [...files.values()].reverse();
}

export interface TurnStoredMessage {
  role: "user" | "assistant";
  text: string;
  ts: number;
  agent: string;
  speaker?: string;
  images?: string[];
  files?: Array<{ name: string; content?: string }>;
  activity?: unknown[];
  usage?: TurnUsage;
}

export interface TurnReply { text: string; activity?: unknown[]; usage?: TurnUsage; }

export interface TurnCtx {
  ensure(sid: string): TurnSessionRef;
  resolveAgentName(name: string): string;
  add(sid: string, msg: TurnStoredMessage): void;
  broadcast(sid: string, msg: unknown): void;
  pushSessions(): void;
  now(): number;
  runAgentTurn(sid: string, agentName: string, agentText: string, cwd: string, opts: { model?: string; effort?: string; turnId?: string }): Promise<TurnReply>;
  speak(sid: string, replyText: string, also?: string[]): Promise<void>;
  checkBudget?(sid: string): { blocked: boolean; message?: string };
  seen?(turnId: string): boolean;
  afterTurn?(sid: string): void;
}

export interface ManagedTurnInput {
  showText: string;
  agentText?: string;
  model?: string;
  effort?: string;
  speaker?: string;
  images?: string[];
  files?: Array<{ name: string; content?: string }>;
  speak?: boolean;
  speakAlso?: string[];
  turnId?: string;
  onError(message: string, limit: boolean): void;
}

export function isLimitError(message: string): boolean {
  return /limit|rate|quota|exceeded|usage/i.test(message);
}

export async function runManagedTurn(ctx: TurnCtx, sid: string, o: ManagedTurnInput): Promise<void> {
  if (o.turnId && ctx.seen && !ctx.seen(o.turnId)) return;
  const budget = ctx.checkBudget?.(sid);
  if (budget?.blocked) { o.onError(budget.message || "limite de custo desta sessão atingido", true); return; }
  const session = ctx.ensure(sid);
  const agentName = ctx.resolveAgentName(session.agent);
  const userMsg: TurnStoredMessage = {
    role: "user", text: o.showText, ts: ctx.now(), agent: agentName,
    speaker: o.speaker, images: o.images, files: o.files,
  };
  ctx.add(sid, userMsg);
  ctx.broadcast(sid, { t: "message", message: { sessionId: sid, ...userMsg } });
  ctx.pushSessions();
  try {
    const reply = await ctx.runAgentTurn(sid, session.agent, o.agentText ?? o.showText, session.cwd, { model: o.model, effort: o.effort, turnId: o.turnId });
    ctx.add(sid, {
      role: "assistant", text: reply.text, ts: ctx.now(), agent: agentName,
      activity: reply.activity, usage: reply.usage,
    });
    ctx.pushSessions();
    ctx.afterTurn?.(sid);
    if (o.speak) await ctx.speak(sid, reply.text, o.speakAlso);
  } catch (e: unknown) {
    const message = String((e as { message?: unknown } | null)?.message ?? e);
    o.onError(message, isLimitError(message));
  }
}
