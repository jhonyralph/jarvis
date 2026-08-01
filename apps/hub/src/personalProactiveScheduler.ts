import { randomUUID } from "node:crypto";
import type { ContextSuggestion, PersonalAssistantSettings } from "@jarvis/protocol";
import { cleanNotifyText, NOTIFICATION_LIMITS } from "./notifyFormat.js";

type Awaitable<T> = T | Promise<T>;

export type PersonalProactiveLocale = "pt" | "en" | "es";

export interface PersonalProactiveTarget {
  principalId: string;
  deviceId: string;
  generation: number;
  settings: PersonalAssistantSettings;
  /** Separate, explicit opt-in for unsolicited notifications. */
  proactiveEnabled: boolean;
  disabledKinds?: string[];
  locale?: string;
  timeZone: string;
}

export interface PersonalProactiveQuery {
  principalId: string;
  deviceId: string;
  generation: number;
  locale: PersonalProactiveLocale;
  timeZone: string;
  at: number;
  /** Deliberately no point/GPS field: background location acquisition is outside this scheduler. */
}

export interface PersonalProactiveCandidate {
  suggestion: ContextSuggestion;
  validFrom?: number;
  validUntil: number;
  dedupeKey?: string;
}

export interface PersonalProactiveDeliveryTarget {
  principalId: string;
  deviceId: string;
  generation: number;
}

export interface PersonalProactiveNotification {
  id: string;
  suggestionId: string;
  kind: string;
  locale: PersonalProactiveLocale;
  title: string;
  body: string;
  tag: string;
  deepLink: string;
  createdAt: number;
  expiresAt: number;
}

export interface PersonalProactiveDeliveryRecord {
  id: string;
  principalId: string;
  deviceId: string;
  generation: number;
  suggestionId: string;
  kind?: string;
  title?: string;
  body?: string;
  deepLink?: string;
  expiresAt?: number;
  dedupeKey: string;
  deliveredAt: number;
  dedupeUntil: number;
  state?: "pending" | "delivered" | "failed";
}

export type PersonalProactiveSuppressionReason =
  | "disabled"
  | "paused"
  | "invalid_target"
  | "duplicate_target"
  | "invalid_timezone"
  | "invalid_policy"
  | "quiet_hours"
  | "daily_limit"
  | "cooldown"
  | "history_error"
  | "query_error"
  | "no_suggestion"
  | "invalid_suggestion"
  | "not_yet_valid"
  | "expired"
  | "low_score"
  | "category_disabled"
  | "duplicate"
  | "send_rejected"
  | "outbox_error"
  | "aborted";

export interface PersonalProactiveDecision {
  principalId?: string;
  deviceId?: string;
  suggestionId?: string;
  allowed: boolean;
  reason?: PersonalProactiveSuppressionReason;
}

export interface PersonalProactiveRunReport {
  startedAt: number;
  completedAt: number;
  targets: number;
  queried: number;
  sent: number;
  suppressed: number;
  errors: number;
  decisions: PersonalProactiveDecision[];
}

export interface PersonalProactiveErrorContext {
  phase: "run" | "list_targets" | "history" | "query" | "send" | "record" | "observer";
  principalId?: string;
  deviceId?: string;
  suggestionId?: string;
}

