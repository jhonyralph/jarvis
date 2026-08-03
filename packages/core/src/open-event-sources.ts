import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  ContextCandidate,
  ContextSourceDescriptor,
  ContextSourceRef,
  GeoPoint,
  PersonalContextQuery,
} from "@jarvis/protocol";
import type { ContextSource, ContextSourceRuntime } from "./context-sources.js";
import {
  MAX_ICS_WINDOW_MS,
  calendarWallTimeToEpoch,
  parseCalendarTimestamp,
  parseIcsCalendar,
} from "./calendar-context.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_EVENT_WINDOW_MS = 90 * DAY_MS;
const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 500;
const DEFAULT_HTTP_CACHE_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_HTTP_RESPONSE_LIMIT = 4 * 1_024 * 1_024;
const SOURCE_METADATA_LAST_REVIEWED_AT = "2026-08-01";
const DEFAULT_EVENT_RETENTION_POLICY = "Bounded conditional response cache only; no durable raw-feed retention";
const UNDECLARED_EVENT_LICENSE = "Not declared by configured source; operator review required";

export const MAPAS_CULTURAIS_PARSER_VERSION = 1;
export const PBH_EVENT_PARSER_VERSION = MAPAS_CULTURAIS_PARSER_VERSION;
export const DEFAULT_PBH_EVENT_ENDPOINT = "https://mapaculturalbh.pbh.gov.br/api/event/find";

export type OpenEventState = "confirmed" | "cancelled" | "postponed" | "draft" | "unknown";

const OPEN_EVENT_STATES = new Set<OpenEventState>(["confirmed", "cancelled", "postponed", "draft", "unknown"]);

export interface OpenEventVariant {
  sourceId: string;
  recordId?: string;
  observedAt: number;
  title: string;
  startAt: number;
  endAt?: number;
  locationName?: string;
  address?: string;
  url: string;
  state: OpenEventState;
  sourceState?: string;
  timeZone: string;
  updatedAt?: number;
}

export interface OpenEventConflict {
  field: "title" | "startAt" | "endAt" | "locationName" | "address" | "state" | "timeZone";
  preferredSourceId: string;
  values: Array<{ sourceId: string; observedAt: number; value: string | number }>;
}

export interface OpenEventData {
  recordId: string;
  startAt: number;
  endAt?: number;
  allDay: boolean;
  state: OpenEventState;
  sourceState?: string;
  timeZone: string;
  url: string;
  description?: string;
  locationName?: string;
  address?: string;
  region?: string;
  categories?: string[];
  languages?: string[];
  updatedAt?: number;
  variants?: OpenEventVariant[];
  conflicts?: OpenEventConflict[];
  preferredSourceId?: string;
}

export interface OpenEventParserOptions {
  sourceId: string;
  sourceUrl: string;
  observedAt: number;
  attribution: string;
  defaultTimeZone?: string;
}

interface ParsedOpenEvent {
  recordId: string;
  title: string;
  startAt: number;
  endAt?: number;
  allDay: boolean;
  state: OpenEventState;
  sourceState?: string;
  timeZone?: string;
  url: string;
  description?: string;
  locationName?: string;
  address?: string;
  region?: string;
  categories?: string[];
  languages?: string[];
  updatedAt?: number;
  point?: GeoPoint;
}

interface HttpEventSourceBaseOptions {
  sourceId: string;
  label: string;
  attribution: string;
  license?: string;
  retentionPolicy?: string;
  lastReviewedAt?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  staleIfErrorMs?: number;
  maxResponseBytes?: number;
}

export interface MapasCulturaisSourceOptions extends Partial<HttpEventSourceBaseOptions> {
  endpoint: string;
  sourceId?: string;
  label?: string;
  attribution?: string;
  sourcePageUrl?: string;
  defaultTimeZone?: string;
  apiLimit?: number;
  parserVersion?: number;
  query?: Record<string, string | number | boolean>;
}

export interface PbhEventSourceOptions extends Omit<MapasCulturaisSourceOptions, "endpoint"> {
  endpoint?: string;
}

export interface RssAtomFieldMap {
  start?: string[];
  end?: string[];
  location?: string[];
  address?: string[];
  region?: string[];
  status?: string[];
  language?: string[];
}

export interface RssAtomEventSourceOptions extends Partial<HttpEventSourceBaseOptions> {
  url: string;
  sourceId?: string;
  label?: string;
  attribution?: string;
  defaultTimeZone?: string;
  fields?: RssAtomFieldMap;
}

export interface IcsEventSourceOptions extends Partial<HttpEventSourceBaseOptions> {
  url: string;
  sourceId?: string;
  label?: string;
  attribution?: string;
  defaultTimeZone?: string;
}

export interface JsonLdEventSourceOptions extends Partial<HttpEventSourceBaseOptions> {
  url: string;
  sourceId?: string;
  label?: string;
  attribution?: string;
  defaultTimeZone?: string;
}

export interface EventSourceFailure {
  sourceId: string;
  message: string;
}

export interface OpenEventFederatorOptions {
  sourceId?: string;
  label?: string;
  sources: Array<ContextSource<OpenEventData>>;
  dedupTimeToleranceMs?: number;
  onPartialFailure?: (failure: EventSourceFailure) => void;
}

interface ConditionalCacheEntry {
  body: string;
  contentType: string;
  etag?: string;
  lastModified?: string;
}

function stableId(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value)) {
    for (const key of ["#text", "__cdata", "value", "name"]) {
      const nested = stringValue(value[key]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function ownValue(record: Record<string, unknown>, name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, name)) return record[name];
  const target = name.toLowerCase();
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === target);
  return key === undefined ? undefined : record[key];
}

function pathValue(record: Record<string, unknown>, path: string): unknown {
  let value: unknown = record;
  for (const part of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = ownValue(value, part);
  }
  return value;
}

function firstPath(record: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = pathValue(record, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function flattenStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (isRecord(value)) return Object.values(value).flatMap(flattenStrings);
  const text = stringValue(value);
  return text ? text.split(",").map((part) => part.trim()).filter(Boolean) : [];
}

function uniqueStrings(values: string[]): string[] | undefined {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length ? unique : undefined;
}

function normalizeText(value: string | undefined): string {
  return (value || "").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function validateSourceUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("event source URL is invalid"); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("event source URL must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("event source URL must not contain credentials");
  url.hash = "";
  return url;
}

function originalUrl(value: unknown, fallback: string): string {
  const text = stringValue(value);
  if (!text) return fallback;
  try {
    const url = new URL(text, fallback);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return fallback;
    return url.toString();
  } catch { return fallback; }
}

function dateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function dateOnlyText(value: unknown): string | undefined {
  const text = stringValue(value);
  return text && dateOnly(text) ? text.trim() : undefined;
}

function nextLocalDay(value: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())!;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return calendarWallTimeToEpoch({
    year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0, second: 0,
  }, timeZone);
}

function temporal(value: unknown, timeZone: string, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let timestamp: unknown = value;
  let effectiveTimeZone = timeZone;
  if (isRecord(value)) {
    const nestedDate = ownValue(value, "date") ?? ownValue(value, "datetime");
    const nestedTimeZone = stringValue(ownValue(value, "timezone") ?? ownValue(value, "timeZone") ?? ownValue(value, "tzid"));
    if (nestedDate !== undefined) timestamp = nestedDate;
    else {
      const text = stringValue(value);
      if (text !== undefined) timestamp = text;
    }
    if (nestedTimeZone) effectiveTimeZone = nestedTimeZone;
  }
  if (typeof timestamp === "string") {
    timestamp = timestamp.trim().replace(/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:?\d{2})?$)/, "$1");
  }
  try { return parseCalendarTimestamp(timestamp, effectiveTimeZone); }
  catch { throw new Error(`invalid event ${field}`); }
}

