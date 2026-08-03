import { createHash } from "node:crypto";
import OpeningHours from "opening_hours";
import type { ContextCandidate, ContextPurpose, ContextRankingDiagnostic, ContextSourceRef, ContextSuggestion, GeoPoint, PersonalPreference, PersonalVehicleProfile } from "@jarvis/protocol";

export interface ContextRankingWeights {
  source: number;
  distance: number;
  preference: number;
  context: number;
}

export interface ContextRankingInput<T = Record<string, unknown>> {
  candidates: ContextCandidate<T>[];
  preferences?: PersonalPreference[];
  purpose?: ContextPurpose;
  locale?: string;
  origin?: GeoPoint;
  now?: number;
  limit?: number;
  weights?: Partial<ContextRankingWeights>;
}

export type ContextRankingLocale = "pt-BR" | "en" | "es";

interface ContextRankingMessages {
  preferenceConflict: (key: string) => string;
  preferenceMatch: (key: string) => string;
  distanceMeters: (distanceM: number) => string;
  distanceKilometers: (distanceKm: string) => string;
  recentSources: string;
  contextMatch: string;
  openAtRequestedTime: string;
  openingHoursUnconfirmed: string;
  restrictionsUnconfirmed: string;
  calendarFree: string;
  calendarConflict: string;
  weatherPoor: string;
  weatherMixed: string;
  vehicleCompatible: string;
  vehicleCompatibilityUnknown: string;
  outsideNominalRange: string;
  routeDuration: (minutes: number) => string;
  routeUnreachable: string;
  staleOrUnknownTimestamp: string;
  sourceMissing: string;
  sourceUnavailable: (sourceId: string) => string;
  semanticDuplicate: (candidateId: string) => string;
  explicitPreferenceAvoid: (preferenceId: string) => string;
  explicitPreferenceRequire: (preferenceId: string) => string;
  incompatibleVehicleConnector: string;
  routeDurationExceeded: string;
  knownClosedAtRequestedTime: string;
  explicitRestrictionMismatch: string;
  requiredCalendarConflict: string;
  rankLimit: string;
  requiredFilter: string;
}

