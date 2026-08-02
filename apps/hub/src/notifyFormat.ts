export type NotifyKind = "done" | "error" | "machine" | "personal";

export interface PushNotificationPayload {
  title: string;
  body: string;
  tag: string;
  sid?: string;
  url?: string;
  kind: NotifyKind;
}

export interface GroupedNotifyItem {
  kind: NotifyKind;
  title: string;
  body: string;
}

export const NOTIFICATION_LIMITS = {
  fcmMessageBytes: 4096,
  fcmTopicMessageBytes: 2048,
  apnsRemoteNotificationBytes: 4096,
  webPushMinimumPayloadBytes: 4096,
  jarvisSoftPayloadBytes: 2048,
  titleChars: 56,
  bodyChars: 96,
  groupedBodyChars: 180,
} as const;

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Strip markup/noise before the text is spoken or shown inside a short OS notification. */
export function cleanNotifyText(s: string): string {
  return String(s || "")
    .replace(ANSI_RE, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*`>_~]/g, "")
    .replace(CONTROL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function payloadBytes(payload: object): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function clipChars(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  if (max <= 3) return chars.slice(0, max).join("");
  return chars.slice(0, max - 3).join("").trimEnd() + "...";
}

function clipUtf8(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  const suffix = "...";
  const chars = [...s];
  while (chars.length && Buffer.byteLength(chars.join("").trimEnd() + suffix, "utf8") > maxBytes) chars.pop();
  return chars.join("").trimEnd() + suffix;
}

function sessionIdFromTag(tag?: string): string | undefined {
  const t = cleanNotifyText(tag || "");
  if (!t || ["done", "error", "machine", "jarvis-grouped", "jarvis-push-test"].includes(t)) return undefined;
  return t;
}

function subjectFromTitle(title: string): string {
  const t = title.replace(/^Jarvis\s*[·-]\s*/i, "").trim();
  const [left] = t.split(/\s+[·-]\s+/);
  return cleanNotifyText(left || t);
}

function compactError(title: string, body: string): string {
  const subject = subjectFromTitle(title);
  if (subject && body) return `${subject}: ${body}`;
  return body || subject || "Veja os detalhes no Jarvis.";
}

function compactMachine(title: string, body: string): string {
  if (title && body) return `${title}: ${body}`;
  return title || body || "Atualização do Jarvis.";
}

function doneBody(title: string, body: string): string {
  if (/teste de notific/i.test(title)) return body || "Push funcionando.";
  if (/aprova/i.test(title)) return compactMachine(title, body);
  // Objective summary of what was worked on = the FIRST sentence of the assistant's final reply.
  // We deliberately do NOT dump the full reply (cost/leak) nor the session id (useless to a human
  // and a waste of the tiny notification budget) nor a generic "open the session" filler. The OS
  // notification still clips this to the body limit; taking the first sentence keeps it short and
  // meaningful. Tapping opens the right session via the payload sid, so identity is not lost.
  const clean = cleanNotifyText(body);
  const firstSentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  if (firstSentence) return firstSentence;
  return "Concluído.";
}

function fitPayload(payload: PushNotificationPayload, maxBytes = NOTIFICATION_LIMITS.jarvisSoftPayloadBytes): PushNotificationPayload {
  let out: PushNotificationPayload = {
    ...payload,
    title: clipChars(payload.title, NOTIFICATION_LIMITS.titleChars),
    body: clipChars(payload.body, NOTIFICATION_LIMITS.bodyChars),
  };
  if (payloadBytes(out) <= maxBytes) return out;
  out = { ...out, body: clipUtf8(out.body, Math.max(0, maxBytes - payloadBytes({ ...out, body: "" }))) };
  if (payloadBytes(out) <= maxBytes) return out;
  out = { ...out, title: clipUtf8(out.title, Math.max(0, maxBytes - payloadBytes({ ...out, title: "" }))) };
  return out;
}

export function formatPushPayload(kind: NotifyKind, title: string, body: string, tag?: string, url?: string): PushNotificationPayload {
  const cleanTitle = cleanNotifyText(title);
  const cleanBody = cleanNotifyText(body);
  const sid = sessionIdFromTag(tag);
  let outTitle = "Jarvis";
  let outBody = "";

  if (kind === "done") {
    outTitle = /teste de notific/i.test(cleanTitle) ? "Jarvis · teste" : "Jarvis · concluído";
    outBody = doneBody(cleanTitle, cleanBody);
  } else if (kind === "error") {
    outTitle = "Jarvis · falhou";
    outBody = compactError(cleanTitle, cleanBody);
  } else if (kind === "machine") {
    outTitle = "Jarvis · sistema";
    outBody = compactMachine(cleanTitle, cleanBody);
  } else {
    outTitle = cleanTitle || "Jarvis";
    outBody = cleanBody || "Nova sugestão disponível.";
  }

  const safeUrl = typeof url === "string" && url.length <= 2_048 && ((url.startsWith("/") && !url.startsWith("//")) || url.startsWith("jarvis://assistant/")) ? url : undefined;
  return fitPayload({ title: outTitle, body: outBody, tag: cleanNotifyText(tag || kind) || kind, ...(kind === "personal" ? {} : { sid }), ...(safeUrl ? { url: safeUrl } : {}), kind });
}

export function formatGroupedPushPayload(items: GroupedNotifyItem[]): PushNotificationPayload {
  const safe = items.map((i) => ({ kind: i.kind, title: cleanNotifyText(i.title), body: cleanNotifyText(i.body) })).filter((i) => i.title || i.body);
  const n = safe.length;
  const lines = safe.slice(-4).map((i) => {
    const prefix = i.kind === "error" ? "Falha" : i.kind === "machine" ? "Sistema" : i.kind === "personal" ? "Sugestão" : "Ok";
    return `${prefix}: ${i.title || i.body}`;
  });
  const payload: PushNotificationPayload = {
    title: `Jarvis · ${n || 0} eventos`,
    body: clipChars(lines.join(" | "), NOTIFICATION_LIMITS.groupedBodyChars),
    tag: "jarvis-grouped",
    kind: "machine",
  };
  return fitPayload(payload);
}