function pointFrom(value: unknown): GeoPoint | undefined {
  if (!isRecord(value)) return undefined;
  const coordinates = ownValue(value, "coordinates");
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lng = Number(coordinates[0]), lat = Number(coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  const lat = Number(firstPath(value, ["lat", "latitude"]));
  const lng = Number(firstPath(value, ["lng", "lon", "long", "longitude"]));
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  return undefined;
}

const CONFIRMED_EVENT_STATES = new Set([
  "1", "active", "ativa", "ativo", "ativada", "ativado", "confirmed", "confirmada", "confirmado",
  "enabled", "eventscheduled", "published", "publicada", "publicado", "scheduled",
]);
const CANCELLED_EVENT_STATES = new Set([
  "-10", "-2", "-9", "archived", "arquivada", "arquivado", "canceled", "cancelada", "cancelado", "cancelled",
  "desabilitada", "desabilitado", "disabled", "eventcanceled", "eventcancelled", "lixeira", "trash",
]);
const POSTPONED_EVENT_STATES = new Set([
  "adiada", "adiado", "eventpostponed", "eventrescheduled", "postponed", "remarcada", "remarcado", "rescheduled",
  "suspensa", "suspenso",
]);
const DRAFT_EVENT_STATES = new Set([
  "-5", "0", "draft", "nao confirmada", "nao confirmado", "nao publicada", "nao publicado", "not confirmed",
  "not published", "pending", "pendente", "rascunho", "unconfirmed", "unpublished",
]);
const PBH_CANCELLED_EVENT_STATES = new Set([
  "desistencia", "desistente", "indeferida", "indeferido", "nao autorizada", "nao autorizado",
  "negada", "negado", "reserva nao confirmada",
]);
const PBH_CONFIRMED_EVENT_STATES = new Set([
  "aprovada", "aprovado", "autorizada", "autorizado", "deferida", "deferido", "licenciada", "licenciado",
  "reserva confirmada",
]);
const PBH_DRAFT_EVENT_STATES = new Set([
  "aguardando analise", "em analise", "em licenciamento", "protocolada", "protocolado", "reserva previa",
  "solicitada", "solicitado",
]);

function sourceStateValue(value: unknown): string | undefined {
  const state = stringValue(value);
  return state ? state.slice(0, 200) : undefined;
}

function statusMatches(status: string, expected: ReadonlySet<string>): boolean {
  if (expected.has(status)) return true;
  const qualified = status.startsWith("http ") || status.startsWith("https ") || status.startsWith("urn ") || status.startsWith("status ");
  if (qualified) for (const value of expected) if (status.endsWith(` ${value}`)) return true;
  return false;
}

function mapKnownEventState(value: unknown): OpenEventState {
  const sourceState = sourceStateValue(value);
  if (sourceState === "1") return "confirmed";
  if (sourceState === "0" || sourceState === "-5") return "draft";
  if (sourceState === "-2" || sourceState === "-9" || sourceState === "-10") return "cancelled";
  const status = normalizeText(sourceState);
  if (!status) return "unknown";
  if (statusMatches(status, CANCELLED_EVENT_STATES)) return "cancelled";
  if (statusMatches(status, POSTPONED_EVENT_STATES)) return "postponed";
  if (statusMatches(status, DRAFT_EVENT_STATES)) return "draft";
  if (statusMatches(status, CONFIRMED_EVENT_STATES)) return "confirmed";
  return "unknown";
}

/** Mapas Culturais entity/occurrence states as defined by parser contract v1. */
export function mapMapasCulturaisEventState(value: unknown): OpenEventState {
  return mapKnownEventState(value);
}

/** PBH extends the Mapas Culturais states with public licensing labels used by municipal feeds. */
export function mapPbhEventState(value: unknown): OpenEventState {
  const status = normalizeText(sourceStateValue(value));
  if (!status) return "unknown";
  if (statusMatches(status, PBH_CANCELLED_EVENT_STATES)) return "cancelled";
  if (statusMatches(status, PBH_CONFIRMED_EVENT_STATES)) return "confirmed";
  if (statusMatches(status, PBH_DRAFT_EVENT_STATES)) return "draft";
  return mapKnownEventState(value);
}

interface EventStateResolution {
  state: OpenEventState;
  sourceState?: string;
}

function resolveEventState(values: unknown[], mapper: (value: unknown) => OpenEventState): EventStateResolution {
  const sourceStates = uniqueStrings(values.flatMap((value) => sourceStateValue(value) || []));
  const states = values.filter((value) => sourceStateValue(value) !== undefined).map(mapper);
  let state: OpenEventState = "unknown";
  if (states.includes("cancelled")) state = "cancelled";
  else if (states.includes("draft")) state = "draft";
  else if (states.includes("postponed")) state = "postponed";
  else if (states.length > 0 && states.every((value) => value === "confirmed")) state = "confirmed";
  return { state, ...(sourceStates ? { sourceState: sourceStates.join(" | ") } : {}) };
}

function suppressOpenEvent(state: OpenEventState): boolean {
  return state === "cancelled" || state === "draft";
}

function validatedTimeZone(value: string): string {
  const timeZone = value.trim();
  if (!timeZone) throw new Error("event timezone is invalid");
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(0); }
  catch { throw new Error("event timezone is invalid"); }
  return timeZone;
}

function parserOptions(input: OpenEventParserOptions): Required<OpenEventParserOptions> {
  return { ...input, defaultTimeZone: validatedTimeZone(input.defaultTimeZone || "UTC") };
}

function candidateFromParsed(event: ParsedOpenEvent, options: Required<OpenEventParserOptions>): ContextCandidate<OpenEventData> {
  if (!event.title.trim()) throw new Error("event title is required");
  if (!Number.isFinite(event.startAt)) throw new Error("event startAt is invalid");
  if (event.endAt !== undefined && (!Number.isFinite(event.endAt) || event.endAt <= event.startAt)) throw new Error("event endAt is invalid");
  if (!OPEN_EVENT_STATES.has(event.state)) throw new Error("event state is invalid");
  const timeZone = validatedTimeZone(event.timeZone || options.defaultTimeZone);
  const data: OpenEventData = {
    recordId: event.recordId,
    startAt: event.startAt,
    ...(event.endAt !== undefined ? { endAt: event.endAt } : {}),
    allDay: event.allDay,
    state: event.state,
    ...(event.sourceState ? { sourceState: event.sourceState } : {}),
    timeZone,
    url: event.url,
    ...(event.description ? { description: event.description } : {}),
    ...(event.locationName ? { locationName: event.locationName } : {}),
    ...(event.address ? { address: event.address } : {}),
    ...(event.region ? { region: event.region } : {}),
    ...(event.categories ? { categories: event.categories } : {}),
    ...(event.languages ? { languages: event.languages } : {}),
    ...(event.updatedAt !== undefined ? { updatedAt: event.updatedAt } : {}),
  };
  const source: ContextSourceRef = {
    sourceId: options.sourceId,
    recordId: event.recordId,
    observedAt: options.observedAt,
    freshness: "fresh",
    attribution: options.attribution,
    url: event.url,
  };
  return {
    id: `open-event-${stableId(options.sourceId, event.recordId, event.startAt)}`,
    kind: "open_event",
    title: event.title.trim(),
    data,
    ...(event.point ? { point: { ...event.point } } : {}),
    sources: [source],
  };
}

