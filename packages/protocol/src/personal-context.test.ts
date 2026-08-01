import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAL_SOURCE_DISCOVERY_LIMITS,
  isPersonalClientMessage,
  type ContextSourceDescriptor,
  type PersonalSourceDiscovery,
} from "./personal-context.js";

test("context source descriptors carry retention and review metadata without breaking legacy records", () => {
  const current: ContextSourceDescriptor = {
    id: "events",
    label: "Events",
    purposes: ["events"],
    costClass: "free",
    transport: "http",
    certification: "audited",
    license: "CC BY 4.0",
    cachePolicy: "15m conditional cache",
    retentionPolicy: "Raw responses are not persisted; derived results expire after 15m",
    lastReviewedAt: "2026-08-01",
  };
  const legacy: ContextSourceDescriptor = {
    id: "legacy",
    label: "Legacy",
    purposes: ["nearby"],
    costClass: "local",
    transport: "builtin",
    certification: "first_party",
  };

  assert.equal(current.retentionPolicy?.includes("not persisted"), true);
  assert.equal(current.lastReviewedAt, "2026-08-01");
  assert.equal(legacy.retentionPolicy, undefined);
  assert.equal(legacy.lastReviewedAt, undefined);
});

test("personal message validator accepts bounded typed requests", () => {
  assert.equal(isPersonalClientMessage({ t: "personal_context_get", requestId: "r1" }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_context_update", requestId: "r1", revision: 2, patch: { enabled: true } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_context_update", requestId: "r1", revision: 2, patch: { pausedSourceIds: ["device-calendar", "caldav-work"] } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_device_update", requestId: "r1", revision: 2, profile: { locale: "pt-BR", timeZone: "America/Sao_Paulo", proactiveEnabled: true } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_device_context_clear", requestId: "r1", kind: "location" }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_device_context_clear", requestId: "r1", kind: "everything" }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_device_update", requestId: "r1", revision: 2, profile: { locale: "pt-BR", timeZone: "America/Sao_Paulo", proactiveEnabled: true, notifications: { quietStart: "22:00", quietEnd: "08:00", maxPerDay: 3, cooldownMinutes: 30, minScore: 0.7 } } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_vehicle_put", requestId: "r1", revision: 2, profile: { id: "car", label: "Carro", connectorTypeIds: [25, 27], maxAcceptedPowerKw: 150, rangeKm: 420, minimumPreferredPowerKw: 50, preferredOperators: ["Rede A"], isDefault: true } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_vehicle_delete", requestId: "r1", revision: 2, profileId: "car" }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_location_put", requestId: "r1", purpose: "nearby", observation: { observedAt: 10, expiresAt: 20, point: { lat: -19.9, lng: -43.9, accuracyM: 20 }, precision: "precise", source: "android" } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_calendar_put", requestId: "r1", observation: { observedAt: 10, expiresAt: 20, rangeStartAt: 10, rangeEndAt: 100, timeZone: "America/Sao_Paulo", intervals: [{ startAt: 30, endAt: 40, allDay: false }], truncated: false, source: "android" } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_geofence_transition_put", requestId: "r1", purpose: "events", observation: { id: "tr-1", geofenceId: "home", transition: "enter", occurredAt: 10, recordedAt: 11, source: "android" } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_action_preview", requestId: "r1", kind: "navigation.open", payload: { url: "geo:1,2" } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_action_handoff_result", requestId: "r1", planId: "plan", success: true }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_data_category_erase", requestId: "r1", revision: 2, category: "observations", confirmation: "ERASE_CATEGORY" }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_notification_feedback", requestId: "r1", notificationId: "n1", outcome: "dismissed", disableKind: true }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_notification_feedback", requestId: "r1", notificationId: "n1", outcome: "ignored" }), true);
});

