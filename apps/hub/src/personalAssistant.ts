import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { PERSONAL_SOURCE_DISCOVERY_LIMITS, toPersonalSourceView } from "@jarvis/protocol";
import type {
  ContextPurpose,
  ContextSuggestion,
  ContextSourceDescriptor,
  ContextSourceResult,
  DeviceCalendarObservation,
  DeviceGeofenceTransitionObservation,
  DeviceLocationObservation,
  FavoritePlace,
  PersonalClientToHub,
  PersonalConsent,
  PersonalContextQuery,
  PersonalContextState,
  PersonalContextView,
  PersonalHubToClient,
  PersonalActionView,
  PersonalPreference,
  PersonalSourceConnection,
  PersonalSourceDiscovery,
  PersonalVehicleProfile,
} from "@jarvis/protocol";
import {
  ContextSourceRegistry,
  PersonalActionManager,
  PersonalContextStore,
  activeConsent,
  createNavigationActionExecutor,
  composeMultiContextCandidates,
  createDeviceCalendarSource,
  inferPreferences,
  localizeContextRankingDiagnostics,
  localizeContextSourceUnavailable,
  normalizeGeoPoint,
  normalizeContextRankingLocale,
  publicActionPlan,
  rankContextCandidatesDetailed,
  resolvePersonalIntentTimeWindow,
  applyVehicleProfileToCandidates,
  applyRouteMatrixToCandidates,
  applyExplicitCandidateFilters,
  type ContextSource,
  type PersonalActionAuthorizationGrant,
  type PersonalActionExecutor,
} from "@jarvis/core";

export interface PersonalAssistantActor {
  principalId: string;
  deviceId?: string;
  owner: boolean;
}

export interface PersonalAssistantServiceOptions {
  root?: string;
  now?: () => number;
  fetch?: typeof fetch;
  allowPersonalContext?: (actor: PersonalAssistantActor) => boolean;
  sourceFactory?: (connection: PersonalSourceConnection) => ContextSource<unknown> | PersonalSourceBundle | undefined;
}

export interface PersonalSourceBundle {
  source: ContextSource<unknown>;
  actions?: PersonalActionExecutor[];
  discover?: (signal: AbortSignal) => Promise<PersonalSourceDiscovery>;
  dispose?: () => void | Promise<void>;
}

export type PersonalContextQueryResponse = Extract<PersonalHubToClient, { t: "personal_context_suggestions" }>;

export interface PersonalTurnContext {
  response: PersonalContextQueryResponse;
  agentText: string;
}

const SERIALIZED_PERSONAL_MUTATIONS = new Set<PersonalClientToHub["t"]>([
  "personal_context_update", "personal_device_update", "personal_notification_feedback",
  "personal_vehicle_put", "personal_vehicle_delete", "personal_consent_put", "personal_consent_revoke",
  "personal_location_put", "personal_calendar_put", "personal_geofence_transition_put", "personal_device_context_clear",
  "personal_favorite_put", "personal_favorite_delete", "personal_preference_put", "personal_preference_delete", "personal_preference_decision", "personal_feedback_put",
  "personal_source_put", "personal_source_delete", "personal_action_preview", "personal_action_approve", "personal_action_execute", "personal_action_handoff_result", "personal_action_cancel",
  "personal_data_prune", "personal_data_category_erase", "personal_data_erase",
]);

function safeError(error: unknown): string {
  const value = String((error as Error)?.message || error || "unknown error").replace(/(bearer|basic)\s+[^\s]+/gi, "$1 [REDACTED]");
  return value.slice(0, 500);
}
function safeDiscoveryText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value.replace(/\b(Bearer|Basic)\s+[^\s]+/gi, "$1 [REDACTED]").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return sanitized ? [...sanitized].slice(0, maximum).join("") : undefined;
}
function sanitizeSourceDiscovery(sourceId: string, input: PersonalSourceDiscovery): PersonalSourceDiscovery {
  const states = new Set<PersonalSourceDiscovery["state"]>(["ready", "awaiting_start", "disconnected", "connecting", "connected", "closing"]);
  const healthValues = new Set<PersonalSourceDiscovery["health"]>(["unknown", "healthy", "unhealthy"]);
  const calendarsInput = Array.isArray(input?.calendars) ? input.calendars : [];
  const toolsInput = Array.isArray(input?.tools) ? input.tools : [];
  const resourcesInput = Array.isArray(input?.resources) ? input.resources : [];
  const calendars = calendarsInput.slice(0, PERSONAL_SOURCE_DISCOVERY_LIMITS.calendars).flatMap((row) => {
    const id = safeDiscoveryText(row?.id, 2_000), href = safeDiscoveryText(row?.href, 2_000), name = safeDiscoveryText(row?.name, 200);
    return id && href ? [{ id, href, ...(name ? { name } : {}), allowed: row.allowed === true }] : [];
  });
  const tools = toolsInput.slice(0, PERSONAL_SOURCE_DISCOVERY_LIMITS.tools).flatMap((row) => {
    const id = safeDiscoveryText(row?.id, 200), name = safeDiscoveryText(row?.name, 200), description = safeDiscoveryText(row?.description, 500);
    return id && name ? [{ id, name, ...(description ? { description } : {}), allowed: row.allowed === true, advertised: row.advertised === true }] : [];
  });
  const resources = resourcesInput.slice(0, PERSONAL_SOURCE_DISCOVERY_LIMITS.resources).flatMap((row) => {
    const id = safeDiscoveryText(row?.id, 2_000), href = safeDiscoveryText(row?.href, 2_000), name = safeDiscoveryText(row?.name, 200), description = safeDiscoveryText(row?.description, 500), mime = safeDiscoveryText(row?.mime, 200);
    return id && href ? [{ id, href, ...(name ? { name } : {}), ...(description ? { description } : {}), ...(mime ? { mime } : {}), allowed: row.allowed === true, advertised: row.advertised === true }] : [];
  });
  const latencyMs = Number(input?.latencyMs);
  return {
    sourceId,
    state: states.has(input?.state) ? input.state : "disconnected",
    health: healthValues.has(input?.health) ? input.health : "unknown",
    ...(Number.isFinite(latencyMs) && latencyMs >= 0 ? { latencyMs: Math.min(latencyMs, 600_000) } : {}),
    calendars, tools, resources,
    truncated: {
      calendars: input?.truncated?.calendars === true || calendarsInput.length > PERSONAL_SOURCE_DISCOVERY_LIMITS.calendars,
      tools: input?.truncated?.tools === true || toolsInput.length > PERSONAL_SOURCE_DISCOVERY_LIMITS.tools,
      resources: input?.truncated?.resources === true || resourcesInput.length > PERSONAL_SOURCE_DISCOVERY_LIMITS.resources,
    },
  };
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("personal context query aborted");
}