function eventWindow(request: PersonalContextQuery, now: number): { startAt: number; endAt: number } {
  const startAt = request.startAt ?? now;
  const endAt = request.endAt ?? startAt + DEFAULT_EVENT_WINDOW_MS;
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || endAt <= startAt) throw new Error("event query window is invalid");
  if (endAt - startAt > MAX_ICS_WINDOW_MS) throw new Error("event query window exceeds the maximum of 366 days");
  return { startAt, endAt };
}

function eventLimit(request: PersonalContextQuery): number {
  if (request.limit === undefined) return DEFAULT_EVENT_LIMIT;
  if (!Number.isSafeInteger(request.limit) || request.limit <= 0) throw new Error("event query limit is invalid");
  return Math.min(MAX_EVENT_LIMIT, request.limit);
}

function filterValues(request: PersonalContextQuery, names: string[]): string[] {
  for (const name of names) {
    const value = request.filters?.[name];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function containsAny(values: string[] | undefined, expected: string[]): boolean {
  if (!expected.length) return true;
  const haystack = (values || []).map(normalizeText);
  return expected.map(normalizeText).some((needle) => haystack.some((value) => value.includes(needle)));
}

export function filterOpenEventCandidates(
  candidates: ContextCandidate<OpenEventData>[],
  request: PersonalContextQuery,
  now: number,
): ContextCandidate<OpenEventData>[] {
  const window = eventWindow(request, now);
  const categories = filterValues(request, ["category", "categories"]);
  const languages = filterValues(request, ["language", "languages"]);
  const regions = filterValues(request, ["region", "regions"]);
  const query = normalizeText(request.text);
  const limit = eventLimit(request);
  return candidates.filter((candidate) => {
    if (suppressOpenEvent(candidate.data.state)) return false;
    const endAt = candidate.data.endAt ?? candidate.data.startAt + 1;
    if (candidate.data.startAt >= window.endAt || endAt <= window.startAt) return false;
    if (!containsAny(candidate.data.categories, categories) || !containsAny(candidate.data.languages, languages)) return false;
    if (regions.length && !containsAny([candidate.data.region || "", candidate.data.locationName || "", candidate.data.address || ""], regions)) return false;
    if (query) {
      const searchable = normalizeText([
        candidate.title, candidate.data.description, candidate.data.locationName, candidate.data.address,
        ...(candidate.data.categories || []), ...(candidate.data.languages || []),
      ].filter(Boolean).join(" "));
      if (!searchable.includes(query)) return false;
    }
    return true;
  }).sort(eventCandidateComparator).slice(0, limit);
}

function eventCandidateComparator(left: ContextCandidate<OpenEventData>, right: ContextCandidate<OpenEventData>): number {
  return left.data.startAt - right.data.startAt
    || compareStrings(normalizeText(left.title), normalizeText(right.title))
    || compareStrings(normalizeText(left.data.locationName || left.data.address), normalizeText(right.data.locationName || right.data.address))
    || compareStrings(left.sources[0]?.sourceId || "", right.sources[0]?.sourceId || "")
    || compareStrings(left.id, right.id);
}

class ConditionalHttpReader {
  private readonly cache = new Map<string, ConditionalCacheEntry>();
  constructor(private readonly maxResponseBytes: number) {}

  async read(
    url: URL,
    accept: string,
    runtime: ContextSourceRuntime,
    requestHeaders: Record<string, string> = {},
  ): Promise<{ body: string; contentType: string; observedAt: number }> {
    const key = url.toString(), cached = this.cache.get(key), headers = new Headers(requestHeaders);
    headers.set("Accept", accept);
    if (cached?.etag) headers.set("If-None-Match", cached.etag);
    if (cached?.lastModified) headers.set("If-Modified-Since", cached.lastModified);
    let response: Response;
    try { response = await runtime.fetch(url, { method: "GET", headers, signal: runtime.signal, redirect: "manual" }); }
    catch { throw new Error("event source network request failed"); }
    if (response.status === 304) {
      if (!cached) throw new Error("event source returned 304 without cached content");
      this.cache.set(key, {
        ...cached,
        ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
        ...(response.headers.get("last-modified") ? { lastModified: response.headers.get("last-modified")! } : {}),
      });
      return { body: cached.body, contentType: cached.contentType, observedAt: runtime.now() };
    }
    if (!response.ok) throw new Error(`event source request failed with HTTP ${response.status}`);
    const body = await readBoundedEventResponse(response, this.maxResponseBytes);
    const entry: ConditionalCacheEntry = {
      body,
      contentType: response.headers.get("content-type") || "",
      ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
      ...(response.headers.get("last-modified") ? { lastModified: response.headers.get("last-modified")! } : {}),
    };
    this.cache.set(key, entry);
    return { body, contentType: entry.contentType, observedAt: runtime.now() };
  }
}

async function readBoundedEventResponse(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("event source response exceeds size limit");
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
        throw new Error("event source response exceeds size limit");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof Error && error.message === "event source response exceeds size limit") throw error;
    throw new Error("event source response could not be read");
  } finally { reader.releaseLock(); }
}

function descriptor(options: HttpEventSourceBaseOptions, transport: "http" | "builtin" = "http"): ContextSourceDescriptor {
  return {
    id: options.sourceId,
    label: options.label,
    purposes: ["events"],
    costClass: "free",
    transport,
    certification: "first_party",
    attribution: options.attribution,
    license: options.license || UNDECLARED_EVENT_LICENSE,
    cachePolicy: "conditional HTTP with ETag/Last-Modified and bounded body",
    retentionPolicy: options.retentionPolicy || DEFAULT_EVENT_RETENTION_POLICY,
    lastReviewedAt: options.lastReviewedAt || SOURCE_METADATA_LAST_REVIEWED_AT,
  };
}

function httpNumericOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved)) throw new Error(`event source ${name} is invalid`);
  return resolved;
}

function httpSourceDefaults(input: Partial<HttpEventSourceBaseOptions>, fallback: { sourceId: string; label: string; attribution: string }): HttpEventSourceBaseOptions {
  return {
    sourceId: input.sourceId || fallback.sourceId,
    label: input.label || fallback.label,
    attribution: input.attribution || fallback.attribution,
    ...(input.license ? { license: input.license } : {}),
    ...(input.retentionPolicy ? { retentionPolicy: input.retentionPolicy } : {}),
    ...(input.lastReviewedAt ? { lastReviewedAt: input.lastReviewedAt } : {}),
    cacheTtlMs: Math.max(0, httpNumericOption(input.cacheTtlMs, DEFAULT_HTTP_CACHE_TTL_MS, "cache TTL")),
    timeoutMs: Math.max(100, httpNumericOption(input.timeoutMs, 10_000, "timeout")),
    staleIfErrorMs: Math.max(0, httpNumericOption(input.staleIfErrorMs, 60 * 60 * 1_000, "stale-if-error window")),
    maxResponseBytes: Math.max(1_024, httpNumericOption(input.maxResponseBytes, DEFAULT_HTTP_RESPONSE_LIMIT, "response limit")),
  };
}