export interface PersonalProactiveSchedulerOptions {
  listTargets: (signal: AbortSignal) => Awaitable<readonly PersonalProactiveTarget[]>;
  query: (request: PersonalProactiveQuery, signal: AbortSignal) => Awaitable<readonly PersonalProactiveCandidate[]>;
  send: (
    notification: PersonalProactiveNotification,
    target: PersonalProactiveDeliveryTarget,
    signal: AbortSignal,
  ) => Awaitable<boolean | void>;
  readDeliveries?: (
    target: PersonalProactiveDeliveryTarget,
    at: number,
    signal: AbortSignal,
  ) => Awaitable<readonly PersonalProactiveDeliveryRecord[]>;
  recordDelivery?: (record: PersonalProactiveDeliveryRecord) => Awaitable<void>;
  onDecision?: (decision: PersonalProactiveDecision) => Awaitable<void>;
  onError?: (error: unknown, context: PersonalProactiveErrorContext) => void;
  deepLinkFor?: (target: PersonalProactiveDeliveryTarget, suggestion: ContextSuggestion, notificationId: string) => string;
  now?: () => number;
  createId?: () => string;
  intervalMs?: number;
  runImmediately?: boolean;
  dedupeWindowMs?: number;
  maximumNotificationValidityMs?: number;
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

interface ZonedTimeParts {
  dateKey: string;
  minuteOfDay: number;
}

interface ValidPolicy {
  quietStart: number;
  quietEnd: number;
  maxPerDay: number;
  cooldownMs: number;
  minScore: number;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_DEDUPE_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_NOTIFICATION_VALIDITY_MS = 24 * 60 * 60_000;
const HISTORY_RETENTION_MS = 8 * 24 * 60 * 60_000;

function identity(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > 200 || value.trim() !== value) return undefined;
  return /[\u0000-\u001f\u007f]/.test(value) ? undefined : value;
}

function localeOf(value?: string): PersonalProactiveLocale {
  const locale = String(value || "").toLowerCase();
  if (locale === "pt" || locale.startsWith("pt-")) return "pt";
  if (locale === "es" || locale.startsWith("es-")) return "es";
  return "en";
}

function clockMinute(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : undefined;
}

function validPolicy(settings: PersonalAssistantSettings): ValidPolicy | undefined {
  const policy = settings.notifications;
  const quietStart = clockMinute(policy?.quietStart);
  const quietEnd = clockMinute(policy?.quietEnd);
  if (quietStart === undefined || quietEnd === undefined) return undefined;
  if (!Number.isInteger(policy.maxPerDay) || policy.maxPerDay < 0 || policy.maxPerDay > 50) return undefined;
  if (!Number.isFinite(policy.cooldownMinutes) || policy.cooldownMinutes < 0 || policy.cooldownMinutes > 10_080) return undefined;
  if (!Number.isFinite(policy.minScore) || policy.minScore < 0 || policy.minScore > 1) return undefined;
  return {
    quietStart,
    quietEnd,
    maxPerDay: policy.maxPerDay,
    cooldownMs: policy.cooldownMinutes * 60_000,
    minScore: policy.minScore,
  };
}

function zonedTimeParts(at: number, timeZone: string): ZonedTimeParts | undefined {
  if (!Number.isFinite(at) || typeof timeZone !== "string" || !timeZone.trim() || timeZone.length > 100) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(at));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hour = Number(values.hour) % 24;
    const minute = Number(values.minute);
    if (!values.year || !values.month || !values.day || !Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
    return { dateKey: `${values.year}-${values.month}-${values.day}`, minuteOfDay: hour * 60 + minute };
  } catch {
    return undefined;
  }
}