function assertRevision(state: PersonalContextState, revision: number): void {
  if (state.revision !== revision) throw Object.assign(new Error("personal context revision conflict"), { code: "REVISION_CONFLICT" });
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function validClock(value: unknown, fallback: string): string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function normalizedAlias(value: unknown): string {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function effectiveContextLocale(state: PersonalContextState, actor: PersonalAssistantActor, requested?: string) {
  const deviceLocale = state.deviceProfiles.find((row) => row.deviceId === (actor.deviceId || "local"))?.locale;
  return (requested?.trim() || deviceLocale?.trim() || "pt-BR").replace(/_/g, "-");
}

function sanitizeSettingsPatch(state: PersonalContextState, patch: PersonalClientToHub & { t: "personal_context_update" }): Parameters<PersonalContextStore["updateSettings"]>[1] {
  const current = state.settings;
  const retention = patch.patch.retention ? {
    observationsDays: boundedNumber(patch.patch.retention.observationsDays, current.retention.observationsDays, 0, 365),
    decisionsDays: boundedNumber(patch.patch.retention.decisionsDays, current.retention.decisionsDays, 1, 3650),
    inferredPreferencesDays: boundedNumber(patch.patch.retention.inferredPreferencesDays, current.retention.inferredPreferencesDays, 1, 3650),
    keepRawLocation: patch.patch.retention.keepRawLocation === true,
  } : undefined;
  const notifications = patch.patch.notifications ? {
    quietStart: validClock(patch.patch.notifications.quietStart, current.notifications.quietStart),
    quietEnd: validClock(patch.patch.notifications.quietEnd, current.notifications.quietEnd),
    maxPerDay: boundedNumber(patch.patch.notifications.maxPerDay, current.notifications.maxPerDay, 0, 50),
    cooldownMinutes: boundedNumber(patch.patch.notifications.cooldownMinutes, current.notifications.cooldownMinutes, 0, 10_080),
    minScore: boundedNumber(patch.patch.notifications.minScore, current.notifications.minScore, 0, 1),
  } : undefined;
  return {
    enabled: typeof patch.patch.enabled === "boolean" ? patch.patch.enabled : current.enabled,
    paused: typeof patch.patch.paused === "boolean" ? patch.patch.paused : current.paused,
    pausedSourceIds: patch.patch.pausedSourceIds === undefined
      ? [...(current.pausedSourceIds || [])]
      : [...new Set(patch.patch.pausedSourceIds.map((sourceId) => requireId(sourceId, "paused source")))].slice(0, 100),
    locationMode: ["off", "foreground", "background"].includes(String(patch.patch.locationMode)) ? patch.patch.locationMode : current.locationMode,
    locationPrecision: ["approximate", "precise"].includes(String(patch.patch.locationPrecision)) ? patch.patch.locationPrecision : current.locationPrecision,
    retention, notifications,
  };
}

function sourceView(state: PersonalContextState, runtimeStatuses: PersonalContextState["sourceStatuses"] = [], deviceId = "local", now = Date.now()): PersonalContextView {
  const statuses = new Map(state.sourceStatuses.map((status) => [status.descriptor.id, structuredClone(status)]));
  runtimeStatuses.forEach((status) => statuses.set(status.descriptor.id, structuredClone(status)));
  for (const sourceId of state.settings.pausedSourceIds || []) {
    const status = statuses.get(sourceId);
    if (status) statuses.set(sourceId, { ...status, state: "paused", message: undefined });
  }
  const sourceIds = (values: Array<string | undefined>): string[] => [...new Set(values.filter((value): value is string => !!value))].sort().slice(0, 100);
  const latest = (values: Array<number | undefined>): number | undefined => {
    const bounded = values.filter((value): value is number => Number.isFinite(value));
    return bounded.length ? Math.max(...bounded) : undefined;
  };
  const category = (name: PersonalContextView["dataSummary"]["categories"][number]["category"], count: number, sources: string[], retentionDays: number | undefined, lastUpdatedAt: number | undefined) => ({
    category: name,
    count,
    sourceIds: sources,
    ...(retentionDays === undefined ? {} : { retentionDays }),
    ...(lastUpdatedAt === undefined ? {} : { lastUpdatedAt }),
  });
  const categories: PersonalContextView["dataSummary"]["categories"] = [
    category("observations", state.observations.length, sourceIds(state.observations.map((row) => row.sourceId)), state.settings.retention.observationsDays, latest(state.observations.map((row) => row.observedAt))),
    category("preferences", state.preferences.length, sourceIds(state.preferences.flatMap((row) => row.evidence.map((evidence) => evidence.sourceId || (row.kind === "explicit" ? "user" : "inference")))), state.settings.retention.inferredPreferencesDays, latest(state.preferences.map((row) => row.updatedAt))),
    category("favorites", state.favorites.length, sourceIds(state.favorites.map((row) => row.source?.sourceId || "user")), undefined, latest(state.favorites.map((row) => row.updatedAt))),
    category("vehicle_profiles", state.vehicleProfiles.length, state.vehicleProfiles.length ? ["user"] : [], undefined, latest(state.vehicleProfiles.map((row) => row.updatedAt))),
    category("actions", state.actions.length, sourceIds(state.actions.map((row) => row.sourceId || "jarvis")), state.settings.retention.decisionsDays, latest(state.actions.map((row) => row.completedAt || row.createdAt))),
    category("notifications", state.notifications.length, state.notifications.length ? ["jarvis"] : [], state.settings.retention.decisionsDays, latest(state.notifications.map((row) => row.at))),
    category("sources", state.sources.length, sourceIds(state.sources.map((row) => row.id)), undefined, latest(state.sources.map((row) => row.updatedAt))),
    category("consents", state.consents.length, sourceIds(state.consents.map((row) => row.sourceId)), undefined, latest(state.consents.map((row) => row.revokedAt || row.grantedAt))),
    category("device_profiles", state.deviceProfiles.length, state.deviceProfiles.length ? ["device"] : [], undefined, latest(state.deviceProfiles.map((row) => row.updatedAt))),
  ];
  const locationObservation = state.observations.find((row) => row.id === `device-location:${deviceId}` && row.kind === "device_location");
  const calendarObservation = state.observations.find((row) => row.id === `device-calendar:${deviceId}` && row.kind === "device_calendar_busy_summary");
  const locationValue = locationObservation?.value || {}, calendarValue = calendarObservation?.value || {};
  const calendarRangeStartAt = Number(calendarValue.rangeStartAt), calendarRangeEndAt = Number(calendarValue.rangeEndAt);
  const validCalendarSummary = !!calendarObservation
    && Number.isFinite(calendarRangeStartAt)
    && Number.isFinite(calendarRangeEndAt)
    && calendarRangeEndAt > calendarRangeStartAt;
  const deviceContext: PersonalContextView["deviceContext"] = {
    deviceId,
    ...(locationObservation ? { location: {
      observedAt: locationObservation.observedAt, expiresAt: locationObservation.expiresAt,
      precision: ["approximate", "precise"].includes(String(locationValue.precision)) ? locationValue.precision as "approximate" | "precise" : "unknown",
      source: ["web", "android", "ios"].includes(String(locationValue.source)) ? locationValue.source as "web" | "android" | "ios" : "unknown",
      status: locationObservation.expiresAt > now ? "fresh" as const : "expired" as const,
      needsSync: locationObservation.expiresAt <= now,
    } } : {}),
    ...(validCalendarSummary ? { calendar: {
      observedAt: calendarObservation.observedAt, expiresAt: calendarObservation.expiresAt,
      rangeStartAt: calendarRangeStartAt, rangeEndAt: calendarRangeEndAt,
      ...(typeof calendarValue.timeZone === "string" ? { timeZone: calendarValue.timeZone } : {}),
      busyIntervals: Number(calendarValue.busyIntervals) || 0, truncated: calendarValue.truncated === true,
      source: ["android", "ios"].includes(String(calendarValue.source)) ? calendarValue.source as "android" | "ios" : "unknown",
      status: calendarObservation.expiresAt > now ? "fresh" as const : "expired" as const,
      needsSync: calendarObservation.expiresAt <= now,
    } } : {}),
  };
  return {
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    settings: structuredClone(state.settings),
    deviceProfiles: structuredClone(state.deviceProfiles),
    vehicleProfiles: structuredClone(state.vehicleProfiles),
    consents: structuredClone(state.consents),
    favorites: structuredClone(state.favorites),
    preferences: structuredClone(state.preferences),
    sources: state.sources.map((source) => toPersonalSourceView(structuredClone(source))),
    sourceStatuses: [...statuses.values()],
    deviceContext,
    actions: state.actions.map(publicActionPlan),
    dataSummary: {
      observations: state.observations.length,
      explicitPreferences: state.preferences.filter((row) => row.kind === "explicit").length,
      inferredPreferences: state.preferences.filter((row) => row.kind === "inferred").length,
      actions: state.actions.length,
      categories,
    },
    updatedAt: state.updatedAt,
  };
}

function requireId(value: string, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`invalid ${label}`);
  return normalized;
}

function normalizeSource(actor: PersonalAssistantActor, source: PersonalClientToHub & { t: "personal_source_put" }, now: number, existing?: PersonalSourceConnection): PersonalSourceConnection {
  const input = source.source;
  const sensitiveConfigKey = /(^|[._-])(authorization|cookie|credential|passwd|password|secret|token|api[._-]?key|private[._-]?key)($|[._-])/i;
  const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const sensitiveEnvironment = /(^|_)(authorization|cookie|credential|passwd|password|secret|token|api_?key|private_?key)($|_)/i;
  if (Object.keys(input.config || {}).some((key) => key.startsWith("env.") || sensitiveConfigKey.test(key))) throw new Error("source secrets and stdio environment must use their dedicated fields");
  const secretRef = input.secretRef === undefined ? existing?.secretRef : String(input.secretRef || "").trim();
  if (secretRef && !/^[A-Z][A-Z0-9_]{1,100}$/.test(secretRef)) throw new Error("secretRef must name a Hub environment variable");
  if (input.endpoint && input.endpoint.length > 2_000) throw new Error("source endpoint is too long");
  const config: PersonalSourceConnection["config"] = Object.fromEntries(Object.entries(input.config || {}).slice(0, 50));
  if (input.type === "mcp_stdio") {
    for (const [key, value] of Object.entries(existing?.config || {})) if (/^env\.[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string") config[key] = value;
    const patch = input.stdioEnv;
    if (patch) {
      const setNames = Object.keys(patch.set || {}), removeNames = Array.isArray(patch.remove) ? patch.remove : [];
      if (setNames.length > 50 || removeNames.length > 50 || setNames.some((name) => !environmentName.test(name) || sensitiveEnvironment.test(name))
        || removeNames.some((name) => !environmentName.test(name)) || setNames.some((name) => removeNames.includes(name))) throw new Error("invalid stdio environment patch");
      for (const name of removeNames) delete config[`env.${name}`];
      for (const name of setNames) {
        const value = patch.set[name];
        if (typeof value !== "string" || value.length > 2_000 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("invalid stdio environment value");
        config[`env.${name}`] = value;
      }
    }
  }
  if (Object.keys(config).length > 50 || JSON.stringify(config).length > 32_768) throw new Error("source configuration is too large");
  const { stdioEnv: _stdioEnv, ...publicInput } = input;
  return {
    ...structuredClone(publicInput), id: requireId(input.id, "source id"), principalId: actor.principalId,
    label: String(input.label || input.type).trim().slice(0, 100), secretRef: secretRef || undefined,
    config,
    allowedResources: [...new Set((input.allowedResources || []).map(String).filter((item) => item.length <= 200))].slice(0, 100),
    allowedActions: [...new Set((input.allowedActions || []).map(String).filter((item) => item.length <= 200))].slice(0, 100),
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
}

function normalizeVehicleProfile(
  principalId: string,
  input: Extract<PersonalClientToHub, { t: "personal_vehicle_put" }>["profile"],
  now: number,
  existing: PersonalVehicleProfile | undefined,
  forceDefault: boolean,
): PersonalVehicleProfile {
  const connectors = [...new Set(input.connectorTypeIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))].sort((left, right) => left - right);
  const preferredOperators = [...new Set(input.preferredOperators.map((value) => String(value).trim()).filter(Boolean))].slice(0, 20);
  const optionalNumber = (value: number | undefined, maximum: number): number | undefined => {
    if (value === undefined) return undefined;
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0 || normalized > maximum) throw new Error("vehicle profile contains an invalid numeric value");
    return Math.round(normalized * 10) / 10;
  };
  if (!connectors.length || connectors.length > 20) throw new Error("vehicle profile needs between 1 and 20 connector types");
  const maxAcceptedPowerKw = optionalNumber(input.maxAcceptedPowerKw, 1_000);
  const rangeKm = optionalNumber(input.rangeKm, 5_000);
  const minimumPreferredPowerKw = optionalNumber(input.minimumPreferredPowerKw, 1_000);
  if (maxAcceptedPowerKw !== undefined && minimumPreferredPowerKw !== undefined && minimumPreferredPowerKw > maxAcceptedPowerKw) {
    throw new Error("preferred charging power cannot exceed the vehicle accepted power");
  }
  const label = String(input.label || "").trim().slice(0, 100);
  if (!label) throw new Error("vehicle profile needs a label");
  return {
    id: requireId(input.id, "vehicle profile id"), principalId, label, connectorTypeIds: connectors,
    ...(maxAcceptedPowerKw === undefined ? {} : { maxAcceptedPowerKw }),
    ...(rangeKm === undefined ? {} : { rangeKm }),
    ...(minimumPreferredPowerKw === undefined ? {} : { minimumPreferredPowerKw }),
    preferredOperators, isDefault: forceDefault || input.isDefault,
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
}

export class PersonalAssistantService {
  readonly store: PersonalContextStore;
  readonly sources: ContextSourceRegistry;
  readonly actions: PersonalActionManager;
  private readonly locations = new Map<string, DeviceLocationObservation>();
  private readonly calendars = new Map<string, DeviceCalendarObservation>();
  private readonly now: () => number;
  private readonly allowPersonalContext: (actor: PersonalAssistantActor) => boolean;
  private readonly sourceFactory?: PersonalAssistantServiceOptions["sourceFactory"];
  private readonly registeredConnections = new Map<string, { adapterId: string; fingerprint: string; actionKinds: string[]; discover?: (signal: AbortSignal) => Promise<PersonalSourceDiscovery>; dispose?: () => void | Promise<void> }>();
  private readonly mutationTails = new Map<string, Promise<void>>();

  constructor(options: PersonalAssistantServiceOptions = {}) {
    this.now = options.now || Date.now;
    this.allowPersonalContext = options.allowPersonalContext || (() => true);
    this.sourceFactory = options.sourceFactory;
    this.store = new PersonalContextStore({ root: options.root || join(process.env.JARVIS_HOME || homedir(), ".jarvis", "personal"), now: this.now });
    this.sources = new ContextSourceRegistry({ fetch: options.fetch, now: this.now, onStatus: (principalId, status) => { try { this.store.putSourceStatus(principalId, status); } catch { /* status persistence must not break a query */ } } });
    this.actions = new PersonalActionManager(this.store, {
      now: this.now,
      authorizeExecutor: (input) => this.authorizeActionExecutor(input),
    });
    this.actions.register(createNavigationActionExecutor());
    this.sources.register(createDeviceCalendarSource({
      sourceId: "device-calendar", label: "Device calendar", attribution: "Calendar on the authorized device", cacheTtlMs: 30_000,
      read: async (request) => {
        const row = this.currentCalendar(request.principalId, request.deviceId);
        if (!row) throw new Error("device calendar snapshot is unavailable or expired");
        if ((request.startAt !== undefined && request.startAt < row.rangeStartAt) || (request.endAt !== undefined && request.endAt > row.rangeEndAt)) throw new Error("device calendar snapshot does not cover the requested window");
        return { observedAt: row.observedAt, complete: !row.truncated, intervals: row.intervals.map((interval) => ({ ...interval, timezone: row.timeZone })) };
      },
      resolveAccess: () => "busy_free",
    }));
  }

  registerSource(source: ContextSource<unknown>): void { this.sources.register(source); }
  registerAction(executor: PersonalActionExecutor): void { this.actions.register(executor); }
  async disposeAll(): Promise<void> {
    const entries = [...this.registeredConnections.entries()];
    this.registeredConnections.clear();
    await Promise.all(entries.map(([key, registered]) => this.unregisterConnection(key.split("\u0000", 1)[0], registered)));
  }
  view(principalId: string, deviceId = "local"): PersonalContextView {
    this.actions.reconcile(principalId);
    const state = this.store.get(principalId); this.ensureConnections(state);
    return sourceView(state, this.sources.statuses(principalId), deviceId, this.now());
  }

  private connectionKey(principalId: string, sourceId: string): string { return `${principalId}\u0000${sourceId}`; }
  private connectionFingerprint(connection: PersonalSourceConnection): string {
    return JSON.stringify([connection.type, connection.label, connection.enabled, connection.endpoint, connection.secretRef, connection.config, connection.allowedResources, connection.allowedActions, connection.updatedAt]);
  }
  private authorizeActionExecutor(input: {
    principalId: string;
    deviceId?: string;
    executor: PersonalActionExecutor;
    existing?: PersonalActionAuthorizationGrant;
  }): PersonalActionAuthorizationGrant | undefined {
    const authorization = input.executor.authorization;
    if (!authorization) return undefined;
    if (!this.allowPersonalContext({ principalId: input.principalId, deviceId: input.deviceId, owner: false })) throw new Error("personal context is blocked by policy");
    const state = this.store.get(input.principalId);
    if (!state.settings.enabled || state.settings.paused) throw new Error("personal assistant is disabled or paused");
    const registered = this.registeredConnections.get(this.connectionKey(input.principalId, authorization.sourceId));
    if (!registered || !registered.actionKinds.includes(input.executor.kind)) throw new Error("action source is no longer registered");
    const purposes = input.existing ? [input.existing.purpose] : authorization.purposes;
    for (const purpose of purposes) {
      for (const consent of state.consents) {
        if (input.existing && consent.id !== input.existing.consentId) continue;
        const active = activeConsent({ settings: state.settings, consents: [consent] }, {
          principalId: input.principalId,
          sourceId: authorization.sourceId,
          purpose,
          fields: authorization.fields || ["actions"],
          deviceId: input.deviceId,
        }, this.now());
        if (active) return { consentId: active.id, purpose, deviceId: active.deviceId };
      }
    }
    throw new Error("action consent is missing, revoked or expired");
  }
  private sourceBundle(created: ContextSource<unknown> | PersonalSourceBundle): PersonalSourceBundle {
    return "source" in created ? created : { source: created };
  }
  private clearEphemeralPrincipal(principalId: string): void {
    const prefix = `${principalId}\u0000`;
    for (const key of this.locations.keys()) if (key.startsWith(prefix)) this.locations.delete(key);
    for (const key of this.calendars.keys()) if (key.startsWith(prefix)) this.calendars.delete(key);
  }
  private async unregisterConnection(principalId: string, registered: { adapterId: string; actionKinds: string[]; dispose?: () => void | Promise<void> }): Promise<void> {
    this.sources.remove(registered.adapterId, principalId);
    registered.actionKinds.forEach((kind) => this.actions.remove(kind, principalId));
    try { await registered.dispose?.(); } catch { /* authority is already removed; disposal is best effort */ }
  }
  private scopedConnectionSource(connection: PersonalSourceConnection, source: ContextSource<unknown>): ContextSource<unknown> {
    return {
      ...source,
      descriptor: { ...structuredClone(source.descriptor), id: connection.id, label: connection.label || source.descriptor.label },
      async query(request, runtime) {
        const candidates = await source.query(request, runtime);
        return candidates.map((candidate) => ({ ...candidate, sources: candidate.sources.map((ref) => ({ ...ref, sourceId: connection.id })) }));
      },
    };
  }
  private installConnection(connection: PersonalSourceConnection, created: ContextSource<unknown> | PersonalSourceBundle): { adapterId: string; fingerprint: string; actionKinds: string[]; discover?: (signal: AbortSignal) => Promise<PersonalSourceDiscovery>; dispose?: () => void | Promise<void> } {
    const bundle = this.sourceBundle(created);
    const fingerprint = this.connectionFingerprint(connection);
    const securedActions = (bundle.actions || []).map((executor): PersonalActionExecutor => {
      const secured: PersonalActionExecutor = {
        ...executor,
        fingerprint: `${fingerprint}\u0000${executor.fingerprint || "v1"}`,
        authorization: { sourceId: connection.id, purposes: [...bundle.source.descriptor.purposes], fields: ["actions"] },
        execute: async (payload, context) => {
          const current = this.registeredConnections.get(this.connectionKey(connection.principalId, connection.id));
          if (!current || current.fingerprint !== fingerprint || !current.actionKinds.includes(executor.kind)) throw new Error("action source changed or was revoked");
          this.authorizeActionExecutor({ principalId: context.principalId, deviceId: context.deviceId, executor: secured, existing: context.authorization });
          return executor.execute(payload, context);
        },
      };
      return secured;
    });
    const actionKinds = securedActions.map((executor) => executor.kind);
    if (new Set(actionKinds).size !== actionKinds.length) throw new Error("source bundle has duplicate action executors");
    const adapter = this.scopedConnectionSource(connection, bundle.source);
    const registeredActions: string[] = [];
    try {
      this.sources.register(adapter, connection.principalId);
      for (const executor of securedActions) {
        this.actions.register(executor, connection.principalId);
        registeredActions.push(executor.kind);
      }
      return { adapterId: adapter.descriptor.id, fingerprint, actionKinds, ...(bundle.discover ? { discover: bundle.discover } : {}), ...(bundle.dispose ? { dispose: bundle.dispose } : {}) };
    } catch (error) {
      for (const kind of registeredActions) this.actions.remove(kind, connection.principalId);
      this.sources.remove(adapter.descriptor.id, connection.principalId);
      try { void Promise.resolve(bundle.dispose?.()).catch(() => undefined); } catch { /* best effort */ }
      throw error;
    }
  }
  private restoreConnection(connection: PersonalSourceConnection | undefined): void {
    if (!connection?.enabled || !this.sourceFactory || this.store.get(connection.principalId).settings.pausedSourceIds?.includes(connection.id)) return;
    try {
      const created = this.sourceFactory(connection); if (!created) return;
      this.registeredConnections.set(this.connectionKey(connection.principalId, connection.id), this.installConnection(connection, created));
    } catch { /* a broken saved adapter remains disabled at runtime */ }
  }
  private async discoverConnection(connection: PersonalSourceConnection): Promise<PersonalSourceDiscovery> {
    const registered = this.registeredConnections.get(this.connectionKey(connection.principalId, connection.id));
    let discover = registered?.discover;
    let dispose: (() => void | Promise<void>) | undefined;
    if (!discover) {
      const created = this.sourceFactory?.(connection);
      if (!created) throw new Error("source discovery is unavailable");
      const bundle = this.sourceBundle(created);
      discover = bundle.discover;
      dispose = bundle.dispose;
    }
    if (!discover) {
      try { await dispose?.(); } catch { /* temporary source has no runtime authority */ }
      throw new Error("source discovery is unavailable");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("source discovery timed out")), 20_000);
    try {
      return sanitizeSourceDiscovery(connection.id, await discover(controller.signal));
    } catch {
      throw new Error("source discovery failed or timed out");
    } finally {
      clearTimeout(timeout);
      if (dispose) try { await dispose(); } catch { /* temporary bundle never gained query authority */ }
    }
  }
  private ensureConnections(state: PersonalContextState): void {
    if (!this.sourceFactory) return;
    if (!state.settings.enabled || state.settings.paused) {
      for (const [key, registered] of [...this.registeredConnections]) {
        if (!key.startsWith(`${state.principalId}\u0000`)) continue;
        this.registeredConnections.delete(key);
        void this.unregisterConnection(state.principalId, registered);
      }
      return;
    }
    const live = new Set<string>();
    for (const connection of state.sources) {
      const key = this.connectionKey(state.principalId, connection.id); live.add(key);
      const fingerprint = this.connectionFingerprint(connection), registered = this.registeredConnections.get(key);
      const authorized = state.consents.some((consent) => consent.sourceId === connection.id && !consent.revokedAt && (!consent.expiresAt || consent.expiresAt > this.now()));
      const paused = state.settings.pausedSourceIds?.includes(connection.id) === true;
      if (!connection.enabled || !authorized || paused) { if (registered) void this.unregisterConnection(state.principalId, registered); this.registeredConnections.delete(key); continue; }
      if (registered?.fingerprint === fingerprint) continue;
      try {
        const created = this.sourceFactory(connection); if (!created) continue;
        if (registered) void this.unregisterConnection(state.principalId, registered);
        this.registeredConnections.delete(key);
        this.registeredConnections.set(key, this.installConnection(connection, created));
      } catch {
        this.registeredConnections.delete(key);
        /* an invalid saved connection stays visible but cannot become query authority */
      }
    }
    for (const [key, registered] of this.registeredConnections) {
      if (!key.startsWith(`${state.principalId}\u0000`) || live.has(key)) continue;
      void this.unregisterConnection(state.principalId, registered); this.registeredConnections.delete(key);
    }
  }

  private locationKey(actor: PersonalAssistantActor): string { return `${actor.principalId}\u0000${actor.deviceId || "unknown"}`; }
  private deviceKey(principalId: string, deviceId?: string): string { return `${principalId}\u0000${deviceId || "unknown"}`; }
  private currentLocation(actor: PersonalAssistantActor): DeviceLocationObservation | undefined {
    const row = this.locations.get(this.locationKey(actor));
    if (!row || row.expiresAt <= this.now()) { this.locations.delete(this.locationKey(actor)); return undefined; }
    return structuredClone(row);
  }
  private currentCalendar(principalId: string, deviceId?: string): DeviceCalendarObservation | undefined {
    const key = this.deviceKey(principalId, deviceId), row = this.calendars.get(key);
    if (!row || row.expiresAt <= this.now()) { this.calendars.delete(key); return undefined; }
    return structuredClone(row);
  }
  private contextualFavorite(actor: PersonalAssistantActor): FavoritePlace | undefined {
    const state = this.store.get(actor.principalId), deviceId = actor.deviceId || "local", now = this.now();
    const latest = state.observations.filter((row) => row.kind === "geofence_transition" && row.expiresAt > now && row.value.deviceId === deviceId)
      .sort((left, right) => right.observedAt - left.observedAt)[0];
    if (!latest || latest.value.transition !== "enter" || typeof latest.value.favoriteId !== "string") return undefined;
    return state.favorites.find((favorite) => favorite.id === latest.value.favoriteId);
  }

  private stateResponse(requestId: string, principalId: string, deviceId?: string): PersonalHubToClient {
    return { t: "personal_context_state", requestId, state: this.view(principalId, deviceId || "local") };
  }

  private conflict(requestId: string, actor: PersonalAssistantActor, error: unknown): PersonalHubToClient {
    return { t: "personal_context_result", requestId, ok: false, error: safeError(error), conflict: this.view(actor.principalId, actor.deviceId || "local") };
  }

  async handle(message: PersonalClientToHub, actor: PersonalAssistantActor): Promise<PersonalHubToClient> {
    if (!SERIALIZED_PERSONAL_MUTATIONS.has(message.t)) return this.handleUnlocked(message, actor);
    const key = String(actor.principalId || "invalid");
    const previous = this.mutationTails.get(key) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.mutationTails.set(key, tail);
    await previous.catch(() => undefined);
    try { return await this.handleUnlocked(message, actor); }
    finally {
      release();
      if (this.mutationTails.get(key) === tail) this.mutationTails.delete(key);
    }
  }

  private async handleUnlocked(message: PersonalClientToHub, actor: PersonalAssistantActor): Promise<PersonalHubToClient> {
    const principalId = requireId(actor.principalId, "principal");
    try {
      if (message.t === "personal_context_get") return this.stateResponse(message.requestId, principalId, actor.deviceId);
      if (message.t === "personal_context_update") {
        if (message.patch.pausedSourceIds !== undefined && !actor.owner) throw new Error("only the owner can pause context sources");
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        this.store.updateSettings(principalId, sanitizeSettingsPatch(state, message));
        const effective = this.store.get(principalId).settings;
        this.sources.invalidate(principalId);
        if (!effective.enabled || effective.paused) {
          await this.actions.beginPrincipalErasure(principalId);
          this.actions.endPrincipalErasure(principalId);
          this.clearEphemeralPrincipal(principalId);
          for (const [key, registered] of [...this.registeredConnections]) {
            if (!key.startsWith(`${principalId}\u0000`)) continue;
            this.registeredConnections.delete(key);
            await this.unregisterConnection(principalId, registered);
          }
        }
        else {
          for (const [key, registered] of [...this.registeredConnections]) {
            if (!key.startsWith(`${principalId}\u0000`)) continue;
            const sourceId = key.slice(key.indexOf("\u0000") + 1);
            if (!effective.pausedSourceIds?.includes(sourceId)) continue;
            this.registeredConnections.delete(key);
            await this.unregisterConnection(principalId, registered);
          }
          this.ensureConnections(this.store.get(principalId));
          if (effective.locationMode === "off") {
            const prefix = `${principalId}\u0000`;
            for (const key of this.locations.keys()) if (key.startsWith(prefix)) this.locations.delete(key);
          }
        }
        return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_device_update") {
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        const deviceId = requireId(actor.deviceId || "local", "device id");
        try { new Intl.DateTimeFormat("en", { timeZone: message.profile.timeZone }).format(0); } catch { throw new Error("device timezone is not supported"); }
        const existing = state.deviceProfiles.find((row) => row.deviceId === deviceId);
        const disabledProactiveKinds = [...new Set((message.profile.disabledProactiveKinds || existing?.disabledProactiveKinds || []).map((value) => requireId(value, "proactive kind")))].slice(0, 50);
        this.store.putDeviceProfile(principalId, {
          deviceId,
          locale: message.profile.locale.replace("_", "-"),
          timeZone: message.profile.timeZone,
          proactiveEnabled: message.profile.proactiveEnabled,
          disabledProactiveKinds,
          ...(message.profile.notifications || existing?.notifications ? { notifications: structuredClone(message.profile.notifications || existing!.notifications!) } : {}),
          updatedAt: this.now(),
        });
        return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_notification_feedback") {
        const state = this.store.get(principalId), deviceId = requireId(actor.deviceId || "local", "device id");
        const notification = state.notifications.find((row) => row.id === message.notificationId && row.deviceId === deviceId);
        if (!notification) throw new Error("notification is unavailable for this device");
        this.store.recordNotification(principalId, { ...notification, outcome: message.outcome });
        if (message.disableKind) {
          if (!notification.kind) throw new Error("notification category is unavailable");
          const profile = this.store.get(principalId).deviceProfiles.find((row) => row.deviceId === deviceId);
          if (!profile) throw new Error("device profile is unavailable");
          this.store.putDeviceProfile(principalId, { ...profile, disabledProactiveKinds: [...new Set([...(profile.disabledProactiveKinds || []), notification.kind])].slice(0, 50), updatedAt: this.now() });
        }
        return { t: "personal_context_result", requestId: message.requestId, ok: true, revision: this.store.get(principalId).revision };
      }
      if (message.t === "personal_vehicle_put") {
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        const existing = state.vehicleProfiles.find((row) => row.id === message.profile.id);
        const profile = normalizeVehicleProfile(principalId, message.profile, this.now(), existing, state.vehicleProfiles.length === 0);
        this.store.putVehicleProfile(principalId, profile);
        return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_vehicle_delete") {
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        this.store.deleteVehicleProfile(principalId, requireId(message.profileId, "vehicle profile id"));
        return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_consent_put") {
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        const sourceId = requireId(message.consent.sourceId, "source id");
        const consent: PersonalConsent = { ...structuredClone(message.consent), id: requireId(message.consent.id, "consent id"), sourceId, principalId, policyVersion: 1, grantedAt: this.now(), ...(["device-location", "device-calendar"].includes(sourceId) ? { deviceId: actor.deviceId } : {}) };
        if (!consent.purposes.length || consent.purposes.length > 6 || !consent.fields.length || consent.fields.length > 50) throw new Error("consent needs bounded purposes and fields");
        this.store.putConsent(principalId, consent); return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_consent_revoke") {
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        const consent = state.consents.find((row) => row.id === message.consentId);
        if (consent) {
          this.sources.invalidate(principalId, consent.sourceId);
          await this.actions.cancelAuthorizations(principalId, [consent.id]);
        }
        this.store.revokeConsent(principalId, message.consentId);
        if (consent?.sourceId === "device-location") this.locations.delete(`${principalId}\u0000${consent.deviceId || actor.deviceId || "unknown"}`);
        if (consent?.sourceId === "device-calendar") this.calendars.delete(this.deviceKey(principalId, consent.deviceId || actor.deviceId));
        if (consent) {
          const remaining = this.store.get(principalId).consents.some((row) => row.sourceId === consent.sourceId && !row.revokedAt && (!row.expiresAt || row.expiresAt > this.now()));
          if (!remaining) {
            const key = this.connectionKey(principalId, consent.sourceId), registered = this.registeredConnections.get(key);
            if (registered) await this.unregisterConnection(principalId, registered);
            this.registeredConnections.delete(key);
          }
        }
        return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_device_context_clear") {
        const deviceId = actor.deviceId || "unknown";
        if (message.kind === "location") {
          this.locations.delete(this.deviceKey(principalId, actor.deviceId));
          this.store.deleteObservation(principalId, `device-location:${deviceId}`);
        } else {
          this.calendars.delete(this.deviceKey(principalId, actor.deviceId));
          this.store.deleteObservation(principalId, `device-calendar:${deviceId}`);
        }
        return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_location_put") {
        const state = this.assertOperational(actor), now = this.now();
        if (state.settings.locationMode === "off") throw new Error("location is disabled");
        if (message.observation.observedAt > now + 60_000 || message.observation.expiresAt <= now) throw new Error("location observation is stale or from the future");
        const consent = activeConsent(state, { principalId, sourceId: "device-location", purpose: message.purpose, fields: ["position"], deviceId: actor.deviceId }, now);
        if (!consent) throw new Error("location consent is missing or expired");
        const precision: "precise" | "approximate" = state.settings.locationPrecision === "precise" && message.observation.precision === "precise" ? "precise" : "approximate";
        const observation: DeviceLocationObservation = { ...structuredClone(message.observation), point: normalizeGeoPoint(message.observation.point, precision), precision };
        this.locations.set(this.locationKey(actor), observation);
        this.store.putObservation(principalId, { id: `device-location:${actor.deviceId || "unknown"}`, principalId, sourceId: "device-location", kind: "device_location", purpose: message.purpose, observedAt: observation.observedAt, expiresAt: observation.expiresAt, value: { point: observation.point, precision: observation.precision, source: observation.source }, source: { sourceId: "device-location", observedAt: observation.observedAt, freshness: "live" } });
        return { t: "personal_context_result", requestId: message.requestId, ok: true, revision: this.store.get(principalId).revision };
      }
      if (message.t === "personal_calendar_put") {
        const state = this.assertOperational(actor), now = this.now(), row = structuredClone(message.observation);
        if (row.observedAt > now + 60_000 || row.expiresAt <= now) throw new Error("calendar observation is stale or from the future");
        const consent = activeConsent(state, { principalId, sourceId: "device-calendar", purpose: "calendar", fields: ["busy"], deviceId: actor.deviceId }, now);
        if (!consent) throw new Error("device calendar consent is missing or expired");
        const intervals = row.intervals.filter((interval) => interval.endAt > row.rangeStartAt && interval.startAt < row.rangeEndAt).slice(0, 512);
        this.calendars.set(this.deviceKey(principalId, actor.deviceId), { ...row, intervals });
        this.store.putObservation(principalId, { id: `device-calendar:${actor.deviceId || "unknown"}`, principalId, sourceId: "device-calendar", kind: "device_calendar_busy_summary", purpose: "calendar", observedAt: row.observedAt, expiresAt: row.expiresAt, value: { rangeStartAt: row.rangeStartAt, rangeEndAt: row.rangeEndAt, timeZone: row.timeZone, busyIntervals: intervals.length, truncated: row.truncated, source: row.source }, source: { sourceId: "device-calendar", observedAt: row.observedAt, freshness: "live" } });
        return { t: "personal_context_result", requestId: message.requestId, ok: true, revision: this.store.get(principalId).revision };
      }
      if (message.t === "personal_geofence_transition_put") {
        const state = this.assertOperational(actor), now = this.now(), row: DeviceGeofenceTransitionObservation = structuredClone(message.observation);
        if (state.settings.locationMode !== "background") throw new Error("background location is not enabled");
        if (row.occurredAt > now + 60_000 || row.recordedAt > now + 60_000 || row.occurredAt < now - 7 * 86_400_000) throw new Error("geofence transition is stale or from the future");
        const consent = activeConsent(state, { principalId, sourceId: "device-location", purpose: message.purpose, fields: ["geofence"], deviceId: actor.deviceId }, now);
        if (!consent) throw new Error("geofence consent is missing or expired");
        const favorite = state.favorites.find((item) => item.id === row.geofenceId && item.geofenceRadiusM && item.geofenceTransitions?.includes(row.transition));
        if (!favorite) throw new Error("geofence is not configured for this favorite and transition");
        const retentionMs = Math.max(1, state.settings.retention.observationsDays) * 86_400_000;
        this.store.putObservation(principalId, {
          id: `device-geofence:${actor.deviceId || "local"}:${row.id}`, principalId, sourceId: "device-location", kind: "geofence_transition", purpose: message.purpose,
          observedAt: row.occurredAt, expiresAt: Math.min(row.occurredAt + retentionMs, now + retentionMs),
          value: { favoriteId: favorite.id, transition: row.transition, deviceId: actor.deviceId || "local" },
          source: { sourceId: "device-location", recordId: row.id, observedAt: row.occurredAt, freshness: now - row.occurredAt <= 15 * 60_000 ? "live" : "fresh" },
        });
        if (row.transition === "enter") {
          const visits = this.store.get(principalId).observations.filter((observation) => observation.kind === "geofence_transition"
            && observation.value.favoriteId === favorite.id && observation.value.transition === "enter" && observation.expiresAt > now);
          const signals = visits.map((observation) => ({
            id: `favorite:${favorite.id}:${observation.id}`,
            principalId,
            key: "frequent_place",
            value: favorite.label,
            polarity: "prefer" as const,
            at: observation.observedAt,
            summary: `visit:${favorite.label}`,
            sourceId: "device-location",
            evidenceKind: "visit_summary" as const,
            purposes: favorite.purposes,
          }));
          for (const inferred of inferPreferences(signals, now)) {
            const prior = this.store.get(principalId).preferences.find((preference) => preference.id === inferred.id);
            if (prior?.decision === "rejected" || prior?.kind === "explicit") continue;
            this.store.putPreference(principalId, inferred);
          }
        }
        return { t: "personal_context_result", requestId: message.requestId, ok: true, revision: this.store.get(principalId).revision };
      }
      if (message.t === "personal_favorite_put") {
        const state = this.store.get(principalId); assertRevision(state, message.revision); const now = this.now();
        const existing = state.favorites.find((row) => row.id === message.favorite.id);
        const transitions = [...new Set((message.favorite.geofenceTransitions || []).filter((item): item is "enter" | "exit" => item === "enter" || item === "exit"))];
        const radius = Number(message.favorite.geofenceRadiusM);
        const favorite: FavoritePlace = {
          ...structuredClone(message.favorite), id: requireId(message.favorite.id, "favorite id"), principalId,
          label: String(message.favorite.label || "").trim().slice(0, 100),
          aliases: [...new Set((message.favorite.aliases || []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 20),
          purposes: [...new Set((message.favorite.purposes || []).filter((purpose) => ["nearby", "mobility", "calendar", "events", "weather", "automation"].includes(purpose)))],
          point: normalizeGeoPoint(message.favorite.point, state.settings.locationPrecision),
          source: message.favorite.source || existing?.source || { sourceId: "user", recordId: message.favorite.id, observedAt: now, freshness: "live" },
          ...(Number.isFinite(radius) && radius >= 50 && radius <= 10_000 && transitions.length ? { geofenceRadiusM: Math.round(radius), geofenceTransitions: transitions } : { geofenceRadiusM: undefined, geofenceTransitions: undefined }),
          createdAt: existing?.createdAt || now, updatedAt: now,
        };
        if (!favorite.label || !favorite.purposes.length) throw new Error("favorite needs a label and at least one purpose");
        this.store.putFavorite(principalId, favorite); return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_favorite_delete") {
        const state = this.store.get(principalId); assertRevision(state, message.revision); this.store.deleteFavorite(principalId, message.favoriteId); return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_preference_put") {
        const state = this.store.get(principalId); assertRevision(state, message.revision); const now = this.now(), existing = state.preferences.find((row) => row.id === message.preference.id);
        const preference: PersonalPreference = { ...structuredClone(message.preference), id: requireId(message.preference.id, "preference id"), principalId, kind: "explicit", key: String(message.preference.key).slice(0, 100), value: String(message.preference.value).slice(0, 500), confidence: 1, createdAt: existing?.createdAt || now, updatedAt: now, lastUsedAt: existing?.lastUsedAt };
        this.store.putPreference(principalId, preference); return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_preference_delete") {
        const state = this.store.get(principalId); assertRevision(state, message.revision); this.store.deletePreference(principalId, message.preferenceId); return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_preference_decision") {
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        const existing = state.preferences.find((row) => row.id === message.preferenceId);
        if (!existing) throw new Error("preference is unavailable");
        const now = this.now();
        if (message.decision === "reject") {
          this.store.putPreference(principalId, {
            ...existing,
            confidence: 0,
            decision: "rejected",
            decisionAt: now,
            updatedAt: now,
            expiresAt: now + Math.max(1, state.settings.retention.decisionsDays) * 86_400_000,
          });
        } else {
          const correction = message.decision === "correct" ? message.correction : undefined;
          this.store.putPreference(principalId, {
            ...existing,
            ...(correction ? structuredClone(correction) : {}),
            kind: "explicit",
            confidence: 1,
            decision: correction ? "corrected" : "confirmed",
            decisionAt: now,
            evidence: [...existing.evidence, {
              id: `${existing.id}:${message.decision}:${now}`.slice(0, 200),
              kind: "correction" as const,
              at: now,
              summary: message.decision,
            }].slice(-20),
            updatedAt: now,
            expiresAt: undefined,
          });
        }
        return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_feedback_put") {
        this.assertOperational(actor);
        const state = this.store.get(principalId); assertRevision(state, message.revision); const now = this.now(), feedback = message.feedback;
        const key = String(feedback.key).trim().slice(0, 100), value = String(feedback.value).trim().slice(0, 500);
        if (feedback.kind === "remember" || feedback.kind === "avoid") {
          this.store.putPreference(principalId, {
            id: requireId(feedback.id, "preference id"), principalId, kind: "explicit", key, value,
            polarity: feedback.kind === "avoid" ? "avoid" : "prefer", confidence: 1,
            evidence: [{ id: feedback.id, kind: "statement", at: now, summary: `${feedback.kind}:${feedback.suggestionId}`, sourceId: feedback.sourceId }],
            purposes: [feedback.purpose], createdAt: now, updatedAt: now,
          });
        } else {
          const signalId = requireId(feedback.id, "feedback id"), polarity = feedback.kind === "like" ? "prefer" as const : "avoid" as const;
          this.store.putObservation(principalId, {
            id: signalId, principalId, sourceId: feedback.sourceId || "user-feedback", kind: "preference_signal", purpose: feedback.purpose,
            observedAt: now, expiresAt: now + 180 * 86_400_000,
            value: { key, value, polarity, suggestionId: feedback.suggestionId },
            source: { sourceId: feedback.sourceId || "user-feedback", recordId: feedback.suggestionId, observedAt: now, freshness: "live" },
          });
          const signals = this.store.get(principalId).observations.filter((row) => row.kind === "preference_signal").flatMap((row) => {
            const signal = row.value;
            if (typeof signal.key !== "string" || typeof signal.value !== "string" || !["prefer", "avoid", "require"].includes(String(signal.polarity))) return [];
            return [{ id: row.id, principalId, key: signal.key, value: signal.value, polarity: signal.polarity as "prefer" | "avoid" | "require", at: row.observedAt, summary: `${String(signal.polarity)}:${String(signal.suggestionId || row.id)}`, sourceId: row.sourceId }];
          });
          for (const inferred of inferPreferences(signals, now)) {
            const prior = this.store.get(principalId).preferences.find((row) => row.id === inferred.id);
            if (prior?.decision) continue;
            this.store.putPreference(principalId, inferred);
          }
        }
        return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_source_put") {
        if (!actor.owner) throw new Error("only the owner can configure context sources");
        const state = this.store.get(principalId); assertRevision(state, message.revision); const existing = state.sources.find((row) => row.id === message.source.id);
        const connection = normalizeSource(actor, message, this.now(), existing);
        const created = this.sourceFactory?.(connection);
        if (connection.enabled && !created) throw new Error(`source adapter is unavailable: ${connection.type}`);
        const authorized = state.settings.enabled && !state.settings.paused && !state.settings.pausedSourceIds?.includes(connection.id)
          && state.consents.some((consent) => consent.sourceId === connection.id && !consent.revokedAt && (!consent.expiresAt || consent.expiresAt > this.now()));
        const key = this.connectionKey(principalId, connection.id), prior = this.registeredConnections.get(key);
        if (prior) {
          await this.actions.cancelKinds(principalId, prior.actionKinds);
          await this.unregisterConnection(principalId, prior); this.registeredConnections.delete(key);
        }
        try {
          if (created && authorized) this.registeredConnections.set(key, this.installConnection(connection, created));
          else if (created && "source" in created) await created.dispose?.();
        } catch (error) {
          this.restoreConnection(existing);
          throw error;
        }
        this.store.putSource(principalId, connection); return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_source_delete") {
        if (!actor.owner) throw new Error("only the owner can configure context sources");
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        const key = this.connectionKey(principalId, message.sourceId), registered = this.registeredConnections.get(key);
        if (registered) {
          await this.actions.cancelKinds(principalId, registered.actionKinds);
          await this.unregisterConnection(principalId, registered);
        }
        this.registeredConnections.delete(key); this.sources.invalidate(principalId, message.sourceId);
        this.store.deleteSource(principalId, message.sourceId); return this.stateResponse(message.requestId, principalId, actor.deviceId);
      }
      if (message.t === "personal_source_test") {
        if (!actor.owner) throw new Error("only the owner can test context sources");
        const state = this.assertOperational(actor); this.ensureConnections(state);
        const descriptor = this.sources.descriptors(message.purpose, principalId).find((row) => row.id === message.sourceId);
        if (!descriptor) throw new Error("context source is unavailable for this purpose");
        const testQuery: PersonalContextQuery = { principalId, deviceId: actor.deviceId, purpose: message.purpose, point: this.currentLocation(actor)?.point, text: message.text, limit: 3 };
        if (!this.sourceConsent(state, descriptor, testQuery, actor)) throw new Error("source consent does not authorize the fields required for this test");
        const result = await this.sources.query(descriptor.id, testQuery, { force: true });
        const status = this.sources.statuses(principalId).find((row) => row.descriptor.id === descriptor.id);
        return { t: "personal_source_test_result", requestId: message.requestId, sourceId: descriptor.id, result, status };
      }
      if (message.t === "personal_source_discover") {
        if (!actor.owner) throw new Error("only the owner can discover context sources");
        const state = this.assertOperational(actor);
        const connection = state.sources.find((row) => row.id === message.sourceId && row.enabled);
        if (!connection || state.settings.pausedSourceIds?.includes(connection.id)) throw new Error("context source is unavailable or paused");
        const discovery = await this.discoverConnection(connection);
        return { t: "personal_source_discovery", requestId: message.requestId, discovery };
      }
      if (message.t === "personal_context_query") return await this.queryContext(message.requestId, message.query, actor);
      if (["personal_action_preview", "personal_action_approve", "personal_action_execute"].includes(message.t)) this.assertOperational(actor);
      if (message.t === "personal_action_preview") return { t: "personal_action_view", requestId: message.requestId, action: publicActionPlan(this.actions.preview(principalId, message.kind, structuredClone(message.payload), message.idempotencyKey, actor.deviceId)) };
      if (message.t === "personal_action_approve") return { t: "personal_action_view", requestId: message.requestId, action: publicActionPlan(this.actions.approve(principalId, message.planId, message.challenge, actor.deviceId)) };
      if (message.t === "personal_action_execute") return { t: "personal_action_view", requestId: message.requestId, action: publicActionPlan(await this.actions.execute(principalId, message.planId, actor.deviceId)) };
      if (message.t === "personal_action_handoff_result") return { t: "personal_action_view", requestId: message.requestId, action: publicActionPlan(this.actions.completeClientHandoff(principalId, message.planId, message.success, actor.deviceId, message.error)) };
      if (message.t === "personal_action_cancel") return { t: "personal_action_view", requestId: message.requestId, action: publicActionPlan(await this.actions.cancel(principalId, message.planId)) };
      if (message.t === "personal_data_export") return { t: "personal_data_export", requestId: message.requestId, data: this.store.export(principalId) };
      if (message.t === "personal_data_prune") { this.store.prune(principalId); return this.stateResponse(message.requestId, principalId, actor.deviceId); }
      if (message.t === "personal_data_category_erase") {
        const state = this.store.get(principalId); assertRevision(state, message.revision);
        if (message.category === "sources" && !actor.owner) throw new Error("only the owner can erase context source configuration");
        const quiesceActions = ["actions", "consents", "sources"].includes(message.category);
        if (quiesceActions) await this.actions.beginPrincipalErasure(principalId);
        try {
          if (message.category === "sources") {
            for (const [key, registered] of this.registeredConnections) {
              if (!key.startsWith(`${principalId}\u0000`)) continue;
              await this.unregisterConnection(principalId, registered); this.registeredConnections.delete(key);
            }
          }
          if (["observations", "consents", "sources"].includes(message.category)) {
            this.sources.invalidate(principalId);
            this.clearEphemeralPrincipal(principalId);
          }
          this.store.eraseCategory(principalId, message.category);
          return this.stateResponse(message.requestId, principalId, actor.deviceId);
        } finally {
          if (quiesceActions) this.actions.endPrincipalErasure(principalId);
        }
      }
      if (message.t === "personal_data_erase") {
        await this.actions.beginPrincipalErasure(principalId);
        try {
          this.sources.invalidate(principalId); this.clearEphemeralPrincipal(principalId);
          for (const [key, registered] of this.registeredConnections) {
            if (!key.startsWith(`${principalId}\u0000`)) continue;
            await this.unregisterConnection(principalId, registered); this.registeredConnections.delete(key);
          }
          return { t: "personal_data_erased", requestId: message.requestId, ok: this.store.erase(principalId) };
        } finally {
          this.actions.endPrincipalErasure(principalId);
        }
      }
      throw new Error("unsupported personal context message");
    } catch (error) { return this.conflict(message.requestId, actor, error); }
  }

  private assertOperational(actor: PersonalAssistantActor): PersonalContextState {
    if (!this.allowPersonalContext(actor)) throw new Error("personal context is blocked by policy");
    const state = this.store.get(actor.principalId);
    if (!state.settings.enabled || state.settings.paused) throw new Error("personal assistant is disabled or paused");
    return state;
  }

  private sourceConsent(
    state: PersonalContextState,
    descriptor: ContextSourceDescriptor,
    query: PersonalContextQuery,
    actor: PersonalAssistantActor,
  ): PersonalConsent | undefined {
    const fields = new Set<string>(), exactFields = new Set<string>();
    const connection = state.sources.find((row) => row.id === descriptor.id);
    if ((descriptor.transport === "device" && descriptor.purposes.includes("calendar")) || connection?.type === "caldav") fields.add("busy");
    if (connection?.type === "caldav" && connection.config.access === "details") exactFields.add("details");
    if (descriptor.transport !== "device") {
      if (query.point) fields.add("position");
      if (query.text?.trim()) fields.add("query");
      if (query.startAt !== undefined || query.endAt !== undefined) fields.add("time");
      if (query.filters && Object.keys(query.filters).length) fields.add("filters");
    }
    return activeConsent(state, {
      principalId: actor.principalId,
      sourceId: descriptor.id,
      purpose: query.purpose,
      fields: [...fields],
      exactFields: [...exactFields],
      deviceId: actor.deviceId,
    }, this.now());
  }

  private suggestionActions(
    suggestion: ContextSuggestion,
    query: PersonalContextQuery,
    actor: PersonalAssistantActor,
    state: PersonalContextState,
    deviceTimeZone: string,
  ): PersonalActionView[] {
    const actions: PersonalActionView[] = [];
    const seen = new Set<string>();
    const add = (kind: string, payload: Record<string, unknown>): void => {
      if (actions.length >= 8) return;
      const fingerprint = createHash("sha256").update(JSON.stringify([
        suggestion.id,
        kind,
        payload,
        actor.deviceId || "local",
        Math.floor(this.now() / (10 * 60_000)),
      ])).digest("hex").slice(0, 32);
      const key = `suggestion:${fingerprint}`;
      if (seen.has(key)) return;
      seen.add(key);
      try { actions.push(publicActionPlan(this.actions.preview(actor.principalId, kind, payload, key, actor.deviceId))); }
      catch { /* unavailable, invalid or unauthorized actions are not offered */ }
    };
    const candidate = suggestion.candidate;
    const data = candidate.data && typeof candidate.data === "object" && !Array.isArray(candidate.data)
      ? candidate.data as Record<string, unknown>
      : {};
    const candidateUrls = [data.url, ...candidate.sources.map((source) => source.url)]
      .filter((value): value is string => typeof value === "string" && value.length <= 2_000);
    for (const value of candidateUrls) {
      try {
        const url = new URL(value);
        if (url.protocol === "https:") add("navigation.open", { url: url.toString(), title: candidate.title });
      } catch { /* malformed source URLs are not actionable */ }
      if (actions.length) break;
    }
    if (candidate.point) {
      const label = candidate.title.slice(0, 160);
      const coordinates = `${candidate.point.lat},${candidate.point.lng}`;
      add("navigation.open", { url: `geo:${coordinates}?q=${encodeURIComponent(`${coordinates}(${label})`)}`, title: candidate.title });
    }

    const sourceIds = new Set(candidate.sources.map((source) => source.sourceId));
    for (const connection of state.sources) {
      const registered = this.registeredConnections.get(this.connectionKey(actor.principalId, connection.id));
      if (!registered) continue;
      for (const kind of registered.actionKinds) {
        if (kind.startsWith(`mcp:${connection.id}:`) && sourceIds.has(connection.id)) {
          add(kind, {
            query: query.text || candidate.title,
            purpose: query.purpose,
            ...(query.startAt === undefined ? {} : { startAt: query.startAt }),
            ...(query.endAt === undefined ? {} : { endAt: query.endAt }),
          });
        } else if (kind.startsWith(`home-assistant:${connection.id}:`) && sourceIds.has(connection.id) && typeof data.entityId === "string") {
          add(kind, { entityIds: [data.entityId], data: {} });
        } else if (kind === `calendar.caldav:${connection.id}:create` && ["event", "calendar_event"].includes(candidate.kind)) {
          const startAt = Number(data.startAt), endAt = Number(data.endAt);
          if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt || !connection.allowedResources[0]) continue;
          const uid = `jarvis-${createHash("sha256").update(JSON.stringify([candidate.title.trim().toLowerCase(), startAt, endAt, data.locationName || data.address || ""])).digest("hex").slice(0, 32)}@local`;
          add(kind, {
            calendarHref: connection.allowedResources[0], uid, title: candidate.title, startAt, endAt,
            timeZone: typeof data.timeZone === "string" ? data.timeZone : typeof data.timezone === "string" ? data.timezone : deviceTimeZone,
            ...((typeof data.locationName === "string" || typeof data.address === "string") ? { location: String(data.locationName || data.address).slice(0, 500) } : {}),
          });
        }
      }
    }
    return actions;
  }

  async queryContext(requestId: string, input: Omit<PersonalContextQuery, "principalId" | "deviceId">, actor: PersonalAssistantActor, signal?: AbortSignal): Promise<PersonalContextQueryResponse> {
    throwIfAborted(signal);
    const state = this.assertOperational(actor);
    const location = this.currentLocation(actor), contextualFavorite = this.contextualFavorite(actor);
    const requestedProfileId = typeof input.filters?.vehicleProfileId === "string" ? input.filters.vehicleProfileId : undefined;
    const vehicleProfile = requestedProfileId
      ? state.vehicleProfiles.find((row) => row.id === requestedProfileId)
      : state.vehicleProfiles.find((row) => row.isDefault) || state.vehicleProfiles[0];
    if (requestedProfileId && !vehicleProfile) throw new Error("vehicle profile is unavailable");
    const requestedFavoriteId = typeof input.filters?.favoriteId === "string" ? input.filters.favoriteId : undefined;
    const reference = typeof input.filters?.reference === "string" ? normalizedAlias(input.filters.reference) : "";
    let selectedFavorite = requestedFavoriteId ? state.favorites.find((row) => row.id === requestedFavoriteId) : undefined;
    if (requestedFavoriteId && !selectedFavorite) throw new Error("favorite place is unavailable");
    if (!selectedFavorite && reference) {
      const matches = state.favorites.filter((row) => [row.label, ...row.aliases].some((alias) => normalizedAlias(alias) === reference));
      if (matches.length > 1) throw new Error("favorite alias is ambiguous; choose a favorite id");
      selectedFavorite = matches[0];
    }
    if (selectedFavorite && !selectedFavorite.purposes.includes(input.purpose)) throw new Error("favorite place is not authorized for this purpose");
    const requireCalendarFree = input.filters?.requireCalendarFree === true;
    if ((input.startAt === undefined) !== (input.endAt === undefined)) throw new Error("context time window requires both startAt and endAt");
    const rawMaxDuration = Number(input.filters?.maxDurationMinutes);
    const maxDurationMinutes = Number.isFinite(rawMaxDuration) && rawMaxDuration > 0 && rawMaxDuration <= 10_080 ? rawMaxDuration : undefined;
    const dateText = typeof input.filters?.dateText === "string" ? input.filters.dateText : undefined;
    const timeText = typeof input.filters?.timeText === "string" ? input.filters.timeText : undefined;
    const requireOpen = input.filters?.requireOpen === true;
    const supportedRestrictions = new Set(["vegan", "vegetarian", "wheelchair", "gluten_free", "halal", "kosher"]);
    const restrictions = Array.isArray(input.filters?.restrictions)
      ? [...new Set(input.filters.restrictions.map(String).filter((value) => supportedRestrictions.has(value)))].slice(0, 10)
      : [];
    const deviceProfile = state.deviceProfiles.find((row) => row.deviceId === (actor.deviceId || "local"));
    const deviceTimeZone = deviceProfile?.timeZone || "UTC";
    const locale = effectiveContextLocale(state, actor, input.locale);
    const intentWindow = resolvePersonalIntentTimeWindow({ dateText, timeText }, { now: this.now(), timeZone: deviceTimeZone });
    const baseFilters = structuredClone(input.filters || {}); delete baseFilters.vehicleProfileId; delete baseFilters.favoriteId; delete baseFilters.reference; delete baseFilters.requireCalendarFree; delete baseFilters.maxDurationMinutes; delete baseFilters.dateText; delete baseFilters.timeText; delete baseFilters.requireOpen; delete baseFilters.restrictions;
    const query: PersonalContextQuery = {
      ...structuredClone(input), filters: baseFilters, principalId: actor.principalId, deviceId: actor.deviceId,
      locale,
      point: input.point || selectedFavorite?.point || location?.point || (contextualFavorite?.purposes.includes(input.purpose) ? contextualFavorite.point : undefined),
      ...(input.startAt !== undefined ? { startAt: input.startAt } : intentWindow ? { startAt: intentWindow.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : intentWindow ? { endAt: intentWindow.endAt } : {}),
      limit: Math.max(1, Math.min(50, input.limit || 10)),
    };
    this.ensureConnections(state);
    const valhallaConnections = state.sources.filter((source) => source.type === "valhalla");
    const routeSourceIds = new Set(["valhalla", ...valhallaConnections.filter((source) => source.config.matrix !== true).map((source) => source.id)]);
    const matrixSourceIds = new Set(["valhalla-matrix", ...valhallaConnections.filter((source) => source.config.matrix === true).map((source) => source.id)]);
    const hasDestination = Number.isFinite(Number(query.filters?.destinationLat)) && Number.isFinite(Number(query.filters?.destinationLng));
    const hasDestinations = hasDestination || (Array.isArray(query.filters?.destinationPoints) && query.filters.destinationPoints.length > 0);
    const vehicleSourceIds = new Set(["open-charge-map", ...state.sources.filter((source) => source.type === "open_charge_map").map((source) => source.id)]);
    const sourceRequests = this.sources.descriptors(query.purpose, actor.principalId).filter((descriptor) =>
      (!routeSourceIds.has(descriptor.id) || hasDestination)
      && (!matrixSourceIds.has(descriptor.id) || hasDestinations))
      .map((descriptor) => {
        if (!vehicleProfile || !vehicleSourceIds.has(descriptor.id) || !["nearby", "mobility"].includes(query.purpose)) return { descriptor, query };
        const filters = { ...(query.filters || {}) };
        if (filters.connectorTypeId === undefined && filters.connectorTypeIds === undefined) filters.connectorTypeIds = vehicleProfile.connectorTypeIds.map(String);
        return { descriptor, query: { ...query, filters } as PersonalContextQuery };
      })
      .filter(({ descriptor, query: sourceQuery }) => this.sourceConsent(state, descriptor, sourceQuery, actor));
    const allowed = sourceRequests.map(({ descriptor }) => descriptor);
    const settled = await Promise.allSettled(sourceRequests.map(({ descriptor, query: sourceQuery }) => this.sources.query(descriptor.id, sourceQuery, { signal })));
    throwIfAborted(signal);
    const results: ContextSourceResult[] = [], errors: Array<{ sourceId: string; error: string }> = [];
    settled.forEach((item, index) => item.status === "fulfilled" ? results.push(item.value) : errors.push({ sourceId: allowed[index].id, error: safeError(item.reason) }));
    if (query.point && !results.some((result) => result.items.some((candidate) => candidate.kind === "route_matrix"))) {
      const targets = results.flatMap((result) => result.items).filter((candidate) => candidate.point && !["weather_forecast", "calendar_availability", "calendar_event", "route_matrix"].includes(candidate.kind))
        .filter((candidate, index, rows) => rows.findIndex((row) => row.point && candidate.point && Math.abs(row.point.lat - candidate.point.lat) < 1e-6 && Math.abs(row.point.lng - candidate.point.lng) < 1e-6) === index)
        .slice(0, 25);
      if (targets.length) {
        const destinationPoints = targets.map((candidate) => `${candidate.point!.lat},${candidate.point!.lng}`);
        const matrixQuery: PersonalContextQuery = {
          principalId: actor.principalId, deviceId: actor.deviceId, purpose: "mobility", point: query.point, locale: query.locale, limit: destinationPoints.length,
          filters: { destinationPoints, ...(typeof query.filters?.mode === "string" ? { mode: query.filters.mode } : {}) },
        };
        const matrixAllowed = this.sources.descriptors("mobility", actor.principalId).filter((descriptor) => matrixSourceIds.has(descriptor.id)
          && this.sourceConsent(state, descriptor, matrixQuery, actor));
        const matrixSettled = await Promise.allSettled(matrixAllowed.map((descriptor) => this.sources.query(descriptor.id, matrixQuery, { signal })));
        throwIfAborted(signal);
        matrixSettled.forEach((item, index) => item.status === "fulfilled" ? results.push(item.value) : errors.push({ sourceId: matrixAllowed[index].id, error: safeError(item.reason) }));
      }
    }
    if (query.purpose === "mobility" && query.point && !results.some((result) => result.items.some((candidate) => candidate.kind === "route"))) {
      const destinations = results.flatMap((result) => result.items)
        .filter((candidate) => candidate.point && !["weather_forecast", "calendar_availability", "calendar_event", "route_matrix", "route"].includes(candidate.kind))
        .filter((candidate, index, rows) => rows.findIndex((row) => row.point && candidate.point && Math.abs(row.point.lat - candidate.point.lat) < 1e-6 && Math.abs(row.point.lng - candidate.point.lng) < 1e-6) === index)
        .slice(0, 3);
      const routeQuery = (destination: (typeof destinations)[number]): PersonalContextQuery => ({
        principalId: actor.principalId,
        deviceId: actor.deviceId,
        purpose: "mobility",
        point: query.point,
        locale: query.locale,
        limit: 1,
        filters: {
          destinationLat: destination.point!.lat,
          destinationLng: destination.point!.lng,
          ...(typeof query.filters?.mode === "string" ? { mode: query.filters.mode } : {}),
        },
      });
      const routeRequests = this.sources.descriptors("mobility", actor.principalId).filter((descriptor) => routeSourceIds.has(descriptor.id))
        .flatMap((descriptor) => destinations.map((destination) => ({ descriptor, destination })))
        .filter(({ descriptor, destination }) => this.sourceConsent(state, descriptor, routeQuery(destination), actor));
      const routeSettled = await Promise.allSettled(routeRequests.map(({ descriptor, destination }) => this.sources.query(descriptor.id, routeQuery(destination), { signal })));
      throwIfAborted(signal);
      routeSettled.forEach((item, index) => item.status === "fulfilled" ? results.push(item.value) : errors.push({ sourceId: routeRequests[index].descriptor.id, error: safeError(item.reason) }));
    }
    if (["events", "mobility"].includes(query.purpose)) {
      const primaryWindows = results.flatMap((result) => result.items).flatMap((candidate) => {
        if (!candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) return [];
        const startAt = Number((candidate.data as Record<string, unknown>).startAt), rawEndAt = Number((candidate.data as Record<string, unknown>).endAt);
        return Number.isFinite(startAt) ? [{ startAt, endAt: Number.isFinite(rawEndAt) && rawEndAt > startAt ? rawEndAt : startAt + 2 * 3_600_000 }] : [];
      }).sort((left, right) => left.startAt - right.startAt).slice(0, 20);
      const startAt = input.startAt ?? primaryWindows[0]?.startAt;
      const requestedEndAt = input.endAt ?? (primaryWindows.length ? Math.max(...primaryWindows.map((row) => row.endAt)) : undefined);
      const endAt = startAt === undefined || requestedEndAt === undefined ? undefined : Math.min(requestedEndAt, startAt + 31 * 86_400_000);
      if (startAt !== undefined && endAt !== undefined && endAt > startAt) {
        const calendarQuery: PersonalContextQuery = { principalId: actor.principalId, deviceId: actor.deviceId, purpose: "calendar", locale: query.locale, startAt, endAt, limit: 50 };
        const calendarAllowed = this.sources.descriptors("calendar", actor.principalId).filter((descriptor) =>
          !allowed.some((row) => row.id === descriptor.id)
          && this.sourceConsent(state, descriptor, calendarQuery, actor),
        );
        const calendarSettled = await Promise.allSettled(calendarAllowed.map((descriptor) => this.sources.query(descriptor.id, calendarQuery, { signal })));
        throwIfAborted(signal);
        calendarSettled.forEach((item, index) => item.status === "fulfilled" ? results.push(item.value) : errors.push({ sourceId: calendarAllowed[index].id, error: safeError(item.reason) }));
      }
    }
    const openAt = requireOpen && (timeText || !dateText) ? (query.startAt ?? this.now()) : undefined;
    const explicitlyFilteredCandidates = applyExplicitCandidateFilters(results.flatMap((result) => result.items), { openAt, timeZone: deviceTimeZone, origin: query.point, restrictions });
    const routedCandidates = applyRouteMatrixToCandidates(explicitlyFilteredCandidates, { maxDurationMinutes });
    const vehicleCandidates = applyVehicleProfileToCandidates(routedCandidates, vehicleProfile, query.point);
    const candidates = composeMultiContextCandidates({ candidates: vehicleCandidates, purpose: query.purpose, requireCalendarFree });
    const ranking = rankContextCandidatesDetailed({ candidates, preferences: state.preferences, purpose: query.purpose, locale: query.locale, origin: query.point, now: this.now(), limit: query.limit });
    throwIfAborted(signal);
    if (ranking.usedPreferenceIds.length) this.store.markPreferencesUsed(actor.principalId, ranking.usedPreferenceIds, this.now());
    const suggestions = ranking.suggestions.map((suggestion) => ({
      ...suggestion,
      actions: this.suggestionActions(suggestion, query, actor, state, deviceTimeZone),
    }));
    return { t: "personal_context_suggestions", requestId, revision: this.store.get(actor.principalId).revision, results, errors, suggestions, diagnostics: ranking.diagnostics };
  }

  async contextForTurn(input: Omit<PersonalContextQuery, "principalId" | "deviceId">, actor: PersonalAssistantActor, signal?: AbortSignal): Promise<PersonalTurnContext> {
    const queryLocale = effectiveContextLocale(this.store.get(actor.principalId), actor, input.locale);
    const locale = normalizeContextRankingLocale(queryLocale);
    const response = await this.queryContext(randomUUID(), { ...input, locale: queryLocale }, actor, signal);
    const rows = response.suggestions.slice(0, 8).map((suggestion) => ({
      id: suggestion.id,
      kind: suggestion.kind,
      title: suggestion.candidate.title.slice(0, 300),
      score: Number(suggestion.score.toFixed(3)),
      reasons: suggestion.reasons.slice(0, 4),
      caveats: suggestion.caveats.slice(0, 4),
      facts: minimizedFacts(input.purpose, suggestion.candidate.data),
      sources: suggestion.sources.slice(0, 8).map(({ sourceId, recordId, observedAt, freshness, attribution, url }) => ({ sourceId, recordId, observedAt, freshness, attribution, url })),
    }));
    const unavailable = response.errors.slice(0, 8).map(({ sourceId }) => sourceId);
    const missingData = unavailable.map((sourceId) => ({ sourceId, explanation: localizeContextSourceUnavailable(sourceId, locale) }));
    const discardedCandidates = localizeContextRankingDiagnostics(response.diagnostics || [], locale).slice(0, 8).map((diagnostic) => ({
      candidateId: diagnostic.candidateId,
      kind: diagnostic.kind,
      reasonCodes: diagnostic.reasonCodes.slice(0, 8),
      explanations: diagnostic.reasons.slice(0, 8),
    }));
    const agentText = `<jarvis_personal_context purpose="${input.purpose}" locale="${locale}" generated_at="${this.now()}">\n${JSON.stringify({ locale, results: rows, unavailableSources: unavailable, missingData, discardedCandidates })}\n</jarvis_personal_context>`;
    return { response, agentText };
  }
}

function minimizedFacts(purpose: ContextPurpose, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const common = ["category", "type", "displayName", "straightLineDistanceM", "routedDistanceM", "durationSeconds", "mode", "openingHours", "availability", "operationalStatus", "numberOfPoints", "usageCost", "operator", "connections", "vehicleCompatibility", "startAt", "endAt", "allDay", "state", "url", "locationName", "address", "region", "categories", "languages", "availability", "complete", "timezone", "current", "hourly", "context", "entityId", "lastChanged", "lastUpdated"];
  const byPurpose: Partial<Record<ContextPurpose, Set<string>>> = {
    nearby: new Set(common.slice(0, 15)), mobility: new Set([...common.slice(0, 9), "vehicleCompatibility", "context"]), calendar: new Set(common.slice(15, 31)),
    events: new Set([...common.slice(15, 27), "context"]), weather: new Set(["timezone", "current", "hourly"]), automation: new Set(["entityId", "state", "lastChanged", "lastUpdated"]),
  };
  const output: Record<string, unknown> = {};
  for (const key of byPurpose[purpose] || []) {
    if (!(key in input)) continue;
    const serialized = JSON.stringify(input[key]);
    if (serialized !== undefined && serialized.length <= 4_000) output[key] = structuredClone(input[key]);
  }
  return output;
}
