import { createHash, randomUUID } from "node:crypto";
import ICAL from "ical.js";
import type { CalDavCredential, CalDavSecretResolver } from "./calendar-context.js";
import type { PersonalActionExecutor } from "./personal-actions.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1_024;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_UNDO_TTL_MS = 15 * 60_000;

export const CALDAV_ACTION_KINDS = Object.freeze({
  create: "calendar.caldav.create",
  update: "calendar.caldav.update",
  delete: "calendar.caldav.delete",
  undo: "calendar.caldav.undo",
});

export type CalDavActionOperation = "create" | "update" | "delete";

export interface CalDavActionCalendar {
  href: string;
  label?: string;
}

export interface CalDavActionKinds {
  create: string;
  update: string;
  delete: string;
  undo: string;
}

export interface CalDavActionEventInput {
  calendarHref?: string;
  eventHref?: string;
  /** Optional for create; a semantic UID is derived from the normalized event when omitted. */
  uid?: string;
  title: string;
  startAt: number;
  endAt: number;
  timeZone: string;
  location?: string;
  description?: string;
  remindersMinutes?: number[];
  expectedEtag?: string;
}

export interface CalDavActionExecutorOptions {
  endpoint: string;
  calendars: readonly (string | CalDavActionCalendar)[];
  secretRef: string;
  resolveSecret: CalDavSecretResolver;
  sourceId?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  undoTtlMs?: number;
  maxUndoEntries?: number;
  actionKinds?: Partial<CalDavActionKinds>;
}

export type CalDavActionErrorCode =
  | "CALDAV_ABORTED"
  | "CALDAV_TIMEOUT"
  | "CALDAV_NETWORK_ERROR"
  | "CALDAV_HTTP_ERROR"
  | "CALDAV_REDIRECT_BLOCKED"
  | "CALDAV_DUPLICATE"
  | "CALDAV_PRECONDITION_FAILED"
  | "CALDAV_NOT_FOUND"
  | "CALDAV_RESPONSE_TOO_LARGE"
  | "CALDAV_INVALID_RESPONSE"
  | "CALDAV_SECRET_RESOLUTION_FAILED"
  | "CALDAV_UNDO_UNAVAILABLE";

export class CalDavActionError extends Error {
  constructor(
    readonly code: CalDavActionErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CalDavActionError";
  }
}

export interface CalDavActionExecutorBundle {
  create: PersonalActionExecutor;
  update: PersonalActionExecutor;
  delete: PersonalActionExecutor;
  undo: PersonalActionExecutor;
  executors: readonly PersonalActionExecutor[];
  clearUndo(principalId?: string): void;
}

interface NormalizedCalendar {
  href: string;
  label: string;
  url: URL;
}

interface NormalizedEvent {
  operation: CalDavActionOperation;
  calendar: NormalizedCalendar;
  eventHref: string;
  eventUrl: URL;
  uid: string;
  title: string;
  startAt: number;
  endAt: number;
  timeZone: string;
  location?: string;
  description?: string;
  remindersMinutes: number[];
  expectedEtag?: string;
}

type UndoRecord = {
  principalId: string;
  token: string;
  expiresAt: number;
  originalOperation: CalDavActionOperation;
  calendarHref: string;
  eventHref: string;
  eventUrl: URL;
  uid: string;
} & (
  | { inverse: "delete"; expectedEtag: string }
  | { inverse: "put"; condition: "if-match"; expectedEtag: string; ics: string }
  | { inverse: "put"; condition: "if-none-match"; ics: string }
);

type WithoutUndoMetadata<T> = T extends unknown ? Omit<T, "token" | "expiresAt"> : never;
type PendingUndoRecord = WithoutUndoMetadata<UndoRecord>;

interface OperationScope {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

function actionError(code: CalDavActionErrorCode, message: string, status?: number): CalDavActionError {
  return new CalDavActionError(code, message, status);
}

function assertPlainRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CalDAV action payload must be an object");
}

