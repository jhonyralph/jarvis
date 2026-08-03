import type {
  ContextCandidate,
  ContextFreshness,
  ContextPurpose,
  ContextSourceRef,
  GeoPoint,
  PersonalContextQuery,
} from "@jarvis/protocol";
import type { ContextSource, ContextSourceRuntime } from "./context-sources.js";

const OSM_ATTRIBUTION = "OpenStreetMap contributors, ODbL 1.0";
const OCM_ATTRIBUTION = "Open Charge Map contributors";
const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com";
const SOURCE_METADATA_LAST_REVIEWED_AT = "2026-08-01";
const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const EARTH_RADIUS_M = 6_371_008.8;

export const OPEN_GEO_DEFAULT_ENDPOINTS = Object.freeze({
  nominatim: "http://127.0.0.1:8080/",
  valhalla: "http://127.0.0.1:8002/",
  overpass: "https://overpass-api.de/api/interpreter",
  openChargeMap: "https://api.openchargemap.io/v3/poi/",
  openMeteo: "https://api.open-meteo.com/v1/forecast",
});

export class OpenGeoSourceError extends Error {
  constructor(
    public readonly sourceId: string,
    message: string,
  ) {
    super(`${sourceId}: ${message}`);
    this.name = "OpenGeoSourceError";
  }
}

export interface OpenGeoSourceTimingOptions {
  cacheTtlMs?: number;
  timeoutMs?: number;
  staleIfErrorMs?: number;
}

interface JsonObject {
  [key: string]: unknown;
}

function fail(sourceId: string, message: string): never {
  throw new OpenGeoSourceError(sourceId, message);
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  throw error;
}

function configuredEndpoint(sourceId: string, value: string | undefined, fallback: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value ?? fallback);
  } catch {
    return fail(sourceId, "endpoint must be an absolute URL");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    fail(sourceId, "endpoint protocol must be http or https");
  }
  if (endpoint.username || endpoint.password) fail(sourceId, "endpoint must not contain credentials");
  if (endpoint.search || endpoint.hash) fail(sourceId, "endpoint must not contain query parameters or a fragment");
  return endpoint.toString();
}

function childEndpoint(endpoint: string, path: string): URL {
  const base = new URL(endpoint);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(path, base);
}

function timingValue(sourceId: string, name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) fail(sourceId, `${name} must be a non-negative finite number`);
  return value;
}

function requirePurpose(sourceId: string, request: PersonalContextQuery, purposes: readonly ContextPurpose[]): void {
  if (!purposes.includes(request.purpose)) fail(sourceId, `purpose ${request.purpose} is not supported`);
}

function requestLimit(sourceId: string, request: PersonalContextQuery, fallback: number, maximum: number): number {
  const value = request.limit ?? fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    fail(sourceId, `limit must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function requestText(sourceId: string, value: string | undefined, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > maximum) fail(sourceId, `text must not exceed ${maximum} characters`);
  if (/\p{Cc}/u.test(text)) fail(sourceId, "text must not contain control characters");
  return text;
}

function requestLocale(sourceId: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const locale = value.trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
    fail(sourceId, "locale must be a valid language tag");
  }
  return locale;
}

function filterValue(request: PersonalContextQuery, key: string): unknown {
  return request.filters?.[key];
}

function finiteFilter(
  sourceId: string,
  request: PersonalContextQuery,
  key: string,
  options: { minimum: number; maximum: number; fallback?: number },
): number | undefined {
  const raw = filterValue(request, key);
  if (raw === undefined) return options.fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < options.minimum || raw > options.maximum) {
    fail(sourceId, `${key} must be between ${options.minimum} and ${options.maximum}`);
  }
  return raw;
}

function stringFilter(sourceId: string, request: PersonalContextQuery, key: string, maximum: number): string | undefined {
  const raw = filterValue(request, key);
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") fail(sourceId, `${key} must be a string`);
  return requestText(sourceId, raw, maximum);
}

function validateCoordinate(sourceId: string, value: unknown, axis: "latitude" | "longitude"): number {
  const bound = axis === "latitude" ? 90 : 180;
  if (typeof value !== "number" || !Number.isFinite(value) || value < -bound || value > bound) {
    fail(sourceId, `${axis} must be a finite number between ${-bound} and ${bound}`);
  }
  return value;
}

function validatePoint(sourceId: string, point: GeoPoint | undefined, label = "point"): GeoPoint {
  if (!point || typeof point !== "object") fail(sourceId, `${label} is required`);
  return {
    lat: validateCoordinate(sourceId, point.lat, "latitude"),
    lng: validateCoordinate(sourceId, point.lng, "longitude"),
    ...(point.accuracyM === undefined ? {} : { accuracyM: finiteAccuracy(sourceId, point.accuracyM) }),
  };
}

function finiteAccuracy(sourceId: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    fail(sourceId, "accuracyM must be a finite number between 0 and 1000000");
  }
  return value;
}

function objectValue(sourceId: string, value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(sourceId, `${label} must be an object`);
  return value as JsonObject;
}

function arrayValue(sourceId: string, value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(sourceId, `${label} must be an array`);
  return value;
}

function requiredString(sourceId: string, value: unknown, label: string, maximum = 4_096): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    fail(sourceId, `${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function optionalString(sourceId: string, value: unknown, label: string, maximum = 4_096): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(sourceId, value, label, maximum);
}

function responseNumber(sourceId: string, value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) fail(sourceId, `${label} must be a finite number`);
  return parsed;
}

function optionalResponseNumber(sourceId: string, value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return responseNumber(sourceId, value, label);
}

function nullableResponseNumber(sourceId: string, value: unknown, label: string): number | null {
  if (value === null) return null;
  return responseNumber(sourceId, value, label);
}

function responseInteger(sourceId: string, value: unknown, label: string): number {
  const parsed = responseNumber(sourceId, value, label);
  if (!Number.isSafeInteger(parsed)) fail(sourceId, `${label} must be a safe integer`);
  return parsed;
}

function optionalBoolean(sourceId: string, value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") fail(sourceId, `${label} must be a boolean`);
  return value;
}

function stringRecord(sourceId: string, value: unknown, label: string): Record<string, string> {
  const object = objectValue(sourceId, value, label);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== "string") fail(sourceId, `${label}.${key} must be a string`);
    result[key] = item;
  }
  return result;
}

function optionalStringRecord(sourceId: string, value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  return stringRecord(sourceId, value, label);
}

function parseDate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function freshnessAt(observedAt: number | undefined, now: number, freshForMs: number): ContextFreshness {
  if (observedAt === undefined || observedAt > now + 5 * 60_000) return "unknown";
  return now - observedAt <= freshForMs ? "fresh" : "stale";
}