test("personal message validator rejects identity injection, unknown settings and unsafe location envelopes", () => {
  assert.equal(isPersonalClientMessage({ t: "personal_context_get", requestId: "" }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_update", requestId: "r", revision: 0, patch: { principalId: "other" } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_device_update", requestId: "r", revision: 0, profile: { locale: "pt-BR", timeZone: "../secrets", proactiveEnabled: true } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_device_update", requestId: "r", revision: 0, profile: { locale: "pt-BR", timeZone: "UTC", proactiveEnabled: true, notifications: { quietStart: "25:00", quietEnd: "08:00", maxPerDay: 3, cooldownMinutes: 30, minScore: 0.7 } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_vehicle_put", requestId: "r", revision: 0, profile: { id: "car", label: "Carro", connectorTypeIds: [], preferredOperators: [], isDefault: true } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_vehicle_put", requestId: "r", revision: 0, profile: { id: "car", label: "Carro", connectorTypeIds: [25], maxAcceptedPowerKw: 50, minimumPreferredPowerKw: 100, preferredOperators: [], isDefault: true } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_vehicle_put", requestId: "r", revision: 0, profile: { id: "car", label: "Carro", connectorTypeIds: [25], preferredOperators: [], isDefault: true, principalId: "other" } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_location_put", requestId: "r", purpose: "nearby", observation: { observedAt: 10, expiresAt: 9, point: { lat: 91, lng: 0 }, precision: "precise", source: "web" } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_calendar_put", requestId: "r", observation: { observedAt: 10, expiresAt: 20, rangeStartAt: 10, rangeEndAt: 9, timeZone: "UTC", intervals: [], truncated: false, source: "ios" } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_geofence_transition_put", requestId: "r", purpose: "events", observation: { id: "tr-1", geofenceId: "home", transition: "enter", occurredAt: 10, recordedAt: 10 + 8 * 86_400_000, source: "android" } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_action_preview", requestId: "r", kind: "navigation.open", payload: { huge: "x".repeat(40_000) } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_action_handoff_result", requestId: "r", planId: "plan", success: false, error: "x".repeat(1_001) }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_data_erase", requestId: "r", confirmation: "yes" }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_data_category_erase", requestId: "r", revision: 0, category: "everything", confirmation: "ERASE_CATEGORY" }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_notification_feedback", requestId: "r", notificationId: "n1", outcome: "unknown", disableKind: true }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_get", requestId: "r", principalId: "other" }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_update", requestId: "r", revision: 0, patch: { retention: { observationsDays: 999 } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_update", requestId: "r", revision: 0, patch: { notifications: { quietStart: "25:00" } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_update", requestId: "r", revision: 0, patch: { pausedSourceIds: ["calendar", "calendar"] } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_update", requestId: "r", revision: 0, patch: { pausedSourceIds: [""] } }), false);
});

test("personal message validator accepts bounded feedback and rejects oversized memory text", () => {
  assert.equal(isPersonalClientMessage({ t: "personal_feedback_put", requestId: "r", revision: 0, feedback: { id: "f", suggestionId: "s", purpose: "nearby", kind: "like", key: "category", value: "cafe", sourceId: "osm" } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_feedback_put", requestId: "r", revision: 0, feedback: { id: "f", suggestionId: "s", purpose: "nearby", kind: "like", key: "category", value: "x".repeat(501) } }), false);
});

test("personal message validator accepts source health tests only for declared purposes", () => {
  assert.equal(isPersonalClientMessage({ t: "personal_source_test", requestId: "r", sourceId: "osm", purpose: "nearby", text: "cafe" }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_source_test", requestId: "r", sourceId: "osm", purpose: "invalid" }), false);
});

test("personal source discovery is an explicit bounded source-only command", () => {
  assert.equal(isPersonalClientMessage({ t: "personal_source_discover", requestId: "r", sourceId: "caldav-work" }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_source_discover", requestId: "r", sourceId: "" }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_source_discover", requestId: "r", sourceId: "caldav-work", principalId: "other" }), false);
  assert.deepEqual(PERSONAL_SOURCE_DISCOVERY_LIMITS, { calendars: 100, tools: 100, resources: 100 });

  const discovery: PersonalSourceDiscovery = {
    sourceId: "caldav-work",
    state: "ready",
    health: "healthy",
    latencyMs: 12,
    calendars: [{ id: "calendar-1", name: "Work", href: "https://calendar.example/work/", allowed: true }],
    tools: [],
    resources: [],
    truncated: { calendars: false, tools: false, resources: false },
  };
  assert.deepEqual(Object.keys(discovery).sort(), ["calendars", "health", "latencyMs", "resources", "sourceId", "state", "tools", "truncated"]);
});

test("personal message validator bounds consent, favorite and preference envelopes", () => {
  assert.equal(isPersonalClientMessage({
    t: "personal_consent_put", requestId: "r", revision: 0,
    consent: { id: "c", sourceId: "osm", purposes: ["nearby"], fields: ["position"], expiresAt: Date.now() + 1_000 },
  }), true);
  assert.equal(isPersonalClientMessage({
    t: "personal_consent_put", requestId: "r", revision: 0,
    consent: { id: "c", sourceId: "osm", purposes: ["unknown"], fields: ["position"] },
  }), false);
  assert.equal(isPersonalClientMessage({
    t: "personal_consent_put", requestId: "r", revision: 0,
    consent: { id: "c", sourceId: "osm", purposes: ["nearby"], fields: ["x".repeat(201)] },
  }), false);

  const favorite = { id: "home", label: "Casa", aliases: ["lar"], point: { lat: -19.9, lng: -43.9 }, purposes: ["nearby"] };
  assert.equal(isPersonalClientMessage({ t: "personal_favorite_put", requestId: "r", revision: 0, favorite }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_favorite_put", requestId: "r", revision: 0, favorite: { ...favorite, point: { lat: -19.9, lng: -43.9, principalId: "other" } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_favorite_put", requestId: "r", revision: 0, favorite: { ...favorite, geofenceRadiusM: 100 } }), false);

  const preference = { id: "p", key: "food", value: "vegetarian", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"] };
  assert.equal(isPersonalClientMessage({ t: "personal_preference_put", requestId: "r", revision: 0, preference }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_preference_put", requestId: "r", revision: 0, preference: { ...preference, lastUsedAt: 123 } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_preference_put", requestId: "r", revision: 0, preference: { ...preference, evidence: [{ id: "e", kind: "statement", at: 1, summary: "x".repeat(501) }] } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_preference_decision", requestId: "r", revision: 0, preferenceId: "p", decision: "confirm" }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_preference_decision", requestId: "r", revision: 0, preferenceId: "p", decision: "correct", correction: { key: "diet", value: "vegan", polarity: "require", purposes: ["nearby"] } }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_preference_decision", requestId: "r", revision: 0, preferenceId: "p", decision: "correct" }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_preference_decision", requestId: "r", revision: 0, preferenceId: "p", decision: "reject", correction: { key: "x", value: "y", polarity: "prefer", purposes: ["nearby"] } }), false);
});

test("personal message validator bounds source configuration and query filters", () => {
  const source = { id: "events", type: "open_events", label: "Events", enabled: true, config: {}, allowedResources: [], allowedActions: [] };
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source }), true);
  const stdio = { ...source, type: "mcp_stdio", endpoint: "node", stdioEnv: { set: { NODE_OPTIONS: "--no-warnings" }, remove: ["OLD_SETTING"] } };
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: stdio }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: { ...source, stdioEnv: { set: {}, remove: [] } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: { ...stdio, config: { "env.NODE_OPTIONS": "--inspect" } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: { ...stdio, stdioEnv: { set: { API_TOKEN: "secret" }, remove: [] } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: { ...stdio, stdioEnv: { set: { NODE_OPTIONS: "x" }, remove: ["NODE_OPTIONS"] } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: { ...source, type: "paid_vendor" } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: { ...source, secretRef: "literal-secret" } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: { ...source, config: { api_key: "literal-secret" } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_source_put", requestId: "r", revision: 0, source: { ...source, config: { blob: "x".repeat(33_000) } } }), false);

  assert.equal(isPersonalClientMessage({
    t: "personal_context_query", requestId: "r",
    query: { purpose: "events", point: { lat: -19.9, lng: -43.9 }, locale: "pt-BR", limit: 20, filters: { categories: ["music"], radiusKm: 10 } },
  }), true);
  assert.equal(isPersonalClientMessage({ t: "personal_context_query", requestId: "r", query: { purpose: "events", limit: 0 } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_query", requestId: "r", query: { purpose: "events", startAt: 2, endAt: 1 } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_query", requestId: "r", query: { purpose: "events", filters: { huge: "x".repeat(17_000) } } }), false);
  assert.equal(isPersonalClientMessage({ t: "personal_context_query", requestId: "r", query: { purpose: "events", principalId: "other" } }), false);
});
