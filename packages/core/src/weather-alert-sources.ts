import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ContextCandidate, ContextFreshness, ContextSourceRef, GeoPoint, PersonalContextQuery } from "@jarvis/protocol";
import type { ContextSource, ContextSourceRuntime } from "./context-sources.js";

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ALERTS = 200;

export interface CapWeatherAlertData {
  identifier: string;
  sender: string;
  sentAt: number;
  status: string;
  messageType: string;
  scope: string;
  event: string;
  urgency: string;
  severity: string;
  certainty: string;
  effectiveAt?: number;
  onsetAt?: number;
  expiresAt?: number;
  areaDescription?: string;
  description?: string;
  instruction?: string;
  language?: string;
  authority: string;
  officialAlert: true;
}

export interface CapWeatherAlertSourceOptions {
  url: string;
  sourceId: string;
  label: string;
  attribution: string;
  authority: string;
  certification: "first_party" | "audited";
  cacheTtlMs?: number;
  timeoutMs?: number;
  staleIfErrorMs?: number;
  maxResponseBytes?: number;
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function list<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const row = record(value);
  return row ? text(row["#text"] ?? row.__cdata ?? row.value) : undefined;
}

function time(value: unknown): number | undefined {
  const parsed = Date.parse(text(value) || "");
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);
}

function sourceUrl(value: unknown, fallback: string): string {
  try {
    const url = new URL(text(value) || "", fallback);
    return url.protocol === "https:" ? url.toString() : fallback;
  } catch { return fallback; }
}

function boundedPositive(value: number | undefined, fallback: number, maximum: number): number {
  const output = value ?? fallback;
  if (!Number.isSafeInteger(output) || output <= 0 || output > maximum) throw new Error("invalid CAP source limit");
  return output;
}

function validateEndpoint(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname.endsWith(".localhost");
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("CAP source must use HTTPS or loopback HTTP without URL credentials");
  return url;
}