function observedAtOrNow(observedAt: number | undefined, now: number): number {
  return observedAt !== undefined && observedAt <= now + 5 * 60_000 ? observedAt : now;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function fetchJson(
  sourceId: string,
  runtime: ContextSourceRuntime,
  url: URL,
  init: RequestInit = {},
): Promise<unknown> {
  throwIfAborted(runtime.signal);
  const response = await runtime.fetch(url, { ...init, signal: runtime.signal });
  throwIfAborted(runtime.signal);
  if (!response.ok) fail(sourceId, `request failed with HTTP ${response.status}`);
  try {
    const result: unknown = await response.json();
    throwIfAborted(runtime.signal);
    return result;
  } catch (error) {
    throwIfAborted(runtime.signal);
    if (error instanceof OpenGeoSourceError) throw error;
    fail(sourceId, "response is not valid JSON");
  }
}

function haversineDistanceM(from: GeoPoint, to: GeoPoint): number {
  const radians = Math.PI / 180;
  const lat1 = from.lat * radians;
  const lat2 = to.lat * radians;
  const deltaLat = (to.lat - from.lat) * radians;
  const deltaLng = (to.lng - from.lng) * radians;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function timing(
  sourceId: string,
  options: OpenGeoSourceTimingOptions,
  defaults: { cacheTtlMs: number; timeoutMs: number; staleIfErrorMs: number },
): Pick<ContextSource, "cacheTtlMs" | "timeoutMs" | "staleIfErrorMs"> {
  return {
    cacheTtlMs: timingValue(sourceId, "cacheTtlMs", options.cacheTtlMs, defaults.cacheTtlMs),
    timeoutMs: timingValue(sourceId, "timeoutMs", options.timeoutMs, defaults.timeoutMs),
    staleIfErrorMs: timingValue(sourceId, "staleIfErrorMs", options.staleIfErrorMs, defaults.staleIfErrorMs),
  };
}

// Nominatim

const NOMINATIM_SOURCE_ID = "nominatim";
const NOMINATIM_PURPOSES = ["nearby", "mobility"] as const satisfies readonly ContextPurpose[];

export interface NominatimSourceOptions extends OpenGeoSourceTimingOptions {
  endpoint?: string;
  userAgent?: string;
  email?: string;
}

export interface NominatimQueryFilters {
  countryCodes?: string[];
  layer?: "address" | "poi" | "railway" | "natural" | "manmade";
}

export interface NominatimBoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface NominatimPlaceData {
  displayName: string;
  category: string;
  type: string;
  importance?: number;
  address?: Record<string, string>;
  extraTags?: Record<string, string>;
  names?: Record<string, string>;
  boundingBox?: NominatimBoundingBox;
  osmType?: "node" | "way" | "relation";
  osmId?: number;
}

function nominatimUserAgent(sourceId: string, value: string | undefined): string {
  const userAgent = value?.trim() || "Jarvis personal assistant (self-hosted)";
  if (userAgent.length > 200 || /[\r\n]/.test(userAgent)) fail(sourceId, "userAgent is invalid");
  return userAgent;
}

function nominatimSourceUrl(osmType: string | undefined, osmId: number | undefined): string {
  if ((osmType === "node" || osmType === "way" || osmType === "relation") && osmId !== undefined) {
    return `https://www.openstreetmap.org/${osmType}/${osmId}`;
  }
  return "https://www.openstreetmap.org/copyright";
}

function parseNominatimPlace(value: unknown, index: number, now: number): ContextCandidate<NominatimPlaceData> {
  const item = objectValue(NOMINATIM_SOURCE_ID, value, `response[${index}]`);
  const placeIdRaw = item.place_id;
  const placeId = typeof placeIdRaw === "string"
    ? requiredString(NOMINATIM_SOURCE_ID, placeIdRaw, `response[${index}].place_id`, 128)
    : String(responseInteger(NOMINATIM_SOURCE_ID, placeIdRaw, `response[${index}].place_id`));
  const lat = validateCoordinate(
    NOMINATIM_SOURCE_ID,
    responseNumber(NOMINATIM_SOURCE_ID, item.lat, `response[${index}].lat`),
    "latitude",
  );
  const lng = validateCoordinate(
    NOMINATIM_SOURCE_ID,
    responseNumber(NOMINATIM_SOURCE_ID, item.lon, `response[${index}].lon`),
    "longitude",
  );
  const displayName = requiredString(NOMINATIM_SOURCE_ID, item.display_name, `response[${index}].display_name`);
  const category = optionalString(NOMINATIM_SOURCE_ID, item.category ?? item.class, `response[${index}].category`, 128) ?? "unknown";
  const type = optionalString(NOMINATIM_SOURCE_ID, item.type, `response[${index}].type`, 128) ?? "unknown";
  const importance = optionalResponseNumber(NOMINATIM_SOURCE_ID, item.importance, `response[${index}].importance`);
  if (importance !== undefined && (importance < 0 || importance > 1)) {
    fail(NOMINATIM_SOURCE_ID, `response[${index}].importance must be between 0 and 1`);
  }
  const osmTypeRaw = optionalString(NOMINATIM_SOURCE_ID, item.osm_type, `response[${index}].osm_type`, 16);
  const osmType = osmTypeRaw === "node" || osmTypeRaw === "way" || osmTypeRaw === "relation" ? osmTypeRaw : undefined;
  const osmId = optionalResponseNumber(NOMINATIM_SOURCE_ID, item.osm_id, `response[${index}].osm_id`);
  if (osmId !== undefined && (!Number.isSafeInteger(osmId) || osmId < 1)) {
    fail(NOMINATIM_SOURCE_ID, `response[${index}].osm_id must be a positive safe integer`);
  }
  let boundingBox: NominatimBoundingBox | undefined;
  if (item.boundingbox !== undefined && item.boundingbox !== null) {
    const values = arrayValue(NOMINATIM_SOURCE_ID, item.boundingbox, `response[${index}].boundingbox`);
    if (values.length !== 4) fail(NOMINATIM_SOURCE_ID, `response[${index}].boundingbox must contain four coordinates`);
    boundingBox = {
      south: validateCoordinate(NOMINATIM_SOURCE_ID, responseNumber(NOMINATIM_SOURCE_ID, values[0], "boundingbox.south"), "latitude"),
      north: validateCoordinate(NOMINATIM_SOURCE_ID, responseNumber(NOMINATIM_SOURCE_ID, values[1], "boundingbox.north"), "latitude"),
      west: validateCoordinate(NOMINATIM_SOURCE_ID, responseNumber(NOMINATIM_SOURCE_ID, values[2], "boundingbox.west"), "longitude"),
      east: validateCoordinate(NOMINATIM_SOURCE_ID, responseNumber(NOMINATIM_SOURCE_ID, values[3], "boundingbox.east"), "longitude"),
    };
    if (boundingBox.south > boundingBox.north || boundingBox.west > boundingBox.east) {
      fail(NOMINATIM_SOURCE_ID, `response[${index}].boundingbox is reversed`);
    }
  }
  const attribution = optionalString(NOMINATIM_SOURCE_ID, item.licence, `response[${index}].licence`, 1_000) ?? OSM_ATTRIBUTION;
  const recordId = osmType && osmId !== undefined ? `${osmType}/${osmId}` : placeId;
  const source: ContextSourceRef = {
    sourceId: NOMINATIM_SOURCE_ID,
    recordId,
    observedAt: now,
    freshness: "fresh",
    attribution,
    url: nominatimSourceUrl(osmType, osmId),
  };
  const title = displayName.split(",", 1)[0]?.trim() || displayName;
  return {
    id: `nominatim:${recordId}`,
    kind: "place",
    title,
    point: { lat, lng },
    data: {
      displayName,
      category,
      type,
      ...(importance === undefined ? {} : { importance }),
      ...(item.address === undefined ? {} : { address: optionalStringRecord(NOMINATIM_SOURCE_ID, item.address, `response[${index}].address`) }),
      ...(item.extratags === undefined ? {} : { extraTags: optionalStringRecord(NOMINATIM_SOURCE_ID, item.extratags, `response[${index}].extratags`) }),
      ...(item.namedetails === undefined ? {} : { names: optionalStringRecord(NOMINATIM_SOURCE_ID, item.namedetails, `response[${index}].namedetails`) }),
      ...(boundingBox === undefined ? {} : { boundingBox }),
      ...(osmType === undefined ? {} : { osmType }),
      ...(osmId === undefined ? {} : { osmId }),
    },
    ...(importance === undefined ? {} : { scoreParts: { match: importance } }),
    sources: [source],
  };
}

export function createNominatimSource(options: NominatimSourceOptions = {}): ContextSource<NominatimPlaceData> {
  const endpoint = configuredEndpoint(NOMINATIM_SOURCE_ID, options.endpoint, OPEN_GEO_DEFAULT_ENDPOINTS.nominatim);
  const userAgent = nominatimUserAgent(NOMINATIM_SOURCE_ID, options.userAgent);
  const email = options.email === undefined ? undefined : requiredString(NOMINATIM_SOURCE_ID, options.email, "email", 320);
  const sourceTiming = timing(NOMINATIM_SOURCE_ID, options, {
    cacheTtlMs: DAY_MS,
    timeoutMs: 10_000,
    staleIfErrorMs: 7 * DAY_MS,
  });
  return {
    descriptor: {
      id: NOMINATIM_SOURCE_ID,
      label: "Nominatim",
      purposes: [...NOMINATIM_PURPOSES],
      costClass: "free",
      transport: "http",
      certification: "first_party",
      attribution: OSM_ATTRIBUTION,
      license: "ODbL 1.0",
      cachePolicy: "24h default; loopback self-hosted endpoint; no public autocomplete fallback",
      retentionPolicy: "Derived geocoding results only; raw responses are not persisted; 24h cache TTL by default",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    },
    ...sourceTiming,
    async query(request, runtime) {
      requirePurpose(NOMINATIM_SOURCE_ID, request, NOMINATIM_PURPOSES);
      const limit = requestLimit(NOMINATIM_SOURCE_ID, request, 10, 40);
      const text = requestText(NOMINATIM_SOURCE_ID, request.text, 256);
      const locale = requestLocale(NOMINATIM_SOURCE_ID, request.locale);
      const point = request.point === undefined ? undefined : validatePoint(NOMINATIM_SOURCE_ID, request.point);
      if (!text && !point) fail(NOMINATIM_SOURCE_ID, "text or point is required");
      const url = childEndpoint(endpoint, text ? "search" : "reverse");
      const params = new URLSearchParams({ format: "jsonv2", addressdetails: "1", extratags: "1", namedetails: "1" });
      if (text) {
        params.set("q", text);
        params.set("limit", String(limit));
        const countryCodes = filterValue(request, "countryCodes");
        if (countryCodes !== undefined) {
          if (!Array.isArray(countryCodes) || countryCodes.length < 1 || countryCodes.length > 10 || countryCodes.some((code) => typeof code !== "string" || !/^[A-Za-z]{2}$/.test(code))) {
            fail(NOMINATIM_SOURCE_ID, "countryCodes must contain 1 to 10 ISO alpha-2 codes");
          }
          params.set("countrycodes", countryCodes.map((code) => String(code).toLowerCase()).join(","));
        }
        const layer = stringFilter(NOMINATIM_SOURCE_ID, request, "layer", 16);
        if (layer) {
          if (!["address", "poi", "railway", "natural", "manmade"].includes(layer)) fail(NOMINATIM_SOURCE_ID, "layer is not supported");
          params.set("layer", layer);
        }
      } else {
        params.set("lat", String(point!.lat));
        params.set("lon", String(point!.lng));
      }
      if (locale) params.set("accept-language", locale);
      if (email) params.set("email", email);
      url.search = params.toString();
      const response = await fetchJson(NOMINATIM_SOURCE_ID, runtime, url, {
        headers: { Accept: "application/json", "User-Agent": userAgent },
      });
      if (text) {
        return arrayValue(NOMINATIM_SOURCE_ID, response, "response")
          .slice(0, limit)
          .map((item, index) => parseNominatimPlace(item, index, runtime.now()));
      }
      const reverse = objectValue(NOMINATIM_SOURCE_ID, response, "response");
      if (typeof reverse.error === "string") fail(NOMINATIM_SOURCE_ID, `reverse geocoding failed: ${reverse.error.slice(0, 200)}`);
      return [parseNominatimPlace(reverse, 0, runtime.now())];
    },
  };
}

// Valhalla

const VALHALLA_SOURCE_ID = "valhalla";
const VALHALLA_PURPOSES = ["mobility"] as const satisfies readonly ContextPurpose[];

export type ValhallaTravelMode = "car" | "walk" | "bicycle";

export interface ValhallaSourceOptions extends OpenGeoSourceTimingOptions {
  endpoint?: string;
  clientId?: string;
}

export interface ValhallaRouteQueryFilters {
  destinationLat: number;
  destinationLng: number;
  mode?: ValhallaTravelMode | "auto" | "pedestrian" | "bike";
}

export interface ValhallaManeuverData {
  instruction?: string;
  verbalInstruction?: string;
  distanceM: number;
  durationSeconds: number;
  type?: number;
}

export interface ValhallaRouteLegData {
  distanceM: number;
  durationSeconds: number;
  encodedPolyline: string;
  maneuvers: ValhallaManeuverData[];
}

export interface ValhallaRouteData {
  mode: ValhallaTravelMode;
  costing: "auto" | "pedestrian" | "bicycle";
  routedDistanceM: number;
  straightLineDistanceM: number;
  durationSeconds: number;
  units: "kilometers";
  legs: ValhallaRouteLegData[];
}

function valhallaMode(
  request: PersonalContextQuery,
  sourceId = VALHALLA_SOURCE_ID,
): { mode: ValhallaTravelMode; costing: ValhallaRouteData["costing"] } {
  const raw = filterValue(request, "mode") ?? "car";
  if (raw === "car" || raw === "auto") return { mode: "car", costing: "auto" };
  if (raw === "walk" || raw === "pedestrian") return { mode: "walk", costing: "pedestrian" };
  if (raw === "bike" || raw === "bicycle") return { mode: "bicycle", costing: "bicycle" };
  return fail(sourceId, "mode must be car, walk, or bicycle");
}

function parseValhallaManeuvers(value: unknown, legIndex: number): ValhallaManeuverData[] {
  if (value === undefined) return [];
  return arrayValue(VALHALLA_SOURCE_ID, value, `trip.legs[${legIndex}].maneuvers`).map((raw, index) => {
    const item = objectValue(VALHALLA_SOURCE_ID, raw, `trip.legs[${legIndex}].maneuvers[${index}]`);
    const lengthKm = responseNumber(VALHALLA_SOURCE_ID, item.length, `maneuver[${index}].length`);
    const durationSeconds = responseNumber(VALHALLA_SOURCE_ID, item.time, `maneuver[${index}].time`);
    if (lengthKm < 0 || durationSeconds < 0) fail(VALHALLA_SOURCE_ID, `maneuver[${index}] contains a negative value`);
    const type = optionalResponseNumber(VALHALLA_SOURCE_ID, item.type, `maneuver[${index}].type`);
    if (type !== undefined && !Number.isInteger(type)) fail(VALHALLA_SOURCE_ID, `maneuver[${index}].type must be an integer`);
    return {
      ...(optionalString(VALHALLA_SOURCE_ID, item.instruction, `maneuver[${index}].instruction`) === undefined ? {} : { instruction: String(item.instruction) }),
      ...(optionalString(VALHALLA_SOURCE_ID, item.verbal_transition_alert_instruction, `maneuver[${index}].verbal_instruction`) === undefined
        ? {}
        : { verbalInstruction: String(item.verbal_transition_alert_instruction) }),
      distanceM: lengthKm * 1_000,
      durationSeconds,
      ...(type === undefined ? {} : { type }),
    };
  });
}

function parseValhallaRoute(
  response: unknown,
  origin: GeoPoint,
  destination: GeoPoint,
  mode: ReturnType<typeof valhallaMode>,
  now: number,
  sourceUrl: string,
): ContextCandidate<ValhallaRouteData> {
  const root = objectValue(VALHALLA_SOURCE_ID, response, "response");
  const trip = objectValue(VALHALLA_SOURCE_ID, root.trip, "response.trip");
  const status = optionalResponseNumber(VALHALLA_SOURCE_ID, trip.status, "trip.status");
  if (status !== undefined && status !== 0) {
    const message = optionalString(VALHALLA_SOURCE_ID, trip.status_message, "trip.status_message", 200);
    fail(VALHALLA_SOURCE_ID, `routing failed with status ${status}${message ? `: ${message}` : ""}`);
  }
  const units = optionalString(VALHALLA_SOURCE_ID, trip.units, "trip.units", 32) ?? "kilometers";
  if (units !== "kilometers") fail(VALHALLA_SOURCE_ID, "response units must be kilometers");
  const summary = objectValue(VALHALLA_SOURCE_ID, trip.summary, "trip.summary");
  const routedDistanceKm = responseNumber(VALHALLA_SOURCE_ID, summary.length, "trip.summary.length");
  const durationSeconds = responseNumber(VALHALLA_SOURCE_ID, summary.time, "trip.summary.time");
  if (routedDistanceKm < 0 || durationSeconds < 0) fail(VALHALLA_SOURCE_ID, "trip summary contains a negative value");
  const legs = arrayValue(VALHALLA_SOURCE_ID, trip.legs, "trip.legs").map((raw, index): ValhallaRouteLegData => {
    const leg = objectValue(VALHALLA_SOURCE_ID, raw, `trip.legs[${index}]`);
    const legSummary = objectValue(VALHALLA_SOURCE_ID, leg.summary, `trip.legs[${index}].summary`);
    const distanceKm = responseNumber(VALHALLA_SOURCE_ID, legSummary.length, `trip.legs[${index}].summary.length`);
    const time = responseNumber(VALHALLA_SOURCE_ID, legSummary.time, `trip.legs[${index}].summary.time`);
    if (distanceKm < 0 || time < 0) fail(VALHALLA_SOURCE_ID, `trip.legs[${index}] contains a negative value`);
    return {
      distanceM: distanceKm * 1_000,
      durationSeconds: time,
      encodedPolyline: requiredString(VALHALLA_SOURCE_ID, leg.shape, `trip.legs[${index}].shape`, 2_000_000),
      maneuvers: parseValhallaManeuvers(leg.maneuvers, index),
    };
  });
  if (legs.length < 1) fail(VALHALLA_SOURCE_ID, "trip.legs must not be empty");
  const source: ContextSourceRef = {
    sourceId: VALHALLA_SOURCE_ID,
    recordId: `route:${destination.lat.toFixed(6)},${destination.lng.toFixed(6)}`,
    observedAt: now,
    freshness: "fresh",
    attribution: `Valhalla; ${OSM_ATTRIBUTION}`,
    url: sourceUrl,
  };
  return {
    id: `valhalla:route:${destination.lat.toFixed(6)},${destination.lng.toFixed(6)}`,
    kind: "route",
    title: `${mode.mode} route`,
    point: destination,
    data: {
      mode: mode.mode,
      costing: mode.costing,
      routedDistanceM: routedDistanceKm * 1_000,
      straightLineDistanceM: haversineDistanceM(origin, destination),
      durationSeconds,
      units: "kilometers",
      legs,
    },
    sources: [source],
  };
}

export function createValhallaSource(options: ValhallaSourceOptions = {}): ContextSource<ValhallaRouteData> {
  const endpoint = configuredEndpoint(VALHALLA_SOURCE_ID, options.endpoint, OPEN_GEO_DEFAULT_ENDPOINTS.valhalla);
  const clientId = options.clientId === undefined ? undefined : requiredString(VALHALLA_SOURCE_ID, options.clientId, "clientId", 200);
  const sourceTiming = timing(VALHALLA_SOURCE_ID, options, {
    cacheTtlMs: 5 * 60_000,
    timeoutMs: 15_000,
    staleIfErrorMs: 30 * 60_000,
  });
  return {
    descriptor: {
      id: VALHALLA_SOURCE_ID,
      label: "Valhalla",
      purposes: [...VALHALLA_PURPOSES],
      costClass: "local",
      transport: "http",
      certification: "first_party",
      attribution: `Valhalla; ${OSM_ATTRIBUTION}`,
      license: "MIT engine; routing data license depends on the configured tiles",
      cachePolicy: "5m default by origin, destination, and mode",
      retentionPolicy: "Derived route results only; raw responses are not persisted; 5m cache TTL by default",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    },
    ...sourceTiming,
    async query(request, runtime) {
      requirePurpose(VALHALLA_SOURCE_ID, request, VALHALLA_PURPOSES);
      requestLimit(VALHALLA_SOURCE_ID, request, 1, 1);
      const origin = validatePoint(VALHALLA_SOURCE_ID, request.point, "origin point");
      const destination: GeoPoint = {
        lat: validateCoordinate(VALHALLA_SOURCE_ID, filterValue(request, "destinationLat"), "latitude"),
        lng: validateCoordinate(VALHALLA_SOURCE_ID, filterValue(request, "destinationLng"), "longitude"),
      };
      const mode = valhallaMode(request);
      const locale = requestLocale(VALHALLA_SOURCE_ID, request.locale);
      const url = childEndpoint(endpoint, "route");
      const body: JsonObject = {
        locations: [
          { lat: origin.lat, lon: origin.lng },
          { lat: destination.lat, lon: destination.lng },
        ],
        costing: mode.costing,
        directions_options: { units: "kilometers", ...(locale ? { language: locale } : {}) },
      };
      const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });
      if (clientId) headers.set("X-Client-Id", clientId);
      const response = await fetchJson(VALHALLA_SOURCE_ID, runtime, url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      return [parseValhallaRoute(response, origin, destination, mode, runtime.now(), url.toString())];
    },
  };
}

const VALHALLA_MATRIX_SOURCE_ID = "valhalla-matrix";

export interface ValhallaMatrixQueryFilters {
  destinationPoints?: string[];
  destinationLat?: number;
  destinationLng?: number;
  mode?: ValhallaTravelMode | "auto" | "pedestrian" | "bike";
}

export interface ValhallaMatrixCellData {
  fromIndex: number;
  toIndex: number;
  source: GeoPoint;
  target: GeoPoint;
  reachable: boolean;
  distanceM: number | null;
  durationSeconds: number | null;
}

export interface ValhallaMatrixData {
  mode: ValhallaTravelMode;
  costing: ValhallaRouteData["costing"];
  units: "kilometers";
  algorithm?: string;
  sources: GeoPoint[];
  targets: GeoPoint[];
  cells: ValhallaMatrixCellData[];
}

function valhallaMatrixTargets(request: PersonalContextQuery, maximum: number): GeoPoint[] {
  const encoded = filterValue(request, "destinationPoints");
  const destinationLat = filterValue(request, "destinationLat");
  const destinationLng = filterValue(request, "destinationLng");
  if (encoded !== undefined && (destinationLat !== undefined || destinationLng !== undefined)) {
    fail(VALHALLA_MATRIX_SOURCE_ID, "use destinationPoints or destinationLat/destinationLng, not both");
  }
  if (encoded === undefined) {
    return [{
      lat: validateCoordinate(VALHALLA_MATRIX_SOURCE_ID, destinationLat, "latitude"),
      lng: validateCoordinate(VALHALLA_MATRIX_SOURCE_ID, destinationLng, "longitude"),
    }];
  }
  if (!Array.isArray(encoded) || encoded.length < 1 || encoded.length > maximum) {
    fail(VALHALLA_MATRIX_SOURCE_ID, `destinationPoints must contain between 1 and ${maximum} coordinates`);
  }
  return encoded.map((raw, index) => {
    if (typeof raw !== "string" || raw.length > 64) {
      fail(VALHALLA_MATRIX_SOURCE_ID, `destinationPoints[${index}] must use the lat,lng format`);
    }
    const parts = raw.split(",").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      fail(VALHALLA_MATRIX_SOURCE_ID, `destinationPoints[${index}] must use the lat,lng format`);
    }
    return {
      lat: validateCoordinate(VALHALLA_MATRIX_SOURCE_ID, Number(parts[0]), "latitude"),
      lng: validateCoordinate(VALHALLA_MATRIX_SOURCE_ID, Number(parts[1]), "longitude"),
    };
  });
}

