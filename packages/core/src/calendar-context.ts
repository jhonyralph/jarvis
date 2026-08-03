import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import ICAL from "ical.js";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  ContextCandidate,
  ContextFreshness,
  ContextSourceDescriptor,
  ContextSourceRef,
  PersonalContextQuery,
} from "@jarvis/protocol";
import type { ContextSource, ContextSourceRuntime } from "./context-sources.js";
import { writeJsonAtomic } from "./persist.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_CALENDAR_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_CALDAV_CACHE_MAX_AGE_MS = DAY_MS;
const MAX_CALDAV_CACHE_MAX_AGE_MS = 30 * DAY_MS;
const DEFAULT_CALDAV_CACHED_COLLECTIONS = 128;
const MAX_CALDAV_CACHED_COLLECTIONS = 1_024;
const DEFAULT_CALDAV_CACHE_BYTES = 4 * 1_024 * 1_024;
const MAX_CALDAV_CACHE_BYTES = 16 * 1_024 * 1_024;
const MAX_DAV_VALIDATOR_LENGTH = 8 * 1_024;
const CALDAV_CACHE_VERSION = 1;
const SOURCE_METADATA_LAST_REVIEWED_AT = "2026-08-01";

export const MAX_ICS_WINDOW_MS = 366 * DAY_MS;
export const MAX_ICS_OCCURRENCES = 5_000;
export const MAX_ICS_EXPANSION_STEPS = 100_000;

export type CalendarAccessLevel = "busy_free" | "details";

export interface CalendarWindow {
  startAt: number;
  endAt: number;
}

export interface DeviceCalendarInterval {
  id?: string;
  calendarId?: string;
  startAt: number;
  endAt: number;
  allDay?: boolean;
  availability?: "busy" | "free" | "tentative" | "unavailable";
  status?: string;
  transparency?: "opaque" | "transparent";
  timezone?: string;
  title?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  url?: string;
  updatedAt?: number;
}

export interface CalendarAvailabilitySegment {
  availability: "busy" | "free";
  startAt: number;
  endAt: number;
  allDay: boolean;
}

export interface CalendarAvailabilitySnapshot {
  windowStartAt: number;
  windowEndAt: number;
  busy: CalendarAvailabilitySegment[];
  free: CalendarAvailabilitySegment[];
}

export interface IcsCalendarOccurrence {
  id: string;
  startAt: number;
  endAt: number;
  allDay: boolean;
  availability: "busy";
  timezone: string;
  source: ContextSourceRef;
  title?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  url?: string;
  categories?: string[];
  calendarStatus?: string;
  updatedAt?: number;
  calendarHref?: string;
  eventHref?: string;
  etag?: string;
  uid?: string;
}

export interface ParseIcsCalendarOptions extends CalendarWindow {
  sourceId: string;
  observedAt: number;
  access?: CalendarAccessLevel;
  defaultTimeZone?: string;
  freshness?: ContextFreshness;
  attribution?: string;
  sourceUrl?: string;
  maxOccurrences?: number;
  maxExpansionSteps?: number;
}

export interface CalendarAvailabilityData {
  availability: "busy" | "free";
  startAt: number;
  endAt: number;
  allDay: boolean;
  complete: boolean;
}

export interface CalendarEventData {
  availability: "busy";
  startAt: number;
  endAt: number;
  allDay: boolean;
  timezone: string;
  description?: string;
  location?: string;
  attendees?: string[];
  url?: string;
  categories?: string[];
  calendarStatus?: string;
  updatedAt?: number;
  calendarHref?: string;
  eventHref?: string;
  etag?: string;
  uid?: string;
}

export type CalendarCandidateData = CalendarAvailabilityData | CalendarEventData;

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalTime = InstanceType<typeof ICAL.Time>;

function stableId(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);
}

function opaqueCacheKey(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error(`${name} must be a finite epoch timestamp`);
}

export function assertCalendarWindow(window: CalendarWindow): CalendarWindow {
  assertTimestamp(window.startAt, "calendar window startAt");
  assertTimestamp(window.endAt, "calendar window endAt");
  if (window.endAt <= window.startAt) throw new Error("calendar window endAt must be after startAt");
  if (window.endAt - window.startAt > MAX_ICS_WINDOW_MS) throw new Error("calendar window exceeds the maximum of 366 days");
  return window;
}

export interface CalendarWallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond?: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        calendar: "iso8601",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      throw new Error("calendar timezone is not supported");
    }
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(timestamp: number, timeZone: string): CalendarWallTime {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of zonedFormatter(timeZone).formatToParts(timestamp)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour === 24 ? 0 : values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function sameWallTime(left: CalendarWallTime, right: CalendarWallTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

function zoneOffsetAt(timestamp: number, timeZone: string): number {
  const parts = zonedParts(timestamp, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(timestamp / 1_000) * 1_000;
}

/** RFC 5545 uses the pre-transition offset for nonexistent wall times and the first occurrence for ambiguous times. */
export function calendarWallTimeToEpoch(parts: CalendarWallTime, timeZone: string): number {
  if (![parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond || 0].every(Number.isInteger)
    || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31
    || parts.hour < 0 || parts.hour > 23 || parts.minute < 0 || parts.minute > 59
    || parts.second < 0 || parts.second > 59 || (parts.millisecond || 0) < 0 || (parts.millisecond || 0) > 999) {
    throw new Error("calendar wall time is invalid");
  }
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond || 0);
  const normalized = new Date(naive);
  if (normalized.getUTCFullYear() !== parts.year || normalized.getUTCMonth() + 1 !== parts.month || normalized.getUTCDate() !== parts.day) {
    throw new Error("calendar wall time is invalid");
  }
  const offsets = new Set<number>();
  for (const delta of [-36 * 60 * 60 * 1_000, -12 * 60 * 60 * 1_000, 0, 12 * 60 * 60 * 1_000, 36 * 60 * 60 * 1_000]) {
    offsets.add(zoneOffsetAt(naive + delta, timeZone));
  }
  const exact = [...offsets]
    .map((offset) => naive - offset)
    .filter((candidate) => sameWallTime(zonedParts(candidate, timeZone), parts))
    .sort((a, b) => a - b);
  if (exact.length) return exact[0];
  const preTransitionOffset = zoneOffsetAt(naive - 12 * 60 * 60 * 1_000, timeZone);
  return naive - preTransitionOffset;
}

/** Parses epoch values, offset-bearing ISO values, date-only values, and local ISO values in a declared zone. */
export function parseCalendarTimestamp(value: unknown, defaultTimeZone = "UTC"): number {
  if (typeof value === "number") {
    assertTimestamp(value, "calendar timestamp");
    return value;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    assertTimestamp(timestamp, "calendar timestamp");
    return timestamp;
  }
  if (typeof value !== "string" || !value.trim()) throw new Error("calendar timestamp is invalid");
  const input = value.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(input);
  if (local) {
    const milliseconds = Number((local[7] || "").padEnd(3, "0"));
    return calendarWallTimeToEpoch({
      year: Number(local[1]), month: Number(local[2]), day: Number(local[3]),
      hour: Number(local[4] || 0), minute: Number(local[5] || 0), second: Number(local[6] || 0), millisecond: milliseconds,
    }, defaultTimeZone);
  }
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) throw new Error("calendar timestamp is invalid");
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})T/.exec(input);
  if (isoDate) {
    const probe = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
    if (probe.getUTCFullYear() !== Number(isoDate[1]) || probe.getUTCMonth() + 1 !== Number(isoDate[2]) || probe.getUTCDate() !== Number(isoDate[3])) {
      throw new Error("calendar timestamp is invalid");
    }
  }
  return parsed;
}