function mapasDate(containers: Record<string, unknown>[], kind: "start" | "end", timeZone: string): { at?: number; allDay: boolean; dateValue?: string } {
  const directNames = kind === "start"
    ? ["startDate", "start", "start_datetime", "startsAt"]
    : ["endDate", "end", "end_datetime", "endsAt"];
  const dateNames = kind === "start" ? ["startsOn", "startDate", "date"] : ["endsOn", "endDate"];
  const timeNames = kind === "start" ? ["startsAt", "startTime"] : ["endsAt", "endTime"];
  let sawDateField = false;
  for (const container of containers) {
    const explicitDatePart = stringValue(firstPath(container, dateNames));
    const timePart = stringValue(firstPath(container, timeNames));
    const datePart = explicitDatePart || (kind === "end" && timePart
      ? stringValue(firstPath(container, ["startsOn", "startDate", "date"])) : undefined);
    const direct = firstPath(container, directNames);
    if (explicitDatePart || timePart || direct !== undefined) sawDateField = true;
    if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart) && timePart && /^\d{1,2}:\d{2}/.test(timePart)) {
      return { at: temporal(`${datePart}T${timePart}`, timeZone, `${kind} date`), allDay: false, dateValue: datePart };
    }
    const directText = stringValue(direct);
    if (direct !== undefined && (typeof direct === "number" || !!directText && (!/^\d{1,2}:\d{2}/.test(directText)))) {
      const directDate = dateOnlyText(direct);
      return { at: temporal(direct, timeZone, `${kind} date`), allDay: directDate !== undefined, ...(directDate ? { dateValue: directDate } : {}) };
    }
  }
  if (sawDateField) throw new Error(`invalid event ${kind} date`);
  return { allDay: false };
}

function mapasLocation(record: Record<string, unknown>, occurrence: Record<string, unknown>): {
  locationName?: string; address?: string; region?: string; point?: GeoPoint;
} {
  const locationValue = firstPath(occurrence, ["space", "location"]) ?? firstPath(record, ["space", "location"]);
  const location = isRecord(locationValue) ? locationValue : {};
  const locationName = stringValue(firstPath(location, ["name", "title"])) || (typeof locationValue === "string" ? locationValue : undefined);
  const addressValue = firstPath(location, ["address", "endereco", "streetAddress"]);
  const address = isRecord(addressValue)
    ? uniqueStrings(["streetAddress", "addressLocality", "addressRegion", "postalCode"].map((key) => stringValue(firstPath(addressValue, [key])) || ""))?.join(", ")
    : stringValue(addressValue) || uniqueStrings(["En_Nome_Logradouro", "En_Num", "En_Municipio"].map((key) => stringValue(firstPath(location, [key])) || ""))?.join(", ");
  const region = stringValue(firstPath(location, ["region", "neighborhood", "bairro", "En_Bairro", "address.addressRegion"]));
  const point = pointFrom(firstPath(location, ["location", "geo"]) || location);
  return { ...(locationName ? { locationName } : {}), ...(address ? { address } : {}), ...(region ? { region } : {}), ...(point ? { point } : {}) };
}

function mapasDurationMs(containers: Record<string, unknown>[]): number | undefined {
  for (const container of containers) {
    const raw = firstPath(container, ["durationMinutes", "duration"]);
    if (raw === undefined || raw === null || raw === "") continue;
    const text = stringValue(raw) || "";
    let minutes: number;
    if (/^\d+(?:\.\d+)?$/.test(text)) minutes = Number(text);
    else {
      const iso = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?$/i.exec(text);
      if (!iso || (!iso[1] && !iso[2])) throw new Error("invalid event duration");
      minutes = Number(iso[1] || 0) * 60 + Number(iso[2] || 0);
    }
    const duration = minutes * 60 * 1_000;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 31 * DAY_MS) throw new Error("invalid event duration");
    return duration;
  }
  return undefined;
}

function mapasTimeZone(containers: Record<string, unknown>[], fallback: string): string {
  for (const container of containers) {
    const value = stringValue(firstPath(container, ["timezone", "timeZone", "tzid"]));
    if (value) return validatedTimeZone(value);
  }
  return fallback;
}

function parseMapasCulturaisEventsV1(
  payload: unknown,
  input: OpenEventParserOptions,
  stateMapper: (value: unknown) => OpenEventState,
): ContextCandidate<OpenEventData>[] {
  const options = parserOptions(input);
  const records = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.events) ? payload.events
      : isRecord(payload) && Array.isArray(payload.data) ? payload.data : undefined;
  if (!records) throw new Error("invalid Mapas Culturais response");
  const candidates: ContextCandidate<OpenEventData>[] = [];
  for (const [recordIndex, value] of records.entries()) {
    if (!isRecord(value)) throw new Error("invalid Mapas Culturais event record");
    const recordStatus = firstPath(value, ["status", "eventStatus"]);
    if (suppressOpenEvent(resolveEventState([recordStatus], stateMapper).state)) continue;
    const title = stringValue(firstPath(value, ["name", "title"]));
    if (!title) throw new Error("invalid Mapas Culturais event title");
    const occurrencesValue = firstPath(value, ["occurrences", "occurrence"]);
    const occurrences = occurrencesValue === undefined ? [value] : asArray(occurrencesValue);
    for (const [occurrenceIndex, occurrenceValue] of occurrences.entries()) {
      if (!isRecord(occurrenceValue)) throw new Error("invalid Mapas Culturais occurrence");
      const rule = isRecord(firstPath(occurrenceValue, ["rule"])) ? firstPath(occurrenceValue, ["rule"]) as Record<string, unknown> : {};
      const occurrenceStatus = occurrenceValue === value ? undefined : firstPath(occurrenceValue, ["status", "eventStatus"]);
      const state = resolveEventState([recordStatus, occurrenceStatus], stateMapper);
      if (suppressOpenEvent(state.state)) continue;
      const timeZone = mapasTimeZone([occurrenceValue, rule, value], options.defaultTimeZone);
      const start = mapasDate([occurrenceValue, rule, value], "start", timeZone);
      if (start.at === undefined) continue;
      const end = mapasDate([occurrenceValue, rule, value], "end", timeZone);
      const duration = mapasDurationMs([occurrenceValue, rule, value]);
      const endAt = end.at ?? (duration !== undefined ? start.at + duration
        : start.allDay && start.dateValue ? nextLocalDay(start.dateValue, timeZone) : undefined);
      const recordId = `${stringValue(firstPath(value, ["id", "@id"])) || recordIndex}:${stringValue(firstPath(occurrenceValue, ["id", "@id"])) || occurrenceIndex}`;
      const url = originalUrl(firstPath(occurrenceValue, ["singleUrl", "url", "@id"]) ?? firstPath(value, ["singleUrl", "url", "@id"]), options.sourceUrl);
      const location = mapasLocation(value, occurrenceValue);
      const terms = isRecord(value.terms) ? value.terms : {};
      const languages = uniqueStrings(flattenStrings(firstPath(terms, ["linguagem", "language", "languages"])));
      const categories = uniqueStrings(Object.entries(terms).filter(([key]) => !["linguagem", "language", "languages"].includes(key.toLowerCase())).flatMap(([, term]) => flattenStrings(term)));
      const updatedAt = temporal(firstPath(value, ["updateTimestamp", "updatedAt", "dateModified"]), options.defaultTimeZone, "updated date");
      const description = markupText(firstPath(value, ["shortDescription", "description"]));
      candidates.push(candidateFromParsed({
        recordId, title, startAt: start.at, ...(endAt !== undefined ? { endAt } : {}), allDay: start.allDay,
        state: state.state, ...(state.sourceState ? { sourceState: state.sourceState } : {}), timeZone, url,
        ...(description ? { description } : {}),
        ...location,
        ...(categories ? { categories } : {}), ...(languages ? { languages } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
      }, options));
    }
  }
  return candidates.sort(eventCandidateComparator);
}

function assertMapasParserVersion(version: number, source: string): void {
  if (version !== MAPAS_CULTURAIS_PARSER_VERSION) throw new Error(`unsupported ${source} parser version: ${version}`);
}