function nullableValhallaMetric(value: unknown, label: string): number | null {
  if (value === null) return null;
  const number = responseNumber(VALHALLA_MATRIX_SOURCE_ID, value, label);
  if (number < 0) fail(VALHALLA_MATRIX_SOURCE_ID, `${label} must be non-negative or null`);
  return number;
}

function parseValhallaMatrix(
  response: unknown,
  origin: GeoPoint,
  targets: GeoPoint[],
  mode: ReturnType<typeof valhallaMode>,
  now: number,
  sourceUrl: string,
): ContextCandidate<ValhallaMatrixData> {
  const root = objectValue(VALHALLA_MATRIX_SOURCE_ID, response, "response");
  const units = optionalString(VALHALLA_MATRIX_SOURCE_ID, root.units, "response.units", 32) ?? "kilometers";
  if (units !== "kilometers") fail(VALHALLA_MATRIX_SOURCE_ID, "response units must be kilometers");
  const rows = arrayValue(VALHALLA_MATRIX_SOURCE_ID, root.sources_to_targets, "response.sources_to_targets");
  if (rows.length !== 1) fail(VALHALLA_MATRIX_SOURCE_ID, "response.sources_to_targets must contain one source row");
  const row = arrayValue(VALHALLA_MATRIX_SOURCE_ID, rows[0], "response.sources_to_targets[0]");
  if (row.length !== targets.length) {
    fail(VALHALLA_MATRIX_SOURCE_ID, "matrix target count does not match the request");
  }
  const algorithm = optionalString(VALHALLA_MATRIX_SOURCE_ID, root.algorithm, "response.algorithm", 100);
  const cells = row.map((raw, index): ValhallaMatrixCellData => {
    const cell = objectValue(VALHALLA_MATRIX_SOURCE_ID, raw, `response.sources_to_targets[0][${index}]`);
    const fromIndex = responseInteger(VALHALLA_MATRIX_SOURCE_ID, cell.from_index, `matrix[${index}].from_index`);
    const toIndex = responseInteger(VALHALLA_MATRIX_SOURCE_ID, cell.to_index, `matrix[${index}].to_index`);
    if (fromIndex !== 0 || toIndex !== index) fail(VALHALLA_MATRIX_SOURCE_ID, `matrix[${index}] has inconsistent indices`);
    const distanceKm = nullableValhallaMetric(cell.distance, `matrix[${index}].distance`);
    const durationSeconds = nullableValhallaMetric(cell.time, `matrix[${index}].time`);
    if ((distanceKm === null) !== (durationSeconds === null)) {
      fail(VALHALLA_MATRIX_SOURCE_ID, `matrix[${index}] must provide both distance and time or neither`);
    }
    return {
      fromIndex,
      toIndex,
      source: origin,
      target: targets[index],
      reachable: distanceKm !== null,
      distanceM: distanceKm === null ? null : distanceKm * 1_000,
      durationSeconds,
    };
  });
  const source: ContextSourceRef = {
    sourceId: VALHALLA_MATRIX_SOURCE_ID,
    recordId: "one-to-many",
    observedAt: now,
    freshness: "fresh",
    attribution: `Valhalla; ${OSM_ATTRIBUTION}`,
    url: sourceUrl,
  };
  return {
    id: "valhalla-matrix:one-to-many",
    kind: "route_matrix",
    title: `${mode.mode} route matrix`,
    point: origin,
    data: {
      mode: mode.mode,
      costing: mode.costing,
      units: "kilometers",
      ...(algorithm === undefined ? {} : { algorithm }),
      sources: [origin],
      targets,
      cells,
    },
    sources: [source],
  };
}

