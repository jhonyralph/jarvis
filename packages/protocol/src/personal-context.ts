export const PERSONAL_CONTEXT_SCHEMA_VERSION = 1 as const;

export type ContextPurpose = "nearby" | "mobility" | "calendar" | "events" | "weather" | "automation";
export type ContextFreshness = "live" | "fresh" | "stale" | "unknown";
export type ContextCostClass = "local" | "free";
export type ContextSourceState = "ready" | "degraded" | "offline" | "paused" | "unconfigured" | "uncertified";
export type PersonalLocationMode = "off" | "foreground" | "background";
export type PersonalLocationPrecision = "approximate" | "precise";
export type PersonalMemoryKind = "explicit" | "inferred";
export type PersonalFeedbackKind = "like" | "dislike" | "remember" | "avoid";
export type PersonalDataCategory = "observations" | "preferences" | "favorites" | "vehicle_profiles" | "actions" | "notifications" | "sources" | "consents" | "device_profiles";
export type PersonalActionRisk = "read" | "local_reversible" | "external_reversible" | "consequential";
export type PersonalActionState = "pending" | "approved" | "running" | "succeeded" | "failed" | "cancelled" | "expired" | "uncertain";
export type PersonalSourceType = "device_location" | "device_calendar" | "nominatim" | "valhalla" | "osm" | "open_charge_map" | "open_meteo" | "weather_alerts" | "mapas_culturais" | "open_events" | "caldav" | "mcp_http" | "mcp_stdio" | "home_assistant";

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
}

export interface ContextSourceRef {
  sourceId: string;
  recordId?: string;
  observedAt: number;
  freshness: ContextFreshness;
  attribution?: string;
  url?: string;
}