async function calendarAccess(
  resolver: ((request: PersonalContextQuery) => CalendarAccessLevel | Promise<CalendarAccessLevel>) | undefined,
  request: PersonalContextQuery,
): Promise<CalendarAccessLevel> {
  const access = await resolver?.(request) || "busy_free";
  if (access !== "busy_free" && access !== "details") throw new Error("calendar access level is invalid");
  return access;
}

function isBusyInterval(interval: DeviceCalendarInterval): boolean {
  const status = (interval.status || "").toLowerCase();
  return status !== "cancelled" && status !== "canceled"
    && interval.availability !== "free" && interval.transparency !== "transparent";
}

export function mergeCalendarBusyIntervals(intervals: CalendarAvailabilitySegment[]): CalendarAvailabilitySegment[] {
  const sorted = intervals.map((interval) => ({ ...interval })).sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
  const merged: CalendarAvailabilitySegment[] = [];
  for (const interval of sorted) {
    if (interval.availability !== "busy") continue;
    const current = merged.at(-1);
    if (!current || interval.startAt > current.endAt) {
      merged.push(interval);
      continue;
    }
    current.endAt = Math.max(current.endAt, interval.endAt);
    current.allDay = current.allDay && interval.allDay;
  }
  return merged;
}

/** Produces only busy/free facts; title, location, participants and calendar identifiers are never copied. */
export function normalizeDeviceCalendarBusyFree(
  intervals: readonly DeviceCalendarInterval[],
  window: CalendarWindow,
): CalendarAvailabilitySnapshot {
  assertCalendarWindow(window);
  const busy = mergeCalendarBusyIntervals(intervals.filter(isBusyInterval).map((interval, index) => {
    assertTimestamp(interval.startAt, `device calendar interval ${index} startAt`);
    assertTimestamp(interval.endAt, `device calendar interval ${index} endAt`);
    if (interval.endAt <= interval.startAt) throw new Error(`device calendar interval ${index} has an invalid range`);
    return {
      availability: "busy" as const,
      startAt: Math.max(interval.startAt, window.startAt),
      endAt: Math.min(interval.endAt, window.endAt),
      allDay: interval.allDay === true,
    };
  }).filter((interval) => interval.endAt > interval.startAt));
  const free: CalendarAvailabilitySegment[] = [];
  let cursor = window.startAt;
  for (const interval of busy) {
    if (interval.startAt > cursor) free.push({ availability: "free", startAt: cursor, endAt: interval.startAt, allDay: false });
    cursor = Math.max(cursor, interval.endAt);
  }
  if (cursor < window.endAt) free.push({ availability: "free", startAt: cursor, endAt: window.endAt, allDay: false });
  return { windowStartAt: window.startAt, windowEndAt: window.endAt, busy, free };
}

function componentText(component: IcalComponent, property: string): string | undefined {
  const value = component.getFirstPropertyValue(property);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function propertyTimezone(component: IcalComponent, property: string, fallback: string): string {
  const prop = component.getFirstProperty(property);
  const tzid = prop?.getParameter("tzid");
  if (typeof tzid === "string" && tzid.trim()) return tzid.trim();
  const value = prop?.getFirstValue();
  if (value instanceof ICAL.Time && value.zone?.tzid && value.zone.tzid !== "floating") return value.zone.tzid;
  return fallback;
}

function icalTimeToEpoch(time: IcalTime, timeZone: string): number {
  if (time.zone?.tzid && time.zone.tzid !== "floating" && time.zone.tzid !== "local") return time.toUnixTime() * 1_000;
  return calendarWallTimeToEpoch({
    year: time.year, month: time.month, day: time.day,
    hour: time.isDate ? 0 : time.hour, minute: time.isDate ? 0 : time.minute, second: time.isDate ? 0 : time.second,
  }, timeZone);
}

function propertyTimeToEpoch(component: IcalComponent, property: string, fallbackTimeZone: string): number | undefined {
  const value = component.getFirstPropertyValue(property);
  if (!(value instanceof ICAL.Time)) return undefined;
  return icalTimeToEpoch(value, propertyTimezone(component, property, fallbackTimeZone));
}

function eventIsBusy(component: IcalComponent): boolean {
  const status = (componentText(component, "status") || "").toLowerCase();
  const transparency = (componentText(component, "transp") || "").toLowerCase();
  return status !== "cancelled" && status !== "canceled" && transparency !== "transparent";
}

function propertyStrings(component: IcalComponent, property: string): string[] | undefined {
  const values = component.getAllProperties(property).flatMap((item) => item.getValues()).flatMap((value) => {
    if (typeof value !== "string") return [];
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  });
  return values.length ? [...new Set(values)] : undefined;
}

function occurrenceFromDetails(
  component: IcalComponent,
  start: IcalTime,
  end: IcalTime,
  masterComponent: IcalComponent,
  options: Required<Pick<ParseIcsCalendarOptions, "sourceId" | "observedAt" | "access" | "defaultTimeZone" | "freshness">>
    & Pick<ParseIcsCalendarOptions, "attribution" | "sourceUrl">,
): IcsCalendarOccurrence | undefined {
  if (!eventIsBusy(component)) return undefined;
  const startZone = propertyTimezone(component, "dtstart", propertyTimezone(masterComponent, "dtstart", options.defaultTimeZone));
  const endZone = propertyTimezone(component, "dtend", propertyTimezone(masterComponent, "dtend", startZone));
  const startAt = icalTimeToEpoch(start, startZone);
  const endAt = icalTimeToEpoch(end, endZone);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) throw new Error("invalid ICS event range");
  const uid = componentText(component, "uid") || componentText(masterComponent, "uid") || "anonymous";
  const id = `ical-${stableId(options.sourceId, uid, startAt, endAt)}`;
  const source: ContextSourceRef = {
    sourceId: options.sourceId,
    observedAt: options.observedAt,
    freshness: options.freshness,
    ...(options.attribution ? { attribution: options.attribution } : {}),
  };
  const occurrence: IcsCalendarOccurrence = {
    id, startAt, endAt, allDay: start.isDate, availability: "busy", timezone: startZone, source,
  };
  if (options.access === "details") {
    const title = componentText(component, "summary");
    const description = componentText(component, "description");
    const location = componentText(component, "location");
    const url = componentText(component, "url") || options.sourceUrl;
    const attendees = propertyStrings(component, "attendee");
    const categories = propertyStrings(component, "categories");
    const calendarStatus = componentText(component, "status");
    const updatedAt = propertyTimeToEpoch(component, "last-modified", "UTC")
      ?? propertyTimeToEpoch(component, "dtstamp", "UTC");
    if (title) occurrence.title = title;
    if (description) occurrence.description = description;
    if (location) occurrence.location = location;
    if (attendees) occurrence.attendees = attendees;
    if (url) occurrence.url = url;
    if (categories) occurrence.categories = categories;
    if (calendarStatus) occurrence.calendarStatus = calendarStatus;
    if (updatedAt !== undefined) occurrence.updatedAt = updatedAt;
    occurrence.source.recordId = uid;
    if (url) occurrence.source.url = url;
  }
  return occurrence;
}