export function createValhallaMatrixSource(options: ValhallaSourceOptions = {}): ContextSource<ValhallaMatrixData> {
  const endpoint = configuredEndpoint(VALHALLA_MATRIX_SOURCE_ID, options.endpoint, OPEN_GEO_DEFAULT_ENDPOINTS.valhalla);
  const clientId = options.clientId === undefined
    ? undefined
    : requiredString(VALHALLA_MATRIX_SOURCE_ID, options.clientId, "clientId", 200);
  const sourceTiming = timing(VALHALLA_MATRIX_SOURCE_ID, options, {
    cacheTtlMs: 5 * 60_000,
    timeoutMs: 15_000,
    staleIfErrorMs: 30 * 60_000,
  });
  return {
    descriptor: {
      id: VALHALLA_MATRIX_SOURCE_ID,
      label: "Valhalla matrix",
      purposes: [...VALHALLA_PURPOSES],
      costClass: "local",
      transport: "http",
      certification: "first_party",
      attribution: `Valhalla; ${OSM_ATTRIBUTION}`,
      license: "MIT engine; routing data license depends on the configured tiles",
      cachePolicy: "5m default for a maximum of 25 one-to-many targets",
      retentionPolicy: "Derived route matrix only; raw responses are not persisted; 5m cache TTL by default",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    },
    ...sourceTiming,
    async query(request, runtime) {
      requirePurpose(VALHALLA_MATRIX_SOURCE_ID, request, VALHALLA_PURPOSES);
      const maximumTargets = requestLimit(VALHALLA_MATRIX_SOURCE_ID, request, 10, 25);
      const origin = validatePoint(VALHALLA_MATRIX_SOURCE_ID, request.point, "origin point");
      const targets = valhallaMatrixTargets(request, maximumTargets);
      const mode = valhallaMode(request, VALHALLA_MATRIX_SOURCE_ID);
      const url = childEndpoint(endpoint, "sources_to_targets");
      const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });
      if (clientId) headers.set("X-Client-Id", clientId);
      const response = await fetchJson(VALHALLA_MATRIX_SOURCE_ID, runtime, url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          sources: [{ lat: origin.lat, lon: origin.lng }],
          targets: targets.map((target) => ({ lat: target.lat, lon: target.lng })),
          costing: mode.costing,
          units: "kilometers",
          verbose: true,
        }),
      });
      return [parseValhallaMatrix(response, origin, targets, mode, runtime.now(), url.toString())];
    },
  };
}