export interface PersonalConsent {
  id: string;
  principalId: string;
  sourceId: string;
  purposes: ContextPurpose[];
  fields: string[];
  deviceId?: string;
  policyVersion?: number;
  grantedAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

export interface PersonalRetentionPolicy {
  observationsDays: number;
  decisionsDays: number;
  inferredPreferencesDays: number;
  keepRawLocation: boolean;
}

export interface PersonalNotificationPolicy {
  quietStart: string;
  quietEnd: string;
  maxPerDay: number;
  cooldownMinutes: number;
  minScore: number;
}

export interface PersonalDeviceProfile {
  deviceId: string;
  locale: string;
  timeZone: string;
  proactiveEnabled: boolean;
  disabledProactiveKinds?: string[];
  notifications?: PersonalNotificationPolicy;
  updatedAt: number;
}

export interface PersonalVehicleProfile {
  id: string;
  principalId: string;
  label: string;
  connectorTypeIds: number[];
  maxAcceptedPowerKw?: number;
  rangeKm?: number;
  minimumPreferredPowerKw?: number;
  preferredOperators: string[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalAssistantSettings {
  schemaVersion: typeof PERSONAL_CONTEXT_SCHEMA_VERSION;
  principalId: string;
  enabled: boolean;
  paused: boolean;
  /** Sources suspended without revoking consent or deleting their configuration. */
  pausedSourceIds?: string[];
  locationMode: PersonalLocationMode;
  locationPrecision: PersonalLocationPrecision;
  retention: PersonalRetentionPolicy;
  notifications: PersonalNotificationPolicy;
  updatedAt: number;
}

export interface FavoritePlace {
  id: string;
  principalId: string;
  label: string;
  aliases: string[];
  point: GeoPoint;
  address?: string;
  source?: ContextSourceRef;
  purposes: ContextPurpose[];
  geofenceRadiusM?: number;
  geofenceTransitions?: Array<"enter" | "exit">;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalPreferenceEvidence {
  id: string;
  kind: "statement" | "choice" | "dismissal" | "visit_summary" | "correction";
  at: number;
  summary: string;
  sourceId?: string;
}

export interface PersonalPreference {
  id: string;
  principalId: string;
  kind: PersonalMemoryKind;
  key: string;
  value: string;
  polarity: "prefer" | "avoid" | "require";
  confidence: number;
  evidence: PersonalPreferenceEvidence[];
  purposes: ContextPurpose[];
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  decision?: "confirmed" | "corrected" | "rejected";
  decisionAt?: number;
  /** Last time this preference materially affected filtering or ranking. */
  lastUsedAt?: number;
}

export interface ContextObservation {
  id: string;
  principalId: string;
  sourceId: string;
  kind: string;
  purpose: ContextPurpose;
  observedAt: number;
  expiresAt: number;
  value: Record<string, unknown>;
  source: ContextSourceRef;
}

export interface ContextSnapshot {
  schemaVersion: typeof PERSONAL_CONTEXT_SCHEMA_VERSION;
  principalId: string;
  purpose: ContextPurpose;
  generatedAt: number;
  expiresAt: number;
  fields: Record<string, unknown>;
  sources: ContextSourceRef[];
}

export interface ContextCandidate<T = Record<string, unknown>> {
  id: string;
  kind: string;
  title: string;
  data: T;
  point?: GeoPoint;
  hardFailures?: string[];
  scoreParts?: Record<string, number>;
  sources: ContextSourceRef[];
}

export interface ContextSuggestion<T = Record<string, unknown>> {
  id: string;
  kind: string;
  candidate: ContextCandidate<T>;
  score: number;
  reasons: string[];
  caveats: string[];
  sources: ContextSourceRef[];
  actions: PersonalActionView[];
}

export interface PersonalActionPlan {
  id: string;
  principalId: string;
  idempotencyKey: string;
  kind: string;
  risk: PersonalActionRisk;
  executorFingerprint?: string;
  sourceId?: string;
  authorizationConsentId?: string;
  authorizationPurpose?: ContextPurpose;
  authorizationDeviceId?: string;
  preview: Record<string, unknown>;
  payload: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  state: PersonalActionState;
  requiresConfirmation?: boolean;
  approvalDigest?: string;
  confirmationChallenge?: string;
  approvedByDeviceId?: string;
  approvedAt?: number;
  /** The server is waiting for the initiating client to confirm a local handoff. */
  awaitingClientAck?: boolean;
  /** Device allowed to acknowledge the client-side handoff. */
  executionDeviceId?: string;
  /** Deadline after which an unacknowledged handoff is reconciled as uncertain. */
  clientAckExpiresAt?: number;
  completedAt?: number;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ContextSourceDescriptor {
  id: string;
  label: string;
  purposes: ContextPurpose[];
  costClass: ContextCostClass;
  transport: "builtin" | "http" | "stdio" | "device";
  certification: "first_party" | "audited" | "uncertified";
  attribution?: string;
  license?: string;
  cachePolicy?: string;
  /** Optional only for descriptors persisted before retention metadata was introduced. */
  retentionPolicy?: string;
  /** ISO 8601 full-date when license/retention metadata was reviewed; optional for legacy descriptors. */
  lastReviewedAt?: string;
}

export interface ContextSourceStatus {
  descriptor: ContextSourceDescriptor;
  state: ContextSourceState;
  checkedAt: number;
  lastSuccessAt?: number;
  latencyMs?: number;
  failures: number;
  message?: string;
}

export interface PersonalSourceConnection {
  id: string;
  principalId: string;
  type: PersonalSourceType;
  label: string;
  enabled: boolean;
  endpoint?: string;
  secretRef?: string;
  config: Record<string, string | number | boolean | string[]>;
  allowedResources: string[];
  allowedActions: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PersonalStdioEnvironmentPatch {
  /** Values to create or replace. Existing values are never returned to the client. */
  set: Record<string, string>;
  /** Names to remove while preserving every unmentioned value. */
  remove: string[];
}

export type PersonalSourceInput = Omit<PersonalSourceConnection, "principalId" | "createdAt" | "updatedAt"> & {
  stdioEnv?: PersonalStdioEnvironmentPatch;
};

export type PersonalSourceView = Omit<PersonalSourceConnection, "secretRef"> & {
  hasSecret: boolean;
  configuredEnvNames: string[];
};

export const PERSONAL_SOURCE_DISCOVERY_LIMITS = Object.freeze({
  calendars: 100,
  tools: 100,
  resources: 100,
} as const);

export type PersonalSourceDiscoveryState = "ready" | "awaiting_start" | "disconnected" | "connecting" | "connected" | "closing";
export type PersonalSourceDiscoveryHealth = "unknown" | "healthy" | "unhealthy";

export interface PersonalSourceDiscoveryCalendar {
  id: string;
  name?: string;
  href: string;
  allowed: boolean;
}

export interface PersonalSourceDiscoveryTool {
  id: string;
  name: string;
  description?: string;
  allowed: boolean;
  advertised: boolean;
}

export interface PersonalSourceDiscoveryResource {
  id: string;
  name?: string;
  description?: string;
  href: string;
  mime?: string;
  allowed: boolean;
  advertised: boolean;
}

/** Bounded metadata returned only after an owner explicitly requests source discovery. */
export interface PersonalSourceDiscovery {
  sourceId: string;
  state: PersonalSourceDiscoveryState;
  health: PersonalSourceDiscoveryHealth;
  latencyMs?: number;
  calendars: PersonalSourceDiscoveryCalendar[];
  tools: PersonalSourceDiscoveryTool[];
  resources: PersonalSourceDiscoveryResource[];
  truncated: {
    calendars: boolean;
    tools: boolean;
    resources: boolean;
  };
}

/** Produce the only source representation that may cross the Hub/client boundary. */
export function toPersonalSourceView(source: PersonalSourceConnection): PersonalSourceView {
  const { secretRef, ...visible } = source;
  const configuredEnvNames: string[] = [];
  const config: PersonalSourceConnection["config"] = {};
  for (const [key, value] of Object.entries(source.config || {})) {
    const match = /^env\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(key);
    if (match) { configuredEnvNames.push(match[1]); continue; }
    config[key] = Array.isArray(value) ? [...value] : value;
  }
  return {
    ...visible,
    config,
    configuredEnvNames: [...new Set(configuredEnvNames)].sort(),
    hasSecret: !!secretRef,
  };
}

export interface PersonalContextExport {
  schemaVersion: typeof PERSONAL_CONTEXT_SCHEMA_VERSION;
  exportedAt: number;
  settings: PersonalAssistantSettings;
  deviceProfiles: PersonalDeviceProfile[];
  vehicleProfiles: PersonalVehicleProfile[];
  consents: PersonalConsent[];
  favorites: FavoritePlace[];
  preferences: PersonalPreference[];
  observations: ContextObservation[];
  sources: PersonalSourceView[];
  sourceStatuses: ContextSourceStatus[];
  notifications: PersonalNotificationRecord[];
  actions: Array<Omit<PersonalActionPlan, "payload" | "confirmationChallenge">>;
}

export type PersonalActionView = Omit<PersonalActionPlan, "payload">;

export interface PersonalNotificationRecord {
  id: string;
  principalId: string;
  suggestionId: string;
  channel: "in_app" | "push" | "voice";
  outcome: "pending" | "shown" | "opened" | "ignored" | "dismissed" | "acted" | "suppressed" | "delivery_failed";
  reason?: string;
  kind?: string;
  deviceId?: string;
  title?: string;
  body?: string;
  deepLink?: string;
  expiresAt?: number;
  dedupeKey?: string;
  dedupeUntil?: number;
  at: number;
}

export interface PersonalFeedbackInput {
  id: string;
  suggestionId: string;
  purpose: ContextPurpose;
  kind: PersonalFeedbackKind;
  key: string;
  value: string;
  sourceId?: string;
}

export interface PersonalContextState {
  schemaVersion: typeof PERSONAL_CONTEXT_SCHEMA_VERSION;
  principalId: string;
  revision: number;
  settings: PersonalAssistantSettings;
  deviceProfiles: PersonalDeviceProfile[];
  vehicleProfiles: PersonalVehicleProfile[];
  consents: PersonalConsent[];
  favorites: FavoritePlace[];
  preferences: PersonalPreference[];
  observations: ContextObservation[];
  actions: PersonalActionPlan[];
  sources: PersonalSourceConnection[];
  sourceStatuses: ContextSourceStatus[];
  notifications: PersonalNotificationRecord[];
  updatedAt: number;
}

export interface PersonalContextQuery {
  principalId: string;
  purpose: ContextPurpose;
  deviceId?: string;
  point?: GeoPoint;
  text?: string;
  locale?: string;
  startAt?: number;
  endAt?: number;
  limit?: number;
  filters?: Record<string, string | number | boolean | string[]>;
}

export interface DeviceLocationObservation {
  observedAt: number;
  expiresAt: number;
  point: GeoPoint;
  precision: PersonalLocationPrecision | "unknown";
  source: "web" | "android" | "ios";
}

export interface DeviceCalendarBusyInterval {
  startAt: number;
  endAt: number;
  allDay: boolean;
}

export interface DeviceCalendarObservation {
  observedAt: number;
  expiresAt: number;
  rangeStartAt: number;
  rangeEndAt: number;
  timeZone: string;
  intervals: DeviceCalendarBusyInterval[];
  truncated: boolean;
  source: "android" | "ios";
}

export interface DeviceGeofenceTransitionObservation {
  id: string;
  geofenceId: string;
  transition: "enter" | "exit";
  occurredAt: number;
  recordedAt: number;
  source: "android" | "ios";
}

export interface ContextSourceResult<T = Record<string, unknown>> {
  sourceId: string;
  items: ContextCandidate<T>[];
  fetchedAt: number;
  expiresAt: number;
  freshness: ContextFreshness;
  fromCache: boolean;
  warning?: string;
}

export interface PersonalContextView {
  schemaVersion: typeof PERSONAL_CONTEXT_SCHEMA_VERSION;
  revision: number;
  settings: PersonalAssistantSettings;
  deviceProfiles: PersonalDeviceProfile[];
  vehicleProfiles: PersonalVehicleProfile[];
  consents: PersonalConsent[];
  favorites: FavoritePlace[];
  preferences: PersonalPreference[];
  sources: PersonalSourceView[];
  sourceStatuses: ContextSourceStatus[];
  deviceContext: PersonalDeviceContextView;
  actions: PersonalActionView[];
  dataSummary: {
    observations: number;
    explicitPreferences: number;
    inferredPreferences: number;
    actions: number;
    categories: PersonalDataSummaryCategory[];
  };
  updatedAt: number;
}

export interface PersonalDeviceContextView {
  deviceId: string;
  location?: {
    observedAt: number;
    expiresAt: number;
    precision: PersonalLocationPrecision | "unknown";
    source: "web" | "android" | "ios" | "unknown";
    status: "fresh" | "expired";
    needsSync: boolean;
  };
  calendar?: {
    observedAt: number;
    expiresAt: number;
    rangeStartAt: number;
    rangeEndAt: number;
    timeZone?: string;
    busyIntervals: number;
    truncated: boolean;
    source: "android" | "ios" | "unknown";
    status: "fresh" | "expired";
    needsSync: boolean;
  };
}

export interface PersonalDataSummaryCategory {
  category: PersonalDataCategory;
  count: number;
  sourceIds: string[];
  retentionDays?: number;
  lastUpdatedAt?: number;
}

export type PersonalClientToHub =
  | { t: "personal_context_get"; requestId: string }
  | { t: "personal_context_update"; requestId: string; revision: number; patch: Partial<Pick<PersonalAssistantSettings, "enabled" | "paused" | "pausedSourceIds" | "locationMode" | "locationPrecision" | "retention" | "notifications">> }
  | { t: "personal_device_update"; requestId: string; revision: number; profile: Omit<PersonalDeviceProfile, "deviceId" | "updatedAt"> }
  | { t: "personal_notification_feedback"; requestId: string; notificationId: string; outcome: "opened" | "ignored" | "dismissed" | "acted"; disableKind?: boolean }
  | { t: "personal_vehicle_put"; requestId: string; revision: number; profile: Omit<PersonalVehicleProfile, "principalId" | "createdAt" | "updatedAt"> }
  | { t: "personal_vehicle_delete"; requestId: string; revision: number; profileId: string }
  | { t: "personal_consent_put"; requestId: string; revision: number; consent: Omit<PersonalConsent, "principalId" | "grantedAt" | "revokedAt"> }
  | { t: "personal_consent_revoke"; requestId: string; revision: number; consentId: string }
  | { t: "personal_location_put"; requestId: string; observation: DeviceLocationObservation; purpose: ContextPurpose }
  | { t: "personal_calendar_put"; requestId: string; observation: DeviceCalendarObservation }
  | { t: "personal_device_context_clear"; requestId: string; kind: "location" | "calendar" }
  | { t: "personal_geofence_transition_put"; requestId: string; purpose: ContextPurpose; observation: DeviceGeofenceTransitionObservation }
  | { t: "personal_favorite_put"; requestId: string; revision: number; favorite: Omit<FavoritePlace, "principalId" | "createdAt" | "updatedAt"> }
  | { t: "personal_favorite_delete"; requestId: string; revision: number; favoriteId: string }
  | { t: "personal_preference_put"; requestId: string; revision: number; preference: Omit<PersonalPreference, "principalId" | "createdAt" | "updatedAt" | "kind" | "decision" | "decisionAt" | "lastUsedAt"> }
  | { t: "personal_preference_delete"; requestId: string; revision: number; preferenceId: string }
  | { t: "personal_preference_decision"; requestId: string; revision: number; preferenceId: string; decision: "confirm" | "correct" | "reject"; correction?: { key: string; value: string; polarity: PersonalPreference["polarity"]; purposes: ContextPurpose[] } }
  | { t: "personal_feedback_put"; requestId: string; revision: number; feedback: PersonalFeedbackInput }
  | { t: "personal_source_put"; requestId: string; revision: number; source: PersonalSourceInput }
  | { t: "personal_source_delete"; requestId: string; revision: number; sourceId: string }
  | { t: "personal_source_discover"; requestId: string; sourceId: string }
  | { t: "personal_source_test"; requestId: string; sourceId: string; purpose: ContextPurpose; text?: string }
  | { t: "personal_context_query"; requestId: string; query: Omit<PersonalContextQuery, "principalId" | "deviceId"> }
  | { t: "personal_action_preview"; requestId: string; kind: string; payload: Record<string, unknown>; idempotencyKey?: string }
  | { t: "personal_action_approve"; requestId: string; planId: string; challenge: string }
  | { t: "personal_action_execute"; requestId: string; planId: string }
  | { t: "personal_action_handoff_result"; requestId: string; planId: string; success: boolean; error?: string }
  | { t: "personal_action_cancel"; requestId: string; planId: string }
  | { t: "personal_data_export"; requestId: string }
  | { t: "personal_data_prune"; requestId: string }
  | { t: "personal_data_category_erase"; requestId: string; revision: number; category: PersonalDataCategory; confirmation: "ERASE_CATEGORY" }
  | { t: "personal_data_erase"; requestId: string; confirmation: "ERASE" };

export interface PersonalContextSuggestionsResponse {
  t: "personal_context_suggestions";
  requestId: string;
  /** Current personal-store revision after reviewable action plans were created. */
  revision?: number;
  results: ContextSourceResult[];
  errors: Array<{ sourceId: string; error: string }>;
  suggestions: ContextSuggestion[];
  diagnostics?: ContextRankingDiagnostic[];
}

export interface ContextRankingDiagnostic {
  candidateId: string;
  kind: string;
  status: "discarded";
  reasons: string[];
}

export type PersonalHubToClient =
  | { t: "personal_context_state"; requestId?: string; state: PersonalContextView }
  | { t: "personal_context_result"; requestId: string; ok: boolean; revision?: number; error?: string; conflict?: PersonalContextView }
  | PersonalContextSuggestionsResponse
  | { t: "personal_source_discovery"; requestId: string; discovery: PersonalSourceDiscovery }
  | { t: "personal_source_test_result"; requestId: string; sourceId: string; result: ContextSourceResult; status?: ContextSourceStatus }
  | { t: "personal_proactive_notification"; notification: { id: string; suggestionId: string; kind: string; locale: "pt" | "en" | "es"; title: string; body: string; tag: string; deepLink: string; createdAt: number; expiresAt: number } }
  | { t: "personal_turn_suggestions"; sessionId: string; runnerId: string; intent: ContextPurpose | "ev"; purpose: ContextPurpose; response: PersonalContextSuggestionsResponse }
  | { t: "personal_action_view"; requestId: string; action: PersonalActionView }
  | { t: "personal_data_export"; requestId: string; data: PersonalContextExport }
  | { t: "personal_data_erased"; requestId: string; ok: boolean };

export type PersonalContextQueryResponseWire = PersonalContextSuggestionsResponse;

const PERSONAL_ID = /^[^\u0000-\u001f\u007f]{1,200}$/;
const PERSONAL_PURPOSES = new Set<ContextPurpose>(["nearby", "mobility", "calendar", "events", "weather", "automation"]);
const PERSONAL_SOURCE_TYPES = new Set<PersonalSourceType>(["device_location", "device_calendar", "nominatim", "valhalla", "osm", "open_charge_map", "open_meteo", "weather_alerts", "mapas_culturais", "open_events", "caldav", "mcp_http", "mcp_stdio", "home_assistant"]);
const PERSONAL_MESSAGE_TYPES = new Set([
  "personal_context_get", "personal_context_update", "personal_consent_put", "personal_consent_revoke", "personal_location_put", "personal_calendar_put",
  "personal_geofence_transition_put", "personal_device_context_clear",
  "personal_device_update",
  "personal_notification_feedback",
  "personal_vehicle_put", "personal_vehicle_delete",
  "personal_favorite_put", "personal_favorite_delete", "personal_preference_put", "personal_preference_delete", "personal_preference_decision", "personal_source_put",
  "personal_feedback_put",
  "personal_source_delete", "personal_source_discover", "personal_source_test", "personal_context_query", "personal_action_preview", "personal_action_approve", "personal_action_execute", "personal_action_handoff_result", "personal_action_cancel",
  "personal_data_export", "personal_data_prune", "personal_data_erase",
  "personal_data_category_erase",
]);
const objectValue = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const personalId = (value: unknown): value is string => typeof value === "string" && PERSONAL_ID.test(value);
const revision = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
};
const boundedText = (value: unknown, maximum: number, required = false): value is string => typeof value === "string"
  && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) && (!required || value.trim().length > 0);
const boundedStringList = (value: unknown, maximumItems: number, maximumLength: number, required = false): value is string[] => Array.isArray(value)
  && value.length <= maximumItems && (!required || value.length > 0)
  && value.every((item) => boundedText(item, maximumLength, true));
const purposeList = (value: unknown, required = true): value is ContextPurpose[] => Array.isArray(value) && value.length <= PERSONAL_PURPOSES.size
  && (!required || value.length > 0) && value.every((item) => PERSONAL_PURPOSES.has(item as ContextPurpose));
const geoPoint = (value: unknown): value is GeoPoint => objectValue(value) && onlyKeys(value, ["lat", "lng", "accuracyM"])
  && finite(value.lat) && value.lat >= -90 && value.lat <= 90 && finite(value.lng) && value.lng >= -180 && value.lng <= 180
  && (value.accuracyM === undefined || (finite(value.accuracyM) && value.accuracyM >= 0 && value.accuracyM <= 10_000_000));
const clock = (value: unknown): value is string => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const locale = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 35
  && /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(value);
const timeZone = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 100
  && /^[A-Za-z0-9][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+-]*)*$/.test(value);
const safeJsonLength = (value: unknown, maximum: number): boolean => {
  try { return JSON.stringify(value).length <= maximum; } catch { return false; }
};
const sourceRef = (value: unknown): value is ContextSourceRef => objectValue(value)
  && onlyKeys(value, ["sourceId", "recordId", "observedAt", "freshness", "attribution", "url"])
  && personalId(value.sourceId) && (value.recordId === undefined || personalId(value.recordId)) && timestamp(value.observedAt)
  && ["live", "fresh", "stale", "unknown"].includes(String(value.freshness))
  && (value.attribution === undefined || boundedText(value.attribution, 500))
  && (value.url === undefined || boundedText(value.url, 2_000));
const filterRecord = (value: unknown): value is PersonalContextQuery["filters"] => {
  if (!objectValue(value) || Object.keys(value).length > 30 || !safeJsonLength(value, 16_384)) return false;
  return Object.entries(value).every(([key, item]) => boundedText(key, 100, true) && (
    (typeof item === "string" && item.length <= 500 && !/[\u0000-\u001f\u007f]/.test(item))
    || (finite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER)
    || typeof item === "boolean"
    || (Array.isArray(item) && item.length <= 50 && item.every((entry) => boundedText(entry, 200)))
  ));
};
const sourceConfig = (value: unknown): value is PersonalSourceConnection["config"] => {
  if (!objectValue(value) || Object.keys(value).length > 50 || !safeJsonLength(value, 32_768)) return false;
  const sensitive = /(^|[._-])(authorization|cookie|credential|passwd|password|secret|token|api[._-]?key|private[._-]?key)($|[._-])/i;
  return Object.entries(value).every(([key, item]) => boundedText(key, 100, true) && !key.startsWith("env.") && !sensitive.test(key) && (
    (typeof item === "string" && item.length <= 2_000 && !/[\u0000-\u001f\u007f]/.test(item))
    || (finite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER)
    || typeof item === "boolean"
    || (Array.isArray(item) && item.length <= 100 && item.every((entry) => boundedText(entry, 500)))
  ));
};
const stdioEnvironmentPatch = (value: unknown): value is PersonalStdioEnvironmentPatch => {
  if (!objectValue(value) || !onlyKeys(value, ["set", "remove"])) return false;
  const set = objectValue(value.set) ? value.set : undefined;
  const remove = boundedStringList(value.remove, 50, 100) ? value.remove : undefined;
  if (!set || !remove || Object.keys(set).length > 50 || !safeJsonLength(value, 32_768)) return false;
  const name = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const sensitive = /(^|_)(authorization|cookie|credential|passwd|password|secret|token|api_?key|private_?key)($|_)/i;
  const setNames = Object.keys(set);
  if (!setNames.every((key) => name.test(key) && !sensitive.test(key)
    && boundedText(set[key], 2_000))) return false;
  if (!remove.every((key) => name.test(key))) return false;
  const removed = new Set(remove);
  return setNames.every((key) => !removed.has(key));
};
const settingsPatch = (value: unknown): boolean => {
  if (!objectValue(value) || !onlyKeys(value, ["enabled", "paused", "pausedSourceIds", "locationMode", "locationPrecision", "retention", "notifications"])) return false;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return false;
  if (value.paused !== undefined && typeof value.paused !== "boolean") return false;
  if (value.pausedSourceIds !== undefined && (!Array.isArray(value.pausedSourceIds) || value.pausedSourceIds.length > 100
    || value.pausedSourceIds.some((sourceId) => !personalId(sourceId))
    || new Set(value.pausedSourceIds).size !== value.pausedSourceIds.length)) return false;
  if (value.locationMode !== undefined && !["off", "foreground", "background"].includes(String(value.locationMode))) return false;
  if (value.locationPrecision !== undefined && !["approximate", "precise"].includes(String(value.locationPrecision))) return false;
  if (value.retention !== undefined) {
    if (!objectValue(value.retention) || !onlyKeys(value.retention, ["observationsDays", "decisionsDays", "inferredPreferencesDays", "keepRawLocation"])) return false;
    if (value.retention.observationsDays !== undefined && !(Number.isSafeInteger(value.retention.observationsDays) && Number(value.retention.observationsDays) >= 0 && Number(value.retention.observationsDays) <= 365)) return false;
    if (value.retention.decisionsDays !== undefined && !(Number.isSafeInteger(value.retention.decisionsDays) && Number(value.retention.decisionsDays) >= 1 && Number(value.retention.decisionsDays) <= 3_650)) return false;
    if (value.retention.inferredPreferencesDays !== undefined && !(Number.isSafeInteger(value.retention.inferredPreferencesDays) && Number(value.retention.inferredPreferencesDays) >= 1 && Number(value.retention.inferredPreferencesDays) <= 3_650)) return false;
    if (value.retention.keepRawLocation !== undefined && typeof value.retention.keepRawLocation !== "boolean") return false;
  }
  if (value.notifications !== undefined) {
    if (!objectValue(value.notifications) || !onlyKeys(value.notifications, ["quietStart", "quietEnd", "maxPerDay", "cooldownMinutes", "minScore"])) return false;
    if (value.notifications.quietStart !== undefined && !clock(value.notifications.quietStart)) return false;
    if (value.notifications.quietEnd !== undefined && !clock(value.notifications.quietEnd)) return false;
    if (value.notifications.maxPerDay !== undefined && !(Number.isSafeInteger(value.notifications.maxPerDay) && Number(value.notifications.maxPerDay) >= 0 && Number(value.notifications.maxPerDay) <= 50)) return false;
    if (value.notifications.cooldownMinutes !== undefined && !(Number.isSafeInteger(value.notifications.cooldownMinutes) && Number(value.notifications.cooldownMinutes) >= 0 && Number(value.notifications.cooldownMinutes) <= 10_080)) return false;
    if (value.notifications.minScore !== undefined && !(finite(value.notifications.minScore) && value.notifications.minScore >= 0 && value.notifications.minScore <= 1)) return false;
  }
  return true;
};

export function isPersonalClientMessage(value: unknown): value is PersonalClientToHub {
  if (!objectValue(value) || typeof value.t !== "string" || !PERSONAL_MESSAGE_TYPES.has(value.t) || !personalId(value.requestId)) return false;
  if (["personal_context_get", "personal_data_export", "personal_data_prune"].includes(value.t)) return onlyKeys(value, ["t", "requestId"]);
  if (value.t === "personal_device_context_clear") return onlyKeys(value, ["t", "requestId", "kind"])
    && (value.kind === "location" || value.kind === "calendar");
  if (value.t === "personal_data_erase") return onlyKeys(value, ["t", "requestId", "confirmation"]) && value.confirmation === "ERASE";
  if (value.t === "personal_data_category_erase") return onlyKeys(value, ["t", "requestId", "revision", "category", "confirmation"])
    && revision(value.revision) && value.confirmation === "ERASE_CATEGORY"
    && ["observations", "preferences", "favorites", "vehicle_profiles", "actions", "notifications", "sources", "consents", "device_profiles"].includes(String(value.category));
  if (["personal_consent_revoke", "personal_favorite_delete", "personal_preference_delete", "personal_source_delete", "personal_vehicle_delete"].includes(value.t)) {
    const key = value.t === "personal_consent_revoke" ? "consentId" : value.t === "personal_favorite_delete" ? "favoriteId" : value.t === "personal_preference_delete" ? "preferenceId" : value.t === "personal_vehicle_delete" ? "profileId" : "sourceId";
    return onlyKeys(value, ["t", "requestId", "revision", key]) && revision(value.revision) && personalId(value[key]);
  }
  if (["personal_action_execute", "personal_action_cancel"].includes(value.t)) return onlyKeys(value, ["t", "requestId", "planId"]) && personalId(value.planId);
  if (value.t === "personal_action_handoff_result") {
    return onlyKeys(value, ["t", "requestId", "planId", "success", "error"])
      && personalId(value.planId) && typeof value.success === "boolean"
      && (value.error === undefined || boundedText(value.error, 1_000));
  }
  if (value.t === "personal_action_preview") {
    return onlyKeys(value, ["t", "requestId", "kind", "payload", "idempotencyKey"])
      && personalId(value.kind) && objectValue(value.payload) && safeJsonLength(value.payload, 32_768)
      && (value.idempotencyKey === undefined || personalId(value.idempotencyKey));
  }
  if (value.t === "personal_action_approve") return onlyKeys(value, ["t", "requestId", "planId", "challenge"]) && personalId(value.planId) && personalId(value.challenge);
  if (value.t === "personal_context_update") return onlyKeys(value, ["t", "requestId", "revision", "patch"]) && revision(value.revision) && settingsPatch(value.patch);
  if (value.t === "personal_device_update") {
    const profile = objectValue(value.profile) ? value.profile : undefined;
    return onlyKeys(value, ["t", "requestId", "revision", "profile"]) && revision(value.revision) && !!profile
      && onlyKeys(profile, ["locale", "timeZone", "proactiveEnabled", "disabledProactiveKinds", "notifications"])
      && locale(profile.locale) && timeZone(profile.timeZone)
      && typeof profile.proactiveEnabled === "boolean"
      && (profile.disabledProactiveKinds === undefined || (Array.isArray(profile.disabledProactiveKinds) && profile.disabledProactiveKinds.length <= 50 && profile.disabledProactiveKinds.every((item) => personalId(item))))
      && (profile.notifications === undefined || (objectValue(profile.notifications)
        && onlyKeys(profile.notifications, ["quietStart", "quietEnd", "maxPerDay", "cooldownMinutes", "minScore"])
        && clock(profile.notifications.quietStart) && clock(profile.notifications.quietEnd)
        && Number.isSafeInteger(profile.notifications.maxPerDay) && Number(profile.notifications.maxPerDay) >= 0 && Number(profile.notifications.maxPerDay) <= 50
        && Number.isSafeInteger(profile.notifications.cooldownMinutes) && Number(profile.notifications.cooldownMinutes) >= 0 && Number(profile.notifications.cooldownMinutes) <= 10_080
        && finite(profile.notifications.minScore) && profile.notifications.minScore >= 0 && profile.notifications.minScore <= 1));
  }
  if (value.t === "personal_notification_feedback") return onlyKeys(value, ["t", "requestId", "notificationId", "outcome", "disableKind"])
    && personalId(value.notificationId)
    && ["opened", "ignored", "dismissed", "acted"].includes(String(value.outcome))
    && (value.disableKind === undefined || typeof value.disableKind === "boolean");
  if (value.t === "personal_preference_decision") {
    const correction = value.correction === undefined ? undefined : objectValue(value.correction) ? value.correction : null;
    if (!onlyKeys(value, ["t", "requestId", "revision", "preferenceId", "decision", "correction"])
      || !revision(value.revision) || !personalId(value.preferenceId) || !["confirm", "correct", "reject"].includes(String(value.decision))) return false;
    if (value.decision !== "correct") return correction === undefined;
    return !!correction && onlyKeys(correction, ["key", "value", "polarity", "purposes"])
      && boundedText(correction.key, 100, true) && boundedText(correction.value, 500, true)
      && ["prefer", "avoid", "require"].includes(String(correction.polarity)) && purposeList(correction.purposes);
  }
  if (value.t === "personal_vehicle_put") {
    const profile = objectValue(value.profile) ? value.profile : undefined;
    if (!onlyKeys(value, ["t", "requestId", "revision", "profile"]) || !revision(value.revision) || !profile || !onlyKeys(profile, ["id", "label", "connectorTypeIds", "maxAcceptedPowerKw", "rangeKm", "minimumPreferredPowerKw", "preferredOperators", "isDefault"])) return false;
    if (!personalId(profile.id) || typeof profile.label !== "string" || !profile.label.trim() || profile.label.length > 100
      || !Array.isArray(profile.connectorTypeIds) || profile.connectorTypeIds.length < 1 || profile.connectorTypeIds.length > 20
      || !profile.connectorTypeIds.every((item) => Number.isSafeInteger(item) && Number(item) > 0)
      || !Array.isArray(profile.preferredOperators) || profile.preferredOperators.length > 20
      || !profile.preferredOperators.every((item) => typeof item === "string" && !!item.trim() && item.length <= 100)
      || typeof profile.isDefault !== "boolean") return false;
    const boundedOptional = (input: unknown, maximum: number): boolean => input === undefined || (finite(input) && input > 0 && input <= maximum);
    if (!boundedOptional(profile.maxAcceptedPowerKw, 1_000) || !boundedOptional(profile.rangeKm, 5_000) || !boundedOptional(profile.minimumPreferredPowerKw, 1_000)) return false;
    return typeof profile.maxAcceptedPowerKw !== "number" || typeof profile.minimumPreferredPowerKw !== "number" || profile.minimumPreferredPowerKw <= profile.maxAcceptedPowerKw;
  }
  if (value.t === "personal_location_put") {
    const row = objectValue(value.observation) ? value.observation : undefined, point = objectValue(row?.point) ? row.point : undefined;
    return onlyKeys(value, ["t", "requestId", "observation", "purpose"]) && !!row && onlyKeys(row, ["observedAt", "expiresAt", "point", "precision", "source"])
      && !!point && PERSONAL_PURPOSES.has(value.purpose as ContextPurpose) && timestamp(row.observedAt) && timestamp(row.expiresAt)
      && row.expiresAt > row.observedAt && row.expiresAt - row.observedAt <= 3_600_000
      && geoPoint(point)
      && ["approximate", "precise", "unknown"].includes(String(row.precision)) && ["web", "android", "ios"].includes(String(row.source));
  }
  if (value.t === "personal_calendar_put") {
    const row = objectValue(value.observation) ? value.observation : undefined, intervals = Array.isArray(row?.intervals) ? row.intervals : undefined;
    return onlyKeys(value, ["t", "requestId", "observation"]) && !!row && onlyKeys(row, ["observedAt", "expiresAt", "rangeStartAt", "rangeEndAt", "timeZone", "intervals", "truncated", "source"])
      && !!intervals && intervals.length <= 512 && timestamp(row.observedAt) && timestamp(row.expiresAt) && row.expiresAt > row.observedAt
      && row.expiresAt - row.observedAt <= 3_600_000 && timestamp(row.rangeStartAt) && timestamp(row.rangeEndAt) && row.rangeEndAt > row.rangeStartAt
      && row.rangeEndAt - row.rangeStartAt <= 366 * 86_400_000 && timeZone(row.timeZone)
      && typeof row.truncated === "boolean" && ["android", "ios"].includes(String(row.source))
      && intervals.every((item) => objectValue(item) && onlyKeys(item, ["startAt", "endAt", "allDay"])
        && timestamp(item.startAt) && timestamp(item.endAt) && item.endAt > item.startAt && typeof item.allDay === "boolean");
  }
  if (value.t === "personal_geofence_transition_put") {
    const row = objectValue(value.observation) ? value.observation : undefined;
    return onlyKeys(value, ["t", "requestId", "purpose", "observation"]) && !!row
      && onlyKeys(row, ["id", "geofenceId", "transition", "occurredAt", "recordedAt", "source"])
      && PERSONAL_PURPOSES.has(value.purpose as ContextPurpose) && personalId(row.id) && personalId(row.geofenceId)
      && ["enter", "exit"].includes(String(row.transition)) && timestamp(row.occurredAt) && timestamp(row.recordedAt)
      && row.recordedAt >= row.occurredAt && row.recordedAt - row.occurredAt <= 7 * 86_400_000
      && ["android", "ios"].includes(String(row.source));
  }
  if (value.t === "personal_context_query") {
    const query = objectValue(value.query) ? value.query : undefined;
    return onlyKeys(value, ["t", "requestId", "query"]) && !!query
      && onlyKeys(query, ["purpose", "point", "text", "locale", "startAt", "endAt", "limit", "filters"])
      && PERSONAL_PURPOSES.has(query.purpose as ContextPurpose)
      && (query.point === undefined || geoPoint(query.point))
      && (query.limit === undefined || (Number.isSafeInteger(query.limit) && Number(query.limit) >= 1 && Number(query.limit) <= 50))
      && (query.text === undefined || boundedText(query.text, 500))
      && (query.locale === undefined || locale(query.locale))
      && (query.startAt === undefined || timestamp(query.startAt)) && (query.endAt === undefined || timestamp(query.endAt))
      && (query.startAt === undefined || query.endAt === undefined || (query.endAt > query.startAt && query.endAt - query.startAt <= 366 * 86_400_000))
      && (query.filters === undefined || filterRecord(query.filters));
  }
  if (value.t === "personal_source_test") return onlyKeys(value, ["t", "requestId", "sourceId", "purpose", "text"])
    && personalId(value.sourceId) && PERSONAL_PURPOSES.has(value.purpose as ContextPurpose) && (value.text === undefined || boundedText(value.text, 500));
  if (value.t === "personal_source_discover") return onlyKeys(value, ["t", "requestId", "sourceId"])
    && personalId(value.sourceId);
  if (value.t === "personal_feedback_put") {
    const feedback = objectValue(value.feedback) ? value.feedback : undefined;
    return onlyKeys(value, ["t", "requestId", "revision", "feedback"]) && revision(value.revision) && !!feedback
      && onlyKeys(feedback, ["id", "suggestionId", "purpose", "kind", "key", "value", "sourceId"])
      && personalId(feedback.id) && personalId(feedback.suggestionId)
      && PERSONAL_PURPOSES.has(feedback.purpose as ContextPurpose) && ["like", "dislike", "remember", "avoid"].includes(String(feedback.kind))
      && typeof feedback.key === "string" && feedback.key.trim().length > 0 && feedback.key.length <= 100
      && typeof feedback.value === "string" && feedback.value.trim().length > 0 && feedback.value.length <= 500
      && (feedback.sourceId === undefined || personalId(feedback.sourceId));
  }
  if (value.t === "personal_consent_put") {
    const consent = objectValue(value.consent) ? value.consent : undefined;
    return onlyKeys(value, ["t", "requestId", "revision", "consent"]) && revision(value.revision) && !!consent
      && onlyKeys(consent, ["id", "sourceId", "purposes", "fields", "deviceId", "policyVersion", "expiresAt"])
      && personalId(consent.id) && personalId(consent.sourceId) && purposeList(consent.purposes)
      && boundedStringList(consent.fields, 50, 200, true) && (consent.deviceId === undefined || personalId(consent.deviceId))
      && (consent.policyVersion === undefined || (Number.isSafeInteger(consent.policyVersion) && Number(consent.policyVersion) >= 1))
      && (consent.expiresAt === undefined || timestamp(consent.expiresAt));
  }
  if (value.t === "personal_favorite_put") {
    const favorite = objectValue(value.favorite) ? value.favorite : undefined;
    if (!onlyKeys(value, ["t", "requestId", "revision", "favorite"]) || !revision(value.revision) || !favorite
      || !onlyKeys(favorite, ["id", "label", "aliases", "point", "address", "source", "purposes", "geofenceRadiusM", "geofenceTransitions"])) return false;
    const transitions = favorite.geofenceTransitions;
    return personalId(favorite.id) && boundedText(favorite.label, 100, true) && boundedStringList(favorite.aliases, 20, 100)
      && geoPoint(favorite.point) && (favorite.address === undefined || boundedText(favorite.address, 500))
      && (favorite.source === undefined || sourceRef(favorite.source)) && purposeList(favorite.purposes)
      && (favorite.geofenceRadiusM === undefined || (finite(favorite.geofenceRadiusM) && favorite.geofenceRadiusM >= 50 && favorite.geofenceRadiusM <= 10_000))
      && (transitions === undefined || (Array.isArray(transitions) && transitions.length <= 2 && transitions.every((item) => item === "enter" || item === "exit")))
      && (favorite.geofenceRadiusM === undefined || (Array.isArray(transitions) && transitions.length > 0));
  }
  if (value.t === "personal_preference_put") {
    const preference = objectValue(value.preference) ? value.preference : undefined;
    if (!onlyKeys(value, ["t", "requestId", "revision", "preference"]) || !revision(value.revision) || !preference
      || !onlyKeys(preference, ["id", "key", "value", "polarity", "confidence", "evidence", "purposes", "expiresAt"])) return false;
    const evidence = Array.isArray(preference.evidence) ? preference.evidence : undefined;
    return personalId(preference.id) && boundedText(preference.key, 100, true) && boundedText(preference.value, 500, true)
      && ["prefer", "avoid", "require"].includes(String(preference.polarity)) && finite(preference.confidence) && preference.confidence >= 0 && preference.confidence <= 1
      && !!evidence && evidence.length <= 20 && evidence.every((item) => objectValue(item)
        && onlyKeys(item, ["id", "kind", "at", "summary", "sourceId"]) && personalId(item.id)
        && ["statement", "choice", "dismissal", "visit_summary", "correction"].includes(String(item.kind))
        && timestamp(item.at) && boundedText(item.summary, 500, true) && (item.sourceId === undefined || personalId(item.sourceId)))
      && purposeList(preference.purposes) && (preference.expiresAt === undefined || timestamp(preference.expiresAt));
  }
  if (value.t === "personal_source_put") {
    const source = objectValue(value.source) ? value.source : undefined;
    return onlyKeys(value, ["t", "requestId", "revision", "source"]) && revision(value.revision) && !!source
      && onlyKeys(source, ["id", "type", "label", "enabled", "endpoint", "secretRef", "config", "allowedResources", "allowedActions", "stdioEnv"])
      && personalId(source.id) && PERSONAL_SOURCE_TYPES.has(source.type as PersonalSourceType) && boundedText(source.label, 100, true)
      && typeof source.enabled === "boolean" && (source.endpoint === undefined || boundedText(source.endpoint, 2_000, true))
      && (source.secretRef === undefined || (typeof source.secretRef === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(source.secretRef)))
      && sourceConfig(source.config) && boundedStringList(source.allowedResources, 100, 200)
      && boundedStringList(source.allowedActions, 100, 200)
      && (source.stdioEnv === undefined || (source.type === "mcp_stdio" && stdioEnvironmentPatch(source.stdioEnv)));
  }
  return false;
}