const CONTEXT_RANKING_MESSAGES = {
  "pt-BR": {
    preferenceConflict: (key) => `Conflita com a preferência ${key}`,
    preferenceMatch: (key) => `Combina com a preferência ${key}`,
    distanceMeters: (distanceM) => `Fica a ${distanceM} m`,
    distanceKilometers: (distanceKm) => `Fica a ${distanceKm} km`,
    recentSources: "Fontes recentes",
    contextMatch: "Atende bem ao contexto informado",
    openAtRequestedTime: "Aberto no horário solicitado",
    openingHoursUnconfirmed: "O horário de funcionamento não pôde ser confirmado",
    restrictionsUnconfirmed: "Uma ou mais restrições informadas não puderam ser confirmadas",
    calendarFree: "Não conflita com a agenda consultada",
    calendarConflict: "Há conflito com a agenda consultada",
    weatherPoor: "O clima previsto pode prejudicar esta opção",
    weatherMixed: "A previsão do tempo ainda é incerta para esta opção",
    vehicleCompatible: "Conector compatível com o veículo selecionado",
    vehicleCompatibilityUnknown: "A compatibilidade do conector não pôde ser confirmada",
    outsideNominalRange: "Fica além da autonomia nominal informada",
    routeDuration: (minutes) => `Deslocamento estimado em ${minutes} min`,
    routeUnreachable: "A rota não pôde ser calculada; apenas a distância em linha reta está disponível",
    staleOrUnknownTimestamp: "Há dados desatualizados ou sem horário confirmado",
    sourceMissing: "A origem deste resultado não foi informada",
    sourceUnavailable: (sourceId) => `Os dados da fonte ${sourceId} não estão disponíveis`,
    semanticDuplicate: (candidateId) => `Duplicado semântico de ${candidateId}`,
    explicitPreferenceAvoid: (preferenceId) => `Conflita com a preferência explícita ${preferenceId}`,
    explicitPreferenceRequire: (preferenceId) => `Não atende à preferência explícita obrigatória ${preferenceId}`,
    incompatibleVehicleConnector: "Conector incompatível com o veículo selecionado",
    routeDurationExceeded: "Excede o tempo máximo de deslocamento",
    knownClosedAtRequestedTime: "Fechado no horário solicitado",
    explicitRestrictionMismatch: "Não atende a uma restrição explícita",
    requiredCalendarConflict: "Conflita com a agenda consultada",
    rankLimit: "Fora do limite de resultados",
    requiredFilter: "Descartado por um filtro obrigatório",
  },
  en: {
    preferenceConflict: (key) => `Conflicts with the ${key} preference`,
    preferenceMatch: (key) => `Matches the ${key} preference`,
    distanceMeters: (distanceM) => `It is ${distanceM} m away`,
    distanceKilometers: (distanceKm) => `It is ${distanceKm} km away`,
    recentSources: "Recent sources",
    contextMatch: "Matches the provided context well",
    openAtRequestedTime: "Open at the requested time",
    openingHoursUnconfirmed: "Opening hours could not be confirmed",
    restrictionsUnconfirmed: "One or more requested restrictions could not be confirmed",
    calendarFree: "Does not conflict with the checked calendar",
    calendarConflict: "Conflicts with the checked calendar",
    weatherPoor: "The forecast weather may affect this option",
    weatherMixed: "The weather forecast is still uncertain for this option",
    vehicleCompatible: "Connector is compatible with the selected vehicle",
    vehicleCompatibilityUnknown: "Connector compatibility could not be confirmed",
    outsideNominalRange: "It is beyond the stated nominal range",
    routeDuration: (minutes) => `Estimated travel time is ${minutes} min`,
    routeUnreachable: "The route could not be calculated; only straight-line distance is available",
    staleOrUnknownTimestamp: "Some data is stale or has no confirmed timestamp",
    sourceMissing: "No source was provided for this result",
    sourceUnavailable: (sourceId) => `Data from source ${sourceId} is unavailable`,
    semanticDuplicate: (candidateId) => `Semantic duplicate of ${candidateId}`,
    explicitPreferenceAvoid: (preferenceId) => `Conflicts with explicit preference ${preferenceId}`,
    explicitPreferenceRequire: (preferenceId) => `Does not satisfy required explicit preference ${preferenceId}`,
    incompatibleVehicleConnector: "Connector is incompatible with the selected vehicle",
    routeDurationExceeded: "Exceeds the maximum travel time",
    knownClosedAtRequestedTime: "Closed at the requested time",
    explicitRestrictionMismatch: "Does not satisfy an explicit restriction",
    requiredCalendarConflict: "Conflicts with the checked calendar",
    rankLimit: "Outside the result limit",
    requiredFilter: "Discarded by a required filter",
  },
  es: {
    preferenceConflict: (key) => `Entra en conflicto con la preferencia ${key}`,
    preferenceMatch: (key) => `Coincide con la preferencia ${key}`,
    distanceMeters: (distanceM) => `Está a ${distanceM} m`,
    distanceKilometers: (distanceKm) => `Está a ${distanceKm} km`,
    recentSources: "Fuentes recientes",
    contextMatch: "Se ajusta bien al contexto indicado",
    openAtRequestedTime: "Abierto a la hora solicitada",
    openingHoursUnconfirmed: "No se pudo confirmar el horario de apertura",
    restrictionsUnconfirmed: "No se pudieron confirmar una o más restricciones indicadas",
    calendarFree: "No entra en conflicto con el calendario consultado",
    calendarConflict: "Hay un conflicto con el calendario consultado",
    weatherPoor: "El clima previsto puede perjudicar esta opción",
    weatherMixed: "El pronóstico del tiempo aún es incierto para esta opción",
    vehicleCompatible: "El conector es compatible con el vehículo seleccionado",
    vehicleCompatibilityUnknown: "No se pudo confirmar la compatibilidad del conector",
    outsideNominalRange: "Está fuera de la autonomía nominal indicada",
    routeDuration: (minutes) => `Tiempo de desplazamiento estimado: ${minutes} min`,
    routeUnreachable: "No se pudo calcular la ruta; solo está disponible la distancia en línea recta",
    staleOrUnknownTimestamp: "Hay datos desactualizados o sin hora confirmada",
    sourceMissing: "No se indicó la fuente de este resultado",
    sourceUnavailable: (sourceId) => `Los datos de la fuente ${sourceId} no están disponibles`,
    semanticDuplicate: (candidateId) => `Duplicado semántico de ${candidateId}`,
    explicitPreferenceAvoid: (preferenceId) => `Entra en conflicto con la preferencia explícita ${preferenceId}`,
    explicitPreferenceRequire: (preferenceId) => `No cumple la preferencia explícita obligatoria ${preferenceId}`,
    incompatibleVehicleConnector: "El conector es incompatible con el vehículo seleccionado",
    routeDurationExceeded: "Supera el tiempo máximo de desplazamiento",
    knownClosedAtRequestedTime: "Cerrado a la hora solicitada",
    explicitRestrictionMismatch: "No cumple una restricción explícita",
    requiredCalendarConflict: "Entra en conflicto con el calendario consultado",
    rankLimit: "Fuera del límite de resultados",
    requiredFilter: "Descartado por un filtro obligatorio",
  },
} satisfies Record<ContextRankingLocale, ContextRankingMessages>;

export function normalizeContextRankingLocale(locale?: string): ContextRankingLocale {
  const language = String(locale || "").trim().toLowerCase().split(/[-_]/, 1)[0];
  if (language === "en" || language === "es") return language;
  return "pt-BR";
}

export type ContextRankingDiagnosticCode =
  | "incompatible_vehicle_connector"
  | "route_duration_exceeded"
  | "known_closed_at_requested_time"
  | "explicit_restriction_mismatch"
  | "calendar_conflict"
  | "rank_limit"
  | `semantic_duplicate_of:${string}`
  | `explicit_preference_avoid:${string}`
  | `explicit_preference_require:${string}`;

export interface LocalizedContextRankingDiagnostic extends Omit<ContextRankingDiagnostic, "reasons"> {
  reasonCodes: string[];
  reasons: string[];
}