/** Parses iCalendar with ical.js and expands recurrence only inside a hard-bounded query window. */
export function parseIcsCalendar(ics: string, input: ParseIcsCalendarOptions): IcsCalendarOccurrence[] {
  assertCalendarWindow(input);
  if (typeof ics !== "string" || !ics.trim()) throw new Error("invalid ICS calendar");
  if (input.access !== undefined && input.access !== "busy_free" && input.access !== "details") throw new Error("calendar access level is invalid");
  const options = {
    ...input,
    access: input.access || "busy_free",
    defaultTimeZone: input.defaultTimeZone || "UTC",
    freshness: input.freshness || "fresh",
    maxOccurrences: Math.min(MAX_ICS_OCCURRENCES, Math.max(1, input.maxOccurrences || MAX_ICS_OCCURRENCES)),
    maxExpansionSteps: Math.min(MAX_ICS_EXPANSION_STEPS, Math.max(1, input.maxExpansionSteps || MAX_ICS_EXPANSION_STEPS)),
  } as const;
  zonedFormatter(options.defaultTimeZone);
  let calendar: IcalComponent;
  try {
    calendar = new ICAL.Component(ICAL.parse(ics));
  } catch {
    throw new Error("invalid ICS calendar");
  }
  if (calendar.name !== "vcalendar") throw new Error("invalid ICS calendar: VCALENDAR is required");
  const components = calendar.getAllSubcomponents("vevent");
  let expansionSteps = 0;
  const occurrences: IcsCalendarOccurrence[] = [];
  const append = (occurrence: IcsCalendarOccurrence | undefined): void => {
    if (!occurrence || occurrence.startAt >= options.endAt || occurrence.endAt <= options.startAt) return;
    if (occurrences.length >= options.maxOccurrences) throw new Error("ICS occurrence limit exceeded");
    occurrences.push(occurrence);
  };
  try {
    for (const component of components) {
      if (component.hasProperty("recurrence-id")) continue;
      if (!component.hasProperty("dtstart")) throw new Error("invalid ICS event: DTSTART is required");
      const event = new ICAL.Event(component);
      if (!eventIsBusy(component)) continue;
      if (!event.isRecurring()) {
        append(occurrenceFromDetails(component, event.startDate, event.endDate, component, options));
        continue;
      }
      const iterator = event.iterator();
      let recurrence: IcalTime | undefined;
      while ((recurrence = iterator.next())) {
        expansionSteps++;
        if (expansionSteps > options.maxExpansionSteps) throw new Error("ICS recurrence expansion limit exceeded");
        const recurrenceZone = propertyTimezone(component, "dtstart", options.defaultTimeZone);
        if (icalTimeToEpoch(recurrence, recurrenceZone) >= options.endAt) break;
        const details = event.getOccurrenceDetails(recurrence);
        append(occurrenceFromDetails(details.item.component, details.startDate, details.endDate, component, options));
      }
    }
  } catch (error) {
    if (error instanceof Error && /^(ICS |invalid ICS )/.test(error.message)) throw error;
    throw new Error("invalid ICS calendar");
  }
  return occurrences.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.id.localeCompare(b.id));
}

function sourceRef(sourceId: string, observedAt: number, attribution?: string): ContextSourceRef {
  return { sourceId, observedAt, freshness: "fresh", ...(attribution ? { attribution } : {}) };
}

function availabilityCandidates(
  snapshot: CalendarAvailabilitySnapshot,
  source: ContextSourceRef,
  complete: boolean,
  includeFree: boolean,
): ContextCandidate<CalendarAvailabilityData>[] {
  const segments = includeFree ? [...snapshot.busy, ...snapshot.free] : snapshot.busy;
  return segments.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.availability.localeCompare(b.availability)).map((segment) => ({
    id: `calendar-${segment.availability}-${stableId(source.sourceId, segment.startAt, segment.endAt)}`,
    kind: "calendar_availability",
    title: segment.availability === "busy" ? "Busy" : "Free",
    data: { ...segment, complete },
    sources: [{ ...source }],
  }));
}

function occurrenceCandidate(occurrence: IcsCalendarOccurrence): ContextCandidate<CalendarEventData> {
  const data: CalendarEventData = {
    availability: "busy", startAt: occurrence.startAt, endAt: occurrence.endAt,
    allDay: occurrence.allDay, timezone: occurrence.timezone,
  };
  for (const key of ["description", "location", "attendees", "url", "categories", "calendarStatus", "updatedAt", "calendarHref", "eventHref", "etag", "uid"] as const) {
    const value = occurrence[key];
    if (value !== undefined) Object.assign(data, { [key]: Array.isArray(value) ? [...value] : value });
  }
  return {
    id: occurrence.id,
    kind: "calendar_event",
    title: occurrence.title || "Busy",
    data,
    sources: [{ ...occurrence.source }],
  };
}

function queryWindow(request: PersonalContextQuery): CalendarWindow {
  if (request.startAt === undefined || request.endAt === undefined) throw new Error("calendar query requires startAt and endAt");
  return assertCalendarWindow({ startAt: request.startAt, endAt: request.endAt });
}

export interface DeviceCalendarSourceOptions {
  sourceId?: string;
  label?: string;
  attribution?: string;
  cacheTtlMs?: number;
  read: (request: PersonalContextQuery, runtime: ContextSourceRuntime) => Promise<readonly DeviceCalendarInterval[] | DeviceCalendarSnapshotInput>;
  resolveAccess?: (request: PersonalContextQuery) => CalendarAccessLevel | Promise<CalendarAccessLevel>;
}

export interface DeviceCalendarSnapshotInput {
  intervals: readonly DeviceCalendarInterval[];
  observedAt?: number;
  complete?: boolean;
}

export function createDeviceCalendarSource(options: DeviceCalendarSourceOptions): ContextSource<CalendarCandidateData> {
  const sourceId = options.sourceId || "device-calendar";
  return {
    descriptor: {
      id: sourceId, label: options.label || "Device calendar", purposes: ["calendar"], costClass: "local",
      transport: "device", certification: "first_party", ...(options.attribution ? { attribution: options.attribution } : {}),
      license: "User-owned calendar data; no third-party data license",
      cachePolicy: "busy/free snapshot with bounded TTL",
      retentionPolicy: "Minimized calendar results only; raw device payloads are not persisted; 5m cache TTL by default",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    },
    cacheTtlMs: Math.max(0, options.cacheTtlMs ?? DEFAULT_CALENDAR_TTL_MS),
    staleIfErrorMs: 30 * 60 * 1_000,
    async query(request, runtime) {
      const window = queryWindow(request);
      const access = await calendarAccess(options.resolveAccess, request);
      const loaded = await options.read(request, runtime);
      const snapshot: DeviceCalendarSnapshotInput = Array.isArray(loaded) ? { intervals: loaded } : loaded as DeviceCalendarSnapshotInput;
      if (!snapshot || !Array.isArray(snapshot.intervals)) throw new Error("device calendar snapshot is invalid");
      const observedAt = snapshot.observedAt ?? runtime.now();
      assertTimestamp(observedAt, "device calendar observedAt");
      const intervals = snapshot.intervals;
      const complete = snapshot.complete !== false;
      const source = sourceRef(sourceId, observedAt, options.attribution);
      if (access === "busy_free") {
        return availabilityCandidates(normalizeDeviceCalendarBusyFree(intervals, window), source, complete, complete);
      }
      return intervals.filter(isBusyInterval).map((interval, index) => {
        assertTimestamp(interval.startAt, `device calendar interval ${index} startAt`);
        assertTimestamp(interval.endAt, `device calendar interval ${index} endAt`);
        if (interval.endAt <= interval.startAt) throw new Error(`device calendar interval ${index} has an invalid range`);
        const startAt = Math.max(interval.startAt, window.startAt), endAt = Math.min(interval.endAt, window.endAt);
        if (endAt <= startAt) return undefined;
        const occurrence: IcsCalendarOccurrence = {
          id: `device-event-${stableId(sourceId, interval.id || index, startAt, endAt)}`,
          startAt, endAt, allDay: interval.allDay === true, availability: "busy",
          timezone: interval.timezone || "UTC",
          source: { ...source, ...(interval.id ? { recordId: interval.id } : {}), ...(interval.url ? { url: interval.url } : {}) },
          ...(interval.title ? { title: interval.title } : {}),
          ...(interval.description ? { description: interval.description } : {}),
          ...(interval.location ? { location: interval.location } : {}),
          ...(interval.attendees?.length ? { attendees: [...interval.attendees] } : {}),
          ...(interval.url ? { url: interval.url } : {}),
          ...(interval.status ? { calendarStatus: interval.status } : {}),
          ...(interval.updatedAt !== undefined ? { updatedAt: interval.updatedAt } : {}),
        };
        return occurrenceCandidate(occurrence);
      }).filter((candidate): candidate is ContextCandidate<CalendarEventData> => candidate !== undefined);
    },
  };
}

