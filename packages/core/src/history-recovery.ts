import type { Store, StoredMessage } from "./store.js";
import type { ExecutionStore } from "./execution-store.js";
import { nativeHistoryAsync, nativeHistoryForRecovery, type HistMsg } from "./native.js";
import { findHistoryGaps, normalizePrompt } from "./history-gaps.js";
import { pendingActivityReplay } from "./activity-replay.js";
import { partialTurnFromActivity } from "./turn.js";

/** Match an existing human turn by BOTH time and text. Short repeated prompts ("continue") are
 * valid anchors here: unlike finding entirely missing turns, we know the person sent them. */
export function nativeReplyForUser(user: StoredMessage, nextUserTs: number, native: readonly HistMsg[]): HistMsg | undefined {
  const prompt = normalizePrompt(user.text);
  if (!prompt || !user.ts) return undefined;
  const anchors = native.map((message, index) => ({ message, index })).filter(({ message }) => {
    const text = normalizePrompt(message.text);
    const frameworkWrapped = message.text.startsWith("Instruções universais do Framework Jarvis")
      && message.text.trimEnd().endsWith("\n\n" + user.text.trim());
    return message.role === "user" && message.ts >= user.ts - 2_000 && message.ts < nextUserTs
      && Math.abs(message.ts - user.ts) <= 30_000 && (text === prompt || frameworkWrapped || (prompt.length >= 24 && text.includes(prompt)));
  });
  if (anchors.length !== 1) return undefined; // ambiguous prompt expansion/retry: never guess
  const replies: HistMsg[] = [];
  for (const message of native.slice(anchors[0].index + 1)) {
    if (message.role === "user" || message.ts >= nextUserTs) break;
    if (message.role === "assistant" && message.ts >= user.ts && (message.text || message.activity?.length)) replies.push({ ...message,
      text: message.textParts ? message.textParts.filter((part) => part.ts < nextUserTs).map((part) => part.text).join("") : message.text,
      activity: message.activity?.filter((event) => !event.at || event.at < nextUserTs),
      completion: message.completedAt && message.completedAt >= nextUserTs ? undefined : message.completion,
    });
  }
  if (!replies.length) return undefined;
  return { ...replies[0], text: replies.map((m) => m.text).join("\n\n"),
    activity: replies.flatMap((m) => m.activity || []), completion: replies.at(-1)?.completion };
}

export function missingNativeReplies(stored: readonly StoredMessage[], native: readonly HistMsg[]): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (let i = 0; i < stored.length; i++) {
    const user = stored[i];
    if (user.role !== "user") continue;
    const end = stored.findIndex((m, index) => index > i && m.role === "user");
    const window = stored.slice(i + 1, end < 0 ? undefined : end);
    if (window.some((m) => m.role === "assistant")) continue;
    const reply = nativeReplyForUser(user, end < 0 ? Infinity : stored[end].ts, native);
    if (reply) out.push({ role: "assistant", text: reply.text, ts: reply.ts, agent: user.agent,
      activity: reply.activity, interrupted: reply.completion !== "completed", restored: true });
  }
  return out;
}

function isNativeProjection(message: StoredMessage): boolean {
  return message.role === "assistant" && !message.usage && !message.contextManifest
    && ((!!message.restored && !message.activity?.length) || (!!message.activity?.length
      && message.activity.every((event: any) => ["tool", "thinking", "text"].includes(event?.kind))));
}

/** Older boot reconciliation stored a tail-only native projection without provenance. Upgrade only
 * that recognizable shape, preserving every original character. Ordinary provider replies, which
 * carry canonical events/usage, are never replaced by a transcript's concatenated commentary. */