export function localizeContextRankingDiagnosticReason(reason: string, locale?: string): string {
  const messages = CONTEXT_RANKING_MESSAGES[normalizeContextRankingLocale(locale)];
  if (reason.startsWith("semantic_duplicate_of:")) return messages.semanticDuplicate(reason.slice("semantic_duplicate_of:".length));
  if (reason.startsWith("explicit_preference_avoid:")) return messages.explicitPreferenceAvoid(reason.slice("explicit_preference_avoid:".length));
  if (reason.startsWith("explicit_preference_require:")) return messages.explicitPreferenceRequire(reason.slice("explicit_preference_require:".length));
  if (reason === "incompatible_vehicle_connector") return messages.incompatibleVehicleConnector;
  if (reason === "route_duration_exceeded") return messages.routeDurationExceeded;
  if (reason === "known_closed_at_requested_time") return messages.knownClosedAtRequestedTime;
  if (reason === "explicit_restriction_mismatch") return messages.explicitRestrictionMismatch;
  if (reason === "calendar_conflict") return messages.requiredCalendarConflict;
  if (reason === "rank_limit") return messages.rankLimit;
  return messages.requiredFilter;
}

export function localizeContextSourceUnavailable(sourceId: string, locale?: string): string {
  return CONTEXT_RANKING_MESSAGES[normalizeContextRankingLocale(locale)].sourceUnavailable(sourceId);
}

export function localizeContextRankingDiagnostics(
  diagnostics: ContextRankingDiagnostic[],
  locale?: string,
): LocalizedContextRankingDiagnostic[] {
  return diagnostics.map(({ reasons, ...diagnostic }) => ({
    ...diagnostic,
    reasonCodes: [...reasons],
    reasons: reasons.map((reason) => localizeContextRankingDiagnosticReason(reason, locale)),
  }));
}

export interface ExplicitCandidateFilterOptions {
  openAt?: number;
  timeZone?: string;
  origin?: GeoPoint;
  maximumFallbackDistanceM?: number;
  restrictions?: string[];
}

const DEFAULT_WEIGHTS: ContextRankingWeights = { source: 0.2, distance: 0.25, preference: 0.25, context: 0.3 };
const clamp = (value: number, fallback = 0): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const words = (value: unknown): string => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

interface VehicleConnectionLike {
  connectorTypeId?: unknown;
  powerKw?: unknown;
}

export function applyVehicleProfileToCandidates<T>(
  candidates: ContextCandidate<T>[],
  profile?: PersonalVehicleProfile,
  origin?: GeoPoint,
): ContextCandidate<T>[] {
  if (!profile) return candidates;
  const connectorIds = new Set(profile.connectorTypeIds);
  const preferredOperators = profile.preferredOperators.map(words);
  return candidates.map((candidate) => {
    if (candidate.kind !== "ev_charger" || !candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) return candidate;
    const copy = structuredClone(candidate) as ContextCandidate<Record<string, unknown>>;
    const data = copy.data;
    const rawConnections = Array.isArray(data.connections) ? data.connections as VehicleConnectionLike[] : [];
    const knownConnections = rawConnections.filter((connection) => Number.isSafeInteger(connection.connectorTypeId) && Number(connection.connectorTypeId) > 0);
    const compatible = knownConnections.filter((connection) => connectorIds.has(Number(connection.connectorTypeId)));
    if (knownConnections.length && !compatible.length) {
      copy.hardFailures = [...(copy.hardFailures || []), "incompatible_vehicle_connector"];
      return copy as ContextCandidate<T>;
    }
    if (compatible.length) data.connections = compatible;
    const powers = compatible.map((connection) => Number(connection.powerKw)).filter((value) => Number.isFinite(value) && value > 0);
    const stationPowerKw = powers.length ? Math.max(...powers) : undefined;
    const effectivePowerKw = stationPowerKw === undefined ? undefined : Math.min(stationPowerKw, profile.maxAcceptedPowerKw || stationPowerKw);
    const powerFit = profile.minimumPreferredPowerKw === undefined
      ? (effectivePowerKw === undefined ? 0.5 : 0.8)
      : (effectivePowerKw === undefined ? 0.25 : clamp(effectivePowerKw / profile.minimumPreferredPowerKw));
    const operator = words(data.operator);
    const operatorFit = preferredOperators.length === 0 ? 0.5 : preferredOperators.some((value) => operator.includes(value)) ? 1 : 0.35;
    const distanceM = origin && copy.point ? haversineMeters(origin, copy.point) : undefined;
    const rangeFit = profile.rangeKm === undefined || distanceM === undefined ? 0.5 : clamp(1 - Math.max(0, distanceM - profile.rangeKm * 750) / Math.max(1, profile.rangeKm * 500));
    copy.scoreParts = { ...(copy.scoreParts || {}), connectorFit: compatible.length ? 1 : 0.2, chargingPowerFit: powerFit, operatorFit, rangeFit };
    data.vehicleCompatibility = {
      profileId: profile.id,
      status: compatible.length ? "compatible" : "unknown",
      connectorTypeIds: compatible.map((connection) => Number(connection.connectorTypeId)),
      ...(effectivePowerKw === undefined ? {} : { effectivePowerKw }),
      ...(distanceM === undefined || profile.rangeKm === undefined ? {} : { withinNominalRange: distanceM <= profile.rangeKm * 1_000 }),
    };
    return copy as ContextCandidate<T>;
  });
}

