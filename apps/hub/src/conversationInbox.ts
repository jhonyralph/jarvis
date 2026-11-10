import { createHash } from "node:crypto";
import { conversationBriefing, type ConversationTask } from "./conversation.js";
import type { ConversationPreferences } from "./conversationLedger.js";

export const CONVERSATION_PAGE_SIZE = 50;
const SUMMARY_CHARS = 1200;
export interface ConversationListRequest {
  offset?: unknown;
  summaryOnly?: unknown;
  version?: unknown;
  requestId?: unknown;
}

/** Display projection only. Never truncate the journal or the coordinator's task collection. */
function preview(task: ConversationTask) {
  return {
    ...task,
    title: String(task.title || "").slice(0, 240), origin: String(task.origin || "").slice(0, 512),
    summary: task.summary ? String(task.summary).slice(0, SUMMARY_CHARS) : undefined,
    summaryTruncated: String(task.summary || "").length > SUMMARY_CHARS,
  };
}

/** Input has already passed the Hub's per-principal, machine and session access checks. */
export function buildConversationInbox(tasks: ConversationTask[], preferences: ConversationPreferences,
  request: ConversationListRequest, updates: string[]) {
  const visible = tasks.filter(t => t.state !== "handled");
  const requested = typeof request.offset === "number" && Number.isSafeInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
  const offset = Math.min(Math.floor(requested / CONVERSATION_PAGE_SIZE) * CONVERSATION_PAGE_SIZE,
    Math.max(0, Math.ceil(visible.length / CONVERSATION_PAGE_SIZE) - 1) * CONVERSATION_PAGE_SIZE);
  const focus = tasks.find(t => preferences.task && t.runnerId === preferences.task.runnerId
    && t.sessionId === preferences.task.sessionId && (!preferences.task.turnId || t.turnId === preferences.task.turnId));
  const summaryOnly = request.summaryOnly === true;
  const page = summaryOnly ? undefined : visible.slice(offset, offset + CONVERSATION_PAGE_SIZE).map(preview);
  const selected = focus ? preview(focus) : undefined;
  // seen/notified are private server-side bookkeeping, not a multi-thousand-entry UI payload.
  const publicPreferences = { quiet: !!preferences.quiet, task: focus ? preferences.task : undefined };
  const version = createHash("sha256").update(JSON.stringify({ page, selected, offset, total: visible.length, preferences: publicPreferences })).digest("hex");
  const unchanged = !summaryOnly && request.version === version;
  return {
    t: "conversation_inbox" as const,
    requestId: typeof request.requestId === "string" ? request.requestId.slice(0, 100) : undefined,
    offset, limit: CONVERSATION_PAGE_SIZE, total: visible.length, summaryOnly, version, unchanged,
    tasks: unchanged ? undefined : page, selected, preferences: publicPreferences,
    updates: updates.slice(0, CONVERSATION_PAGE_SIZE), updateCount: updates.length,
    briefing: conversationBriefing(tasks, preferences.seen),
  };
}