// OpenStreetMap nearby via Overpass

const OVERPASS_SOURCE_ID = "overpass-osm";
const OVERPASS_PURPOSES = ["nearby"] as const satisfies readonly ContextPurpose[];

const OSM_CATEGORY_FILTERS = {
  restaurant: '["amenity"="restaurant"]',
  cafe: '["amenity"="cafe"]',
  bar: '["amenity"="bar"]',
  fast_food: '["amenity"="fast_food"]',
  pharmacy: '["amenity"="pharmacy"]',
  hospital: '["amenity"="hospital"]',
  clinic: '["amenity"="clinic"]',
  supermarket: '["shop"="supermarket"]',
  bakery: '["shop"="bakery"]',
  hotel: '["tourism"="hotel"]',
  parking: '["amenity"="parking"]',
  fuel: '["amenity"="fuel"]',
  charging_station: '["amenity"="charging_station"]',
  bank: '["amenity"="bank"]',
  atm: '["amenity"="atm"]',
} as const;

export type OpenStreetMapNearbyCategory = keyof typeof OSM_CATEGORY_FILTERS;

export interface OverpassNearbySourceOptions extends OpenGeoSourceTimingOptions {
  endpoint?: string;
  defaultRadiusM?: number;
  maximumRadiusM?: number;
  queryTimeoutSeconds?: number;
}

export interface OverpassNearbyQueryFilters {
  category?: OpenStreetMapNearbyCategory;
  name?: string;
  radiusM?: number;
}

export interface OpenStreetMapNearbyData {
  osmType: "node" | "way" | "relation";
  osmId: number;
  category: OpenStreetMapNearbyCategory | "unknown";
  tags: Record<string, string>;
  straightLineDistanceM: number;
  openingHours?: string;
}

function overpassCategory(request: PersonalContextQuery, text: string | undefined): OpenStreetMapNearbyCategory | undefined {
  const raw = filterValue(request, "category") ?? (text && text in OSM_CATEGORY_FILTERS ? text : undefined);
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !(raw in OSM_CATEGORY_FILTERS)) {
    fail(OVERPASS_SOURCE_ID, `category must be one of: ${Object.keys(OSM_CATEGORY_FILTERS).join(", ")}`);
  }
  return raw as OpenStreetMapNearbyCategory;
}

function overpassStringLiteral(value: string): string {
  const escapedRegex = value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  return JSON.stringify(escapedRegex);
}

function parseOverpassElement(
  value: unknown,
  index: number,
  origin: GeoPoint,
  category: OpenStreetMapNearbyCategory | undefined,
  source: ContextSourceRef,
): ContextCandidate<OpenStreetMapNearbyData> {
  const element = objectValue(OVERPASS_SOURCE_ID, value, `response.elements[${index}]`);
  const type = requiredString(OVERPASS_SOURCE_ID, element.type, `response.elements[${index}].type`, 16);
  if (type !== "node" && type !== "way" && type !== "relation") fail(OVERPASS_SOURCE_ID, `response.elements[${index}].type is invalid`);
  const id = responseInteger(OVERPASS_SOURCE_ID, element.id, `response.elements[${index}].id`);
  if (id < 1) fail(OVERPASS_SOURCE_ID, `response.elements[${index}].id must be positive`);
  const center = element.center === undefined ? undefined : objectValue(OVERPASS_SOURCE_ID, element.center, `response.elements[${index}].center`);
  const lat = validateCoordinate(
    OVERPASS_SOURCE_ID,
    responseNumber(OVERPASS_SOURCE_ID, type === "node" ? element.lat : center?.lat, `response.elements[${index}].lat`),
    "latitude",
  );
  const lng = validateCoordinate(
    OVERPASS_SOURCE_ID,
    responseNumber(OVERPASS_SOURCE_ID, type === "node" ? element.lon : center?.lon, `response.elements[${index}].lon`),
    "longitude",
  );
  const tags = optionalStringRecord(OVERPASS_SOURCE_ID, element.tags, `response.elements[${index}].tags`) ?? {};
  const point = { lat, lng };
  const distanceM = haversineDistanceM(origin, point);
  const recordId = `${type}/${id}`;
  return {
    id: `osm:${recordId}`,
    kind: "place",
    title: tags.name || tags.brand || `${category ?? "place"} (${recordId})`,
    point,
    data: {
      osmType: type,
      osmId: id,
      category: category ?? "unknown",
      tags,
      straightLineDistanceM: distanceM,
      ...(tags.opening_hours ? { openingHours: tags.opening_hours } : {}),
    },
    sources: [{ ...source, recordId, url: `https://www.openstreetmap.org/${type}/${id}` }],
  };
}

export function createOverpassNearbySource(options: OverpassNearbySourceOptions = {}): ContextSource<OpenStreetMapNearbyData> {
  const endpoint = configuredEndpoint(OVERPASS_SOURCE_ID, options.endpoint, OPEN_GEO_DEFAULT_ENDPOINTS.overpass);
  const maximumRadiusM = options.maximumRadiusM ?? 50_000;
  if (!Number.isFinite(maximumRadiusM) || maximumRadiusM < 100 || maximumRadiusM > 100_000) {
    fail(OVERPASS_SOURCE_ID, "maximumRadiusM must be between 100 and 100000");
  }
  const defaultRadiusM = options.defaultRadiusM ?? 3_000;
  if (!Number.isFinite(defaultRadiusM) || defaultRadiusM < 1 || defaultRadiusM > maximumRadiusM) {
    fail(OVERPASS_SOURCE_ID, "defaultRadiusM must be within the configured maximum");
  }
  const queryTimeoutSeconds = options.queryTimeoutSeconds ?? 20;
  if (!Number.isInteger(queryTimeoutSeconds) || queryTimeoutSeconds < 1 || queryTimeoutSeconds > 60) {
    fail(OVERPASS_SOURCE_ID, "queryTimeoutSeconds must be an integer between 1 and 60");
  }
  const sourceTiming = timing(OVERPASS_SOURCE_ID, options, {
    cacheTtlMs: 5 * 60_000,
    timeoutMs: 25_000,
    staleIfErrorMs: HOUR_MS,
  });
  return {
    descriptor: {
      id: OVERPASS_SOURCE_ID,
      label: "OpenStreetMap nearby (Overpass)",
      purposes: [...OVERPASS_PURPOSES],
      costClass: "free",
      transport: "http",
      certification: "first_party",
      attribution: OSM_ATTRIBUTION,
      license: "ODbL 1.0",
      cachePolicy: "5m default; public Overpass is a development fallback for bounded nearby queries",
      retentionPolicy: "Derived nearby results only; raw responses are not persisted; 5m cache TTL by default",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    },
    ...sourceTiming,
    async query(request, runtime) {
      requirePurpose(OVERPASS_SOURCE_ID, request, OVERPASS_PURPOSES);
      const origin = validatePoint(OVERPASS_SOURCE_ID, request.point);
      const limit = requestLimit(OVERPASS_SOURCE_ID, request, 20, 100);
      const radiusM = finiteFilter(OVERPASS_SOURCE_ID, request, "radiusM", { minimum: 1, maximum: maximumRadiusM, fallback: defaultRadiusM })!;
      const text = requestText(OVERPASS_SOURCE_ID, request.text, 100);
      const category = overpassCategory(request, text);
      const explicitName = stringFilter(OVERPASS_SOURCE_ID, request, "name", 100);
      const name = explicitName ?? (category ? undefined : text);
      if (!category && !name) fail(OVERPASS_SOURCE_ID, "category, name, or text is required");
      const categoryClause = category ? OSM_CATEGORY_FILTERS[category] : "[\"name\"]";
      const nameClause = name ? `[\"name\"~${overpassStringLiteral(name)},i]` : "";
      const query = `[out:json][timeout:${queryTimeoutSeconds}];nwr(around:${radiusM},${origin.lat},${origin.lng})${categoryClause}${nameClause};out center ${limit};`;
      const body = new URLSearchParams({ data: query });
      const url = new URL(endpoint);
      const response = await fetchJson(OVERPASS_SOURCE_ID, runtime, url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
      });
      const root = objectValue(OVERPASS_SOURCE_ID, response, "response");
      const osm3s = root.osm3s === undefined ? undefined : objectValue(OVERPASS_SOURCE_ID, root.osm3s, "response.osm3s");
      const baseTimestamp = parseDate(osm3s?.timestamp_osm_base);
      const now = runtime.now();
      const source: ContextSourceRef = {
        sourceId: OVERPASS_SOURCE_ID,
        observedAt: observedAtOrNow(baseTimestamp, now),
        freshness: freshnessAt(baseTimestamp, now, DAY_MS),
        attribution: OSM_ATTRIBUTION,
        url: "https://www.openstreetmap.org/copyright",
      };
      const seen = new Set<string>();
      const candidates: ContextCandidate<OpenStreetMapNearbyData>[] = [];
      for (const [index, element] of arrayValue(OVERPASS_SOURCE_ID, root.elements, "response.elements").slice(0, limit).entries()) {
        const candidate = parseOverpassElement(element, index, origin, category, source);
        if (candidate.data.straightLineDistanceM > radiusM + 1) continue;
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        candidates.push(candidate);
        if (candidates.length === limit) break;
      }
      return candidates;
    },
  };
}