export interface MultiContextCompositionInput<T = Record<string, unknown>> {
  candidates: ContextCandidate<T>[];
  purpose: ContextPurpose;
  requireCalendarFree?: boolean;
}

export function applyRouteMatrixToCandidates<T>(
  candidates: ContextCandidate<T>[],
  options: { maxDurationMinutes?: number } = {},
): ContextCandidate<T>[] {
  const matrices = candidates.filter((candidate) => candidate.kind === "route_matrix");
  if (!matrices.length) return candidates;
  const cells = matrices.flatMap((matrix) => {
    const data = record(matrix.data), raw = Array.isArray(data?.cells) ? data.cells : [];
    return raw.flatMap((value) => {
      const cell = record(value), target = record(cell?.target);
      const lat = Number(target?.lat), lng = Number(target?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ cell: cell!, target: { lat, lng }, sources: matrix.sources }] : [];
    });
  });
  return candidates.filter((candidate) => candidate.kind !== "route_matrix").map((candidate) => {
    if (!candidate.point) return candidate;
    const match = cells.find((row) => haversineMeters(candidate.point!, row.target) < 15);
    if (!match || !candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) return candidate;
    const copy = structuredClone(candidate) as ContextCandidate<Record<string, unknown>>, reachable = match.cell.reachable === true;
    const durationSeconds = Number(match.cell.durationSeconds), distanceM = Number(match.cell.distanceM);
    if (!reachable || !Number.isFinite(durationSeconds) || !Number.isFinite(distanceM)) {
      copy.data.route = { status: "unreachable" };
      copy.scoreParts = { ...(copy.scoreParts || {}), routeFit: 0.2 };
      copy.sources = mergeSourceRefs(copy.sources, match.sources);
      return copy as ContextCandidate<T>;
    }
    const mode = typeof record(matrices[0].data)?.mode === "string" ? record(matrices[0].data)!.mode : undefined;
    copy.data.routedDistanceM = distanceM;
    copy.data.durationSeconds = durationSeconds;
    copy.data.route = { status: "ready", ...(mode ? { mode } : {}) };
    copy.scoreParts = { ...(copy.scoreParts || {}), routeFit: Math.exp(-durationSeconds / 3_600) };
    copy.sources = mergeSourceRefs(copy.sources, match.sources);
    if (options.maxDurationMinutes !== undefined && durationSeconds > options.maxDurationMinutes * 60) {
      copy.hardFailures = [...(copy.hardFailures || []), "route_duration_exceeded"];
    }
    return copy as ContextCandidate<T>;
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function mergeSourceRefs(target: ContextSourceRef[], additions: ContextSourceRef[]): ContextSourceRef[] {
  const output = target.map((source) => ({ ...source }));
  for (const source of additions) {
    if (!output.some((row) => row.sourceId === source.sourceId && row.recordId === source.recordId && row.observedAt === source.observedAt)) output.push({ ...source });
  }
  return output.slice(0, 20);
}

function wallClockDate(at: number, timeZone: string): Date | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(at));
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    if (![values.year, values.month, values.day, values.hour, values.minute, values.second].every(Number.isFinite)) return undefined;
    return new Date(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  } catch { return undefined; }
}

function openingStatus(value: unknown, at: number, timeZone: string): "open" | "closed" | "unknown" {
  if (typeof value !== "string" || !value.trim()) return "unknown";
  const date = wallClockDate(at, timeZone); if (!date) return "unknown";
  try {
    const hours = new OpeningHours(value);
    if (hours.getUnknown(date)) return "unknown";
    return hours.getState(date) ? "open" : "closed";
  } catch { return "unknown"; }
}

function validTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 100) return undefined;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return value; } catch { return undefined; }
}

const RESTRICTION_TAGS: Record<string, string[]> = {
  vegan: ["diet:vegan"], vegetarian: ["diet:vegetarian"], gluten_free: ["diet:gluten_free"], halal: ["diet:halal"], kosher: ["diet:kosher"], wheelchair: ["wheelchair"],
};

function restrictionStatus(tags: Record<string, unknown>, restriction: string): "match" | "mismatch" | "unknown" {
  const keys = RESTRICTION_TAGS[restriction] || [];
  for (const key of keys) {
    const value = words(tags[key]);
    if (!value) continue;
    if (["yes", "only", "designated"].includes(value)) return "match";
    if (["no", "none"].includes(value)) return "mismatch";
    return "unknown";
  }
  return "unknown";
}