export type CalDavCredential =
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string };

export interface CalDavCredentialContext {
  principalId: string;
  sourceId: string;
  signal: AbortSignal;
}

export type CalDavSecretResolver = (secretRef: string, context: CalDavCredentialContext) => Promise<CalDavCredential>;

export interface CalDavCalendar {
  href: string;
  displayName?: string;
  syncToken?: string;
  etag?: string;
}

export interface CalDavPartialFailure {
  sourceId: string;
  calendarIndex: number;
  message: string;
}

export interface CalDavReadOnlySourceOptions {
  sourceId?: string;
  label?: string;
  endpoint: string;
  secretRef: string;
  resolveSecret: CalDavSecretResolver;
  /** Integration-scoped fetch implementation; callers should provide a DNS-pinned restricted fetch. */
  fetch?: typeof fetch;
  calendarHrefs?: string[];
  resolveAccess?: (request: PersonalContextQuery) => CalendarAccessLevel | Promise<CalendarAccessLevel>;
  defaultTimeZone?: string;
  attribution?: string;
  cacheTtlMs?: number;
  /** Optional per-source file for restart-safe sync state. */
  cacheFile?: string;
  /** Maximum age of durable sync state; zero disables and clears durable caching. */
  cacheMaxAgeMs?: number;
  maxCachedCollections?: number;
  maxCachedResources?: number;
  maxCacheBytes?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  onPartialFailure?: (failure: CalDavPartialFailure) => void;
}

interface DavResource {
  href: string;
  status: number;
  etag?: string;
  calendarData?: string;
  displayName?: string;
  isCalendar: boolean;
  syncToken?: string;
  currentUserPrincipal?: string;
  calendarHomeSet?: string;
}

interface DavMultiStatus {
  resources: DavResource[];
  syncToken?: string;
}

interface DavResponse {
  status: number;
  body: string;
  etag?: string;
}

interface CalDavResourceState {
  etag?: string;
  occurrences: IcsCalendarOccurrence[];
}

interface CalDavCollectionState {
  principalKey: string;
  collectionKey: string;
  windowKey: string;
  syncToken?: string;
  collectionEtag?: string;
  resources: Map<string, CalDavResourceState>;
  updatedAt: number;
  expiresAt: number;
}

interface PersistedCalDavOccurrence {
  id: string;
  startAt: number;
  endAt: number;
  allDay: boolean;
}

interface PersistedCalDavResource {
  key: string;
  etag?: string;
  occurrences: PersistedCalDavOccurrence[];
}

interface PersistedCalDavCollection {
  key: string;
  principalKey: string;
  collectionKey: string;
  windowKey: string;
  syncToken?: string;
  collectionEtag?: string;
  resources: PersistedCalDavResource[];
  updatedAt: number;
  expiresAt: number;
}

interface PersistedCalDavCache {
  version: typeof CALDAV_CACHE_VERSION;
  sourceKey: string;
  collections: PersistedCalDavCollection[];
}

class DavHttpError extends Error {
  constructor(readonly status: number) { super(`CalDAV request failed with HTTP ${status}`); }
}

const davParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  maxNestedTags: 100,
  isArray: (name) => name === "response" || name === "propstat",
});

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function xmlText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const decoded = value.replace(/&(quot|apos|lt|gt|amp);/g, (_match, entity: string) => ({ quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" })[entity] || "");
    return decoded.trim() || undefined;
  }
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return xmlText((value as Record<string, unknown>)["#text"]);
  return undefined;
}

function davHref(value: unknown): string | undefined {
  if (isDavRecord(value)) return xmlText(value.href) || xmlText(value["#text"]);
  return xmlText(value);
}

function isDavRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function statusCode(value: unknown): number {
  const match = /\s(\d{3})(?:\s|$)/.exec(xmlText(value) || "");
  return match ? Number(match[1]) : 200;
}

function parseDavMultiStatus(xml: string): DavMultiStatus {
  if (XMLValidator.validate(xml) !== true) throw new Error("invalid CalDAV XML response");
  let parsed: Record<string, unknown>;
  try { parsed = davParser.parse(xml) as Record<string, unknown>; }
  catch { throw new Error("invalid CalDAV XML response"); }
  const root = (parsed.multistatus || parsed) as Record<string, unknown>;
  const resources: DavResource[] = [];
  for (const responseValue of asArray(root.response as Record<string, unknown>[] | undefined)) {
    const response = responseValue as Record<string, unknown>;
    const topStatus = statusCode(response.status);
    let properties: Record<string, unknown> = {};
    let successfulPropstat = false;
    for (const propstatValue of asArray(response.propstat as Record<string, unknown>[] | undefined)) {
      const propstat = propstatValue as Record<string, unknown>;
      if (statusCode(propstat.status) < 300) {
        successfulPropstat = true;
        if (propstat.prop && typeof propstat.prop === "object") properties = { ...properties, ...(propstat.prop as Record<string, unknown>) };
      }
    }
    const href = xmlText(response.href);
    if (!href) continue;
    const resourceType = properties.resourcetype;
    const isCalendar = !!resourceType && typeof resourceType === "object"
      && Object.prototype.hasOwnProperty.call(resourceType, "calendar");
    resources.push({
      href,
      status: topStatus >= 300 ? topStatus : successfulPropstat ? 200 : topStatus,
      ...(xmlText(properties.getetag) ? { etag: xmlText(properties.getetag) } : {}),
      ...(xmlText(properties["calendar-data"]) ? { calendarData: xmlText(properties["calendar-data"]) } : {}),
      ...(xmlText(properties.displayname) ? { displayName: xmlText(properties.displayname) } : {}),
      isCalendar,
      ...(xmlText(properties["sync-token"]) ? { syncToken: xmlText(properties["sync-token"]) } : {}),
      ...(davHref(properties["current-user-principal"]) ? { currentUserPrincipal: davHref(properties["current-user-principal"]) } : {}),
      ...(davHref(properties["calendar-home-set"]) ? { calendarHomeSet: davHref(properties["calendar-home-set"]) } : {}),
    });
  }
  return { resources, ...(xmlText(root["sync-token"]) ? { syncToken: xmlText(root["sync-token"]) } : {}) };
}

function davValidator(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_DAV_VALIDATOR_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
}

function boundedCalDavOption(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
  allowZero = false,
  minimum = 1,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < (allowZero ? 0 : minimum)) throw new Error(`${label} is invalid`);
  return Math.min(maximum, selected);
}

function onlyObjectKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function validOpaqueKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function persistedWindow(value: unknown): CalendarWindow | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(-?\d+):(-?\d+):busy_free$/.exec(value);
  if (!match) return undefined;
  const startAt = Number(match[1]), endAt = Number(match[2]);
  return Number.isSafeInteger(startAt) && Number.isSafeInteger(endAt)
    && endAt > startAt && endAt - startAt <= MAX_ICS_WINDOW_MS ? { startAt, endAt } : undefined;
}

function busyFreeWindowKey(windowKey: string): string | undefined {
  const match = /^(-?\d+):(-?\d+):(busy_free|details)$/.exec(windowKey);
  return match ? `${match[1]}:${match[2]}:busy_free` : undefined;
}

function normalizeCalendarTitle(value: string | undefined): string {
  return (value || "").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function calendarOccurrencePreference(left: IcsCalendarOccurrence, right: IcsCalendarOccurrence): number {
  return (right.updatedAt ?? -1) - (left.updatedAt ?? -1) || left.id.localeCompare(right.id);
}

/** Semantic collapse is intentionally exact on collection and interval; missing titles never match. */
function deduplicateCalendarOccurrences(occurrences: IcsCalendarOccurrence[]): IcsCalendarOccurrence[] {
  const selected: IcsCalendarOccurrence[] = [];
  const exact = new Set<string>();
  const semantic = new Set<string>();
  for (const occurrence of [...occurrences].sort(calendarOccurrencePreference)) {
    const exactKey = JSON.stringify([occurrence.calendarHref || null, occurrence.id, occurrence.startAt, occurrence.endAt]);
    if (exact.has(exactKey)) continue;
    exact.add(exactKey);
    const title = normalizeCalendarTitle(occurrence.title);
    if (!occurrence.calendarHref || !title) {
      selected.push(occurrence);
      continue;
    }
    const semanticKey = JSON.stringify([occurrence.calendarHref, occurrence.startAt, occurrence.endAt, title]);
    if (semantic.has(semanticKey)) continue;
    semantic.add(semanticKey);
    selected.push(occurrence);
  }
  return selected.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.id.localeCompare(b.id));
}