// Open Charge Map

const OCM_SOURCE_ID = "open-charge-map";
const OCM_PURPOSES = ["nearby", "mobility"] as const satisfies readonly ContextPurpose[];

export interface OpenChargeMapSourceOptions extends OpenGeoSourceTimingOptions {
  endpoint?: string;
  apiKey?: string;
  userAgent?: string;
  freshForMs?: number;
  maximumRadiusKm?: number;
}

export interface OpenChargeMapQueryFilters {
  radiusKm?: number;
  connectorTypeId?: number | string;
  connectorTypeIds?: string[];
  minimumPowerKw?: number;
}

export interface OpenChargeMapConnectionData {
  id: number;
  connectorTypeId: number;
  connectorTitle?: string;
  quantity?: number;
  powerKw?: number;
  voltage?: number;
  amps?: number;
  operationalStatus?: string;
}

export interface OpenChargeMapStatusData {
  id?: number;
  title?: string;
  isOperational?: boolean;
  observedAt?: number;
  freshness: ContextFreshness;
}

export interface OpenChargeMapPlaceData {
  openChargeMapId: number;
  address: {
    line1?: string;
    town?: string;
    stateOrProvince?: string;
    postcode?: string;
    country?: string;
  };
  straightLineDistanceM: number;
  numberOfPoints?: number;
  usageCost?: string;
  operator?: string;
  dataProvider: {
    title: string;
    license?: string;
    website?: string;
  };
  connections: OpenChargeMapConnectionData[];
  operationalStatus: OpenChargeMapStatusData;
  availability: {
    status: "unknown";
    freshness: "unknown";
  };
  lastVerifiedAt?: number;
  openData: true;
}

function connectorTypeIds(request: PersonalContextQuery): number[] {
  const plural = filterValue(request, "connectorTypeIds");
  const singular = filterValue(request, "connectorTypeId");
  if (plural !== undefined && singular !== undefined) fail(OCM_SOURCE_ID, "use connectorTypeId or connectorTypeIds, not both");
  const values = plural !== undefined ? plural : singular === undefined ? [] : [singular];
  if (!Array.isArray(values) || values.length > 20) fail(OCM_SOURCE_ID, "connectorTypeIds must be an array with at most 20 values");
  const parsed = values.map((value, index) => {
    const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || number < 1) fail(OCM_SOURCE_ID, `connectorTypeIds[${index}] must be a positive integer`);
    return number;
  });
  return [...new Set(parsed)];
}

function parseOcmConnection(value: unknown, index: number): OpenChargeMapConnectionData {
  const item = objectValue(OCM_SOURCE_ID, value, `response.Connections[${index}]`);
  const type = item.ConnectionType === undefined || item.ConnectionType === null
    ? undefined
    : objectValue(OCM_SOURCE_ID, item.ConnectionType, `response.Connections[${index}].ConnectionType`);
  const connectorTypeId = responseInteger(
    OCM_SOURCE_ID,
    item.ConnectionTypeID ?? type?.ID,
    `response.Connections[${index}].ConnectionTypeID`,
  );
  const id = responseInteger(OCM_SOURCE_ID, item.ID, `response.Connections[${index}].ID`);
  if (id < 1 || connectorTypeId < 1) fail(OCM_SOURCE_ID, `response.Connections[${index}] contains an invalid ID`);
  const quantity = optionalResponseNumber(OCM_SOURCE_ID, item.Quantity, `response.Connections[${index}].Quantity`);
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 0)) fail(OCM_SOURCE_ID, `response.Connections[${index}].Quantity is invalid`);
  const status = item.StatusType === undefined || item.StatusType === null
    ? undefined
    : objectValue(OCM_SOURCE_ID, item.StatusType, `response.Connections[${index}].StatusType`);
  const connectorTitle = optionalString(OCM_SOURCE_ID, type?.Title, `response.Connections[${index}].ConnectionType.Title`, 200);
  const powerKw = optionalResponseNumber(OCM_SOURCE_ID, item.PowerKW, `response.Connections[${index}].PowerKW`);
  const voltage = optionalResponseNumber(OCM_SOURCE_ID, item.Voltage, `response.Connections[${index}].Voltage`);
  const amps = optionalResponseNumber(OCM_SOURCE_ID, item.Amps, `response.Connections[${index}].Amps`);
  if ([powerKw, voltage, amps].some((number) => number !== undefined && number < 0)) {
    fail(OCM_SOURCE_ID, `response.Connections[${index}] contains a negative electrical value`);
  }
  const operationalStatus = optionalString(OCM_SOURCE_ID, status?.Title, `response.Connections[${index}].StatusType.Title`, 200);
  return {
    id,
    connectorTypeId,
    ...(connectorTitle === undefined ? {} : { connectorTitle }),
    ...(quantity === undefined ? {} : { quantity }),
    ...(powerKw === undefined ? {} : { powerKw }),
    ...(voltage === undefined ? {} : { voltage }),
    ...(amps === undefined ? {} : { amps }),
    ...(operationalStatus === undefined ? {} : { operationalStatus }),
  };
}

function parseOcmPlace(
  value: unknown,
  index: number,
  origin: GeoPoint,
  now: number,
  freshForMs: number,
): ContextCandidate<OpenChargeMapPlaceData> {
  const item = objectValue(OCM_SOURCE_ID, value, `response[${index}]`);
  const id = responseInteger(OCM_SOURCE_ID, item.ID, `response[${index}].ID`);
  if (id < 1) fail(OCM_SOURCE_ID, `response[${index}].ID must be positive`);
  const address = objectValue(OCM_SOURCE_ID, item.AddressInfo, `response[${index}].AddressInfo`);
  const title = requiredString(OCM_SOURCE_ID, address.Title, `response[${index}].AddressInfo.Title`);
  const country = address.Country === undefined || address.Country === null
    ? undefined
    : objectValue(OCM_SOURCE_ID, address.Country, `response[${index}].AddressInfo.Country`);
  const point: GeoPoint = {
    lat: validateCoordinate(OCM_SOURCE_ID, responseNumber(OCM_SOURCE_ID, address.Latitude, `response[${index}].AddressInfo.Latitude`), "latitude"),
    lng: validateCoordinate(OCM_SOURCE_ID, responseNumber(OCM_SOURCE_ID, address.Longitude, `response[${index}].AddressInfo.Longitude`), "longitude"),
  };
  const provider = item.DataProvider === undefined || item.DataProvider === null
    ? undefined
    : objectValue(OCM_SOURCE_ID, item.DataProvider, `response[${index}].DataProvider`);
  const providerTitle = optionalString(OCM_SOURCE_ID, provider?.Title, `response[${index}].DataProvider.Title`, 300) ?? OCM_ATTRIBUTION;
  const providerLicense = optionalString(OCM_SOURCE_ID, provider?.License, `response[${index}].DataProvider.License`, 1_000);
  const providerWebsite = httpUrl(provider?.WebsiteURL);
  const status = item.StatusType === undefined || item.StatusType === null
    ? undefined
    : objectValue(OCM_SOURCE_ID, item.StatusType, `response[${index}].StatusType`);
  const statusObservedAt = parseDate(item.DateLastStatusUpdate);
  const sourceFreshness = freshnessAt(statusObservedAt, now, freshForMs);
  const connections = arrayValue(OCM_SOURCE_ID, item.Connections ?? [], `response[${index}].Connections`).map(parseOcmConnection);
  const operator = item.OperatorInfo === undefined || item.OperatorInfo === null
    ? undefined
    : objectValue(OCM_SOURCE_ID, item.OperatorInfo, `response[${index}].OperatorInfo`);
  const numberOfPoints = optionalResponseNumber(OCM_SOURCE_ID, item.NumberOfPoints, `response[${index}].NumberOfPoints`);
  if (numberOfPoints !== undefined && (!Number.isInteger(numberOfPoints) || numberOfPoints < 0)) {
    fail(OCM_SOURCE_ID, `response[${index}].NumberOfPoints is invalid`);
  }
  const addressLine1 = optionalString(OCM_SOURCE_ID, address.AddressLine1, `response[${index}].AddressInfo.AddressLine1`, 500);
  const town = optionalString(OCM_SOURCE_ID, address.Town, `response[${index}].AddressInfo.Town`, 300);
  const stateOrProvince = optionalString(OCM_SOURCE_ID, address.StateOrProvince, `response[${index}].AddressInfo.StateOrProvince`, 300);
  const postcode = optionalString(OCM_SOURCE_ID, address.Postcode, `response[${index}].AddressInfo.Postcode`, 100);
  const countryTitle = optionalString(OCM_SOURCE_ID, country?.Title, `response[${index}].AddressInfo.Country.Title`, 300);
  const usageCost = optionalString(OCM_SOURCE_ID, item.UsageCost, `response[${index}].UsageCost`, 1_000);
  const operatorTitle = optionalString(OCM_SOURCE_ID, operator?.Title, `response[${index}].OperatorInfo.Title`, 300);
  const statusId = optionalResponseNumber(OCM_SOURCE_ID, status?.ID, `response[${index}].StatusType.ID`);
  if (statusId !== undefined && (!Number.isSafeInteger(statusId) || statusId < 1)) {
    fail(OCM_SOURCE_ID, `response[${index}].StatusType.ID must be a positive safe integer`);
  }
  const statusTitle = optionalString(OCM_SOURCE_ID, status?.Title, `response[${index}].StatusType.Title`, 300);
  const isOperational = optionalBoolean(OCM_SOURCE_ID, status?.IsOperational, `response[${index}].StatusType.IsOperational`);
  const lastVerifiedAt = parseDate(item.DateLastVerified);
  const recordUrl = `https://openchargemap.org/site/poi/details/${id}`;
  const attribution = providerTitle === OCM_ATTRIBUTION ? OCM_ATTRIBUTION : `${providerTitle} via Open Charge Map`;
  return {
    id: `ocm:${id}`,
    kind: "ev_charger",
    title,
    point,
    data: {
      openChargeMapId: id,
      address: {
        ...(addressLine1 === undefined ? {} : { line1: addressLine1 }),
        ...(town === undefined ? {} : { town }),
        ...(stateOrProvince === undefined ? {} : { stateOrProvince }),
        ...(postcode === undefined ? {} : { postcode }),
        ...(countryTitle === undefined ? {} : { country: countryTitle }),
      },
      straightLineDistanceM: haversineDistanceM(origin, point),
      ...(numberOfPoints === undefined ? {} : { numberOfPoints }),
      ...(usageCost === undefined ? {} : { usageCost }),
      ...(operatorTitle === undefined ? {} : { operator: operatorTitle }),
      dataProvider: {
        title: providerTitle,
        ...(providerLicense ? { license: providerLicense } : {}),
        ...(providerWebsite ? { website: providerWebsite } : {}),
      },
      connections,
      operationalStatus: {
        ...(statusId === undefined ? {} : { id: statusId }),
        ...(statusTitle === undefined ? {} : { title: statusTitle }),
        ...(isOperational === undefined ? {} : { isOperational }),
        ...(statusObservedAt === undefined ? {} : { observedAt: statusObservedAt }),
        freshness: sourceFreshness,
      },
      availability: { status: "unknown", freshness: "unknown" },
      ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }),
      openData: true,
    },
    sources: [{
      sourceId: OCM_SOURCE_ID,
      recordId: String(id),
      observedAt: observedAtOrNow(statusObservedAt, now),
      freshness: sourceFreshness,
      attribution,
      url: recordUrl,
    }],
  };
}