function isQuietMinute(current: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function clip(value: string, maximum: number): string {
  const characters = [...value];
  if (characters.length <= maximum) return value;
  if (maximum <= 3) return characters.slice(0, maximum).join("");
  return `${characters.slice(0, maximum - 3).join("").trimEnd()}...`;
}

function safeDeepLink(value: string, fallback: string): string {
  if (typeof value !== "string" || !value || value.length > 2_048 || /[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  if ((value.startsWith("/") && !value.startsWith("//")) || value.startsWith("jarvis://assistant/")) return value;
  return fallback;
}

function defaultDeepLink(suggestion: ContextSuggestion, notificationId?: string): string {
  const query = new URLSearchParams({ suggestion: suggestion.id });
  if (notificationId) query.set("notification", notificationId);
  return `/#personal-assistant?${query}`;
}

export function formatPersonalProactiveNotification(input: {
  id: string;
  suggestion: ContextSuggestion;
  locale?: string;
  createdAt: number;
  expiresAt: number;
  deepLink?: string;
}): PersonalProactiveNotification {
  const locale = localeOf(input.locale);
  const copy = {
    pt: { title: "Jarvis · sugestão", officialTitle: "Jarvis · alerta oficial", fallback: "Nova recomendação disponível.", valid: "Válida por", soon: "Expira em breve" },
    en: { title: "Jarvis · suggestion", officialTitle: "Jarvis · official alert", fallback: "A new recommendation is available.", valid: "Valid for", soon: "Expires soon" },
    es: { title: "Jarvis · sugerencia", officialTitle: "Jarvis · alerta oficial", fallback: "Hay una nueva recomendación.", valid: "Válida por", soon: "Expira pronto" },
  }[locale];
  const candidateData = input.suggestion.candidate?.data;
  const officialAlert = !!candidateData && typeof candidateData === "object" && !Array.isArray(candidateData) && (candidateData as Record<string, unknown>).officialAlert === true;
  const subject = cleanNotifyText(input.suggestion.candidate?.title || "");
  const reason = cleanNotifyText(input.suggestion.reasons?.[0] || "");
  const validityMs = Math.max(0, input.expiresAt - input.createdAt);
  const validity = validityMs < 60_000
    ? copy.soon
    : validityMs < 3_600_000
      ? `${copy.valid} ${Math.max(1, Math.round(validityMs / 60_000))} min`
      : validityMs < 86_400_000
        ? `${copy.valid} ${Math.max(1, Math.round(validityMs / 3_600_000))} h`
        : `${copy.valid} ${Math.max(1, Math.round(validityMs / 86_400_000))} d`;
  const prefixMaximum = Math.max(1, NOTIFICATION_LIMITS.bodyChars - [...validity].length - 3);
  const body = `${clip([subject || copy.fallback, reason].filter(Boolean).join(" · "), prefixMaximum)} · ${validity}`;
  const fallbackLink = defaultDeepLink(input.suggestion, input.id);
  return {
    id: input.id,
    suggestionId: input.suggestion.id,
    kind: input.suggestion.kind,
    locale,
    title: clip(officialAlert ? copy.officialTitle : copy.title, NOTIFICATION_LIMITS.titleChars),
    body,
    tag: clip(`personal:${cleanNotifyText(input.suggestion.id) || input.id}`, 128),
    deepLink: safeDeepLink(input.deepLink || fallbackLink, fallbackLink),
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function targetKey(target: PersonalProactiveDeliveryTarget): string {
  return `${target.principalId}\u0000${target.deviceId}`;
}

function deliveryMapKey(record: PersonalProactiveDeliveryRecord): string {
  return `${record.principalId}\u0000${record.deviceId}\u0000${record.id}`;
}

function dedupeKey(candidate: PersonalProactiveCandidate): string {
  const supplied = cleanNotifyText(candidate.dedupeKey || "").slice(0, 256);
  if (supplied) return supplied;
  return `${cleanNotifyText(candidate.suggestion.kind).slice(0, 100)}:${cleanNotifyText(candidate.suggestion.id).slice(0, 150)}`;
}

function validDelivery(record: PersonalProactiveDeliveryRecord, target: PersonalProactiveDeliveryTarget, now: number): boolean {
  return !!identity(record.id)
    && record.principalId === target.principalId
    && record.deviceId === target.deviceId
    && record.generation === target.generation
    && !!identity(record.suggestionId)
    && typeof record.dedupeKey === "string"
    && record.dedupeKey.length > 0
    && record.dedupeKey.length <= 256
    && Number.isFinite(record.deliveredAt)
    && record.deliveredAt <= now + 60_000
    && Number.isFinite(record.dedupeUntil)
    && record.dedupeUntil >= record.deliveredAt
    && (record.state === undefined || record.state === "pending" || record.state === "delivered");
}

export class PersonalProactiveScheduler {
  private readonly options: PersonalProactiveSchedulerOptions;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly intervalMs: number;
  private readonly dedupeWindowMs: number;
  private readonly maximumNotificationValidityMs: number;
  private readonly setIntervalFn: (callback: () => void, intervalMs: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private readonly deliveries = new Map<string, PersonalProactiveDeliveryRecord>();
  private started = false;
  private timerHandle: unknown;
  private activeController?: AbortController;
  private activeRun?: Promise<PersonalProactiveRunReport>;

  constructor(options: PersonalProactiveSchedulerOptions) {
    this.options = options;
    this.now = options.now || Date.now;
    this.createId = options.createId || randomUUID;
    this.intervalMs = positiveDuration(options.intervalMs, DEFAULT_INTERVAL_MS);
    this.dedupeWindowMs = positiveDuration(options.dedupeWindowMs, DEFAULT_DEDUPE_WINDOW_MS);
    this.maximumNotificationValidityMs = positiveDuration(options.maximumNotificationValidityMs, DEFAULT_NOTIFICATION_VALIDITY_MS);
    this.setIntervalFn = options.setInterval || ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.clearIntervalFn = options.clearInterval || ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  }

  isStarted(): boolean { return this.started; }

  start(): boolean {
    if (this.started) return false;
    this.started = true;
    try { this.timerHandle = this.setIntervalFn(() => { this.triggerRun(); }, this.intervalMs); }
    catch (error) { this.started = false; throw error; }
    (this.timerHandle as { unref?: () => void } | undefined)?.unref?.();
    if (this.options.runImmediately !== false) this.triggerRun();
    return true;
  }

  stop(): boolean {
    if (!this.started) return false;
    this.started = false;
    this.clearIntervalFn(this.timerHandle);
    this.timerHandle = undefined;
    this.activeController?.abort();
    return true;
  }

  runOnce(): Promise<PersonalProactiveRunReport> {
    if (this.activeRun) return this.activeRun;
    const controller = new AbortController();
    this.activeController = controller;
    const run = this.executeRun(controller.signal).finally(() => {
      if (this.activeRun === run) this.activeRun = undefined;
      if (this.activeController === controller) this.activeController = undefined;
    });
    this.activeRun = run;
    return run;
  }

  private triggerRun(): void {
    void this.runOnce().catch((error) => this.reportError(error, { phase: "run" }));
  }

  private reportError(error: unknown, context: PersonalProactiveErrorContext): void {
    try { this.options.onError?.(error, context); } catch { /* diagnostics cannot break scheduling */ }
  }

  private async decide(report: PersonalProactiveRunReport, decision: PersonalProactiveDecision): Promise<void> {
    report.decisions.push(decision);
    if (!decision.allowed) report.suppressed += 1;
    if (!this.options.onDecision) return;
    try { await this.options.onDecision(structuredClone(decision)); }
    catch (error) { report.errors += 1; this.reportError(error, { phase: "observer", principalId: decision.principalId, deviceId: decision.deviceId, suggestionId: decision.suggestionId }); }
  }

  private pruneDeliveries(now: number): void {
    for (const [key, record] of this.deliveries) {
      if (record.deliveredAt < now - HISTORY_RETENTION_MS && record.dedupeUntil <= now) this.deliveries.delete(key);
    }
  }

  private async historyFor(
    target: PersonalProactiveDeliveryTarget,
    now: number,
    signal: AbortSignal,
  ): Promise<PersonalProactiveDeliveryRecord[]> {
    if (this.options.readDeliveries) {
      const loaded = await this.options.readDeliveries(target, now, signal);
      if (!Array.isArray(loaded)) throw new Error("proactive delivery history provider returned a non-array value");
      for (const record of loaded) {
        if (!validDelivery(record, target, now)) throw new Error("proactive delivery history contains an invalid or cross-target record");
        this.deliveries.set(deliveryMapKey(record), structuredClone(record));
      }
    }
    return [...this.deliveries.values()].filter((record) => record.principalId === target.principalId && record.deviceId === target.deviceId);
  }

  private async executeRun(signal: AbortSignal): Promise<PersonalProactiveRunReport> {
    const startedAt = this.now();
    const report: PersonalProactiveRunReport = { startedAt, completedAt: startedAt, targets: 0, queried: 0, sent: 0, suppressed: 0, errors: 0, decisions: [] };
    this.pruneDeliveries(startedAt);
    let targets: readonly PersonalProactiveTarget[];
    try { targets = await this.options.listTargets(signal); }
    catch (error) {
      report.errors += 1;
      this.reportError(error, { phase: "list_targets" });
      report.completedAt = this.now();
      return report;
    }
    if (!Array.isArray(targets)) {
      report.errors += 1;
      this.reportError(new Error("proactive target provider returned a non-array value"), { phase: "list_targets" });
      report.completedAt = this.now();
      return report;
    }
    report.targets = targets.length;
    const visited = new Set<string>();
    for (const target of targets) {
      const principalId = identity(target?.principalId);
      const deviceId = identity(target?.deviceId);
      const base = { principalId, deviceId };
      if (!principalId || !deviceId || !Number.isSafeInteger(target.generation) || target.generation < 0 || target.settings?.principalId !== principalId) {
        await this.decide(report, { ...base, allowed: false, reason: "invalid_target" });
        continue;
      }
      const deliveryTarget: PersonalProactiveDeliveryTarget = { principalId, deviceId, generation: target.generation };
      const key = targetKey(deliveryTarget);
      if (visited.has(key)) { await this.decide(report, { ...deliveryTarget, allowed: false, reason: "duplicate_target" }); continue; }
      visited.add(key);
      if (signal.aborted) { await this.decide(report, { ...deliveryTarget, allowed: false, reason: "aborted" }); break; }
      if (target.proactiveEnabled !== true || target.settings.enabled !== true) {
        await this.decide(report, { ...deliveryTarget, allowed: false, reason: "disabled" });
        continue;
      }
      if (target.settings.paused === true) {
        await this.decide(report, { ...deliveryTarget, allowed: false, reason: "paused" });
        continue;
      }
      const policy = validPolicy(target.settings);
      if (!policy) { await this.decide(report, { ...deliveryTarget, allowed: false, reason: "invalid_policy" }); continue; }
      const now = this.now();
      const localNow = zonedTimeParts(now, target.timeZone);
      if (!localNow) { await this.decide(report, { ...deliveryTarget, allowed: false, reason: "invalid_timezone" }); continue; }
      if (isQuietMinute(localNow.minuteOfDay, policy.quietStart, policy.quietEnd)) {
        await this.decide(report, { ...deliveryTarget, allowed: false, reason: "quiet_hours" });
        continue;
      }
      let history: PersonalProactiveDeliveryRecord[];
      try { history = await this.historyFor(deliveryTarget, now, signal); }
      catch (error) {
        report.errors += 1;
        this.reportError(error, { phase: "history", ...deliveryTarget });
        await this.decide(report, { ...deliveryTarget, allowed: false, reason: "history_error" });
        continue;
      }
      const deliveredToday = history.filter((record) => zonedTimeParts(record.deliveredAt, target.timeZone)?.dateKey === localNow.dateKey);
      if (deliveredToday.length >= policy.maxPerDay) {
        await this.decide(report, { ...deliveryTarget, allowed: false, reason: "daily_limit" });
        continue;
      }
      const latest = history.reduce<PersonalProactiveDeliveryRecord | undefined>((current, record) => !current || record.deliveredAt > current.deliveredAt ? record : current, undefined);
      if (latest && now - latest.deliveredAt < policy.cooldownMs) {
        await this.decide(report, { ...deliveryTarget, allowed: false, reason: "cooldown" });
        continue;
      }
      const locale = localeOf(target.locale);
      let candidates: readonly PersonalProactiveCandidate[];
      try {
        report.queried += 1;
        candidates = await this.options.query({ principalId, deviceId, generation: target.generation, locale, timeZone: target.timeZone, at: now }, signal);
        if (!Array.isArray(candidates)) throw new Error("proactive query returned a non-array value");
      } catch (error) {
        report.errors += 1;
        this.reportError(error, { phase: "query", ...deliveryTarget });
        await this.decide(report, { ...deliveryTarget, allowed: false, reason: signal.aborted ? "aborted" : "query_error" });
        continue;
      }
      const ranked = [...candidates].sort((left, right) => (Number.isFinite(right?.suggestion?.score) ? right.suggestion.score : -Infinity) - (Number.isFinite(left?.suggestion?.score) ? left.suggestion.score : -Infinity));
      let sent = false;
      for (const candidate of ranked) {
        const suggestion = candidate?.suggestion;
        const suggestionId = identity(suggestion?.id);
        const decisionBase = { ...deliveryTarget, suggestionId };
        if (!suggestionId || !suggestion.candidate || !Number.isFinite(suggestion.score) || !Number.isFinite(candidate.validUntil) || (candidate.validFrom !== undefined && !Number.isFinite(candidate.validFrom))) {
          await this.decide(report, { ...decisionBase, allowed: false, reason: "invalid_suggestion" });
          continue;
        }
        if ((target.disabledKinds || []).includes(suggestion.kind)) {
          await this.decide(report, { ...decisionBase, allowed: false, reason: "category_disabled" });
          continue;
        }
        const current = this.now();
        if (Number.isFinite(candidate.validFrom) && Number(candidate.validFrom) > current) {
          await this.decide(report, { ...decisionBase, allowed: false, reason: "not_yet_valid" });
          continue;
        }
        if (candidate.validUntil <= current) {
          await this.decide(report, { ...decisionBase, allowed: false, reason: "expired" });
          continue;
        }
        if (suggestion.score < policy.minScore) {
          await this.decide(report, { ...decisionBase, allowed: false, reason: "low_score" });
          continue;
        }
        const candidateDedupeKey = dedupeKey(candidate);
        if (!candidateDedupeKey || history.some((record) => record.dedupeKey === candidateDedupeKey && record.dedupeUntil > current)) {
          await this.decide(report, { ...decisionBase, allowed: false, reason: "duplicate" });
          continue;
        }
        if (signal.aborted) { await this.decide(report, { ...decisionBase, allowed: false, reason: "aborted" }); break; }
        const expiresAt = Math.min(candidate.validUntil, current + this.maximumNotificationValidityMs);
        const notificationId = identity(this.createId()) || randomUUID();
        const fallbackLink = defaultDeepLink(suggestion, notificationId);
        let proposedLink = fallbackLink;
        try { proposedLink = this.options.deepLinkFor?.(deliveryTarget, suggestion, notificationId) || fallbackLink; } catch { proposedLink = fallbackLink; }
        const notification = formatPersonalProactiveNotification({ id: notificationId, suggestion, locale, createdAt: current, expiresAt, deepLink: proposedLink });
        const pendingRecord: PersonalProactiveDeliveryRecord = {
          id: notification.id,
          principalId,
          deviceId,
          generation: target.generation,
          suggestionId,
          kind: suggestion.kind,
          title: notification.title,
          body: notification.body,
          deepLink: notification.deepLink,
          expiresAt: notification.expiresAt,
          dedupeKey: candidateDedupeKey,
          deliveredAt: current,
          dedupeUntil: Math.max(current, Math.min(candidate.validUntil, current + this.dedupeWindowMs)),
          state: "pending",
        };
        const mapKey = deliveryMapKey(pendingRecord);
        this.deliveries.set(mapKey, pendingRecord);
        if (this.options.recordDelivery) {
          try { await this.options.recordDelivery(structuredClone(pendingRecord)); }
          catch (error) {
            this.deliveries.delete(mapKey);
            report.errors += 1;
            this.reportError(error, { phase: "record", ...decisionBase });
            await this.decide(report, { ...decisionBase, allowed: false, reason: "outbox_error" });
            break;
          }
        }
        let accepted: boolean | void;
        try { accepted = await this.options.send(notification, { ...deliveryTarget }, signal); }
        catch (error) {
          await this.markFailedDelivery(pendingRecord, decisionBase, report);
          report.errors += 1;
          this.reportError(error, { phase: "send", ...decisionBase });
          await this.decide(report, { ...decisionBase, allowed: false, reason: signal.aborted ? "aborted" : "send_rejected" });
          break;
        }
        if (accepted === false) {
          await this.markFailedDelivery(pendingRecord, decisionBase, report);
          await this.decide(report, { ...decisionBase, allowed: false, reason: "send_rejected" });
          break;
        }
        const deliveredAt = this.now();
        const record: PersonalProactiveDeliveryRecord = {
          ...pendingRecord,
          deliveredAt,
          dedupeUntil: Math.max(deliveredAt, Math.min(candidate.validUntil, deliveredAt + this.dedupeWindowMs)),
          state: "delivered",
        };
        this.deliveries.set(mapKey, record);
        if (this.options.recordDelivery) {
          try { await this.options.recordDelivery(structuredClone(record)); }
          catch (error) { report.errors += 1; this.reportError(error, { phase: "record", ...decisionBase }); }
        }
        report.sent += 1;
        await this.decide(report, { ...decisionBase, allowed: true });
        sent = true;
        break;
      }
      if (!sent && ranked.length === 0) await this.decide(report, { ...deliveryTarget, allowed: false, reason: "no_suggestion" });
    }
    report.completedAt = this.now();
    return report;
  }

  private async markFailedDelivery(
    pending: PersonalProactiveDeliveryRecord,
    context: Pick<PersonalProactiveDecision, "principalId" | "deviceId" | "suggestionId">,
    report: PersonalProactiveRunReport,
  ): Promise<void> {
    this.deliveries.delete(deliveryMapKey(pending));
    if (!this.options.recordDelivery) return;
    const failedAt = this.now();
    try {
      await this.options.recordDelivery({ ...structuredClone(pending), deliveredAt: failedAt, dedupeUntil: failedAt, state: "failed" });
    } catch (error) {
      report.errors += 1;
      this.reportError(error, { phase: "record", ...context });
    }
  }
}