export function applyExplicitCandidateFilters<T>(candidates: ContextCandidate<T>[], options: ExplicitCandidateFilterOptions): ContextCandidate<T>[] {
  const restrictions = [...new Set((options.restrictions || []).filter((value) => value in RESTRICTION_TAGS))];
  if (options.openAt === undefined && !restrictions.length) return candidates;
  return candidates.map((candidate) => {
    if (!candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) return candidate;
    const copy = structuredClone(candidate) as ContextCandidate<Record<string, unknown>>, data = copy.data;
    const tags = record(data.tags) || {};
    const filterContext: Record<string, unknown> = {};
    if (options.openAt !== undefined) {
      const destinationTimeZone = validTimeZone(data.timeZone ?? data.timezone ?? tags.timezone);
      const fallbackTimeZone = validTimeZone(options.timeZone);
      const fallbackDistance = options.origin && candidate.point ? haversineMeters(options.origin, candidate.point) : undefined;
      const maximumFallbackDistanceM = Number.isFinite(options.maximumFallbackDistanceM)
        ? Math.max(0, Number(options.maximumFallbackDistanceM))
        : 50_000;
      const canUseFallback = !!fallbackTimeZone && (!candidate.point || (!!options.origin && fallbackDistance !== undefined && fallbackDistance <= maximumFallbackDistanceM));
      const evaluationTimeZone = destinationTimeZone || (canUseFallback ? fallbackTimeZone : undefined);
      const status = evaluationTimeZone
        ? openingStatus(data.openingHours ?? tags.opening_hours, options.openAt, evaluationTimeZone)
        : "unknown";
      filterContext.openStatus = status;
      filterContext.openTimeZone = evaluationTimeZone || "unknown";
      filterContext.openTimeZoneBasis = destinationTimeZone ? "destination" : canUseFallback ? "nearby_origin" : "unavailable";
      copy.scoreParts = { ...(copy.scoreParts || {}), openingFit: status === "open" ? 1 : status === "unknown" ? 0.45 : 0 };
      if (status === "closed") copy.hardFailures = [...(copy.hardFailures || []), "known_closed_at_requested_time"];
    }
    if (restrictions.length) {
      const statuses = Object.fromEntries(restrictions.map((restriction) => [restriction, restrictionStatus(tags, restriction)]));
      filterContext.restrictions = statuses;
      const values = Object.values(statuses);
      if (values.includes("mismatch")) copy.hardFailures = [...(copy.hardFailures || []), "explicit_restriction_mismatch"];
      copy.scoreParts = { ...(copy.scoreParts || {}), restrictionFit: values.every((value) => value === "match") ? 1 : values.includes("mismatch") ? 0 : 0.4 };
    }
    data.filterContext = filterContext;
    return copy as ContextCandidate<T>;
  });
}

function interval(candidate: ContextCandidate<unknown>): { startAt: number; endAt: number } | undefined {
  const data = record(candidate.data), startAt = Number(data?.startAt), rawEndAt = Number(data?.endAt);
  if (!Number.isFinite(startAt)) return undefined;
  return { startAt, endAt: Number.isFinite(rawEndAt) && rawEndAt > startAt ? rawEndAt : startAt + 2 * 3_600_000 };
}

function overlaps(left: { startAt: number; endAt: number }, right: { startAt: number; endAt: number }): boolean {
  return left.startAt < right.endAt && right.startAt < left.endAt;
}

function weatherAt(candidate: ContextCandidate<unknown> | undefined, at?: number): Record<string, unknown> | undefined {
  const data = record(candidate?.data); if (!data) return undefined;
  const hourly = Array.isArray(data.hourly) ? data.hourly.map(record).filter((row): row is Record<string, unknown> => !!row) : [];
  const target = at === undefined || !hourly.length ? record(data.current) : hourly.reduce<Record<string, unknown> | undefined>((best, row) => {
    const validAt = Number(row.validAt); if (!Number.isFinite(validAt)) return best;
    if (!best) return row;
    return Math.abs(validAt - at) < Math.abs(Number(best.validAt) - at) ? row : best;
  }, undefined);
  if (!target) return undefined;
  if (at !== undefined && Number.isFinite(Number(target.validAt)) && Math.abs(Number(target.validAt) - at) > 3 * 3_600_000) return undefined;
  const selected: Record<string, unknown> = {};
  for (const key of ["validAt", "temperatureC", "apparentTemperatureC", "precipitationProbabilityPercent", "precipitationMm", "rainMm", "weatherCode", "windSpeedKmh"]) {
    if (target[key] === null || typeof target[key] === "number") selected[key] = target[key];
  }
  return selected;
}

function outdoorCandidate(candidate: ContextCandidate<unknown>, purpose: ContextPurpose): boolean {
  const data = record(candidate.data);
  if (purpose === "mobility") return ["walk", "walking", "bicycle", "cycling", "bike"].includes(words(data?.mode));
  if (purpose !== "events") return false;
  return /\b(outdoor|open air|ao ar livre|extern[oa]|parque|trilha|praca)\b/.test(words(`${candidate.title} ${JSON.stringify(data?.categories || [])} ${data?.description || ""}`));
}