export function parseMapasCulturaisEvents(
  payload: unknown,
  input: OpenEventParserOptions,
  parserVersion = MAPAS_CULTURAIS_PARSER_VERSION,
): ContextCandidate<OpenEventData>[] {
  assertMapasParserVersion(parserVersion, "Mapas Culturais");
  return parseMapasCulturaisEventsV1(payload, input, mapMapasCulturaisEventState);
}

export function parsePbhEvents(
  payload: unknown,
  input: OpenEventParserOptions,
  parserVersion = PBH_EVENT_PARSER_VERSION,
): ContextCandidate<OpenEventData>[] {
  assertMapasParserVersion(parserVersion, "PBH event");
  return parseMapasCulturaisEventsV1(payload, input, mapPbhEventState);
}

const MAPAS_CULTURAIS_API_SELECT = "id,name,shortDescription,singleUrl,status,updateTimestamp,terms,occurrences.{id,status,space.{id,name,location,En_Nome_Logradouro,En_Num,En_Bairro,En_Municipio},rule}";

function mapasApiLimit(value: number | undefined): number {
  if (value === undefined) return 500;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Mapas Culturais API limit is invalid");
  return Math.min(1_000, value);
}

function createMapasCulturaisHttpSource(
  input: MapasCulturaisSourceOptions,
  fallback: { sourceId: string; label: string; attribution: string },
  parsePayload: (payload: unknown, options: OpenEventParserOptions) => ContextCandidate<OpenEventData>[],
  requestHeaders: Record<string, string> = {},
): ContextSource<OpenEventData> {
  const options = httpSourceDefaults(input, fallback);
  const endpoint = validateSourceUrl(input.endpoint);
  const query = {
    ...(input.query || {}),
    "@select": MAPAS_CULTURAIS_API_SELECT,
    "@limit": mapasApiLimit(input.apiLimit),
  };
  for (const [key, value] of Object.entries(query).sort(([a], [b]) => compareStrings(a, b))) endpoint.searchParams.set(key, String(value));
  const sourcePageUrl = originalUrl(input.sourcePageUrl, endpoint.toString());
  const reader = new ConditionalHttpReader(options.maxResponseBytes!);
  return {
    descriptor: descriptor(options), cacheTtlMs: options.cacheTtlMs, timeoutMs: options.timeoutMs, staleIfErrorMs: options.staleIfErrorMs,
    async query(request, runtime) {
      const response = await reader.read(endpoint, "application/json", runtime, requestHeaders);
      let payload: unknown;
      try { payload = JSON.parse(response.body); }
      catch { throw new Error("invalid Mapas Culturais JSON response"); }
      return filterOpenEventCandidates(parsePayload(payload, {
        sourceId: options.sourceId, sourceUrl: sourcePageUrl, observedAt: response.observedAt,
        attribution: options.attribution, defaultTimeZone: input.defaultTimeZone,
      }), request, runtime.now());
    },
  };
}

export function createMapasCulturaisSource(input: MapasCulturaisSourceOptions): ContextSource<OpenEventData> {
  const parserVersion = input.parserVersion ?? MAPAS_CULTURAIS_PARSER_VERSION;
  assertMapasParserVersion(parserVersion, "Mapas Culturais");
  return createMapasCulturaisHttpSource(input, {
    sourceId: input.sourceId || "mapas-culturais",
    label: input.label || "Mapas Culturais",
    attribution: input.attribution || "Mapas Culturais",
  }, (payload, options) => parseMapasCulturaisEvents(payload, options, parserVersion));
}

export function createPbhEventSource(input: PbhEventSourceOptions = {}): ContextSource<OpenEventData> {
  const parserVersion = input.parserVersion ?? PBH_EVENT_PARSER_VERSION;
  assertMapasParserVersion(parserVersion, "PBH event");
  const options: MapasCulturaisSourceOptions = {
    ...input,
    endpoint: input.endpoint || DEFAULT_PBH_EVENT_ENDPOINT,
    sourcePageUrl: input.sourcePageUrl || "https://mapaculturalbh.pbh.gov.br/eventos/",
    defaultTimeZone: input.defaultTimeZone || "America/Sao_Paulo",
  };
  return createMapasCulturaisHttpSource(options, {
    sourceId: input.sourceId || "pbh-events",
    label: input.label || "Mapa Cultural BH",
    attribution: input.attribution || "Mapa Cultural BH / Prefeitura de Belo Horizonte",
  }, (payload, parserOptionsInput) => parsePbhEvents(payload, parserOptionsInput, parserVersion), {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0 Safari/537.36",
  });
}

const feedParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  maxNestedTags: 100,
  isArray: (name) => name === "item" || name === "entry" || name === "link" || name === "category",
});

function feedLink(item: Record<string, unknown>, fallback: string): string {
  for (const value of asArray(ownValue(item, "link"))) {
    if (typeof value === "string") return originalUrl(value, fallback);
    if (isRecord(value)) {
      const rel = stringValue(value["@_rel"]);
      const href = value["@_href"] ?? value.href ?? value["#text"];
      if (!rel || rel === "alternate") return originalUrl(href, fallback);
    }
  }
  return originalUrl(firstPath(item, ["guid", "id"]), fallback);
}

function markupText(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text || !text.includes("<")) return text;
  try {
    const parsed = feedParser.parse(`<root>${text}</root>`) as Record<string, unknown>;
    return uniqueStrings(flattenStrings(parsed.root))?.join(" ");
  } catch { return undefined; }
}

function mappedValue(item: Record<string, unknown>, configured: string[] | undefined, defaults: string[]): unknown {
  return firstPath(item, configured?.length ? configured : defaults);
}

function parseFeedItem(
  item: Record<string, unknown>,
  index: number,
  fields: RssAtomFieldMap,
  options: Required<OpenEventParserOptions>,
): ContextCandidate<OpenEventData> | undefined {
  const rawStart = mappedValue(item, fields.start, ["startDate", "startdate", "start", "eventStart", "date"]);
  if (rawStart === undefined) return undefined;
  const status = mappedValue(item, fields.status, ["eventStatus", "status"]);
  const state = resolveEventState([status], mapKnownEventState);
  if (suppressOpenEvent(state.state)) return undefined;
  const title = stringValue(firstPath(item, ["title", "name"]));
  if (!title) throw new Error("invalid RSS/Atom event title");
  const startAt = temporal(rawStart, options.defaultTimeZone, "start date")!;
  const rawEnd = mappedValue(item, fields.end, ["endDate", "enddate", "end", "eventEnd"]);
  const startDate = dateOnlyText(rawStart);
  const allDay = startDate !== undefined;
  const endAt = rawEnd !== undefined ? temporal(rawEnd, options.defaultTimeZone, "end date")
    : startDate ? nextLocalDay(startDate, options.defaultTimeZone) : undefined;
  const url = feedLink(item, options.sourceUrl);
  const recordId = stringValue(firstPath(item, ["guid", "id"])) || `${stableId(title, startAt, url)}-${index}`;
  const locationName = stringValue(mappedValue(item, fields.location, ["location", "venue", "place"]));
  const address = stringValue(mappedValue(item, fields.address, ["address", "streetAddress"]));
  const region = stringValue(mappedValue(item, fields.region, ["region", "addressRegion"]));
  const languages = uniqueStrings(flattenStrings(mappedValue(item, fields.language, ["language", "inLanguage"])));
  const categories = uniqueStrings(asArray(ownValue(item, "category")).flatMap((category) => flattenStrings(category)));
  const updatedAt = temporal(firstPath(item, ["updated", "modified", "pubDate", "published"]), options.defaultTimeZone, "updated date");
  const point = pointFrom({ lat: firstPath(item, ["lat", "latitude"]), lng: firstPath(item, ["long", "lng", "longitude"]) });
  const description = markupText(firstPath(item, ["description", "summary", "content", "encoded"]));
  return candidateFromParsed({
    recordId, title, startAt, ...(endAt !== undefined ? { endAt } : {}), allDay,
    state: state.state, ...(state.sourceState ? { sourceState: state.sourceState } : {}),
    timeZone: options.defaultTimeZone, url,
    ...(description ? { description } : {}),
    ...(locationName ? { locationName } : {}), ...(address ? { address } : {}), ...(region ? { region } : {}),
    ...(categories ? { categories } : {}), ...(languages ? { languages } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}), ...(point ? { point } : {}),
  }, options);
}

