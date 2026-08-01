import {
  PERSONAL_CONTEXT_SCHEMA_VERSION,
  type ContextPurpose,
  type GeoPoint,
  type PersonalAssistantSettings,
  type PersonalConsent,
  type PersonalContextState,
  type PersonalLocationPrecision,
} from "@jarvis/protocol";

const PURPOSES = new Set<ContextPurpose>(["nearby", "mobility", "calendar", "events", "weather", "automation"]);

export function defaultPersonalAssistantSettings(principalId: string, now = Date.now()): PersonalAssistantSettings {
  return {
    schemaVersion: PERSONAL_CONTEXT_SCHEMA_VERSION,
    principalId,
    enabled: false,
    paused: false,
    pausedSourceIds: [],
    locationMode: "off",
    locationPrecision: "approximate",
    retention: {
      observationsDays: 14,
      decisionsDays: 30,
      inferredPreferencesDays: 90,
      keepRawLocation: false,
    },
    notifications: {
      quietStart: "22:00",
      quietEnd: "08:00",
      maxPerDay: 4,
      cooldownMinutes: 120,
      minScore: 0.72,
    },
    updatedAt: now,
  };
}

export function emptyPersonalContextState(principalId: string, now = Date.now()): PersonalContextState {
  return {
    schemaVersion: PERSONAL_CONTEXT_SCHEMA_VERSION,
    principalId,
    revision: 0,
    settings: defaultPersonalAssistantSettings(principalId, now),
    deviceProfiles: [],
    vehicleProfiles: [],
    consents: [],
    favorites: [],
    preferences: [],
    observations: [],
    actions: [],
    sources: [],
    sourceStatuses: [],
    notifications: [],
    updatedAt: now,
  };
}

export function validContextPurpose(value: unknown): value is ContextPurpose {
  return typeof value === "string" && PURPOSES.has(value as ContextPurpose);
}

export function normalizeGeoPoint(point: GeoPoint, precision: PersonalLocationPrecision): GeoPoint {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) {
    throw new Error("invalid geographic coordinates");
  }
  const digits = precision === "precise" ? 6 : 2;
  const normalized: GeoPoint = {
    lat: Number(point.lat.toFixed(digits)),
    lng: Number(point.lng.toFixed(digits)),
  };
  if (Number.isFinite(point.accuracyM) && (point.accuracyM || 0) >= 0) normalized.accuracyM = precision === "precise" ? point.accuracyM : Math.max(1_000, point.accuracyM || 0);
  return normalized;
}

export function activeConsent(
  state: Pick<PersonalContextState, "settings" | "consents">,
  request: { principalId: string; sourceId: string; purpose: ContextPurpose; fields?: string[]; exactFields?: string[]; deviceId?: string },
  now = Date.now(),
): PersonalConsent | undefined {
  if (!state.settings.enabled || state.settings.paused || state.settings.pausedSourceIds?.includes(request.sourceId)) return undefined;
  return state.consents.find((consent) =>
    consent.principalId === request.principalId
    && consent.sourceId === request.sourceId
    && !consent.revokedAt
    && (!consent.expiresAt || consent.expiresAt > now)
    && (!consent.deviceId || consent.deviceId === request.deviceId)
    && consent.purposes.includes(request.purpose)
    && (request.fields || []).every((field) => consent.fields.includes("*") || consent.fields.includes(field))
    && (request.exactFields || []).every((field) => consent.fields.includes(field)),
  );
}

export function assertPersonalContextAccess(
  state: Pick<PersonalContextState, "settings" | "consents">,
  request: { principalId: string; sourceId: string; purpose: ContextPurpose; fields?: string[]; exactFields?: string[]; deviceId?: string },
  now = Date.now(),
): PersonalConsent {
  const consent = activeConsent(state, request, now);
  if (!consent) throw new Error(`personal context access denied for ${request.sourceId}:${request.purpose}`);
  return consent;
}

export function isQuietTime(now: Date, start: string, end: string): boolean {
  const parse = (value: string): number | undefined => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return undefined;
    const hours = Number(match[1]), minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : undefined;
  };
  const from = parse(start), to = parse(end);
  if (from === undefined || to === undefined || from === to) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return from < to ? current >= from && current < to : current >= from || current < to;
}