function readBoundedCalDavCache(file: string, maxBytes: number): unknown {
  try {
    const size = statSync(file).size;
    if (size <= 0 || size > maxBytes) return undefined;
    const contents = readFileSync(file);
    if (contents.byteLength > maxBytes) return undefined;
    return JSON.parse(contents.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function validateCalDavUrl(value: string, base?: URL): URL {
  let url: URL;
  try { url = base ? new URL(value, base) : new URL(value); }
  catch { throw new Error("CalDAV endpoint is invalid"); }
  if (url.username || url.password) throw new Error("CalDAV credentials must be supplied by the secret resolver");
  if (url.search) throw new Error("CalDAV URL query parameters are not allowed; credentials must use the secret resolver");
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("CalDAV endpoint must use HTTPS or loopback HTTP");
  if (base && url.origin !== base.origin) throw new Error("CalDAV returned a cross-origin calendar URL");
  url.hash = "";
  return url;
}

function authHeaders(credential: CalDavCredential): Headers {
  const headers = new Headers();
  if (credential.kind === "basic") {
    if (!credential.username || !credential.password || /[\r\n]/.test(credential.username + credential.password)) throw new Error("CalDAV credential is invalid");
    headers.set("Authorization", `Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`);
  } else {
    if (!credential.token || /[\r\n]/.test(credential.token)) throw new Error("CalDAV credential is invalid");
    headers.set("Authorization", `Bearer ${credential.token}`);
  }
  headers.set("Content-Type", "application/xml; charset=utf-8");
  return headers;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function utcIcal(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function calendarDataSelection(access: CalendarAccessLevel): string {
  const detailProperties = access === "details"
    ? '<C:prop name="SUMMARY"/><C:prop name="DESCRIPTION"/><C:prop name="LOCATION"/><C:prop name="ATTENDEE"/><C:prop name="URL"/><C:prop name="CATEGORIES"/><C:prop name="LAST-MODIFIED"/>'
    : "";
  return `<C:calendar-data><C:comp name="VCALENDAR"><C:prop name="VERSION"/><C:comp name="VTIMEZONE"/><C:comp name="VEVENT"><C:prop name="UID"/><C:prop name="DTSTART"/><C:prop name="DTEND"/><C:prop name="DURATION"/><C:prop name="RRULE"/><C:prop name="RDATE"/><C:prop name="EXDATE"/><C:prop name="RECURRENCE-ID"/><C:prop name="STATUS"/><C:prop name="TRANSP"/><C:prop name="DTSTAMP"/>${detailProperties}</C:comp></C:comp></C:calendar-data>`;
}

function propfindBody(): string {
  return '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/><D:getetag/><D:sync-token/><D:current-user-principal/><C:calendar-home-set/></D:prop></D:propfind>';
}

function calendarQueryBody(window: CalendarWindow, access: CalendarAccessLevel): string {
  return `<?xml version="1.0" encoding="utf-8"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/>${calendarDataSelection(access)}</D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="${utcIcal(window.startAt)}" end="${utcIcal(window.endAt)}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`;
}

function syncCollectionBody(syncToken: string, access: CalendarAccessLevel): string {
  return `<?xml version="1.0" encoding="utf-8"?><D:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:sync-token>${xmlEscape(syncToken)}</D:sync-token><D:sync-level>1</D:sync-level><D:prop><D:getetag/>${calendarDataSelection(access)}</D:prop></D:sync-collection>`;
}

async function readBoundedResponse(response: Response, maxBytes: number, label: string): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error(`${label} response exceeds size limit`);
  if (!response.body) return "";
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} response exceeds size limit`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof Error && error.message === `${label} response exceeds size limit`) throw error;
    throw new Error(`${label} response could not be read`);
  } finally { reader.releaseLock(); }
}

export class CalDavReadOnlySource implements ContextSource<CalendarCandidateData> {
  readonly descriptor: ContextSourceDescriptor;
  readonly cacheTtlMs: number;
  readonly staleIfErrorMs = 30 * 60 * 1_000;
  readonly timeoutMs: number;
  private readonly endpoint: URL;
  private readonly calendarHrefs?: URL[];
  private readonly states = new Map<string, CalDavCollectionState>();
  private readonly maxResponseBytes: number;
  private readonly cacheFile?: string;
  private readonly cacheMaxAgeMs: number;
  private readonly maxCachedCollections: number;
  private readonly maxCachedResources: number;
  private readonly maxCacheBytes: number;
  private readonly sourceCacheKey: string;
  private readonly disposedPrincipalKeys = new Set<string>();
  private cacheLoaded = false;
  private cacheGeneration = 0;
  private disposed = false;
  private lastObservedAt?: number;

  constructor(private readonly options: CalDavReadOnlySourceOptions) {
    if (!options.secretRef?.trim()) throw new Error("CalDAV secretRef is required");
    if (typeof options.resolveSecret !== "function") throw new Error("CalDAV secret resolver is required");
    this.endpoint = validateCalDavUrl(options.endpoint);
    this.calendarHrefs = options.calendarHrefs?.map((href) => validateCalDavUrl(href, this.endpoint));
    const sourceId = options.sourceId || "caldav-calendar";
    this.descriptor = {
      id: sourceId, label: options.label || "CalDAV calendar", purposes: ["calendar"], costClass: "free",
      transport: "http" as const, certification: "first_party" as const,
      ...(options.attribution ? { attribution: options.attribution } : {}),
      license: "User-owned calendar data; CalDAV server terms apply",
      cachePolicy: "bounded calendar window; ETag and sync-token when supported",
      retentionPolicy: "Minimized bounded cache; 24h default, 30d maximum; credentials are never retained",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    };
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CALENDAR_TTL_MS);
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 10_000);
    this.maxResponseBytes = Math.max(1_024, options.maxResponseBytes ?? 4 * 1_024 * 1_024);
    if (options.cacheFile !== undefined && !options.cacheFile.trim()) throw new Error("CalDAV cacheFile is invalid");
    this.cacheFile = options.cacheFile;
    this.cacheMaxAgeMs = boundedCalDavOption(
      options.cacheMaxAgeMs,
      DEFAULT_CALDAV_CACHE_MAX_AGE_MS,
      MAX_CALDAV_CACHE_MAX_AGE_MS,
      "CalDAV cacheMaxAgeMs",
      true,
    );
    this.maxCachedCollections = boundedCalDavOption(
      options.maxCachedCollections,
      DEFAULT_CALDAV_CACHED_COLLECTIONS,
      MAX_CALDAV_CACHED_COLLECTIONS,
      "CalDAV maxCachedCollections",
    );
    this.maxCachedResources = boundedCalDavOption(
      options.maxCachedResources,
      MAX_ICS_OCCURRENCES,
      MAX_ICS_OCCURRENCES,
      "CalDAV maxCachedResources",
    );
    this.maxCacheBytes = boundedCalDavOption(
      options.maxCacheBytes,
      DEFAULT_CALDAV_CACHE_BYTES,
      MAX_CALDAV_CACHE_BYTES,
      "CalDAV maxCacheBytes",
      false,
      256,
    );
    this.sourceCacheKey = opaqueCacheKey(
      "caldav-source",
      sourceId,
      this.endpoint.toString(),
      options.defaultTimeZone || "UTC",
    );
  }

  /** Erases durable and in-memory state for one principal on this source instance. */
  eraseCachedData(principalId: string): void {
    this.clearCachedData(principalId);
  }

  clearCachedData(principalId?: string): void {
    this.cacheGeneration++;
    const now = this.lastObservedAt ?? Date.now();
    this.loadCache(now);
    if (principalId === undefined) this.states.clear();
    else {
      const principalKey = this.principalCacheKey(principalId);
      for (const [key, state] of this.states) if (state.principalKey === principalKey) this.states.delete(key);
    }
    this.persistCache(now, true);
  }

  /** Lifecycle hook for revocation/removal. Omitting principalId permanently disposes the source. */
  dispose(principalId?: string): void {
    if (principalId === undefined) this.disposed = true;
    else this.disposedPrincipalKeys.add(this.principalCacheKey(principalId));
    this.clearCachedData(principalId);
  }

  private assertActive(principalId: string): void {
    if (this.disposed || this.disposedPrincipalKeys.has(this.principalCacheKey(principalId))) {
      throw new Error("CalDAV source is disposed");
    }
  }

  private principalCacheKey(principalId: string): string {
    return opaqueCacheKey("caldav-principal", this.sourceCacheKey, principalId);
  }

  private collectionCacheKey(url: URL): string {
    return opaqueCacheKey("caldav-collection", this.sourceCacheKey, url.toString());
  }

  private stateCacheKey(principalKey: string, collectionKey: string): string {
    return opaqueCacheKey("caldav-state", this.sourceCacheKey, principalKey, collectionKey);
  }

  private resourceCacheKey(url: URL): string {
    return opaqueCacheKey("caldav-resource", this.sourceCacheKey, url.toString());
  }

  private loadCache(now: number): void {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    if (!this.cacheFile) return;
    if (this.cacheMaxAgeMs === 0) {
      this.persistCache(now, true);
      return;
    }
    const raw = readBoundedCalDavCache(this.cacheFile, this.maxCacheBytes);
    if (!isDavRecord(raw) || !onlyObjectKeys(raw, ["version", "sourceKey", "collections"])
      || raw.version !== CALDAV_CACHE_VERSION || raw.sourceKey !== this.sourceCacheKey
      || !Array.isArray(raw.collections) || raw.collections.length > this.maxCachedCollections) return;
    for (const value of raw.collections) {
      if (!isDavRecord(value) || !onlyObjectKeys(value, [
        "key", "principalKey", "collectionKey", "windowKey", "syncToken", "collectionEtag",
        "resources", "updatedAt", "expiresAt",
      ])) continue;
      const window = persistedWindow(value.windowKey);
      if (!validOpaqueKey(value.key) || !validOpaqueKey(value.principalKey) || !validOpaqueKey(value.collectionKey)
        || value.key !== this.stateCacheKey(value.principalKey, value.collectionKey)
        || !window
        || !Number.isSafeInteger(value.updatedAt) || !Number.isSafeInteger(value.expiresAt)
        || Number(value.updatedAt) < 0 || Number(value.expiresAt) <= now
        || Number(value.expiresAt) <= Number(value.updatedAt)
        || Number(value.expiresAt) - Number(value.updatedAt) > this.cacheMaxAgeMs
        || (value.syncToken !== undefined && davValidator(value.syncToken) === undefined)
        || (value.collectionEtag !== undefined && davValidator(value.collectionEtag) === undefined)
        || !Array.isArray(value.resources) || value.resources.length > this.maxCachedResources) continue;
      const resources = new Map<string, CalDavResourceState>();
      let occurrenceCount = 0, valid = true;
      for (const resourceValue of value.resources) {
        if (!isDavRecord(resourceValue) || !onlyObjectKeys(resourceValue, ["key", "etag", "occurrences"])
          || !validOpaqueKey(resourceValue.key)
          || (resourceValue.etag !== undefined && davValidator(resourceValue.etag) === undefined)
          || !Array.isArray(resourceValue.occurrences)) { valid = false; break; }
        const occurrences: IcsCalendarOccurrence[] = [];
        for (const occurrenceValue of resourceValue.occurrences) {
          occurrenceCount++;
          if (occurrenceCount > MAX_ICS_OCCURRENCES || !isDavRecord(occurrenceValue)
            || !onlyObjectKeys(occurrenceValue, ["id", "startAt", "endAt", "allDay"])
            || typeof occurrenceValue.id !== "string" || !/^caldav-[a-f0-9]{24}$/.test(occurrenceValue.id)
            || !Number.isSafeInteger(occurrenceValue.startAt) || !Number.isSafeInteger(occurrenceValue.endAt)
            || Number(occurrenceValue.endAt) <= Number(occurrenceValue.startAt)
            || Number(occurrenceValue.startAt) >= window.endAt || Number(occurrenceValue.endAt) <= window.startAt
            || typeof occurrenceValue.allDay !== "boolean") {
            valid = false;
            break;
          }
          occurrences.push({
            id: occurrenceValue.id,
            startAt: Number(occurrenceValue.startAt),
            endAt: Number(occurrenceValue.endAt),
            allDay: occurrenceValue.allDay,
            availability: "busy",
            timezone: "UTC",
            source: sourceRef(this.descriptor.id, now, this.options.attribution),
          });
        }
        if (!valid || resources.has(resourceValue.key)) { valid = false; break; }
        resources.set(resourceValue.key, {
          ...(resourceValue.etag ? { etag: resourceValue.etag as string } : {}),
          occurrences,
        });
      }
      if (!valid) continue;
      if (this.states.has(value.key)) continue;
      this.states.set(value.key, {
        principalKey: value.principalKey,
        collectionKey: value.collectionKey,
        windowKey: `${window.startAt}:${window.endAt}:busy_free`,
        ...(value.syncToken ? { syncToken: value.syncToken as string } : {}),
        ...(value.collectionEtag ? { collectionEtag: value.collectionEtag as string } : {}),
        resources,
        updatedAt: Number(value.updatedAt),
        expiresAt: Number(value.expiresAt),
      });
    }
  }

  private pruneCache(now: number): void {
    for (const [key, state] of this.states) if (state.expiresAt <= now) this.states.delete(key);
    const overflow = this.states.size - this.maxCachedCollections;
    if (overflow <= 0) return;
    const oldest = [...this.states.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt || a[0].localeCompare(b[0]));
    for (const [key] of oldest.slice(0, overflow)) this.states.delete(key);
  }

  private persistedCollection(key: string, state: CalDavCollectionState): PersistedCalDavCollection | undefined {
    const windowKey = busyFreeWindowKey(state.windowKey);
    if (!windowKey) return undefined;
    const resources: PersistedCalDavResource[] = [...state.resources.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([resourceKey, resource]) => ({
      key: resourceKey,
      ...(resource.etag ? { etag: resource.etag } : {}),
      occurrences: resource.occurrences.map((occurrence) => ({
        id: occurrence.id,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        allDay: occurrence.allDay,
      })),
    }));
    return {
      key,
      principalKey: state.principalKey,
      collectionKey: state.collectionKey,
      windowKey,
      ...(state.syncToken ? { syncToken: state.syncToken } : {}),
      ...(state.collectionEtag ? { collectionEtag: state.collectionEtag } : {}),
      resources,
      updatedAt: state.updatedAt,
      expiresAt: state.expiresAt,
    };
  }

  private persistCache(now: number, force = false): void {
    if (!this.cacheFile || (this.cacheMaxAgeMs === 0 && !force)) return;
    this.pruneCache(now);
    const collections: PersistedCalDavCollection[] = [];
    const ordered = [...this.states.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt || a[0].localeCompare(b[0]));
    for (const [key, state] of ordered) {
      const collection = this.persistedCollection(key, state);
      if (!collection) continue;
      const candidate: PersistedCalDavCache = {
        version: CALDAV_CACHE_VERSION,
        sourceKey: this.sourceCacheKey,
        collections: [...collections, collection],
      };
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= this.maxCacheBytes) collections.push(collection);
    }
    try {
      const cacheDirectory = dirname(this.cacheFile);
      mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
      try { chmodSync(cacheDirectory, 0o700); } catch { /* best effort on platforms without POSIX modes */ }
      writeJsonAtomic(this.cacheFile, {
        version: CALDAV_CACHE_VERSION,
        sourceKey: this.sourceCacheKey,
        collections,
      } satisfies PersistedCalDavCache, { backup: false });
      try { chmodSync(this.cacheFile, 0o600); } catch { /* best effort on platforms without POSIX modes */ }
    } catch {
      // The live CalDAV result remains usable; cache paths and filesystem details are never logged.
    }
  }

  private async credential(principalId: string, runtime: ContextSourceRuntime): Promise<CalDavCredential> {
    this.assertActive(principalId);
    try {
      return await this.options.resolveSecret(this.options.secretRef, { principalId, sourceId: this.descriptor.id, signal: runtime.signal });
    } catch {
      throw new Error("CalDAV credential resolution failed");
    }
  }

  private async dav(
    method: "PROPFIND" | "REPORT",
    url: URL,
    body: string,
    credential: CalDavCredential,
    runtime: ContextSourceRuntime,
    depth = "1",
    ifNoneMatch?: string,
  ): Promise<DavResponse> {
    const headers = authHeaders(credential);
    headers.set("Depth", depth);
    if (ifNoneMatch) headers.set("If-None-Match", ifNoneMatch);
    let response: Response;
    try {
      response = await (this.options.fetch || runtime.fetch)(url, { method, headers, body, signal: runtime.signal, redirect: "manual" });
    } catch {
      throw new Error("CalDAV network request failed");
    }
    if (response.status !== 304 && !response.ok && response.status !== 207) throw new DavHttpError(response.status);
    return {
      status: response.status,
      body: response.status === 304 ? "" : await readBoundedResponse(response, this.maxResponseBytes, "CalDAV"),
      ...(davValidator(response.headers.get("etag")) ? { etag: response.headers.get("etag")! } : {}),
    };
  }

  private normalizeHref(href: string): URL { return validateCalDavUrl(href, this.endpoint); }

  private async discoverWithCredential(credential: CalDavCredential, runtime: ContextSourceRuntime): Promise<CalDavCalendar[]> {
    const responses: DavMultiStatus[] = [];
    const initial = parseDavMultiStatus((await this.dav("PROPFIND", this.endpoint, propfindBody(), credential, runtime)).body);
    responses.push(initial);
    let homeHref = initial.resources.find((resource) => resource.status < 300 && resource.calendarHomeSet)?.calendarHomeSet;
    if (!homeHref) {
      const principalHref = initial.resources.find((resource) => resource.status < 300 && resource.currentUserPrincipal)?.currentUserPrincipal;
      if (principalHref) {
        const principalUrl = this.normalizeHref(principalHref);
        const principal = parseDavMultiStatus((await this.dav("PROPFIND", principalUrl, propfindBody(), credential, runtime, "0")).body);
        responses.push(principal);
        homeHref = principal.resources.find((resource) => resource.status < 300 && resource.calendarHomeSet)?.calendarHomeSet;
      }
    }
    if (homeHref) {
      const homeUrl = this.normalizeHref(homeHref);
      const home = parseDavMultiStatus((await this.dav("PROPFIND", homeUrl, propfindBody(), credential, runtime)).body);
      responses.push(home);
    }
    const calendars = responses.flatMap((response) => response.resources).filter((resource) => resource.status < 300 && resource.isCalendar).map((resource) => {
      const href = this.normalizeHref(resource.href).toString();
      return {
        href,
        ...(resource.displayName ? { displayName: resource.displayName } : {}),
        ...(davValidator(resource.syncToken) ? { syncToken: resource.syncToken } : {}),
        ...(davValidator(resource.etag) ? { etag: resource.etag } : {}),
      };
    });
    const unique = new Map(calendars.map((calendar) => [calendar.href, calendar]));
    return [...unique.values()].sort((a, b) => a.href.localeCompare(b.href));
  }

  async discoverCalendars(principalId: string, runtime: ContextSourceRuntime): Promise<CalDavCalendar[]> {
    this.assertActive(principalId);
    return this.discoverWithCredential(await this.credential(principalId, runtime), runtime);
  }

  private updateResources(
    current: Map<string, CalDavResourceState>,
    response: DavMultiStatus,
    replace: boolean,
    calendarUrl: URL,
    collectionKey: string,
    window: CalendarWindow,
    access: CalendarAccessLevel,
    observedAt: number,
  ): Map<string, CalDavResourceState> {
    const next = replace ? new Map<string, CalDavResourceState>() : new Map(current);
    for (const resource of response.resources) {
      const resourceUrl = this.normalizeHref(resource.href);
      const resourceKey = this.resourceCacheKey(resourceUrl);
      if (resource.status === 404 || resource.status === 410) { next.delete(resourceKey); continue; }
      if (resource.status >= 300 || resource.isCalendar) continue;
      const previous = current.get(resourceKey);
      if (resource.calendarData) {
        const occurrences = parseIcsCalendar(resource.calendarData, {
          ...window,
          sourceId: this.descriptor.id,
          observedAt,
          access,
          defaultTimeZone: this.options.defaultTimeZone || "UTC",
          attribution: this.options.attribution,
        });
        for (const occurrence of occurrences) {
          occurrence.id = `caldav-${stableId(this.descriptor.id, collectionKey, occurrence.id, occurrence.startAt, occurrence.endAt)}`;
          if (access === "details") {
            occurrence.calendarHref = calendarUrl.toString();
            occurrence.eventHref = resourceUrl.toString();
            occurrence.uid = occurrence.source.recordId;
            if (davValidator(resource.etag)) occurrence.etag = resource.etag;
          }
        }
        next.set(resourceKey, {
          ...(davValidator(resource.etag) ? { etag: resource.etag } : {}),
          occurrences,
        });
      } else if (previous && (!resource.etag || resource.etag === previous.etag)) {
        next.set(resourceKey, previous);
      } else {
        throw new Error("CalDAV response omitted changed calendar data");
      }
      if (next.size > this.maxCachedResources) throw new Error("CalDAV resource limit exceeded");
    }
    if (next.size > this.maxCachedResources) throw new Error("CalDAV resource limit exceeded");
    const occurrenceCount = [...next.values()].reduce((total, resource) => total + resource.occurrences.length, 0);
    if (occurrenceCount > MAX_ICS_OCCURRENCES) throw new Error("CalDAV occurrence limit exceeded");
    return next;
  }

  private stateOccurrences(state: CalDavCollectionState, observedAt: number): IcsCalendarOccurrence[] {
    const occurrences = [...state.resources.values()].flatMap((resource) => resource.occurrences.map((occurrence) => {
      const cloned = structuredClone(occurrence);
      cloned.source.observedAt = observedAt;
      return cloned;
    }));
    return deduplicateCalendarOccurrences(occurrences);
  }

  private async queryCollection(
    principalId: string,
    calendar: CalDavCalendar,
    window: CalendarWindow,
    access: CalendarAccessLevel,
    credential: CalDavCredential,
    runtime: ContextSourceRuntime,
    cacheGeneration: number,
  ): Promise<IcsCalendarOccurrence[]> {
    this.assertActive(principalId);
    const url = this.normalizeHref(calendar.href);
    const now = runtime.now();
    assertTimestamp(now, "CalDAV observedAt");
    this.lastObservedAt = now;
    const principalKey = this.principalCacheKey(principalId);
    const collectionKey = this.collectionCacheKey(url);
    const stateKey = this.stateCacheKey(principalKey, collectionKey);
    const windowKey = `${window.startAt}:${window.endAt}:${access}`;
    const cached = this.states.get(stateKey);
    const previous = cached?.windowKey === windowKey && cached.expiresAt > now ? cached : undefined;
    let response: DavMultiStatus | undefined;
    let report: DavResponse;
    let replace = true;
    let invalidSyncToken = false;
    if (previous?.syncToken) {
      try {
        report = await this.dav("REPORT", url, syncCollectionBody(previous.syncToken, access), credential, runtime);
        response = parseDavMultiStatus(report.body);
        replace = false;
      } catch (error) {
        if (!(error instanceof DavHttpError) || (error.status !== 403 && error.status !== 409)) throw error;
        invalidSyncToken = true;
        report = await this.dav(
          "REPORT",
          url,
          calendarQueryBody(window, access),
          credential,
          runtime,
          "1",
          previous.collectionEtag,
        );
      }
    } else {
      report = await this.dav(
        "REPORT",
        url,
        calendarQueryBody(window, access),
        credential,
        runtime,
        "1",
        previous?.collectionEtag,
      );
    }
    let resources: Map<string, CalDavResourceState>;
    if (report.status === 304) {
      if (!previous) throw new Error("CalDAV returned 304 without cached data");
      resources = previous.resources;
    } else {
      response ||= parseDavMultiStatus(report.body);
      resources = this.updateResources(
        previous?.resources || new Map<string, CalDavResourceState>(),
        response,
        replace,
        url,
        collectionKey,
        window,
        access,
        now,
      );
    }
    const responseToken = davValidator(response?.syncToken);
    const discoveredToken = davValidator(calendar.syncToken);
    let syncToken = replace ? responseToken || discoveredToken : responseToken || previous?.syncToken;
    if (invalidSyncToken && syncToken === previous?.syncToken) syncToken = undefined;
    const responseEtag = davValidator(report.etag);
    const discoveredEtag = davValidator(calendar.etag);
    const collectionEtag = report.status === 304
      ? responseEtag || previous?.collectionEtag
      : replace ? responseEtag || discoveredEtag : responseEtag || discoveredEtag || previous?.collectionEtag;
    const state: CalDavCollectionState = {
      principalKey,
      collectionKey,
      windowKey,
      resources,
      ...(syncToken ? { syncToken } : {}),
      ...(collectionEtag ? { collectionEtag } : {}),
      updatedAt: now,
      expiresAt: now + this.cacheMaxAgeMs,
    };
    if (runtime.signal.aborted || cacheGeneration !== this.cacheGeneration) throw new Error("CalDAV query was invalidated");
    this.assertActive(principalId);
    this.states.set(stateKey, state);
    this.persistCache(now);
    return this.stateOccurrences(state, now);
  }

  async query(request: PersonalContextQuery, runtime: ContextSourceRuntime): Promise<ContextCandidate<CalendarCandidateData>[]> {
    this.assertActive(request.principalId);
    const cacheGeneration = this.cacheGeneration;
    const window = queryWindow(request);
    const now = runtime.now();
    assertTimestamp(now, "CalDAV observedAt");
    this.lastObservedAt = now;
    this.loadCache(now);
    this.pruneCache(now);
    const access = await calendarAccess(this.options.resolveAccess, request);
    const credential = await this.credential(request.principalId, runtime);
    let discovered: CalDavCalendar[] = [];
    try { discovered = await this.discoverWithCredential(credential, runtime); }
    catch (error) { if (!this.calendarHrefs?.length) throw error; }
    const discoveredByHref = new Map(discovered.map((calendar) => [calendar.href, calendar]));
    const calendars = this.calendarHrefs?.length
      ? this.calendarHrefs.map((url) => discoveredByHref.get(url.toString()) || { href: url.toString() })
      : discovered;
    if (!calendars.length) return [];
    const settled = await Promise.allSettled(calendars.map((calendar) => this.queryCollection(
      request.principalId,
      calendar,
      window,
      access,
      credential,
      runtime,
      cacheGeneration,
    )));
    const occurrences: IcsCalendarOccurrence[] = [];
    let failures = 0;
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") occurrences.push(...result.value);
      else {
        failures++;
        this.options.onPartialFailure?.({ sourceId: this.descriptor.id, calendarIndex: index, message: "CalDAV calendar query failed" });
      }
    });
    if (failures === calendars.length) throw new Error("all selected CalDAV calendars failed");
    if (access === "details") return occurrences.map(occurrenceCandidate);
    const intervals: DeviceCalendarInterval[] = occurrences.map((occurrence) => ({
      startAt: occurrence.startAt, endAt: occurrence.endAt, allDay: occurrence.allDay, availability: "busy",
    }));
    const complete = failures === 0;
    return availabilityCandidates(
      normalizeDeviceCalendarBusyFree(intervals, window),
      sourceRef(this.descriptor.id, runtime.now(), this.options.attribution),
      complete,
      complete,
    );
  }
}

/** The returned source retains eraseCachedData/dispose so integration bundles can bind revocation. */
export function createCalDavReadOnlySource(options: CalDavReadOnlySourceOptions): CalDavReadOnlySource {
  return new CalDavReadOnlySource(options);
}