export function parseRssAtomEvents(xml: string, input: OpenEventParserOptions, fields: RssAtomFieldMap = {}): ContextCandidate<OpenEventData>[] {
  if (XMLValidator.validate(xml) !== true) throw new Error("invalid RSS/Atom XML");
  let parsed: Record<string, unknown>;
  try { parsed = feedParser.parse(xml) as Record<string, unknown>; }
  catch { throw new Error("invalid RSS/Atom XML"); }
  const rssChannel = isRecord(parsed.rss) && isRecord(parsed.rss.channel) ? parsed.rss.channel : undefined;
  const atomFeed = isRecord(parsed.feed) ? parsed.feed : undefined;
  const items = rssChannel ? asArray(ownValue(rssChannel, "item")) : atomFeed ? asArray(ownValue(atomFeed, "entry")) : undefined;
  if (!items) throw new Error("invalid RSS/Atom feed");
  const options = parserOptions(input);
  return items.map((item, index) => {
    if (!isRecord(item)) throw new Error("invalid RSS/Atom item");
    return parseFeedItem(item, index, fields, options);
  }).filter((item): item is ContextCandidate<OpenEventData> => item !== undefined).sort(eventCandidateComparator);
}

export function createRssAtomEventSource(input: RssAtomEventSourceOptions): ContextSource<OpenEventData> {
  const options = httpSourceDefaults(input, {
    sourceId: input.sourceId || "rss-events", label: input.label || "RSS/Atom events", attribution: input.attribution || input.label || "RSS/Atom feed",
  });
  const url = validateSourceUrl(input.url), reader = new ConditionalHttpReader(options.maxResponseBytes!);
  return {
    descriptor: descriptor(options), cacheTtlMs: options.cacheTtlMs, timeoutMs: options.timeoutMs, staleIfErrorMs: options.staleIfErrorMs,
    async query(request, runtime) {
      const response = await reader.read(url, "application/rss+xml, application/atom+xml, application/xml, text/xml", runtime);
      return filterOpenEventCandidates(parseRssAtomEvents(response.body, {
        sourceId: options.sourceId, sourceUrl: url.toString(), observedAt: response.observedAt,
        attribution: options.attribution, defaultTimeZone: input.defaultTimeZone,
      }, input.fields), request, runtime.now());
    },
  };
}

export function createIcsEventSource(input: IcsEventSourceOptions): ContextSource<OpenEventData> {
  const options = httpSourceDefaults(input, {
    sourceId: input.sourceId || "ics-events", label: input.label || "ICS events", attribution: input.attribution || input.label || "ICS feed",
  });
  const url = validateSourceUrl(input.url), reader = new ConditionalHttpReader(options.maxResponseBytes!);
  return {
    descriptor: descriptor(options), cacheTtlMs: options.cacheTtlMs, timeoutMs: options.timeoutMs, staleIfErrorMs: options.staleIfErrorMs,
    async query(request, runtime) {
      const response = await reader.read(url, "text/calendar", runtime), window = eventWindow(request, runtime.now());
      const occurrences = parseIcsCalendar(response.body, {
        ...window, sourceId: options.sourceId, observedAt: response.observedAt, access: "details",
        defaultTimeZone: input.defaultTimeZone || "UTC", attribution: options.attribution, sourceUrl: url.toString(),
      });
      const candidates = occurrences.map((occurrence) => {
        if (!occurrence.title) throw new Error("invalid open-event ICS: SUMMARY is required");
        const state = resolveEventState([occurrence.calendarStatus], mapKnownEventState);
        if (suppressOpenEvent(state.state)) return undefined;
        return candidateFromParsed({
          recordId: occurrence.source.recordId || occurrence.id,
          title: occurrence.title,
          startAt: occurrence.startAt,
          endAt: occurrence.endAt,
          allDay: occurrence.allDay,
          state: state.state,
          ...(state.sourceState ? { sourceState: state.sourceState } : {}),
          timeZone: occurrence.timezone,
          url: originalUrl(occurrence.url, url.toString()),
          ...(occurrence.description ? { description: occurrence.description } : {}),
          ...(occurrence.location ? { locationName: occurrence.location } : {}),
          ...(occurrence.categories ? { categories: occurrence.categories } : {}),
          ...(occurrence.updatedAt !== undefined ? { updatedAt: occurrence.updatedAt } : {}),
        }, parserOptions({ sourceId: options.sourceId, sourceUrl: url.toString(), observedAt: response.observedAt, attribution: options.attribution, defaultTimeZone: input.defaultTimeZone }));
      }).filter((candidate): candidate is ContextCandidate<OpenEventData> => candidate !== undefined);
      return filterOpenEventCandidates(candidates, request, runtime.now());
    },
  };
}

const htmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  maxNestedTags: 150,
  stopNodes: ["*.script"],
  unpairedTags: ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"],
  isArray: (name) => name === "script",
});

function jsonLdDocuments(body: string, contentType: string): unknown[] {
  const trimmed = body.trim();
  if (/json(?:\+ld)?/i.test(contentType) || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return [JSON.parse(trimmed)]; }
    catch { throw new Error("invalid JSON-LD document"); }
  }
  let html: Record<string, unknown>;
  try { html = htmlParser.parse(body) as Record<string, unknown>; }
  catch { throw new Error("invalid HTML event document"); }
  const documents: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value)) return;
    for (const [key, nested] of Object.entries(value)) {
      if (key.toLowerCase() === "script") {
        for (const script of asArray(nested)) {
          if (!isRecord(script) || !/application\/ld\+json/i.test(stringValue(ownValue(script, "@_type")) || "")) continue;
          const text = stringValue(script["#text"]);
          if (!text) continue;
          try { documents.push(JSON.parse(text)); }
          catch { throw new Error("invalid JSON-LD script"); }
        }
      } else visit(nested);
    }
  };
  visit(html);
  return documents;
}

function jsonLdTypes(value: unknown): string[] {
  return asArray(value).flatMap((item) => typeof item === "string" ? [item] : []);
}

function collectJsonLdEvents(value: unknown, output: Record<string, unknown>[], budget: { visited: number }, depth = 0): void {
  if (depth > 100 || budget.visited++ > 10_000) throw new Error("JSON-LD document exceeds structure limits");
  if (Array.isArray(value)) { value.forEach((item) => collectJsonLdEvents(item, output, budget, depth + 1)); return; }
  if (!isRecord(value)) return;
  if (jsonLdTypes(value["@type"]).some((type) => normalizeText(type).split(" ").some((part) => part === "event" || part.endsWith("event")))) output.push(value);
  for (const nested of Object.values(value)) collectJsonLdEvents(nested, output, budget, depth + 1);
}