export function createOpenChargeMapSource(options: OpenChargeMapSourceOptions = {}): ContextSource<OpenChargeMapPlaceData> {
  const endpoint = configuredEndpoint(OCM_SOURCE_ID, options.endpoint, OPEN_GEO_DEFAULT_ENDPOINTS.openChargeMap);
  const apiKey = options.apiKey === undefined ? undefined : requiredString(OCM_SOURCE_ID, options.apiKey, "apiKey", 1_000);
  const userAgent = nominatimUserAgent(OCM_SOURCE_ID, options.userAgent);
  const freshForMs = timingValue(OCM_SOURCE_ID, "freshForMs", options.freshForMs, DAY_MS);
  const maximumRadiusKm = options.maximumRadiusKm ?? 200;
  if (!Number.isFinite(maximumRadiusKm) || maximumRadiusKm < 1 || maximumRadiusKm > 1_000) {
    fail(OCM_SOURCE_ID, "maximumRadiusKm must be between 1 and 1000");
  }
  const sourceTiming = timing(OCM_SOURCE_ID, options, {
    cacheTtlMs: 15 * 60_000,
    timeoutMs: 12_000,
    staleIfErrorMs: DAY_MS,
  });
  return {
    descriptor: {
      id: OCM_SOURCE_ID,
      label: "Open Charge Map",
      purposes: [...OCM_PURPOSES],
      costClass: "free",
      transport: "http",
      certification: "first_party",
      attribution: OCM_ATTRIBUTION,
      license: "Per-record open-data license supplied by Open Charge Map",
      cachePolicy: "15m default; only opendata=true records; occupancy availability is always unknown",
      retentionPolicy: "Open-data derived records only; raw responses are not persisted; 15m cache TTL by default",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    },
    ...sourceTiming,
    async query(request, runtime) {
      requirePurpose(OCM_SOURCE_ID, request, OCM_PURPOSES);
      const origin = validatePoint(OCM_SOURCE_ID, request.point);
      const limit = requestLimit(OCM_SOURCE_ID, request, 20, 100);
      const radiusKm = finiteFilter(OCM_SOURCE_ID, request, "radiusKm", { minimum: 0.1, maximum: maximumRadiusKm, fallback: 25 })!;
      const requiredConnectorIds = connectorTypeIds(request);
      const minimumPowerKw = finiteFilter(OCM_SOURCE_ID, request, "minimumPowerKw", { minimum: 0, maximum: 1_000 });
      const params = new URLSearchParams({
        output: "json",
        latitude: String(origin.lat),
        longitude: String(origin.lng),
        distance: String(radiusKm),
        distanceunit: "KM",
        maxresults: String(limit),
        compact: "false",
        verbose: "false",
        opendata: "true",
      });
      if (requiredConnectorIds.length) params.set("connectiontypeid", requiredConnectorIds.join(","));
      const url = new URL(endpoint);
      url.search = params.toString();
      const headers = new Headers({ Accept: "application/json", "User-Agent": userAgent });
      if (apiKey) headers.set("X-API-Key", apiKey);
      const response = await fetchJson(OCM_SOURCE_ID, runtime, url, { headers });
      const now = runtime.now();
      return arrayValue(OCM_SOURCE_ID, response, "response")
        .slice(0, limit)
        .map((item, index) => parseOcmPlace(item, index, origin, now, freshForMs))
        .filter((candidate) => {
          const compatible = requiredConnectorIds.length === 0
            ? candidate.data.connections
            : candidate.data.connections.filter((connection) => requiredConnectorIds.includes(connection.connectorTypeId));
          if (requiredConnectorIds.length && compatible.length === 0) return false;
          if (minimumPowerKw !== undefined && !compatible.some((connection) => connection.powerKw !== undefined && connection.powerKw >= minimumPowerKw)) return false;
          candidate.data.connections = compatible;
          return candidate.data.straightLineDistanceM <= radiusKm * 1_000 + 1;
        })
        .slice(0, limit);
    },
  };
}

// Open-Meteo

const OPEN_METEO_SOURCE_ID = "open-meteo";
const OPEN_METEO_PURPOSES = ["weather", "mobility", "events"] as const satisfies readonly ContextPurpose[];
const OPEN_METEO_CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation",
  "rain",
  "weather_code",
  "wind_speed_10m",
] as const;
const OPEN_METEO_HOURLY_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "rain",
  "weather_code",
  "wind_speed_10m",
] as const;

export interface OpenMeteoSourceOptions extends OpenGeoSourceTimingOptions {
  endpoint?: string;
  coordinatePrecision?: number;
}

export interface OpenMeteoCurrentData {
  validAt: number;
  intervalSeconds?: number;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  weatherCode: number | null;
  windSpeedKmh: number | null;
}

export interface OpenMeteoHourlyData extends OpenMeteoCurrentData {
  precipitationProbabilityPercent: number | null;
}

export interface OpenMeteoWeatherData {
  timezone: string;
  utcOffsetSeconds: number;
  elevationM?: number;
  fetchedAt: number;
  current: OpenMeteoCurrentData;
  hourly: OpenMeteoHourlyData[];
  currentUnits: Record<string, string>;
  hourlyUnits: Record<string, string>;
}