export function nativeRecoveryReplacements(stored: readonly StoredMessage[], native: readonly HistMsg[]): Array<{ before: StoredMessage; after: StoredMessage }> {
  const out: Array<{ before: StoredMessage; after: StoredMessage }> = [];
  for (let i = 0; i < stored.length; i++) {
    const user = stored[i];
    if (user.role !== "user") continue;
    const end = stored.findIndex((m, index) => index > i && m.role === "user");
    const assistants = stored.slice(i + 1, end < 0 ? undefined : end).filter((m) => m.role === "assistant");
    if (assistants.length !== 1) continue;
    const before = assistants[0];
    if (!isNativeProjection(before)) continue;
    const reply = nativeReplyForUser(user, end < 0 ? Infinity : stored[end].ts, native);
    const preservesText = reply && ((!!before.text && reply.text.endsWith(before.text))
      || (before.restored && before.interrupted && reply.text.startsWith(before.text)));
    if (!reply || !preservesText || reply.ts > before.ts) continue;
    if ((reply.activity?.length || 0) < (before.activity?.length || 0)) continue; // never replace a richer projection with a tail
    const after: StoredMessage = { ...before, text: reply.text, ts: reply.ts, activity: reply.activity,
      interrupted: reply.completion !== "completed", restored: true };
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ before, after });
  }
  return out;
}

/** Called only while no provider turn is running, at boot/open AND before accepting a new user
 * message. Writes into the owning Store (including its cache), never into a live process's JSONL
 * from another process. Recheck after disk I/O: opening and sending may race. */
export async function recoverSessionHistory(input: {
  store: Store; sessionId: string; nativeKey?: string | null; executions?: ExecutionStore; isBusy: () => boolean;
}): Promise<number> {
  const { store, sessionId, executions } = input;
  if (input.isBusy() || !store.get(sessionId)) return 0;
  const before = store.history(sessionId).slice();
  const conversation = before.filter((m) => m.role !== "system");
  const hasMissingReply = conversation.some((m, i) => (m.role === "user" && (i === conversation.length - 1 || conversation[i + 1].role === "user"))
    || isNativeProjection(m));
  const native = input.nativeKey
    ? await (hasMissingReply ? nativeHistoryForRecovery : nativeHistoryAsync)(input.nativeKey) : null;
  const current = store.history(sessionId);
  if (input.isBusy() || !store.get(sessionId) || current.length !== before.length || current.some((m, i) => m !== before[i])) return 0;
  const additions = native ? missingNativeReplies(current, native.messages) : [];
  // An exact journal turn id is the fallback when the provider file is missing or has no user
  // anchor. Time-only journal matching can attach a later turn to an earlier unanswered message.
  if (executions) for (let i = 0; i < current.length; i++) {
    const user = current[i];
    if (user.role !== "user" || !user.contextManifest?.turnId) continue;
    const end = current.findIndex((m, index) => index > i && m.role === "user");
    const nextTs = end < 0 ? Infinity : current[end].ts;
    if (current.slice(i + 1, end < 0 ? undefined : end).some((m) => m.role === "assistant")
      || additions.some((m) => m.ts >= user.ts && m.ts < nextTs)) continue;
    const replay = pendingActivityReplay(executions, sessionId, [user], Number.MAX_SAFE_INTEGER);
    if (!replay || ["queued", "running", "waiting_input"].includes(replay.state)) continue;
    const partial = partialTurnFromActivity(replay.events);
    const completed = [...replay.events].reverse().find((e) => e.kind === "completed" && !e.parentId);
    if (!partial && !completed?.text) continue;
    additions.push({ role: "assistant", text: completed?.text || partial?.text || "",
      ts: Math.max(user.ts, Math.min(replay.updatedAt, nextTs - 1)), agent: user.agent,
      activity: replay.events, interrupted: !completed, restored: true });
  }
  if (native) for (const gap of findHistoryGaps([...current, ...additions], native.messages)) {
    additions.push({ ...gap.user, agent: store.get(sessionId)!.agent },
      { ...gap.assistant, agent: store.get(sessionId)!.agent, interrupted: gap.assistant.interrupted });
  }
  return store.applyHistoryRecovery(sessionId, additions, native ? nativeRecoveryReplacements(current, native.messages) : []);
}