function jsonLdLocation(value: unknown): { locationName?: string; address?: string; region?: string; point?: GeoPoint } {
  const location = asArray(value).find(isRecord);
  if (!location) return typeof value === "string" ? { locationName: value } : {};
  const locationName = stringValue(firstPath(location, ["name", "title"]));
  const addressValue = firstPath(location, ["address"]);
  let address: string | undefined, region: string | undefined;
  if (isRecord(addressValue)) {
    address = uniqueStrings(["streetAddress", "addressLocality", "addressRegion", "postalCode"].map((key) => stringValue(firstPath(addressValue, [key])) || ""))?.join(", ");
    region = stringValue(firstPath(addressValue, ["addressRegion", "addressLocality"]));
  } else address = stringValue(addressValue);
  const point = pointFrom(firstPath(location, ["geo"]) || location);
  return { ...(locationName ? { locationName } : {}), ...(address ? { address } : {}), ...(region ? { region } : {}), ...(point ? { point } : {}) };
}

export function parseJsonLdEvents(body: string, contentType: string, input: OpenEventParserOptions): ContextCandidate<OpenEventData>[] {
  const options = parserOptions(input), nodes: Record<string, unknown>[] = [];
  const budget = { visited: 0 };
  for (const document of jsonLdDocuments(body, contentType)) collectJsonLdEvents(document, nodes, budget);
  const seen = new Set<Record<string, unknown>>();
  return nodes.filter((node) => !seen.has(node) && !!seen.add(node)).map((node, index) => {
    const status = firstPath(node, ["eventStatus", "status"]);
    const state = resolveEventState([status], mapKnownEventState);
    if (suppressOpenEvent(state.state)) return undefined;
    const rawStart = firstPath(node, ["startDate", "startTime"]);
    if (rawStart === undefined) throw new Error("invalid JSON-LD event start date");
    const startAt = temporal(rawStart, options.defaultTimeZone, "start date")!;
    const rawEnd = firstPath(node, ["endDate", "endTime"]);
    const startDate = dateOnlyText(rawStart);
    const allDay = startDate !== undefined;
    const endAt = rawEnd !== undefined ? temporal(rawEnd, options.defaultTimeZone, "end date")
      : startDate ? nextLocalDay(startDate, options.defaultTimeZone) : undefined;
    const title = stringValue(firstPath(node, ["name", "headline"]));
    if (!title) throw new Error("invalid JSON-LD event title");
    const url = originalUrl(firstPath(node, ["url", "@id", "mainEntityOfPage"]), options.sourceUrl);
    const recordId = stringValue(firstPath(node, ["@id", "identifier", "url"])) || `${stableId(title, startAt, url)}-${index}`;
    const updatedAt = temporal(firstPath(node, ["dateModified", "updated"]), options.defaultTimeZone, "updated date");
    const categories = uniqueStrings(flattenStrings(firstPath(node, ["keywords", "about", "category"])));
    const languages = uniqueStrings(flattenStrings(firstPath(node, ["inLanguage", "language"])));
    const description = markupText(firstPath(node, ["description"]));
    return candidateFromParsed({
      recordId, title, startAt, ...(endAt !== undefined ? { endAt } : {}), allDay,
      state: state.state, ...(state.sourceState ? { sourceState: state.sourceState } : {}),
      timeZone: options.defaultTimeZone, url,
      ...(description ? { description } : {}),
      ...jsonLdLocation(firstPath(node, ["location"])),
      ...(categories ? { categories } : {}), ...(languages ? { languages } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    }, options);
  }).filter((candidate): candidate is ContextCandidate<OpenEventData> => candidate !== undefined).sort(eventCandidateComparator);
}

export function createJsonLdEventSource(input: JsonLdEventSourceOptions): ContextSource<OpenEventData> {
  const options = httpSourceDefaults(input, {
    sourceId: input.sourceId || "jsonld-events", label: input.label || "JSON-LD events", attribution: input.attribution || input.label || "JSON-LD source",
  });
  const url = validateSourceUrl(input.url), reader = new ConditionalHttpReader(options.maxResponseBytes!);
  return {
    descriptor: descriptor(options), cacheTtlMs: options.cacheTtlMs, timeoutMs: options.timeoutMs, staleIfErrorMs: options.staleIfErrorMs,
    async query(request, runtime) {
      const response = await reader.read(url, "application/ld+json, application/json, text/html", runtime);
      return filterOpenEventCandidates(parseJsonLdEvents(response.body, response.contentType, {
        sourceId: options.sourceId, sourceUrl: url.toString(), observedAt: response.observedAt,
        attribution: options.attribution, defaultTimeZone: input.defaultTimeZone,
      }), request, runtime.now());
    },
  };
}

function primarySource(candidate: ContextCandidate<OpenEventData>): ContextSourceRef {
  const source = [...candidate.sources].sort((a, b) => compareStrings(a.sourceId, b.sourceId) || compareStrings(a.recordId || "", b.recordId || ""))[0];
  if (!source) throw new Error("event candidate has no provenance");
  return source;
}

function eventRecency(candidate: ContextCandidate<OpenEventData>): number {
  return candidate.data.updatedAt ?? Math.max(0, ...candidate.sources.map((source) => source.observedAt));
}

function sameEvent(left: ContextCandidate<OpenEventData>, right: ContextCandidate<OpenEventData>, toleranceMs: number): boolean {
  for (const a of left.sources) for (const b of right.sources) {
    if (a.sourceId === b.sourceId && a.recordId && b.recordId && a.recordId === b.recordId) {
      return Math.abs(left.data.startAt - right.data.startAt) <= toleranceMs;
    }
  }
  if (left.sources.some((a) => right.sources.some((b) => a.sourceId === b.sourceId))) return false;
  if (!normalizeText(left.title) || normalizeText(left.title) !== normalizeText(right.title)) return false;
  if (Math.abs(left.data.startAt - right.data.startAt) > toleranceMs) return false;
  const leftLocation = normalizeText(left.data.locationName || left.data.address);
  const rightLocation = normalizeText(right.data.locationName || right.data.address);
  if (leftLocation && rightLocation) return leftLocation === rightLocation;
  try { return new URL(left.data.url).toString() === new URL(right.data.url).toString(); }
  catch { return left.data.url === right.data.url && !!left.data.url; }
}

function variant(candidate: ContextCandidate<OpenEventData>): OpenEventVariant {
  const source = primarySource(candidate);
  return {
    sourceId: source.sourceId,
    ...(source.recordId ? { recordId: source.recordId } : {}),
    observedAt: source.observedAt,
    title: candidate.title,
    startAt: candidate.data.startAt,
    ...(candidate.data.endAt !== undefined ? { endAt: candidate.data.endAt } : {}),
    ...(candidate.data.locationName ? { locationName: candidate.data.locationName } : {}),
    ...(candidate.data.address ? { address: candidate.data.address } : {}),
    url: candidate.data.url,
    state: candidate.data.state,
    ...(candidate.data.sourceState ? { sourceState: candidate.data.sourceState } : {}),
    timeZone: candidate.data.timeZone,
    ...(candidate.data.updatedAt !== undefined ? { updatedAt: candidate.data.updatedAt } : {}),
  };
}

function conflictValues(variants: OpenEventVariant[], field: OpenEventConflict["field"], preferredSourceId: string): OpenEventConflict | undefined {
  const values = variants.flatMap((item) => {
    const value = item[field];
    return typeof value === "string" || typeof value === "number" ? [{ sourceId: item.sourceId, observedAt: item.updatedAt ?? item.observedAt, value }] : [];
  });
  const unique = new Set(values.map((item) => `${typeof item.value}:${item.value}`));
  return unique.size > 1 ? { field, preferredSourceId, values } : undefined;
}

function mergeEventGroup(group: ContextCandidate<OpenEventData>[]): ContextCandidate<OpenEventData> {
  if (group.length === 1) return {
    ...group[0], data: { ...group[0].data }, point: group[0].point ? { ...group[0].point } : undefined,
    sources: group[0].sources.map((source) => ({ ...source })),
  };
  const ordered = [...group].sort((a, b) => eventRecency(b) - eventRecency(a)
    || compareStrings(primarySource(a).sourceId, primarySource(b).sourceId) || compareStrings(a.id, b.id));
  const preferred = ordered[0], preferredSourceId = primarySource(preferred).sourceId;
  const variants = ordered.map(variant).sort((a, b) => compareStrings(a.sourceId, b.sourceId) || compareStrings(a.recordId || "", b.recordId || ""));
  const conflicts = (["title", "startAt", "endAt", "locationName", "address", "state", "timeZone"] as const)
    .map((field) => conflictValues(variants, field, preferredSourceId)).filter((item): item is OpenEventConflict => item !== undefined);
  const sources = [...new Map(group.flatMap((candidate) => candidate.sources).sort((a, b) => compareStrings(a.sourceId, b.sourceId) || compareStrings(a.recordId || "", b.recordId || ""))
    .map((source) => [`${source.sourceId}:${source.recordId || ""}:${source.url || ""}`, { ...source }])).values()];
  const identity = variants.map((item) => `${item.sourceId}:${item.recordId || item.url}`).sort();
  const occurrenceStartAt = Math.min(...group.map((candidate) => candidate.data.startAt));
  return {
    id: `open-event-federated-${stableId(...identity, occurrenceStartAt)}`,
    kind: "open_event",
    title: preferred.title,
    data: {
      ...preferred.data,
      variants,
      ...(conflicts.length ? { conflicts } : {}),
      preferredSourceId,
    },
    ...(preferred.point ? { point: { ...preferred.point } } : {}),
    sources,
  };
}

/** Complete-link grouping prevents transitive near-matches from collapsing genuinely different events. */
export function deduplicateOpenEvents(
  candidates: ContextCandidate<OpenEventData>[],
  timeToleranceMs = 5 * 60 * 1_000,
): ContextCandidate<OpenEventData>[] {
  if (!Number.isFinite(timeToleranceMs) || timeToleranceMs < 0) throw new Error("event deduplication tolerance is invalid");
  const tolerance = Math.min(60 * 60 * 1_000, timeToleranceMs);
  const groups: Array<Array<ContextCandidate<OpenEventData>>> = [];
  for (const candidate of [...candidates].sort(eventCandidateComparator)) {
    const group = groups.find((current) => current.every((item) => sameEvent(item, candidate, tolerance)));
    if (group) group.push(candidate); else groups.push([candidate]);
  }
  return groups.map(mergeEventGroup).sort(eventCandidateComparator);
}

export class OpenEventFederator implements ContextSource<OpenEventData> {
  readonly descriptor: ContextSourceDescriptor;
  readonly cacheTtlMs = 5 * 60 * 1_000;
  readonly timeoutMs = 15_000;
  readonly staleIfErrorMs = 60 * 60 * 1_000;
  private failures: EventSourceFailure[] = [];
  private readonly toleranceMs: number;

  constructor(private readonly options: OpenEventFederatorOptions) {
    if (!options.sources.length) throw new Error("event federator requires at least one source");
    if (options.dedupTimeToleranceMs !== undefined
      && (!Number.isFinite(options.dedupTimeToleranceMs) || options.dedupTimeToleranceMs < 0)) {
      throw new Error("event deduplication tolerance is invalid");
    }
    const sourceIds = new Set<string>();
    for (const source of options.sources) {
      if (!source.descriptor.purposes.includes("events")) throw new Error(`source ${source.descriptor.id} does not support events`);
      if (!source.descriptor.id || sourceIds.has(source.descriptor.id)) throw new Error(`duplicate event source: ${source.descriptor.id}`);
      sourceIds.add(source.descriptor.id);
    }
    this.toleranceMs = Math.max(0, options.dedupTimeToleranceMs ?? 5 * 60 * 1_000);
    this.descriptor = {
      id: options.sourceId || "open-events", label: options.label || "Open event federation", purposes: ["events"],
      costClass: "free", transport: "builtin", certification: "first_party",
      license: "Inherited from each upstream event source",
      cachePolicy: "per-source conditional cache with deterministic federation",
      retentionPolicy: "Derived federated candidates only; child retention policies apply; 5m cache TTL",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    };
  }

  lastFailures(): EventSourceFailure[] { return this.failures.map((failure) => ({ ...failure })); }

  private failure(sourceId: string, reason: unknown): EventSourceFailure {
    const raw = reason instanceof Error ? reason.message : "event source failed";
    const message = raw.replace(/[\r\n]+/g, " ").replace(/https?:\/\/\S+/gi, "[url]").slice(0, 300);
    return { sourceId, message: message || "event source failed" };
  }

  private validateCandidate(candidate: ContextCandidate<OpenEventData>): void {
    if (!candidate || !candidate.title?.trim() || !candidate.data || !Number.isSafeInteger(candidate.data.startAt)) {
      throw new Error("event source returned an invalid candidate");
    }
    if (candidate.data.endAt !== undefined && (!Number.isSafeInteger(candidate.data.endAt) || candidate.data.endAt <= candidate.data.startAt)) {
      throw new Error("event source returned an invalid candidate range");
    }
    if (!OPEN_EVENT_STATES.has(candidate.data.state)) throw new Error("event source returned an invalid state");
    validatedTimeZone(candidate.data.timeZone);
    if (!candidate.data.url || !candidate.sources?.length || candidate.sources.some((source) => !source.sourceId || !Number.isSafeInteger(source.observedAt))) {
      throw new Error("event source returned a candidate without provenance");
    }
    validateSourceUrl(candidate.data.url);
  }

  async query(request: PersonalContextQuery, runtime: ContextSourceRuntime): Promise<ContextCandidate<OpenEventData>[]> {
    const limit = eventLimit(request);
    const childRequest = { ...request, limit: MAX_EVENT_LIMIT };
    const settled = await Promise.allSettled(this.options.sources.map((source) => source.query(childRequest, runtime)));
    const candidates: ContextCandidate<OpenEventData>[] = [];
    this.failures = [];
    settled.forEach((result, index) => {
      const sourceId = this.options.sources[index].descriptor.id;
      if (result.status === "fulfilled") {
        try {
          if (!Array.isArray(result.value)) throw new Error("event source returned a non-array result");
          result.value.forEach((candidate) => this.validateCandidate(candidate));
          candidates.push(...result.value);
        } catch (error) {
          const failure = this.failure(sourceId, error);
          this.failures.push(failure);
          this.options.onPartialFailure?.({ ...failure });
        }
      } else {
        const failure = this.failure(sourceId, result.reason);
        this.failures.push(failure);
        this.options.onPartialFailure?.({ ...failure });
      }
    });
    this.failures.sort((a, b) => compareStrings(a.sourceId, b.sourceId));
    if (this.failures.length === this.options.sources.length) throw new Error("all open event sources failed");
    return deduplicateOpenEvents(filterOpenEventCandidates(candidates, childRequest, runtime.now()), this.toleranceMs).slice(0, limit);
  }
}

export function createOpenEventFederator(options: OpenEventFederatorOptions): OpenEventFederator {
  return new OpenEventFederator(options);
}