function roundCoordinate(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function requestWindow(sourceId: string, request: PersonalContextQuery, now: number): { startAt?: number; endAt?: number } {
  if ((request.startAt === undefined) !== (request.endAt === undefined)) fail(sourceId, "startAt and endAt must be provided together");
  if (request.startAt === undefined || request.endAt === undefined) return {};
  if (!Number.isFinite(request.startAt) || !Number.isFinite(request.endAt) || request.startAt < 0 || request.endAt < request.startAt) {
    fail(sourceId, "startAt and endAt must form a valid ascending time window");
  }
  if (request.endAt - request.startAt > 16 * DAY_MS) fail(sourceId, "weather time window must not exceed 16 days");
  if (request.startAt < now - DAY_MS || request.endAt > now + 16 * DAY_MS) {
    fail(sourceId, "weather time window must stay within the forecast horizon");
  }
  return { startAt: request.startAt, endAt: request.endAt };
}

function dateParameter(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseOpenMeteoSeries(sourceId: string, hourly: JsonObject, field: string, length: number): Array<number | null> {
  const values = arrayValue(sourceId, hourly[field], `response.hourly.${field}`);
  if (values.length !== length) fail(sourceId, `response.hourly.${field} length does not match response.hourly.time`);
  return values.map((value, index) => nullableResponseNumber(sourceId, value, `response.hourly.${field}[${index}]`));
}

function weatherValue(
  value: number | null,
  label: string,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
  integer = false,
): number | null {
  if (value === null) return null;
  if (value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    fail(OPEN_METEO_SOURCE_ID, `${label} is outside its valid range`);
  }
  return value;
}

function parseOpenMeteoResponse(
  response: unknown,
  now: number,
  maximumHours: number,
  window: { startAt?: number; endAt?: number },
): ContextCandidate<OpenMeteoWeatherData> {
  const root = objectValue(OPEN_METEO_SOURCE_ID, response, "response");
  if (root.error === true) {
    const reason = optionalString(OPEN_METEO_SOURCE_ID, root.reason, "response.reason", 300) ?? "unknown API error";
    fail(OPEN_METEO_SOURCE_ID, reason);
  }
  const point: GeoPoint = {
    lat: validateCoordinate(OPEN_METEO_SOURCE_ID, responseNumber(OPEN_METEO_SOURCE_ID, root.latitude, "response.latitude"), "latitude"),
    lng: validateCoordinate(OPEN_METEO_SOURCE_ID, responseNumber(OPEN_METEO_SOURCE_ID, root.longitude, "response.longitude"), "longitude"),
  };
  const timezone = requiredString(OPEN_METEO_SOURCE_ID, root.timezone, "response.timezone", 100);
  const utcOffsetSeconds = responseInteger(OPEN_METEO_SOURCE_ID, root.utc_offset_seconds, "response.utc_offset_seconds");
  const elevationM = optionalResponseNumber(OPEN_METEO_SOURCE_ID, root.elevation, "response.elevation");
  const current = objectValue(OPEN_METEO_SOURCE_ID, root.current, "response.current");
  const currentTimeSeconds = responseNumber(OPEN_METEO_SOURCE_ID, current.time, "response.current.time");
  if (currentTimeSeconds < 0) fail(OPEN_METEO_SOURCE_ID, "response.current.time must be non-negative");
  const currentInterval = optionalResponseNumber(OPEN_METEO_SOURCE_ID, current.interval, "response.current.interval");
  if (currentInterval !== undefined && currentInterval <= 0) fail(OPEN_METEO_SOURCE_ID, "response.current.interval must be positive");
  const currentData: OpenMeteoCurrentData = {
    validAt: currentTimeSeconds * 1_000,
    ...(currentInterval === undefined ? {} : { intervalSeconds: currentInterval }),
    temperatureC: nullableResponseNumber(OPEN_METEO_SOURCE_ID, current.temperature_2m, "response.current.temperature_2m"),
    apparentTemperatureC: nullableResponseNumber(OPEN_METEO_SOURCE_ID, current.apparent_temperature, "response.current.apparent_temperature"),
    precipitationMm: weatherValue(nullableResponseNumber(OPEN_METEO_SOURCE_ID, current.precipitation, "response.current.precipitation"), "response.current.precipitation", 0),
    rainMm: weatherValue(nullableResponseNumber(OPEN_METEO_SOURCE_ID, current.rain, "response.current.rain"), "response.current.rain", 0),
    weatherCode: weatherValue(nullableResponseNumber(OPEN_METEO_SOURCE_ID, current.weather_code, "response.current.weather_code"), "response.current.weather_code", 0, 99, true),
    windSpeedKmh: weatherValue(nullableResponseNumber(OPEN_METEO_SOURCE_ID, current.wind_speed_10m, "response.current.wind_speed_10m"), "response.current.wind_speed_10m", 0),
  };
  const hourly = objectValue(OPEN_METEO_SOURCE_ID, root.hourly, "response.hourly");
  const rawTimes = arrayValue(OPEN_METEO_SOURCE_ID, hourly.time, "response.hourly.time");
  if (rawTimes.length > 384) fail(OPEN_METEO_SOURCE_ID, "response.hourly.time exceeds the 384-hour limit");
  const timeValues = rawTimes.map((value, index) => {
    const seconds = responseNumber(OPEN_METEO_SOURCE_ID, value, `response.hourly.time[${index}]`);
    if (seconds < 0) fail(OPEN_METEO_SOURCE_ID, `response.hourly.time[${index}] must be non-negative`);
    return seconds * 1_000;
  });
  const series = Object.fromEntries(
    OPEN_METEO_HOURLY_FIELDS.map((field) => [field, parseOpenMeteoSeries(OPEN_METEO_SOURCE_ID, hourly, field, timeValues.length)]),
  ) as Record<(typeof OPEN_METEO_HOURLY_FIELDS)[number], Array<number | null>>;
  const hourlyData = timeValues.map((validAt, index): OpenMeteoHourlyData => ({
    validAt,
    temperatureC: series.temperature_2m[index],
    apparentTemperatureC: series.apparent_temperature[index],
    precipitationProbabilityPercent: weatherValue(series.precipitation_probability[index], `response.hourly.precipitation_probability[${index}]`, 0, 100),
    precipitationMm: weatherValue(series.precipitation[index], `response.hourly.precipitation[${index}]`, 0),
    rainMm: weatherValue(series.rain[index], `response.hourly.rain[${index}]`, 0),
    weatherCode: weatherValue(series.weather_code[index], `response.hourly.weather_code[${index}]`, 0, 99, true),
    windSpeedKmh: weatherValue(series.wind_speed_10m[index], `response.hourly.wind_speed_10m[${index}]`, 0),
  })).filter((item) => (
    window.startAt === undefined
      ? true
      : item.validAt >= window.startAt && item.validAt <= window.endAt!
  )).slice(0, maximumHours);
  const source: ContextSourceRef = {
    sourceId: OPEN_METEO_SOURCE_ID,
    recordId: "forecast",
    observedAt: now,
    freshness: "fresh",
    attribution: OPEN_METEO_ATTRIBUTION,
    url: "https://open-meteo.com/",
  };
  return {
    id: "open-meteo:forecast",
    kind: "weather_forecast",
    title: "Weather forecast",
    point,
    data: {
      timezone,
      utcOffsetSeconds,
      ...(elevationM === undefined ? {} : { elevationM }),
      fetchedAt: now,
      current: currentData,
      hourly: hourlyData,
      currentUnits: stringRecord(OPEN_METEO_SOURCE_ID, root.current_units, "response.current_units"),
      hourlyUnits: stringRecord(OPEN_METEO_SOURCE_ID, root.hourly_units, "response.hourly_units"),
    },
    sources: [source],
  };
}

export function createOpenMeteoSource(options: OpenMeteoSourceOptions = {}): ContextSource<OpenMeteoWeatherData> {
  const endpoint = configuredEndpoint(OPEN_METEO_SOURCE_ID, options.endpoint, OPEN_GEO_DEFAULT_ENDPOINTS.openMeteo);
  const coordinatePrecision = options.coordinatePrecision ?? 3;
  if (!Number.isInteger(coordinatePrecision) || coordinatePrecision < 0 || coordinatePrecision > 6) {
    fail(OPEN_METEO_SOURCE_ID, "coordinatePrecision must be an integer between 0 and 6");
  }
  const sourceTiming = timing(OPEN_METEO_SOURCE_ID, options, {
    cacheTtlMs: 15 * 60_000,
    timeoutMs: 10_000,
    staleIfErrorMs: HOUR_MS,
  });
  return {
    descriptor: {
      id: OPEN_METEO_SOURCE_ID,
      label: "Open-Meteo",
      purposes: [...OPEN_METEO_PURPOSES],
      costClass: "free",
      transport: "http",
      certification: "first_party",
      attribution: OPEN_METEO_ATTRIBUTION,
      license: "CC BY 4.0 data; AGPLv3 server",
      cachePolicy: "15m default; coordinates rounded to 3 decimals by default",
      retentionPolicy: "Derived forecast results only; raw responses are not persisted; 15m cache TTL by default",
      lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
    },
    ...sourceTiming,
    async query(request, runtime) {
      requirePurpose(OPEN_METEO_SOURCE_ID, request, OPEN_METEO_PURPOSES);
      const point = validatePoint(OPEN_METEO_SOURCE_ID, request.point);
      const maximumHours = requestLimit(OPEN_METEO_SOURCE_ID, request, 24, 384);
      const window = requestWindow(OPEN_METEO_SOURCE_ID, request, runtime.now());
      const params = new URLSearchParams({
        latitude: String(roundCoordinate(point.lat, coordinatePrecision)),
        longitude: String(roundCoordinate(point.lng, coordinatePrecision)),
        current: OPEN_METEO_CURRENT_FIELDS.join(","),
        hourly: OPEN_METEO_HOURLY_FIELDS.join(","),
        timeformat: "unixtime",
        timezone: "auto",
      });
      if (window.startAt === undefined) {
        params.set("forecast_hours", String(maximumHours));
      } else {
        params.set("start_date", dateParameter(window.startAt));
        params.set("end_date", dateParameter(window.endAt!));
      }
      const url = new URL(endpoint);
      url.search = params.toString();
      const response = await fetchJson(OPEN_METEO_SOURCE_ID, runtime, url, { headers: { Accept: "application/json" } });
      return [parseOpenMeteoResponse(response, runtime.now(), maximumHours, window)];
    },
  };
}