async function boundedResponse(response: Response, maximum: number): Promise<string> {
  if (!response.ok) throw new Error(`CAP source returned HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error("CAP source response exceeds size limit");
  if (!response.body) return "";
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, output = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximum) throw new Error("CAP source response exceeds size limit");
      output += decoder.decode(next.value, { stream: true });
    }
    return output + decoder.decode();
  } finally { reader.releaseLock(); }
}

function collectAlerts(value: unknown, output: RecordValue[], depth = 0): void {
  if (output.length >= MAX_ALERTS || depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) collectAlerts(item, output, depth + 1);
    return;
  }
  const row = record(value);
  if (!row) return;
  if (record(row.alert)) for (const alert of list(row.alert)) { const item = record(alert); if (item) output.push(item); }
  if (text(row.identifier) && row.info !== undefined && text(row.sender)) output.push(row);
  for (const [key, child] of Object.entries(row)) if (key !== "alert" && key !== "info") collectAlerts(child, output, depth + 1);
}

function parseCoordinatePair(value: string): [number, number] | undefined {
  const parts = value.trim().split(",").map(Number);
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || parts[0] < -90 || parts[0] > 90 || parts[1] < -180 || parts[1] > 180) return undefined;
  return [parts[1], parts[0]];
}

function polygon(value: unknown): Array<[number, number]> {
  return (text(value) || "").split(/\s+/).map(parseCoordinatePair).filter((point): point is [number, number] => !!point).slice(0, 5_000);
}

function circle(value: unknown): { center: [number, number]; radiusKm: number } | undefined {
  const match = /^(\S+)\s+([0-9]+(?:\.[0-9]+)?)$/.exec(text(value) || "");
  const center = match ? parseCoordinatePair(match[1]) : undefined, radiusKm = match ? Number(match[2]) : Number.NaN;
  return center && Number.isFinite(radiusKm) && radiusKm >= 0 ? { center, radiusKm } : undefined;
}

function centroid(points: Array<[number, number]>): GeoPoint | undefined {
  if (!points.length) return undefined;
  const [lng, lat] = points.reduce(([x, y], point) => [x + point[0], y + point[1]], [0, 0]);
  return { lat: lat / points.length, lng: lng / points.length };
}

function insidePolygon(point: GeoPoint, points: Array<[number, number]>): boolean {
  if (points.length < 3) return true;
  let inside = false;
  for (let left = 0, right = points.length - 1; left < points.length; right = left++) {
    const [xi, yi] = points[left], [xj, yj] = points[right];
    const intersects = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceKm(point: GeoPoint, center: [number, number]): number {
  const radians = Math.PI / 180, dLat = (point.lat - center[1]) * radians, dLng = (point.lng - center[0]) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(point.lat * radians) * Math.cos(center[1] * radians) * Math.sin(dLng / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function freshness(sentAt: number, now: number): ContextFreshness {
  const age = Math.max(0, now - sentAt);
  return age <= 15 * 60_000 ? "live" : age <= 6 * 60 * 60_000 ? "fresh" : "stale";
}

function matchingInfo(alert: RecordValue, locale: string | undefined): RecordValue | undefined {
  const infos = list(alert.info).map(record).filter((row): row is RecordValue => !!row);
  const language = String(locale || "").toLowerCase().split("-")[0];
  return infos.find((info) => String(text(info.language) || "").toLowerCase().startsWith(language)) || infos[0];
}

function parseCap(body: string): RecordValue[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error("CAP source XML declarations are not allowed");
  const validation = XMLValidator.validate(body);
  if (validation !== true) throw new Error("CAP source returned invalid XML");
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true, parseTagValue: false, parseAttributeValue: false }).parse(body);
  const output: RecordValue[] = [];
  collectAlerts(parsed, output);
  return [...new Map(output.map((alert) => [`${text(alert.sender)}\u0000${text(alert.identifier)}`, alert])).values()].slice(0, MAX_ALERTS);
}

export function createCapWeatherAlertSource(options: CapWeatherAlertSourceOptions): ContextSource<CapWeatherAlertData> {
  const endpoint = validateEndpoint(options.url), maxResponseBytes = boundedPositive(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 16 * 1024 * 1024);
  if (!options.sourceId || !options.label || !options.attribution || !options.authority) throw new Error("CAP source identity, attribution and authority are required");
  if (!new Set(["first_party", "audited"]).has(options.certification)) throw new Error("CAP alerts require a first-party or audited authority profile");
  return {
    descriptor: {
      id: options.sourceId,
      label: options.label,
      purposes: ["weather"],
      costClass: "free",
      transport: "http",
      certification: options.certification,
      attribution: options.attribution,
      license: "Published by the configured alerting authority; operator must review source terms",
      cachePolicy: "5 minute bounded cache",
      retentionPolicy: "No durable raw-alert retention",
      lastReviewedAt: "2026-08-01",
    },
    cacheTtlMs: boundedPositive(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS, 60 * 60_000),
    timeoutMs: options.timeoutMs,
    staleIfErrorMs: options.staleIfErrorMs,
    retry: { maxAttempts: 2, initialDelayMs: 150, maxDelayMs: 500 },
    async query(request: PersonalContextQuery, runtime: ContextSourceRuntime) {
      const response = await runtime.fetch(endpoint, { signal: runtime.signal, redirect: "error", headers: { accept: "application/cap+xml, application/xml, text/xml;q=0.9" } });
      const alerts = parseCap(await boundedResponse(response, maxResponseBytes)), now = runtime.now(), candidates: Array<ContextCandidate<CapWeatherAlertData>> = [];
      const region = typeof request.filters?.region === "string" ? request.filters.region.toLocaleLowerCase() : "";
      for (const alert of alerts) {
        const identifier = text(alert.identifier), sender = text(alert.sender), sentAt = time(alert.sent), status = text(alert.status) || "Unknown", messageType = text(alert.msgType) || "Unknown", scope = text(alert.scope) || "Unknown";
        if (!identifier || !sender || !sentAt || status.toLowerCase() !== "actual" || !["alert", "update"].includes(messageType.toLowerCase()) || scope.toLowerCase() !== "public") continue;
        const info = matchingInfo(alert, request.locale);
        if (!info) continue;
        const expiresAt = time(info.expires), effectiveAt = time(info.effective), onsetAt = time(info.onset);
        if (expiresAt !== undefined && expiresAt <= now) continue;
        if (request.startAt !== undefined && expiresAt !== undefined && expiresAt < request.startAt) continue;
        if (request.endAt !== undefined && (onsetAt || effectiveAt || sentAt) > request.endAt) continue;
        const areas = list(info.area).map(record).filter((row): row is RecordValue => !!row), areaDescription = areas.map((area) => text(area.areaDesc)).filter(Boolean).join("; ").slice(0, 2_000);
        if (region && !areaDescription.toLocaleLowerCase().includes(region)) continue;
        const polygons = areas.flatMap((area) => list(area.polygon).map(polygon)).filter((points) => points.length > 0), circles = areas.flatMap((area) => list(area.circle).map(circle)).filter((row): row is { center: [number, number]; radiusKm: number } => !!row);
        if (request.point && (polygons.length || circles.length) && !polygons.some((points) => insidePolygon(request.point!, points)) && !circles.some((item) => distanceKm(request.point!, item.center) <= item.radiusKm)) continue;
        const event = text(info.event) || "Weather alert", title = text(info.headline) || event, url = sourceUrl(info.web, endpoint.toString()), observedFreshness = freshness(sentAt, now);
        const source: ContextSourceRef = { sourceId: options.sourceId, recordId: identifier, observedAt: sentAt, freshness: observedFreshness, attribution: options.attribution, url };
        const point = polygons.length ? centroid(polygons[0]) : circles[0] ? { lat: circles[0].center[1], lng: circles[0].center[0] } : undefined;
        candidates.push({
          id: stableId(options.sourceId, sender, identifier), kind: "weather_alert", title: title.slice(0, 512),
          data: {
            identifier, sender, sentAt, status, messageType, scope, event,
            urgency: text(info.urgency) || "Unknown", severity: text(info.severity) || "Unknown", certainty: text(info.certainty) || "Unknown",
            ...(effectiveAt === undefined ? {} : { effectiveAt }), ...(onsetAt === undefined ? {} : { onsetAt }), ...(expiresAt === undefined ? {} : { expiresAt }),
            ...(areaDescription ? { areaDescription } : {}), ...(text(info.description) ? { description: text(info.description)!.slice(0, 8_192) } : {}),
            ...(text(info.instruction) ? { instruction: text(info.instruction)!.slice(0, 4_096) } : {}), ...(text(info.language) ? { language: text(info.language) } : {}),
            authority: options.authority, officialAlert: true,
          },
          ...(point ? { point } : {}), sources: [source],
        });
      }
      return candidates.slice(0, Math.min(request.limit || 20, 100));
    },
  };
}