function assertOnlyKeys(payload: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unexpected = Object.keys(payload).find((key) => !allowed.has(key));
  if (unexpected) throw new Error("CalDAV action payload contains unsupported fields");
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength || /[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength || /[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function semanticEventUid(input: { title: string; startAt: number; endAt: number; timeZone: string; location?: string }): string {
  const text = (value: string | undefined) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("und");
  const digest = createHash("sha256").update(JSON.stringify([
    text(input.title), input.startAt, input.endAt, input.timeZone, text(input.location),
  ])).digest("hex");
  return `jarvis-semantic-${digest}@local`;
}

function requiredSingleLineText(value: unknown, field: string, maxLength: number): string {
  const result = requiredText(value, field, maxLength);
  if (/[\r\n]/.test(result)) throw new Error(`${field} is invalid`);
  return result;
}

function optionalSingleLineText(value: unknown, field: string, maxLength: number): string | undefined {
  const result = optionalText(value, field, maxLength);
  if (result !== undefined && /[\r\n]/.test(result)) throw new Error(`${field} is invalid`);
  return result;
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${field} must be an epoch timestamp`);
  }
  return value;
}

function timezone(value: unknown): string {
  const result = requiredText(value, "timeZone", 128);
  if (!/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/.test(result)) throw new Error("timeZone is invalid");
  try {
    new Intl.DateTimeFormat("en", { timeZone: result }).format(0);
  } catch {
    throw new Error("timeZone is not supported");
  }
  return result;
}

function reminders(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("remindersMinutes must contain at most 8 reminders");
  const normalized = value.map((item) => {
    if (!Number.isSafeInteger(item) || Number(item) < 0 || Number(item) > 28 * 24 * 60) {
      throw new Error("remindersMinutes contains an invalid reminder");
    }
    return Number(item);
  });
  if (new Set(normalized).size !== normalized.length) throw new Error("remindersMinutes contains duplicate reminders");
  return normalized.sort((left, right) => left - right);
}

function strongEtag(value: unknown, field = "expectedEtag"): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 512 || value.startsWith("W/")
    || !/^"[\x21\x23-\x7E\x80-\xFF]*"$/.test(value)) {
    throw new Error(`${field} must be a strong quoted ETag`);
  }
  return value;
}

function responseEtag(response: Response): string | undefined {
  const value = response.headers.get("etag");
  if (!value) return undefined;
  try { return strongEtag(value, "response ETag"); }
  catch { return undefined; }
}

function unsafeEncodedPath(pathname: string): boolean {
  if (/%(?:25|2f|5c|00|2e)/i.test(pathname)) return true;
  return pathname.split("/").some((part) => {
    if (!part) return false;
    try {
      const decoded = decodeURIComponent(part);
      return decoded === "." || decoded === ".." || /[\\/\u0000-\u001F\u007F]/.test(decoded);
    } catch {
      return true;
    }
  });
}

function secureUrl(value: string, base?: URL): URL {
  if (!value || value.length > 4_096 || /[\\\r\n\u0000]/.test(value)) throw new Error("CalDAV URL is invalid");
  let url: URL;
  try { url = base ? new URL(value, base) : new URL(value); }
  catch { throw new Error("CalDAV URL is invalid"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("CalDAV URL must not contain credentials, query parameters, or fragments");
  const loopback = url.protocol === "http:" && new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname);
  if (url.protocol !== "https:" && !loopback) throw new Error("CalDAV URL must use HTTPS or loopback HTTP");
  if (base && url.origin !== base.origin) throw new Error("CalDAV URL must remain on the configured origin");
  if (unsafeEncodedPath(url.pathname)) throw new Error("CalDAV URL path is invalid");
  return url;
}

function calendarUrl(value: string, endpoint: URL): URL {
  const url = secureUrl(value, endpoint);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function configuredEventUrl(value: string, calendar: NormalizedCalendar): URL {
  const url = secureUrl(value, calendar.url);
  const relativePath = url.pathname.startsWith(calendar.url.pathname)
    ? url.pathname.slice(calendar.url.pathname.length)
    : "";
  if (!relativePath || relativePath.includes("/") || !relativePath.toLowerCase().endsWith(".ics")) {
    throw new Error("CalDAV event path must be a direct ICS child of the configured calendar");
  }
  return url;
}

function derivedEventUrl(uid: string, calendar: NormalizedCalendar): URL {
  const digest = createHash("sha256").update(uid, "utf8").digest("hex").slice(0, 40);
  return new URL(`jarvis-${digest}.ics`, calendar.url);
}

function escapeIcsText(value: string): string {
  return value.replace(/\r\n?|\n/g, "\n").replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}

function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const character of line) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (current && currentBytes + bytes > limit) {
      parts.push(current);
      current = character;
      currentBytes = bytes;
      limit = 74;
    } else {
      current += character;
      currentBytes += bytes;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function utcIcs(timestampValue: number): string {
  return new Date(timestampValue).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Serializes one bounded VEVENT using RFC 5545 text escaping, CRLF, and 75-octet folding. */
function serializeCalDavEvent(event: Omit<NormalizedEvent, "operation" | "calendar" | "eventHref" | "eventUrl" | "expectedEtag">, now: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jarvis//Personal Context CalDAV//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-TIMEZONE:${escapeIcsText(event.timeZone)}`,
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${utcIcs(now)}`,
    `DTSTART:${utcIcs(event.startAt)}`,
    `DTEND:${utcIcs(event.endAt)}`,
    `X-JARVIS-TIMEZONE:${escapeIcsText(event.timeZone)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
    "STATUS:CONFIRMED",
    ...event.remindersMinutes.flatMap((minutes) => [
      "BEGIN:VALARM",
      minutes === 0 ? "TRIGGER:PT0M" : `TRIGGER:-PT${minutes}M`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(`Reminder: ${event.title}`)}`,
      "END:VALARM",
    ]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function createScope(parent: AbortSignal, timeoutMs: number): OperationScope {
  const controller = new AbortController();
  let didTimeout = false;
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) abortFromParent();
  else parent.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error("CalDAV action timeout"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abortFromParent);
    },
  };
}

function abortFailure(scope: OperationScope): CalDavActionError {
  return scope.timedOut()
    ? actionError("CALDAV_TIMEOUT", "CalDAV action timed out")
    : actionError("CALDAV_ABORTED", "CalDAV action was cancelled");
}

function abortable<T>(promise: Promise<T>, scope: OperationScope): Promise<T> {
  if (scope.signal.aborted) return Promise.reject(abortFailure(scope));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortFailure(scope));
    scope.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { scope.signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { scope.signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function authHeaders(credential: CalDavCredential): Headers {
  const headers = new Headers();
  if (credential.kind === "basic") {
    if (typeof credential.username !== "string" || !credential.username || credential.username.length > 512
      || typeof credential.password !== "string" || !credential.password || credential.password.length > 8_192
      || /[\r\n\u0000]/.test(credential.username + credential.password)) {
      throw actionError("CALDAV_SECRET_RESOLUTION_FAILED", "CalDAV credential resolution failed");
    }
    headers.set("Authorization", `Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`);
  } else if (credential.kind === "bearer") {
    if (typeof credential.token !== "string" || !credential.token || credential.token.length > 8_192 || /[\r\n\u0000]/.test(credential.token)) {
      throw actionError("CALDAV_SECRET_RESOLUTION_FAILED", "CalDAV credential resolution failed");
    }
    headers.set("Authorization", `Bearer ${credential.token}`);
  } else {
    throw actionError("CALDAV_SECRET_RESOLUTION_FAILED", "CalDAV credential resolution failed");
  }
  return headers;
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw actionError("CALDAV_RESPONSE_TOO_LARGE", "CalDAV response exceeds the configured size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw actionError("CALDAV_RESPONSE_TOO_LARGE", "CalDAV response exceeds the configured size limit");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof CalDavActionError) throw error;
    throw actionError("CALDAV_INVALID_RESPONSE", "CalDAV response could not be read");
  } finally {
    reader.releaseLock();
  }
}

function assertCapturedUid(ics: string, expectedUid: string): void {
  try {
    const calendar = new ICAL.Component(ICAL.parse(ics));
    if (calendar.name !== "vcalendar") throw new Error("not a calendar");
    const events = calendar.getAllSubcomponents("vevent");
    if (!events.length || events.some((event) => event.getFirstPropertyValue("uid") !== expectedUid)) {
      throw new Error("event UID mismatch");
    }
  } catch {
    throw actionError("CALDAV_INVALID_RESPONSE", "CalDAV event response does not match the approved resource");
  }
}

function boundedOption(value: number | undefined, fallback: number, minimum: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return Math.min(maximum, Math.max(minimum, value));
}

function publicPreview(event: NormalizedEvent): Record<string, unknown> {
  return {
    operation: event.operation,
    calendar: { href: event.calendar.href, label: event.calendar.label },
    eventHref: event.eventHref,
    uid: event.uid,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    timeZone: event.timeZone,
    location: event.location ?? null,
    remindersMinutes: [...event.remindersMinutes],
    concurrencyProtected: event.operation === "create" || !!event.expectedEtag,
    ...(event.operation === "delete" ? { consequence: "calendar_event_will_be_deleted" } : {}),
  };
}

class CalDavActionBackend {
  private readonly endpoint: URL;
  private readonly calendars = new Map<string, NormalizedCalendar>();
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly undoTtlMs: number;
  private readonly maxUndoEntries: number;
  private readonly undoRecords = new Map<string, UndoRecord>();
  private readonly undoTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly sourceId: string;

  constructor(private readonly options: CalDavActionExecutorOptions) {
    this.endpoint = secureUrl(options.endpoint);
    if (!Array.isArray(options.calendars) || !options.calendars.length) throw new Error("at least one configured CalDAV calendar is required");
    for (const input of options.calendars) {
      if (typeof input !== "string" && (!input || typeof input !== "object")) throw new Error("configured CalDAV calendar is invalid");
      const href = typeof input === "string" ? input : input.href;
      const url = calendarUrl(requiredText(href, "calendar href", 4_096), this.endpoint);
      const normalized: NormalizedCalendar = {
        href: url.toString(),
        label: typeof input === "string" ? url.pathname : optionalSingleLineText(input.label, "calendar label", 256) || url.pathname,
        url,
      };
      if (this.calendars.has(normalized.href)) throw new Error("duplicate configured CalDAV calendar");
      this.calendars.set(normalized.href, normalized);
    }
    if (typeof options.resolveSecret !== "function" || !options.secretRef?.trim() || options.secretRef.length > 512 || /[\r\n\u0000]/.test(options.secretRef)) {
      throw new Error("CalDAV secret resolver and secretRef are required");
    }
    if (options.fetch !== undefined && typeof options.fetch !== "function") throw new Error("CalDAV fetch implementation is invalid");
    if (options.now !== undefined && typeof options.now !== "function") throw new Error("CalDAV clock is invalid");
    this.fetcher = options.fetch || fetch;
    const clock = options.now || Date.now;
    this.now = () => timestamp(clock(), "CalDAV clock");
    this.timeoutMs = boundedOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 60_000, "timeoutMs");
    this.maxRequestBytes = boundedOption(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 1_024, 4 * 1024 * 1024, "maxRequestBytes");
    this.maxResponseBytes = boundedOption(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1_024, 16 * 1024 * 1024, "maxResponseBytes");
    this.undoTtlMs = boundedOption(options.undoTtlMs, DEFAULT_UNDO_TTL_MS, 60_000, 24 * 60 * 60_000, "undoTtlMs");
    this.maxUndoEntries = Math.floor(boundedOption(options.maxUndoEntries, 256, 1, 10_000, "maxUndoEntries"));
    this.sourceId = requiredSingleLineText(options.sourceId || "caldav-calendar", "sourceId", 256);
  }

  private selectCalendar(value: unknown): NormalizedCalendar {
    if (value === undefined && this.calendars.size === 1) return this.calendars.values().next().value!;
    if (typeof value !== "string") throw new Error("calendarHref is required when more than one calendar is configured");
    const normalized = calendarUrl(value, this.endpoint).toString();
    const calendar = this.calendars.get(normalized);
    if (!calendar) throw new Error("calendarHref is not an explicitly configured calendar");
    return calendar;
  }

  parse(payload: Record<string, unknown>, operation: CalDavActionOperation): NormalizedEvent {
    assertPlainRecord(payload);
    const allowed = new Set(["calendarHref", "uid", "title", "startAt", "endAt", "timeZone", "location", "description", "remindersMinutes"]);
    if (operation !== "create") { allowed.add("eventHref"); allowed.add("expectedEtag"); }
    assertOnlyKeys(payload, allowed);
    const calendar = this.selectCalendar(payload.calendarHref);
    const title = requiredText(payload.title, "title", 512);
    const startAt = timestamp(payload.startAt, "startAt");
    const endAt = timestamp(payload.endAt, "endAt");
    if (endAt <= startAt || endAt - startAt > 366 * DAY_MS) throw new Error("calendar event range is invalid");
    const timeZone = timezone(payload.timeZone);
    const location = optionalText(payload.location, "location", 1_024);
    const uid = operation === "create" && payload.uid === undefined
      ? semanticEventUid({ title, startAt, endAt, timeZone, location })
      : requiredSingleLineText(payload.uid, "uid", 255);
    const eventUrl = operation === "create"
      ? derivedEventUrl(uid, calendar)
      : payload.eventHref === undefined
        ? derivedEventUrl(uid, calendar)
        : configuredEventUrl(requiredText(payload.eventHref, "eventHref", 4_096), calendar);
    return {
      operation,
      calendar,
      eventHref: eventUrl.toString(),
      eventUrl,
      uid,
      title,
      startAt,
      endAt,
      timeZone,
      location,
      description: optionalText(payload.description, "description", 16_384),
      remindersMinutes: reminders(payload.remindersMinutes),
      ...(operation !== "create" ? { expectedEtag: strongEtag(payload.expectedEtag) } : {}),
    };
  }

  preview(payload: Record<string, unknown>, operation: CalDavActionOperation): Record<string, unknown> {
    return publicPreview(this.parse(payload, operation));
  }

  private async run<T>(parent: AbortSignal, task: (scope: OperationScope) => Promise<T>): Promise<T> {
    const scope = createScope(parent, this.timeoutMs);
    try { return await task(scope); }
    catch (error) {
      if (error instanceof CalDavActionError) throw error;
      if (scope.signal.aborted) throw abortFailure(scope);
      throw error;
    } finally { scope.dispose(); }
  }

  private async credential(principalId: string, scope: OperationScope): Promise<CalDavCredential> {
    if (scope.signal.aborted) throw abortFailure(scope);
    try {
      const resolved = await abortable(Promise.resolve(this.options.resolveSecret(this.options.secretRef, {
        principalId,
        sourceId: this.sourceId,
        signal: scope.signal,
      })), scope);
      authHeaders(resolved);
      return resolved;
    } catch (error) {
      if (error instanceof CalDavActionError && (error.code === "CALDAV_ABORTED" || error.code === "CALDAV_TIMEOUT")) throw error;
      if (scope.signal.aborted) throw abortFailure(scope);
      throw actionError("CALDAV_SECRET_RESOLUTION_FAILED", "CalDAV credential resolution failed");
    }
  }

  private async request(
    method: "GET" | "PUT" | "DELETE",
    url: URL,
    credential: CalDavCredential,
    scope: OperationScope,
    extraHeaders: Record<string, string>,
    body?: string,
  ): Promise<Response> {
    if (scope.signal.aborted) throw abortFailure(scope);
    const headers = authHeaders(credential);
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    let response: Response;
    try {
      response = await abortable(Promise.resolve(this.fetcher(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: scope.signal,
        redirect: "manual",
      })), scope);
    } catch (error) {
      if (error instanceof CalDavActionError) throw error;
      if (scope.signal.aborted) throw abortFailure(scope);
      throw actionError("CALDAV_NETWORK_ERROR", "CalDAV network request failed");
    }
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw actionError("CALDAV_REDIRECT_BLOCKED", "CalDAV redirects are not allowed", response.status);
    }
    return response;
  }

  private httpFailure(response: Response): never {
    const status = response.status;
    void response.body?.cancel().catch(() => undefined);
    if (status === 412) throw actionError("CALDAV_PRECONDITION_FAILED", "CalDAV resource changed after preview", status);
    if (status === 404) throw actionError("CALDAV_NOT_FOUND", "CalDAV event was not found", status);
    throw actionError("CALDAV_HTTP_ERROR", `CalDAV request failed with HTTP ${status}`, status);
  }

  private assertRequestSize(ics: string): void {
    if (Buffer.byteLength(ics, "utf8") > this.maxRequestBytes) throw new Error("serialized calendar event exceeds the configured request size limit");
  }

  private async capture(
    event: NormalizedEvent,
    credential: CalDavCredential,
    scope: OperationScope,
  ): Promise<{ ics: string; etag?: string } | undefined> {
    const response = await this.request("GET", event.eventUrl, credential, scope, {
      Accept: "text/calendar",
      "If-Match": event.expectedEtag!,
    });
    if (response.status === 405 || response.status === 501) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    if (!response.ok) this.httpFailure(response);
    const ics = await readBounded(response, this.maxResponseBytes);
    if (!/BEGIN:VCALENDAR(?:\r?\n)/i.test(ics) || !/BEGIN:VEVENT(?:\r?\n)/i.test(ics)) {
      throw actionError("CALDAV_INVALID_RESPONSE", "CalDAV event response is not a valid calendar resource");
    }
    assertCapturedUid(ics, event.uid);
    const etag = responseEtag(response);
    if (etag && etag !== event.expectedEtag) {
      throw actionError("CALDAV_PRECONDITION_FAILED", "CalDAV resource changed after preview", 412);
    }
    return { ics, ...(etag ? { etag } : {}) };
  }

  private pruneUndo(): void {
    const now = this.now();
    for (const [token, record] of this.undoRecords) if (record.expiresAt <= now) this.deleteUndo(token);
    while (this.undoRecords.size >= this.maxUndoEntries) this.deleteUndo(this.undoRecords.keys().next().value!);
  }

  private deleteUndo(token: string): void {
    this.undoRecords.delete(token);
    const timer = this.undoTimers.get(token);
    if (timer) clearTimeout(timer);
    this.undoTimers.delete(token);
  }

  private saveUndo(record: PendingUndoRecord): { token: string; expiresAt: number; durable: false } {
    this.pruneUndo();
    const token = randomUUID();
    const expiresAt = this.now() + this.undoTtlMs;
    this.undoRecords.set(token, { ...record, token, expiresAt } as UndoRecord);
    const timer = setTimeout(() => this.deleteUndo(token), this.undoTtlMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.undoTimers.set(token, timer);
    return { token, expiresAt, durable: false };
  }

  clearUndo(principalId?: string): void {
    if (principalId === undefined) for (const token of [...this.undoRecords.keys()]) this.deleteUndo(token);
    else for (const [token, record] of this.undoRecords) if (record.principalId === principalId) this.deleteUndo(token);
  }

  async create(payload: Record<string, unknown>, principalId: string, signal: AbortSignal, markDispatched?: () => void): Promise<Record<string, unknown>> {
    const event = this.parse(payload, "create");
    const ics = serializeCalDavEvent(event, this.now());
    this.assertRequestSize(ics);
    return this.run(signal, async (scope) => {
      const credential = await this.credential(principalId, scope);
      markDispatched?.();
      const response = await this.request("PUT", event.eventUrl, credential, scope, {
        "Content-Type": "text/calendar; charset=utf-8",
        "If-None-Match": "*",
      }, ics);
      if (response.status === 412) {
        await response.body?.cancel().catch(() => undefined);
        throw actionError("CALDAV_DUPLICATE", "CalDAV event already exists", response.status);
      }
      if (!response.ok) this.httpFailure(response);
      const etag = responseEtag(response);
      await response.body?.cancel().catch(() => undefined);
      const undo = etag
        ? { available: true, ...this.saveUndo({
          principalId, originalOperation: "create", inverse: "delete", expectedEtag: etag,
          calendarHref: event.calendar.href, eventHref: event.eventHref, eventUrl: event.eventUrl, uid: event.uid,
        }) }
        : { available: false, durable: false, reason: "server_did_not_return_a_strong_etag" };
      return { operation: "create", eventHref: event.eventHref, uid: event.uid, ...(etag ? { etag } : {}), undo };
    });
  }

  async update(payload: Record<string, unknown>, principalId: string, signal: AbortSignal, markDispatched?: () => void): Promise<Record<string, unknown>> {
    const event = this.parse(payload, "update");
    const ics = serializeCalDavEvent(event, this.now());
    this.assertRequestSize(ics);
    return this.run(signal, async (scope) => {
      const credential = await this.credential(principalId, scope);
      const previous = await this.capture(event, credential, scope);
      markDispatched?.();
      const response = await this.request("PUT", event.eventUrl, credential, scope, {
        "Content-Type": "text/calendar; charset=utf-8",
        "If-Match": event.expectedEtag!,
      }, ics);
      if (!response.ok) this.httpFailure(response);
      const etag = responseEtag(response);
      await response.body?.cancel().catch(() => undefined);
      const previousIsRestorable = !!previous && Buffer.byteLength(previous.ics, "utf8") <= this.maxRequestBytes;
      const undo = previousIsRestorable && previous && etag
        ? { available: true, ...this.saveUndo({
          principalId, originalOperation: "update", inverse: "put", condition: "if-match", expectedEtag: etag,
          ics: previous.ics, calendarHref: event.calendar.href, eventHref: event.eventHref, eventUrl: event.eventUrl, uid: event.uid,
        }) }
        : { available: false, durable: false, reason: !previous
          ? "server_does_not_support_safe_capture"
          : !previousIsRestorable
            ? "captured_event_exceeds_restore_limit"
            : "server_did_not_return_a_strong_etag" };
      return { operation: "update", eventHref: event.eventHref, uid: event.uid, ...(etag ? { etag } : {}), undo };
    });
  }

  async delete(payload: Record<string, unknown>, principalId: string, signal: AbortSignal, markDispatched?: () => void): Promise<Record<string, unknown>> {
    const event = this.parse(payload, "delete");
    return this.run(signal, async (scope) => {
      const credential = await this.credential(principalId, scope);
      const previous = await this.capture(event, credential, scope);
      markDispatched?.();
      const response = await this.request("DELETE", event.eventUrl, credential, scope, { "If-Match": event.expectedEtag! });
      if (!response.ok) this.httpFailure(response);
      await response.body?.cancel().catch(() => undefined);
      const previousIsRestorable = !!previous && Buffer.byteLength(previous.ics, "utf8") <= this.maxRequestBytes;
      const undo = previousIsRestorable && previous
        ? { available: true, ...this.saveUndo({
          principalId, originalOperation: "delete", inverse: "put", condition: "if-none-match", ics: previous.ics,
          calendarHref: event.calendar.href, eventHref: event.eventHref, eventUrl: event.eventUrl, uid: event.uid,
        }) }
        : { available: false, durable: false, reason: previous ? "captured_event_exceeds_restore_limit" : "server_does_not_support_safe_capture" };
      return { operation: "delete", eventHref: event.eventHref, uid: event.uid, undo };
    });
  }

  undoPreview(payload: Record<string, unknown>): Record<string, unknown> {
    assertPlainRecord(payload);
    assertOnlyKeys(payload, new Set(["undoToken"]));
    const token = requiredSingleLineText(payload.undoToken, "undoToken", 128);
    return { operation: "undo", undoToken: token, durability: "memory_only", requiresFreshResource: true };
  }

  async undo(payload: Record<string, unknown>, principalId: string, signal: AbortSignal, markDispatched?: () => void): Promise<Record<string, unknown>> {
    this.undoPreview(payload);
    const token = String(payload.undoToken);
    const record = this.undoRecords.get(token);
    if (!record || record.principalId !== principalId || record.expiresAt <= this.now()) {
      if (record?.expiresAt && record.expiresAt <= this.now()) this.deleteUndo(token);
      throw actionError("CALDAV_UNDO_UNAVAILABLE", "CalDAV undo is unavailable or expired");
    }
    return this.run(signal, async (scope) => {
      const credential = await this.credential(principalId, scope);
      let response: Response;
      if (record.inverse === "delete") {
        markDispatched?.();
        response = await this.request("DELETE", record.eventUrl, credential, scope, { "If-Match": record.expectedEtag });
      } else {
        this.assertRequestSize(record.ics);
        markDispatched?.();
        response = await this.request("PUT", record.eventUrl, credential, scope, {
          "Content-Type": "text/calendar; charset=utf-8",
          ...(record.condition === "if-match" ? { "If-Match": record.expectedEtag } : { "If-None-Match": "*" }),
        }, record.ics);
        if (record.condition === "if-none-match" && response.status === 412) {
          await response.body?.cancel().catch(() => undefined);
          throw actionError("CALDAV_DUPLICATE", "CalDAV event already exists", response.status);
        }
      }
      if (!response.ok) this.httpFailure(response);
      await response.body?.cancel().catch(() => undefined);
      this.deleteUndo(token);
      return {
        operation: "undo",
        restoredOperation: record.originalOperation,
        eventHref: record.eventHref,
        uid: record.uid,
        undo: { available: false, durable: false },
      };
    });
  }
}

function checkedKinds(options: CalDavActionExecutorOptions): Readonly<CalDavActionKinds> {
  const kinds = { ...CALDAV_ACTION_KINDS, ...options.actionKinds };
  const values = Object.values(kinds);
  if (values.some((kind) => typeof kind !== "string" || !kind.trim() || kind !== kind.trim() || kind.length > 256 || /[\r\n\u0000]/.test(kind))
    || new Set(values).size !== values.length) {
    throw new Error("CalDAV action kinds must be non-empty and unique");
  }
  return Object.freeze(kinds);
}

/** Creates principal-safe CalDAV executors. Registration remains the caller's responsibility. */
export function createCalDavActionExecutors(options: CalDavActionExecutorOptions): CalDavActionExecutorBundle {
  const backend = new CalDavActionBackend(options);
  const kinds = checkedKinds(options);
  const create: PersonalActionExecutor = {
    kind: kinds.create,
    risk: "external_reversible",
    preview: (payload) => backend.preview(payload, "create"),
    execute: (payload, context) => backend.create(payload, context.principalId, context.signal, context.markDispatched),
  };
  const update: PersonalActionExecutor = {
    kind: kinds.update,
    risk: "external_reversible",
    preview: (payload) => backend.preview(payload, "update"),
    execute: (payload, context) => backend.update(payload, context.principalId, context.signal, context.markDispatched),
  };
  const remove: PersonalActionExecutor = {
    kind: kinds.delete,
    risk: "consequential",
    preview: (payload) => backend.preview(payload, "delete"),
    execute: (payload, context) => backend.delete(payload, context.principalId, context.signal, context.markDispatched),
  };
  const undo: PersonalActionExecutor = {
    kind: kinds.undo,
    risk: "external_reversible",
    preview: (payload) => backend.undoPreview(payload),
    execute: (payload, context) => backend.undo(payload, context.principalId, context.signal, context.markDispatched),
  };
  return {
    create,
    update,
    delete: remove,
    undo,
    executors: Object.freeze([create, update, remove, undo]),
    clearUndo: (principalId) => backend.clearUndo(principalId),
  };
}