export function composeMultiContextCandidates<T = Record<string, unknown>>(input: MultiContextCompositionInput<T>): ContextCandidate<T>[] {
  if (!["events", "mobility"].includes(input.purpose)) return input.candidates;
  const weather = input.candidates.find((candidate) => candidate.kind === "weather_forecast") as ContextCandidate<unknown> | undefined;
  const calendar = input.candidates.filter((candidate) => candidate.kind === "calendar_availability" || candidate.kind === "calendar_event") as ContextCandidate<unknown>[];
  const supports = new Set(["weather_forecast", "calendar_availability", "calendar_event", "route_matrix"]);
  return input.candidates.filter((candidate) => !supports.has(candidate.kind)).map((candidate) => {
    const copy = structuredClone(candidate) as ContextCandidate<Record<string, unknown>>;
    if (!copy.data || typeof copy.data !== "object" || Array.isArray(copy.data)) copy.data = {};
    const time = interval(copy), context = record(copy.data.context) || {};
    if (time && calendar.length) {
      const relevant = calendar.filter((row) => { const rowTime = interval(row); return !!rowTime && overlaps(time, rowTime); });
      const busy = relevant.filter((row) => row.kind === "calendar_event" || record(row.data)?.availability === "busy");
      const free = relevant.find((row) => {
        const rowTime = interval(row); return rowTime && record(row.data)?.availability === "free" && rowTime.startAt <= time.startAt && rowTime.endAt >= time.endAt;
      });
      const status = busy.length ? "busy" : free ? "free" : "unknown";
      context.calendar = { status, conflicts: busy.length, complete: calendar.every((row) => record(row.data)?.complete !== false) };
      copy.scoreParts = { ...(copy.scoreParts || {}), calendarFit: status === "free" ? 1 : status === "busy" ? 0.1 : 0.5 };
      copy.sources = mergeSourceRefs(copy.sources, (relevant.length ? relevant : calendar).flatMap((row) => row.sources));
      if (input.requireCalendarFree && status === "busy") copy.hardFailures = [...(copy.hardFailures || []), "calendar_conflict"];
    }
    const forecast = weatherAt(weather, time?.startAt);
    if (forecast) {
      const probability = Number(forecast.precipitationProbabilityPercent), precipitation = Number(forecast.precipitationMm), rain = Number(forecast.rainMm);
      const wet = (Number.isFinite(probability) && probability >= 70) || (Number.isFinite(precipitation) && precipitation >= 5) || (Number.isFinite(rain) && rain >= 5);
      const uncertain = !wet && ((Number.isFinite(probability) && probability >= 40) || (Number.isFinite(precipitation) && precipitation >= 1) || (Number.isFinite(rain) && rain >= 1));
      const applies = outdoorCandidate(copy, input.purpose), suitability = wet ? "poor" : uncertain ? "mixed" : "good";
      context.weather = { suitability, appliesToCandidate: applies, ...forecast };
      if (applies) copy.scoreParts = { ...(copy.scoreParts || {}), weatherFit: wet ? 0.15 : uncertain ? 0.5 : 0.9 };
      copy.sources = mergeSourceRefs(copy.sources, weather?.sources || []);
    }
    if (Object.keys(context).length) copy.data.context = context;
    return copy as ContextCandidate<T>;
  });
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(x)));
}

function sourceScore(sources: ContextSourceRef[], now: number): number {
  if (!sources.length) return 0.25;
  const score = sources.reduce((sum, source) => {
    const freshness = source.freshness === "live" ? 1 : source.freshness === "fresh" ? 0.85 : source.freshness === "stale" ? 0.35 : 0.2;
    const ageHours = Math.max(0, now - source.observedAt) / 3_600_000;
    return sum + freshness * Math.exp(-ageHours / 168);
  }, 0) / sources.length;
  return clamp(score);
}

function preferenceMatches<T>(candidate: ContextCandidate<T>, preference: PersonalPreference): boolean {
  const needle = words(preference.value).trim();
  if (!needle) return false;
  const data = record(candidate.data), tags = record(data?.tags);
  const direct = [data?.[preference.key], tags?.[preference.key]].flatMap((value) => Array.isArray(value) ? value : [value]);
  if (direct.some((value) => words(value).includes(needle))) return true;
  return words(`${candidate.title} ${JSON.stringify(candidate.data)}`).includes(needle);
}

function effectivePreferenceConfidence(preference: PersonalPreference, now: number): number {
  const base = clamp(preference.confidence);
  if (preference.kind !== "inferred") return base;
  const age = Math.max(0, now - preference.updatedAt);
  return clamp(base * Math.exp(-age / (90 * 86_400_000)));
}

function activePreferences(preferences: PersonalPreference[], now: number, purpose?: ContextPurpose): PersonalPreference[] {
  return preferences.filter((preference) => preference.decision !== "rejected"
    && (!preference.expiresAt || preference.expiresAt > now)
    && (!purpose || preference.purposes.includes(purpose)));
}

function explicitPreferenceFailures<T>(candidate: ContextCandidate<T>, preferences: PersonalPreference[]): { failures: string[]; preferenceIds: string[] } {
  const failures: string[] = [], preferenceIds: string[] = [];
  for (const preference of preferences) {
    if (preference.kind !== "explicit") continue;
    const matches = preferenceMatches(candidate, preference);
    if (preference.polarity === "avoid" && matches) { failures.push(`explicit_preference_avoid:${preference.id}`); preferenceIds.push(preference.id); }
    if (preference.polarity === "require" && !matches) { failures.push(`explicit_preference_require:${preference.id}`); preferenceIds.push(preference.id); }
  }
  return { failures, preferenceIds };
}

function preferenceScore<T>(candidate: ContextCandidate<T>, preferences: PersonalPreference[], now: number, messages: ContextRankingMessages): { score: number; reasons: string[]; preferenceIds: string[] } {
  if (!preferences.length) return { score: 0.5, reasons: [], preferenceIds: [] };
  let influence = 0, matches = 0; const reasons: string[] = [], preferenceIds: string[] = [];
  for (const preference of preferences) {
    if (!preferenceMatches(candidate, preference)) continue;
    const confidence = effectivePreferenceConfidence(preference, now);
    if (confidence <= 0) continue;
    matches += 1;
    preferenceIds.push(preference.id);
    influence += preference.polarity === "avoid" ? -confidence : preference.polarity === "require" ? confidence : confidence * 0.9;
    reasons.push(preference.polarity === "avoid" ? messages.preferenceConflict(preference.key) : messages.preferenceMatch(preference.key));
  }
  return matches ? { score: clamp(0.5 + influence / (2 * matches)), reasons, preferenceIds } : { score: 0.5, reasons: [], preferenceIds: [] };
}

function normalizedWeights(input?: Partial<ContextRankingWeights>): ContextRankingWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...(input || {}) };
  for (const key of Object.keys(merged) as Array<keyof ContextRankingWeights>) merged[key] = Math.max(0, Number(merged[key]) || 0);
  const total = Object.values(merged).reduce((sum, value) => sum + value, 0) || 1;
  return { source: merged.source / total, distance: merged.distance / total, preference: merged.preference / total, context: merged.context / total };
}

function deduplicate<T>(candidates: ContextCandidate<T>[]): { kept: ContextCandidate<T>[]; diagnostics: ContextRankingDiagnostic[] } {
  const kept: ContextCandidate<T>[] = [];
  const diagnostics: ContextRankingDiagnostic[] = [];
  for (const candidate of candidates) {
    const duplicate = kept.find((row) => row.kind === candidate.kind && words(row.title) === words(candidate.title)
      && (!row.point || !candidate.point || haversineMeters(row.point, candidate.point) < 75));
    if (!duplicate) kept.push(candidate);
    else {
      duplicate.sources = [...duplicate.sources, ...candidate.sources.filter((source) => !duplicate.sources.some((current) => current.sourceId === source.sourceId && current.recordId === source.recordId))];
      diagnostics.push({ candidateId: candidate.id, kind: candidate.kind, status: "discarded", reasons: [`semantic_duplicate_of:${duplicate.id}`] });
    }
  }
  return { kept, diagnostics };
}

export interface ContextRankingResult<T = Record<string, unknown>> {
  suggestions: ContextSuggestion<T>[];
  diagnostics: ContextRankingDiagnostic[];
  usedPreferenceIds: string[];
}

export function rankContextCandidatesDetailed<T = Record<string, unknown>>(input: ContextRankingInput<T>): ContextRankingResult<T> {
  const now = input.now ?? Date.now(), weights = normalizedWeights(input.weights), preferences = activePreferences(input.preferences || [], now, input.purpose);
  const messages = CONTEXT_RANKING_MESSAGES[normalizeContextRankingLocale(input.locale)];
  const suggestions: ContextSuggestion<T>[] = [], usedPreferenceIds = new Set<string>();
  const deduplicated = deduplicate(input.candidates), diagnostics = [...deduplicated.diagnostics];
  for (const candidate of deduplicated.kept) {
    const explicit = explicitPreferenceFailures(candidate, preferences);
    explicit.preferenceIds.forEach((id) => usedPreferenceIds.add(id));
    const failures = [...(candidate.hardFailures || []), ...explicit.failures];
    if (failures.length) {
      diagnostics.push({ candidateId: candidate.id, kind: candidate.kind, status: "discarded", reasons: [...new Set(failures)].slice(0, 20) });
      continue;
    }
    const source = sourceScore(candidate.sources, now);
    const distanceM = input.origin && candidate.point ? haversineMeters(input.origin, candidate.point) : undefined;
    const distance = distanceM === undefined ? 0.5 : Math.exp(-distanceM / 10_000);
    const preference = preferenceScore(candidate, preferences, now, messages);
    preference.preferenceIds.forEach((id) => usedPreferenceIds.add(id));
    const explicitParts = Object.values(candidate.scoreParts || {}).map((value) => clamp(value));
    const context = explicitParts.length ? explicitParts.reduce((sum, value) => sum + value, 0) / explicitParts.length : 0.5;
    const score = clamp(source * weights.source + distance * weights.distance + preference.score * weights.preference + context * weights.context);
    const reasons = [...preference.reasons];
    if (distanceM !== undefined) reasons.push(distanceM < 1_000 ? messages.distanceMeters(Math.round(distanceM)) : messages.distanceKilometers((distanceM / 1_000).toFixed(1)));
    if (source >= 0.75) reasons.push(messages.recentSources);
    if (context >= 0.7) reasons.push(messages.contextMatch);
    const caveats: string[] = [];
    const candidateData = record(candidate.data), contextual = record(candidateData?.context), calendarContext = record(contextual?.calendar), weatherContext = record(contextual?.weather), vehicleContext = record(candidateData?.vehicleCompatibility);
    const filterContext = record(candidateData?.filterContext), restrictionContext = record(filterContext?.restrictions);
    if (filterContext?.openStatus === "open") reasons.push(messages.openAtRequestedTime);
    if (filterContext?.openStatus === "unknown") caveats.push(messages.openingHoursUnconfirmed);
    if (restrictionContext && Object.values(restrictionContext).some((value) => value === "unknown")) caveats.push(messages.restrictionsUnconfirmed);
    if (calendarContext?.status === "free") reasons.push(messages.calendarFree);
    if (calendarContext?.status === "busy") caveats.push(messages.calendarConflict);
    if (weatherContext?.appliesToCandidate === true && weatherContext.suitability === "poor") caveats.push(messages.weatherPoor);
    if (weatherContext?.appliesToCandidate === true && weatherContext.suitability === "mixed") caveats.push(messages.weatherMixed);
    if (vehicleContext?.status === "compatible") reasons.push(messages.vehicleCompatible);
    if (vehicleContext?.status === "unknown") caveats.push(messages.vehicleCompatibilityUnknown);
    if (vehicleContext?.withinNominalRange === false) caveats.push(messages.outsideNominalRange);
    const routeContext = record(candidateData?.route), routeDuration = Number(candidateData?.durationSeconds);
    if (routeContext?.status === "ready" && Number.isFinite(routeDuration)) reasons.push(messages.routeDuration(Math.max(1, Math.round(routeDuration / 60))));
    if (routeContext?.status === "unreachable") caveats.push(messages.routeUnreachable);
    if (candidate.sources.some((item) => item.freshness === "stale" || item.freshness === "unknown")) caveats.push(messages.staleOrUnknownTimestamp);
    if (!candidate.sources.length) caveats.push(messages.sourceMissing);
    const stableId = createHash("sha256").update(JSON.stringify([candidate.kind, candidate.id, candidate.sources.map((source) => [source.sourceId, source.recordId, source.observedAt])])).digest("hex").slice(0, 24);
    suggestions.push({ id: `suggestion:${stableId}`, kind: candidate.kind, candidate, score, reasons: reasons.slice(0, 4), caveats, sources: candidate.sources, actions: [] });
  }
  const ranked = suggestions.sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title));
  const limit = Math.max(1, Math.min(50, input.limit || 10));
  for (const omitted of ranked.slice(limit)) diagnostics.push({ candidateId: omitted.candidate.id, kind: omitted.candidate.kind, status: "discarded", reasons: ["rank_limit"] });
  return { suggestions: ranked.slice(0, limit), diagnostics, usedPreferenceIds: [...usedPreferenceIds].sort() };
}

export function rankContextCandidates<T = Record<string, unknown>>(input: ContextRankingInput<T>): ContextSuggestion<T>[] {
  return rankContextCandidatesDetailed(input).suggestions;
}

export interface PreferenceSignal {
  id: string;
  principalId: string;
  key: string;
  value: string;
  polarity: PersonalPreference["polarity"];
  at: number;
  summary: string;
  sourceId?: string;
  evidenceKind?: PersonalPreference["evidence"][number]["kind"];
  purposes?: ContextPurpose[];
}

export function inferPreferences(signals: PreferenceSignal[], now = Date.now(), minimumEvidence = 3): PersonalPreference[] {
  const groups = new Map<string, PreferenceSignal[]>();
  for (const signal of signals) {
    const key = `${signal.principalId}\u0000${words(signal.key)}\u0000${words(signal.value)}\u0000${signal.polarity}`;
    const group = groups.get(key) || []; group.push(signal); groups.set(key, group);
  }
  const preferences: PersonalPreference[] = [];
  for (const group of groups.values()) {
    if (group.length < minimumEvidence) continue;
    group.sort((a, b) => a.at - b.at); const latest = group.at(-1)!;
    const recency = Math.exp(-Math.max(0, now - latest.at) / (90 * 86_400_000));
    const confidence = clamp((1 - Math.exp(-group.length / 4)) * recency);
    preferences.push({
      id: `inferred:${createStablePreferenceId(latest)}`, principalId: latest.principalId, kind: "inferred", key: latest.key,
      value: latest.value, polarity: latest.polarity, confidence,
      evidence: group.slice(-10).map((signal) => ({ id: signal.id, kind: signal.evidenceKind || (signal.polarity === "avoid" ? "dismissal" : "choice"), at: signal.at, summary: signal.summary, sourceId: signal.sourceId })),
      purposes: [...new Set(group.flatMap((signal): ContextPurpose[] => signal.purposes || ["nearby", "events"]))], createdAt: group[0].at, updatedAt: latest.at, expiresAt: latest.at + 180 * 86_400_000,
    });
  }
  return preferences;
}

function createStablePreferenceId(signal: PreferenceSignal): string {
  return words(`${signal.principalId}:${signal.key}:${signal.value}:${signal.polarity}`).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}
