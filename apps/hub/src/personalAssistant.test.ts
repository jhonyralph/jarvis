import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonalAssistantService } from "./personalAssistant.js";

const fixture = () => {
  let now = 1_000;
  const service = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-pa-hub-")), now: () => now });
  const actor = { principalId: "alice", deviceId: "phone", owner: true };
  return { service, actor, setNow: (value: number) => { now = value; } };
};

test("personal service is isolated by authenticated principal and uses optimistic revisions", async () => {
  const { service, actor } = fixture();
  const state = await service.handle({ t: "personal_context_get", requestId: "r1" }, actor);
  assert.equal(state.t, "personal_context_state");
  assert.equal(state.t === "personal_context_state" && state.state.dataSummary.categories.length, 9);
  const revision = state.t === "personal_context_state" ? state.state.revision : -1;
  const changed = await service.handle({ t: "personal_context_update", requestId: "r2", revision, patch: { enabled: true } }, actor);
  assert.equal(changed.t, "personal_context_state");
  const conflict = await service.handle({ t: "personal_context_update", requestId: "r3", revision, patch: { paused: true } }, actor);
  assert.equal(conflict.t, "personal_context_result");
  const other = await service.handle({ t: "personal_context_get", requestId: "r4" }, { principalId: "bob", deviceId: "phone", owner: false });
  assert.equal(other.t === "personal_context_state" && other.state.settings.enabled, false);
});

test("device profile is bound to the authenticated device and controls proactive opt-in", async () => {
  const { service, actor } = fixture();
  const revision = service.store.get("alice").revision;
  const updated = await service.handle({ t: "personal_device_update", requestId: "device", revision, profile: { locale: "pt_BR", timeZone: "America/Sao_Paulo", proactiveEnabled: true, notifications: { quietStart: "22:00", quietEnd: "08:00", maxPerDay: 2, cooldownMinutes: 60, minScore: 0.8 } } }, actor);
  assert.equal(updated.t, "personal_context_state");
  assert.deepEqual(service.store.get("alice").deviceProfiles[0], { deviceId: "phone", locale: "pt-BR", timeZone: "America/Sao_Paulo", proactiveEnabled: true, disabledProactiveKinds: [], notifications: { quietStart: "22:00", quietEnd: "08:00", maxPerDay: 2, cooldownMinutes: 60, minScore: 0.8 }, updatedAt: 1_000 });
  const other = await service.handle({ t: "personal_device_update", requestId: "other", revision: service.store.get("alice").revision, profile: { locale: "en-US", timeZone: "UTC", proactiveEnabled: false } }, { ...actor, deviceId: "desktop" });
  assert.equal(other.t, "personal_context_state");
  assert.equal(service.store.get("alice").deviceProfiles.find((row) => row.deviceId === "phone")?.proactiveEnabled, true);
  assert.equal(service.store.get("alice").deviceProfiles.find((row) => row.deviceId === "phone")?.notifications?.maxPerDay, 2);
});

test("manual vehicle profiles are principal-scoped, normalized and keep a single default", async () => {
  const { service, actor } = fixture();
  let revision = service.store.get("alice").revision;
  const first = await service.handle({ t: "personal_vehicle_put", requestId: "v1", revision, profile: { id: "daily", label: "  Daily  ", connectorTypeIds: [25, 25, 27], maxAcceptedPowerKw: 150, rangeKm: 420, minimumPreferredPowerKw: 50, preferredOperators: [" Rede A ", "Rede A"], isDefault: false } }, actor);
  assert.equal(first.t, "personal_context_state");
  revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_vehicle_put", requestId: "v2", revision, profile: { id: "trip", label: "Trip", connectorTypeIds: [2], preferredOperators: [], isDefault: true } }, actor);
  const profiles = service.store.get("alice").vehicleProfiles;
  assert.deepEqual(profiles.map((row) => [row.id, row.isDefault]), [["daily", false], ["trip", true]]);
  assert.deepEqual(profiles[0].connectorTypeIds, [25, 27]);
  assert.deepEqual(profiles[0].preferredOperators, ["Rede A"]);
  assert.equal(service.store.get("bob").vehicleProfiles.length, 0);
});

test("notification feedback is device-scoped and can disable only that proactive kind", async () => {
  const { service, actor } = fixture();
  service.store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "UTC", proactiveEnabled: true, updatedAt: 1 });
  service.store.recordNotification("alice", { id: "n1", principalId: "alice", deviceId: "phone", suggestionId: "s1", kind: "event", channel: "push", outcome: "shown", at: 900 });
  const denied = await service.handle({ t: "personal_notification_feedback", requestId: "other", notificationId: "n1", outcome: "dismissed", disableKind: true }, { ...actor, deviceId: "desktop" });
  assert.equal(denied.t === "personal_context_result" && denied.ok, false);
  const response = await service.handle({ t: "personal_notification_feedback", requestId: "feedback", notificationId: "n1", outcome: "dismissed", disableKind: true }, actor);
  assert.equal(response.t === "personal_context_result" && response.ok, true);
  assert.equal(service.store.get("alice").notifications[0].outcome, "dismissed");
  assert.deepEqual(service.store.get("alice").deviceProfiles[0].disabledProactiveKinds, ["event"]);
  const revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_device_update", requestId: "save", revision, profile: { locale: "en-US", timeZone: "UTC", proactiveEnabled: true } }, actor);
  assert.deepEqual(service.store.get("alice").deviceProfiles[0].disabledProactiveKinds, ["event"]);
});

test("vehicle compatibility is sent only to Open Charge Map and removes incompatible connectors before ranking", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.store.putVehicleProfile("alice", { id: "car", principalId: "alice", label: "Car", connectorTypeIds: [25], maxAcceptedPowerKw: 100, minimumPreferredPowerKw: 50, preferredOperators: [], isDefault: true, createdAt: 1, updatedAt: 1 });
  let evFilters: unknown; let placeFilters: unknown;
  service.registerSource({ descriptor: { id: "open-charge-map", label: "OCM", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" }, query: async (request) => {
    evFilters = request.filters;
    return [
      { id: "ok", kind: "ev_charger", title: "Compatible", data: { connections: [{ connectorTypeId: 25, powerKw: 150 }], availability: { status: "unknown" } }, sources: [{ sourceId: "open-charge-map", observedAt: 1_000, freshness: "fresh" }] },
      { id: "bad", kind: "ev_charger", title: "Wrong", data: { connections: [{ connectorTypeId: 2, powerKw: 100 }] }, sources: [{ sourceId: "open-charge-map", observedAt: 1_000, freshness: "fresh" }] },
    ];
  } });
  service.registerSource({ descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" }, query: async (request) => { placeFilters = request.filters; return []; } });
  service.store.putConsent("alice", { id: "ev", principalId: "alice", sourceId: "open-charge-map", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });
  const response = await service.handle({ t: "personal_context_query", requestId: "ev-query", query: { purpose: "nearby", filters: { vehicleProfileId: "car" } } }, actor);
  assert.deepEqual(evFilters, { connectorTypeIds: ["25"] });
  assert.deepEqual(placeFilters, {});
  assert.equal(response.t, "personal_context_suggestions");
  assert.deepEqual(response.t === "personal_context_suggestions" ? response.suggestions.map((row) => row.candidate.title) : [], ["Compatible"]);
  assert.equal(JSON.stringify(response).includes('"status":"unknown"'), true);
});

test("location requires consent, remains device-scoped and is minimized on disk", async () => {
  const { service, actor } = fixture();
  let state = service.store.get("alice"); service.store.updateSettings("alice", { enabled: true, locationMode: "foreground", locationPrecision: "precise" }); state = service.store.get("alice");
  service.store.putConsent("alice", { id: "c", principalId: "alice", sourceId: "device-location", purposes: ["nearby"], fields: ["position"], deviceId: "phone", grantedAt: 1 });
  const result = await service.handle({ t: "personal_location_put", requestId: "r", purpose: "nearby", observation: { observedAt: 900, expiresAt: 2_000, point: { lat: -19.924501, lng: -43.935237, accuracyM: 5 }, precision: "precise", source: "android" } }, actor);
  assert.equal(result.t === "personal_context_result" && result.ok, true);
  assert.deepEqual(service.store.get("alice").observations[0].value, { point: { lat: -19.92, lng: -43.94, accuracyM: 1_000 }, precision: "precise", source: "android" });
  assert.deepEqual(service.view("alice", "phone").deviceContext.location, { observedAt: 900, expiresAt: 2_000, precision: "precise", source: "android", status: "fresh", needsSync: false });
  const denied = await service.handle({ t: "personal_location_put", requestId: "r2", purpose: "nearby", observation: { observedAt: 900, expiresAt: 2_000, point: { lat: -19, lng: -43 }, precision: "precise", source: "android" } }, { ...actor, deviceId: "other" });
  assert.equal(denied.t === "personal_context_result" && denied.ok, false);
  const cleared = await service.handle({ t: "personal_device_context_clear", requestId: "clear-location", kind: "location" }, actor);
  assert.equal(cleared.t, "personal_context_state");
  assert.equal(service.store.get("alice").observations.some((row) => row.id === "device-location:phone"), false);
  assert.equal(service.store.get("alice").consents.find((row) => row.id === "c")?.revokedAt, undefined);
});

test("pausing immediately rejects new device collection even when old consents remain active", async () => {
  const { service, actor } = fixture();
  service.store.updateSettings("alice", { enabled: true, locationMode: "foreground" });
  service.store.putConsent("alice", { id: "location", principalId: "alice", sourceId: "device-location", purposes: ["nearby"], fields: ["position"], deviceId: "phone", grantedAt: 1 });
  service.store.putConsent("alice", { id: "calendar", principalId: "alice", sourceId: "device-calendar", purposes: ["calendar"], fields: ["busy"], deviceId: "phone", grantedAt: 1 });
  const revision = service.store.get("alice").revision;
  const paused = await service.handle({ t: "personal_context_update", requestId: "pause", revision, patch: { paused: true } }, actor);
  assert.equal(paused.t, "personal_context_state");
  const location = await service.handle({ t: "personal_location_put", requestId: "location", purpose: "nearby", observation: { observedAt: 900, expiresAt: 2_000, point: { lat: 1, lng: 2 }, precision: "precise", source: "android" } }, actor);
  const calendar = await service.handle({ t: "personal_calendar_put", requestId: "calendar", observation: { observedAt: 900, expiresAt: 2_000, rangeStartAt: 800, rangeEndAt: 1_900, timeZone: "UTC", intervals: [], truncated: false, source: "android" } }, actor);
  assert.equal(location.t === "personal_context_result" && location.ok, false);
  assert.equal(calendar.t === "personal_context_result" && calendar.ok, false);
  assert.equal(service.store.get("alice").observations.length, 0);
});

test("device-location consent ignores a client-supplied device identity", async () => {
  const { service, actor } = fixture(); const revision = service.store.get("alice").revision;
  const response = await service.handle({ t: "personal_consent_put", requestId: "c", revision, consent: { id: "location", sourceId: "device-location", purposes: ["nearby"], fields: ["position"], deviceId: "spoofed" } }, actor);
  assert.equal(response.t, "personal_context_state");
  assert.equal(response.t === "personal_context_state" && response.state.consents[0].deviceId, "phone");
});

test("device calendar accepts only consented busy/free snapshots and persists only a summary", async () => {
  const { service, actor, setNow } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.store.putConsent("alice", { id: "calendar", principalId: "alice", sourceId: "device-calendar", purposes: ["calendar"], fields: ["busy"], deviceId: "phone", grantedAt: 1 });
  const put = await service.handle({ t: "personal_calendar_put", requestId: "pc", observation: { observedAt: 900, expiresAt: 2_000, rangeStartAt: 800, rangeEndAt: 1_900, timeZone: "America/Sao_Paulo", intervals: [{ startAt: 1_200, endAt: 1_400, allDay: false }], truncated: false, source: "android" } }, actor);
  assert.equal(put.t === "personal_context_result" && put.ok, true);
  assert.deepEqual(service.store.get("alice").observations[0].value, { rangeStartAt: 800, rangeEndAt: 1_900, timeZone: "America/Sao_Paulo", busyIntervals: 1, truncated: false, source: "android" });
  assert.deepEqual(service.view("alice", "phone").deviceContext.calendar, {
    observedAt: 900, expiresAt: 2_000, rangeStartAt: 800, rangeEndAt: 1_900, timeZone: "America/Sao_Paulo",
    busyIntervals: 1, truncated: false, source: "android", status: "fresh", needsSync: false,
  });
  const result = await service.handle({ t: "personal_context_query", requestId: "qc", query: { purpose: "calendar", startAt: 1_000, endAt: 1_800 } }, actor);
  assert.equal(result.t, "personal_context_suggestions");
  assert.ok(result.t === "personal_context_suggestions" && result.suggestions.length > 0);
  setNow(2_001);
  assert.equal(service.view("alice", "phone").deviceContext.calendar?.status, "expired");
  assert.equal(service.view("alice", "phone").deviceContext.calendar?.needsSync, true);
});

test("geofence transitions require background opt-in and persist no coordinates", async () => {
  const { service, actor, setNow } = fixture();
  service.store.updateSettings("alice", { enabled: true, locationMode: "background" });
  service.store.putConsent("alice", { id: "geo", principalId: "alice", sourceId: "device-location", purposes: ["events"], fields: ["geofence"], deviceId: "phone", grantedAt: 1 });
  service.store.putFavorite("alice", { id: "home", principalId: "alice", label: "Casa", aliases: ["home"], point: { lat: -19.92, lng: -43.94 }, purposes: ["events"], geofenceRadiusM: 200, geofenceTransitions: ["enter", "exit"], createdAt: 1, updatedAt: 1 });
  const entered = await service.handle({ t: "personal_geofence_transition_put", requestId: "enter", purpose: "events", observation: { id: "tr-enter", geofenceId: "home", transition: "enter", occurredAt: 900, recordedAt: 950, source: "android" } }, actor);
  assert.equal(entered.t === "personal_context_result" && entered.ok, true);
  const stored = service.store.get("alice").observations[0];
  assert.deepEqual(stored.value, { favoriteId: "home", transition: "enter", deviceId: "phone" });
  assert.equal(JSON.stringify(stored).includes("-19.92"), false);

  let queryPoint: unknown;
  service.registerSource({ descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" }, query: async (request) => { queryPoint = request.point; return []; } });
  service.store.putConsent("alice", { id: "events", principalId: "alice", sourceId: "events", purposes: ["events"], fields: ["*"], grantedAt: 1 });
  await service.handle({ t: "personal_context_query", requestId: "q", query: { purpose: "events" } }, actor);
  assert.deepEqual(queryPoint, { lat: -19.92, lng: -43.94 });

  setNow(1_100);
  await service.handle({ t: "personal_geofence_transition_put", requestId: "exit", purpose: "events", observation: { id: "tr-exit", geofenceId: "home", transition: "exit", occurredAt: 1_050, recordedAt: 1_075, source: "android" } }, actor);
  service.sources.invalidate("alice", "events");
  queryPoint = "unset";
  await service.handle({ t: "personal_context_query", requestId: "q2", query: { purpose: "events" } }, actor);
  assert.equal(queryPoint, undefined);
});

test("repeated consented geofence visits create an explainable inferred habit that can be rejected and erased", async () => {
  const { service, actor, setNow } = fixture();
  service.store.updateSettings("alice", { enabled: true, locationMode: "background" });
  service.store.putConsent("alice", { id: "geo", principalId: "alice", sourceId: "device-location", purposes: ["events"], fields: ["geofence"], deviceId: "phone", grantedAt: 1 });
  service.store.putFavorite("alice", { id: "venue", principalId: "alice", label: "Centro Cultural", aliases: [], point: { lat: -19.92, lng: -43.94 }, purposes: ["events"], geofenceRadiusM: 200, geofenceTransitions: ["enter"], createdAt: 1, updatedAt: 1 });
  for (const [index, occurredAt] of [800, 850, 900].entries()) {
    const result = await service.handle({
      t: "personal_geofence_transition_put", requestId: `visit-${index}`, purpose: "events",
      observation: { id: `visit-${index}`, geofenceId: "venue", transition: "enter", occurredAt, recordedAt: occurredAt + 10, source: "android" },
    }, actor);
    assert.equal(result.t === "personal_context_result" && result.ok, true);
  }
  const inferred = service.store.get("alice").preferences[0];
  assert.equal(inferred?.kind, "inferred");
  assert.equal(inferred?.key, "frequent_place");
  assert.equal(inferred?.value, "Centro Cultural");
  assert.equal(inferred?.evidence.length, 3);
  assert.equal(inferred?.evidence.every((evidence) => evidence.kind === "visit_summary" && evidence.sourceId === "device-location"), true);

  let revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_preference_decision", requestId: "reject", revision, preferenceId: inferred!.id, decision: "reject" }, actor);
  setNow(1_100);
  await service.handle({
    t: "personal_geofence_transition_put", requestId: "visit-4", purpose: "events",
    observation: { id: "visit-4", geofenceId: "venue", transition: "enter", occurredAt: 1_050, recordedAt: 1_075, source: "android" },
  }, actor);
  assert.equal(service.store.get("alice").preferences[0]?.decision, "rejected");

  revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_favorite_delete", requestId: "delete-favorite", revision, favoriteId: "venue" }, actor);
  assert.equal(service.store.get("alice").preferences.length, 0);
  assert.equal(service.store.get("alice").observations.length, 0);
});

test("queries federate only consented sources and never need location in model prompts", async () => {
  const { service, actor } = fixture();
  service.store.updateSettings("alice", { enabled: true });
  service.registerSource({ descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" }, query: async () => [{ id: "e", kind: "event", title: "Concert", data: {}, sources: [{ sourceId: "events", observedAt: 1_000, freshness: "fresh" }] }] });
  let noConsent = await service.handle({ t: "personal_context_query", requestId: "q1", query: { purpose: "events" } }, actor);
  assert.equal(noConsent.t === "personal_context_suggestions" && noConsent.suggestions.length, 0);
  service.store.putConsent("alice", { id: "c", principalId: "alice", sourceId: "events", purposes: ["events"], fields: ["*"], grantedAt: 1 });
  const result = await service.handle({ t: "personal_context_query", requestId: "q2", query: { purpose: "events" } }, actor);
  assert.equal(result.t === "personal_context_suggestions" && result.suggestions[0].candidate.title, "Concert");
});

test("ranked suggestions expose reviewable navigation actions instead of executing them", async () => {
  const { service, actor } = fixture();
  service.store.updateSettings("alice", { enabled: true });
  service.registerSource({
    descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [{
      id: "cafe", kind: "place", title: "Cafe Central", data: { url: "https://example.test/cafe" }, point: { lat: -19.9, lng: -43.9 },
      sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh", url: "https://example.test/cafe" }],
    }],
  });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1_000 });

  const response = await service.handle({ t: "personal_context_query", requestId: "actions", query: { purpose: "nearby" } }, actor);
  assert.equal(response.t, "personal_context_suggestions");
  const actions = response.t === "personal_context_suggestions" ? response.suggestions[0]?.actions : [];
  assert.equal(actions.length, 2);
  assert.equal(actions.every((action) => action.kind === "navigation.open" && action.state === "pending"), true);
  assert.equal(JSON.stringify(actions).includes("payload"), false);
  assert.equal(service.store.get("alice").actions.every((action) => action.state === "pending"), true);
});

test("a consented MCP result exposes only its registered action as a reviewable plan", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-pa-suggestion-mcp-"));
  const service = new PersonalAssistantService({
    root,
    now: () => 1_000,
    sourceFactory: (connection) => ({
      source: {
        descriptor: { id: "inner", label: connection.label, purposes: ["events"], costClass: "local", transport: "stdio", certification: "first_party" },
        query: async () => [{ id: "event", kind: "event", title: "Evento", data: { startAt: 2_000, endAt: 3_000 }, sources: [{ sourceId: "inner", observedAt: 1_000, freshness: "fresh" }] }],
      },
      actions: [{ kind: `mcp:${connection.id}:book`, risk: "external_reversible", preview: (payload) => ({ tool: "book", query: payload.query }), execute: async () => ({ ok: true }) }],
    }),
  });
  const actor = { principalId: "alice", deviceId: "phone", owner: true };
  service.store.updateSettings("alice", { enabled: true });
  let revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_source_put", requestId: "source", revision, source: { id: "mcp", type: "mcp_stdio", label: "MCP", enabled: true, config: {}, allowedResources: [], allowedActions: [] } }, actor);
  revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_consent_put", requestId: "consent", revision, consent: { id: "mcp-consent", sourceId: "mcp", purposes: ["events"], fields: ["*"] } }, actor);

  const response = await service.handle({ t: "personal_context_query", requestId: "query", query: { purpose: "events", text: "musica" } }, actor);
  assert.equal(response.t, "personal_context_suggestions");
  const action = response.t === "personal_context_suggestions" ? response.suggestions[0]?.actions.find((row) => row.kind === "mcp:mcp:book") : undefined;
  assert.equal(action?.state, "pending");
  assert.equal(action?.sourceId, "mcp");
  assert.equal(action?.authorizationConsentId, "mcp-consent");
});

test("source queries do not receive fields omitted from consent", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  let calls = 0;
  service.registerSource({ descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" }, query: async () => { calls++; return []; } });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["query"], grantedAt: 1 });
  await service.handle({ t: "personal_context_query", requestId: "blocked", query: { purpose: "nearby", text: "cafe", point: { lat: 1, lng: 2 } } }, actor);
  assert.equal(calls, 0);
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["query", "position"], grantedAt: 1 });
  await service.handle({ t: "personal_context_query", requestId: "allowed", query: { purpose: "nearby", text: "cafe", point: { lat: 1, lng: 2 } } }, actor);
  assert.equal(calls, 1);
});

test("CalDAV details require an explicit detail grant beyond wildcard busy access", async () => {
  let calls = 0;
  const service = new PersonalAssistantService({
    root: mkdtempSync(join(tmpdir(), "jarvis-pa-caldav-consent-")), now: () => 1_000,
    sourceFactory: () => ({ descriptor: { id: "inner", label: "Calendar", purposes: ["calendar"], costClass: "free", transport: "http", certification: "audited" }, query: async () => { calls++; return []; } }),
  });
  const actor = { principalId: "alice", deviceId: "phone", owner: true };
  service.store.updateSettings("alice", { enabled: true });
  service.store.putSource("alice", { id: "calendar", principalId: "alice", type: "caldav", label: "Calendar", enabled: true, config: { access: "details" }, allowedResources: [], allowedActions: [], createdAt: 1, updatedAt: 1 });
  service.store.putConsent("alice", { id: "calendar", principalId: "alice", sourceId: "calendar", purposes: ["calendar"], fields: ["*"], grantedAt: 1 });
  await service.handle({ t: "personal_context_query", requestId: "without-details", query: { purpose: "calendar", startAt: 1_000, endAt: 2_000 } }, actor);
  assert.equal(calls, 0);
  service.store.putConsent("alice", { id: "calendar", principalId: "alice", sourceId: "calendar", purposes: ["calendar"], fields: ["*", "details"], grantedAt: 1 });
  await service.handle({ t: "personal_context_query", requestId: "with-details", query: { purpose: "calendar", startAt: 1_000, endAt: 2_000 } }, actor);
  assert.equal(calls, 1);
});

test("event queries compose calendar and weather as support context and remain useful on partial failure", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.registerSource({ descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" }, query: async () => [{ id: "e", kind: "event", title: "Outdoor show", data: { startAt: 1_200, endAt: 1_400, categories: ["outdoor"] }, sources: [{ sourceId: "events", observedAt: 1_000, freshness: "fresh" }] }] });
  service.registerSource({ descriptor: { id: "weather", label: "Weather", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" }, query: async () => [{ id: "w", kind: "weather_forecast", title: "Weather", data: { current: {}, hourly: [{ validAt: 1_200, precipitationProbabilityPercent: 90, precipitationMm: 8, rainMm: 8 }] }, sources: [{ sourceId: "weather", observedAt: 1_000, freshness: "fresh" }] }] });
  service.registerSource({ descriptor: { id: "calendar-support", label: "Calendar", purposes: ["calendar"], costClass: "local", transport: "device", certification: "first_party" }, query: async () => [{ id: "busy", kind: "calendar_availability", title: "Busy", data: { availability: "busy", startAt: 1_250, endAt: 1_300, complete: true }, sources: [{ sourceId: "calendar-support", observedAt: 1_000, freshness: "fresh" }] }] });
  for (const [id, purpose] of [["events", "events"], ["weather", "events"], ["calendar-support", "calendar"]] as const) service.store.putConsent("alice", { id: `consent-${id}`, principalId: "alice", sourceId: id, purposes: [purpose], fields: ["*"], grantedAt: 1 });
  const response = await service.handle({ t: "personal_context_query", requestId: "multi", query: { purpose: "events" } }, actor);
  assert.equal(response.t, "personal_context_suggestions");
  assert.deepEqual(response.t === "personal_context_suggestions" ? response.suggestions.map((row) => row.candidate.title) : [], ["Outdoor show"]);
  assert.ok(response.t === "personal_context_suggestions" && response.suggestions[0].caveats.some((row) => /agenda/.test(row)));
  assert.ok(response.t === "personal_context_suggestions" && response.suggestions[0].caveats.some((row) => /clima/.test(row)));
  assert.deepEqual(response.t === "personal_context_suggestions" ? response.results.map((row) => row.sourceId).sort() : [], ["calendar-support", "events", "weather"]);

  service.sources.remove("weather");
  const partial = await service.handle({ t: "personal_context_query", requestId: "partial", query: { purpose: "events" } }, actor);
  assert.equal(partial.t === "personal_context_suggestions" && partial.suggestions[0].candidate.title, "Outdoor show");
});

test("textual date filters are resolved in the authenticated device timezone and not leaked to adapters", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "America/Sao_Paulo", proactiveEnabled: false, updatedAt: 1 });
  let request: unknown;
  service.registerSource({ descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" }, query: async (input) => { request = input; return []; } });
  service.store.putConsent("alice", { id: "events", principalId: "alice", sourceId: "events", purposes: ["events"], fields: ["*"], grantedAt: 1 });
  const response = await service.handle({ t: "personal_context_query", requestId: "dated", query: { purpose: "events", filters: { dateText: "amanhã", timeText: "às 20h" } } }, actor);
  assert.equal(response.t, "personal_context_suggestions");
  const sent = request as { startAt: number; endAt: number; filters: Record<string, unknown> };
  assert.equal(sent.startAt, Date.parse("1970-01-01T23:00:00Z"));
  assert.equal(sent.endAt, Date.parse("1970-01-02T00:00:00Z"));
  assert.deepEqual(sent.filters, {});
});

test("nearby queries use an authorized Valhalla matrix without losing straight-line fallback semantics", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.registerSource({ descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" }, query: async () => [
    { id: "one", kind: "place", title: "One", point: { lat: 1, lng: 2 }, data: { straightLineDistanceM: 100 }, sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" }] },
    { id: "two", kind: "place", title: "Two", point: { lat: 1.1, lng: 2.1 }, data: { straightLineDistanceM: 200 }, sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" }] },
  ] });
  let matrixFilters: unknown;
  service.registerSource({ descriptor: { id: "valhalla-matrix", label: "Matrix", purposes: ["mobility"], costClass: "local", transport: "http", certification: "first_party" }, query: async (request) => {
    matrixFilters = request.filters;
    return [{ id: "matrix", kind: "route_matrix", title: "Matrix", data: { mode: "car", cells: [
      { target: { lat: 1, lng: 2 }, reachable: true, distanceM: 1_500, durationSeconds: 600 },
      { target: { lat: 1.1, lng: 2.1 }, reachable: false, distanceM: null, durationSeconds: null },
    ] }, sources: [{ sourceId: "valhalla-matrix", observedAt: 1_000, freshness: "fresh" }] }];
  } });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });
  service.store.putConsent("alice", { id: "matrix", principalId: "alice", sourceId: "valhalla-matrix", purposes: ["mobility"], fields: ["*"], grantedAt: 1 });
  const response = await service.handle({ t: "personal_context_query", requestId: "route-nearby", query: { purpose: "nearby", point: { lat: 0.9, lng: 1.9 }, filters: { maxDurationMinutes: 15, mode: "car" } } }, actor);
  assert.deepEqual(matrixFilters, { destinationPoints: ["1,2", "1.1,2.1"], mode: "car" });
  assert.equal(response.t, "personal_context_suggestions");
  assert.equal(response.t === "personal_context_suggestions" && (response.suggestions.find((row) => row.candidate.id === "one")?.candidate.data as Record<string, unknown>).durationSeconds, 600);
  assert.ok(response.t === "personal_context_suggestions" && response.suggestions.find((row) => row.candidate.id === "two")?.caveats.some((row) => /linha reta/.test(row)));
});

test("mobility queries route geocoded destinations and preserve the full encoded path", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.registerSource({ descriptor: { id: "destination", label: "Geocoder", purposes: ["mobility"], costClass: "local", transport: "http", certification: "first_party" }, query: async () => [
    { id: "airport", kind: "place", title: "Airport", point: { lat: 1, lng: 2 }, data: { straightLineDistanceM: 10_000 }, sources: [{ sourceId: "destination", observedAt: 1_000, freshness: "fresh" }] },
  ] });
  let routeFilters: unknown;
  service.registerSource({ descriptor: { id: "valhalla", label: "Route", purposes: ["mobility"], costClass: "local", transport: "http", certification: "first_party" }, query: async (request) => {
    routeFilters = request.filters;
    return [{ id: "route", kind: "route", title: "car route", point: { lat: 1, lng: 2 }, data: { mode: "car", routedDistanceM: 12_000, straightLineDistanceM: 10_000, durationSeconds: 900, legs: [{ encodedPolyline: "polyline6", distanceM: 12_000, durationSeconds: 900, maneuvers: [] }] }, sources: [{ sourceId: "valhalla", observedAt: 1_000, freshness: "fresh" }] }];
  } });
  service.store.putConsent("alice", { id: "destination", principalId: "alice", sourceId: "destination", purposes: ["mobility"], fields: ["*"], grantedAt: 1 });
  service.store.putConsent("alice", { id: "route", principalId: "alice", sourceId: "valhalla", purposes: ["mobility"], fields: ["*"], grantedAt: 1 });
  const response = await service.handle({ t: "personal_context_query", requestId: "route", query: { purpose: "mobility", text: "airport", point: { lat: 0, lng: 0 }, filters: { mode: "car" } } }, actor);
  assert.deepEqual(routeFilters, { destinationLat: 1, destinationLng: 2, mode: "car" });
  assert.equal(response.t, "personal_context_suggestions");
  const route = response.t === "personal_context_suggestions" ? response.suggestions.find((row) => row.candidate.kind === "route") : undefined;
  assert.equal((((route?.candidate.data as Record<string, unknown>).legs as Array<Record<string, unknown>>)[0]).encodedPolyline, "polyline6");
});

test("favorite aliases resolve only inside the principal and ambiguity requires an explicit id", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.store.putFavorite("alice", { id: "club-a", principalId: "alice", label: "Club A", aliases: ["clube"], point: { lat: 1, lng: 2 }, purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  service.store.putFavorite("alice", { id: "club-b", principalId: "alice", label: "Club B", aliases: ["clube"], point: { lat: 3, lng: 4 }, purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  service.store.putFavorite("bob", { id: "private", principalId: "bob", label: "Private", aliases: ["unique"], point: { lat: 8, lng: 9 }, purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  let point: unknown; let filters: unknown;
  service.registerSource({ descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" }, query: async (request) => { point = request.point; filters = request.filters; return []; } });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });
  const ambiguous = await service.handle({ t: "personal_context_query", requestId: "ambiguous", query: { purpose: "nearby", filters: { reference: "clube" } } }, actor);
  assert.equal(ambiguous.t === "personal_context_result" && ambiguous.ok, false);
  const selected = await service.handle({ t: "personal_context_query", requestId: "selected", query: { purpose: "nearby", filters: { favoriteId: "club-b", reference: "clube" } } }, actor);
  assert.equal(selected.t, "personal_context_suggestions");
  assert.deepEqual(point, { lat: 3, lng: 4 });
  assert.deepEqual(filters, {});
  const crossPrincipal = await service.handle({ t: "personal_context_query", requestId: "private", query: { purpose: "nearby", filters: { favoriteId: "private" } } }, actor);
  assert.equal(crossPrincipal.t === "personal_context_result" && crossPrincipal.ok, false);
});

test("source configuration is owner-only and secret refs are never returned", async () => {
  const { service, actor } = fixture(); const revision = service.store.get("alice").revision;
  const source = { id: "ha", type: "home_assistant" as const, label: "Home", enabled: false, secretRef: "HA_TOKEN", config: {}, allowedResources: ["sensor.*"], allowedActions: [] };
  const denied = await service.handle({ t: "personal_source_put", requestId: "r", revision, source }, { ...actor, owner: false });
  assert.equal(denied.t === "personal_context_result" && denied.ok, false);
  const added = await service.handle({ t: "personal_source_put", requestId: "r2", revision, source }, actor);
  assert.equal(added.t, "personal_context_state");
  assert.equal(added.t === "personal_context_state" && added.state.sources[0].hasSecret, true);
  assert.equal(JSON.stringify(added).includes("HA_TOKEN"), false);
  const leaked = await service.handle({ t: "personal_source_put", requestId: "r3", revision: service.store.get("alice").revision, source: { ...source, id: "leaked", config: { password: "literal" } } }, actor);
  assert.equal(leaked.t === "personal_context_result" && leaked.ok, false);

  const stdio = { id: "stdio", type: "mcp_stdio" as const, label: "Local MCP", enabled: false, endpoint: "node", config: { cwd: "C:/work" }, allowedResources: [], allowedActions: [], stdioEnv: { set: { NODE_OPTIONS: "--no-warnings", APP_MODE: "local" }, remove: [] } };
  const configured = await service.handle({ t: "personal_source_put", requestId: "stdio-1", revision: service.store.get("alice").revision, source: stdio }, actor);
  assert.equal(configured.t, "personal_context_state");
  const publicSource = configured.t === "personal_context_state" ? configured.state.sources.find((row) => row.id === "stdio") : undefined;
  assert.deepEqual(publicSource?.configuredEnvNames, ["APP_MODE", "NODE_OPTIONS"]);
  assert.deepEqual(publicSource?.config, { cwd: "C:/work" });
  assert.equal(JSON.stringify(configured).includes("--no-warnings"), false);
  assert.equal(service.store.get("alice").sources.find((row) => row.id === "stdio")?.config["env.NODE_OPTIONS"], "--no-warnings");

  const changed = await service.handle({ t: "personal_source_put", requestId: "stdio-2", revision: service.store.get("alice").revision, source: { ...stdio, config: { cwd: "C:/next" }, stdioEnv: { set: { APP_MODE: "production" }, remove: ["NODE_OPTIONS"] } } }, actor);
  const changedSource = changed.t === "personal_context_state" ? changed.state.sources.find((row) => row.id === "stdio") : undefined;
  assert.deepEqual(changedSource?.configuredEnvNames, ["APP_MODE"]);
  assert.equal(service.store.get("alice").sources.find((row) => row.id === "stdio")?.config["env.APP_MODE"], "production");
  assert.equal(JSON.stringify(changed).includes("production"), false);
  const exported = await service.handle({ t: "personal_data_export", requestId: "stdio-export" }, actor);
  assert.equal(JSON.stringify(exported).includes("production"), false);
  assert.deepEqual(exported.t === "personal_data_export" ? exported.data.sources.find((row) => row.id === "stdio")?.configuredEnvNames : undefined, ["APP_MODE"]);
});

test("source discovery is explicit, owner-only, bounded and never grants query authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-discovery-"));
  let discoveries = 0, queries = 0, disposals = 0;
  try {
    const service = new PersonalAssistantService({
      root,
      sourceFactory: (connection) => ({
        source: {
          descriptor: { id: connection.id, label: connection.label, purposes: ["calendar"], costClass: "free", transport: "http", certification: "audited" },
          query: async () => { queries += 1; return []; },
        },
        discover: async () => {
          discoveries += 1;
          return {
            sourceId: "forged-source",
            state: "ready",
            health: "healthy",
            latencyMs: 25,
            calendars: [{ id: "calendar", href: "https://calendar.invalid/home", name: "Home", allowed: false, secret: "must-not-cross" }],
            tools: Array.from({ length: 105 }, (_, index) => ({ id: `tool-${index}`, name: index === 0 ? "Bearer hidden-value" : `Tool ${index}`, allowed: false, advertised: true })),
            resources: [],
            truncated: { calendars: false, tools: false, resources: false },
            secret: "must-not-cross",
          } as never;
        },
        dispose: async () => { disposals += 1; },
      }),
    });
    const actor = { principalId: "alice", deviceId: "phone", owner: true };
    service.store.updateSettings("alice", { enabled: true });
    const configured = await service.handle({
      t: "personal_source_put",
      requestId: "put",
      revision: service.store.get("alice").revision,
      source: { id: "calendar", type: "caldav", label: "Calendar", enabled: true, endpoint: "https://calendar.invalid/", config: {}, allowedResources: [], allowedActions: [] },
    }, actor);
    assert.equal(configured.t, "personal_context_state");
    assert.equal(disposals, 1, "validation bundle is disposed when no consent grants query authority");

    const denied = await service.handle({ t: "personal_source_discover", requestId: "member", sourceId: "calendar" }, { ...actor, owner: false });
    assert.equal(denied.t, "personal_context_result");
    assert.match(denied.t === "personal_context_result" ? denied.error || "" : "", /owner/);
    assert.equal(discoveries, 0);

    const response = await service.handle({ t: "personal_source_discover", requestId: "discover", sourceId: "calendar" }, actor);
    assert.equal(response.t, "personal_source_discovery");
    if (response.t !== "personal_source_discovery") return;
    assert.equal(response.discovery.sourceId, "calendar");
    assert.equal(response.discovery.tools.length, 100);
    assert.equal(response.discovery.tools[0]?.name, "Bearer [REDACTED]");
    assert.equal(response.discovery.truncated.tools, true);
    assert.equal(JSON.stringify(response).includes("must-not-cross"), false);
    assert.equal(queries, 0);
    assert.equal(disposals, 2, "temporary discovery bundle is always disposed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("revoking a source consent cancels its approved plans before they can execute", async () => {
  let calls = 0;
  const service = new PersonalAssistantService({
    root: mkdtempSync(join(tmpdir(), "jarvis-pa-action-revoke-")), now: () => 1_000,
    sourceFactory: () => ({
      source: { descriptor: { id: "inner", label: "Actions", purposes: ["automation"], costClass: "local", transport: "builtin", certification: "audited" }, query: async () => [] },
      actions: [{ kind: "source:toggle", risk: "external_reversible", preview: () => ({ impact: "toggle" }), execute: async () => ({ calls: ++calls }) }],
    }),
  });
  const actor = { principalId: "alice", deviceId: "phone", owner: true };
  service.store.updateSettings("alice", { enabled: true });
  let revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_source_put", requestId: "source", revision, source: { id: "source", type: "home_assistant", label: "Actions", enabled: true, config: {}, allowedResources: [], allowedActions: ["external_reversible:test.toggle"] } }, actor);
  revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_consent_put", requestId: "grant", revision, consent: { id: "grant", sourceId: "source", purposes: ["automation"], fields: ["*"] } }, actor);
  const preview = await service.handle({ t: "personal_action_preview", requestId: "preview", kind: "source:toggle", payload: {}, idempotencyKey: "toggle-once" }, actor);
  assert.equal(preview.t, "personal_action_view");
  const plan = preview.t === "personal_action_view" ? preview.action : undefined;
  assert.equal(plan?.sourceId, "source");
  assert.equal(plan?.authorizationConsentId, "grant");
  await service.handle({ t: "personal_action_approve", requestId: "approve", planId: plan!.id, challenge: plan!.confirmationChallenge! }, actor);
  revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_consent_revoke", requestId: "revoke", revision, consentId: "grant" }, actor);
  const result = await service.handle({ t: "personal_action_execute", requestId: "execute", planId: plan!.id }, actor);
  assert.equal(result.t === "personal_action_view" && result.action.state, "cancelled");
  assert.equal(calls, 0);
});

test("navigation handoff is completed only by an acknowledgement from the initiating device", async () => {
  const { service, actor } = fixture();
  service.store.updateSettings("alice", { enabled: true });
  const preview = await service.handle({
    t: "personal_action_preview", requestId: "nav-preview", kind: "navigation.open",
    payload: { url: "https://maps.example/route", title: "Route" }, idempotencyKey: "nav-once",
  }, actor);
  assert.equal(preview.t, "personal_action_view");
  const plan = preview.t === "personal_action_view" ? preview.action : undefined;
  await service.handle({ t: "personal_action_approve", requestId: "nav-approve", planId: plan!.id, challenge: plan!.confirmationChallenge! }, actor);
  const execution = await service.handle({ t: "personal_action_execute", requestId: "nav-execute", planId: plan!.id }, actor);
  assert.equal(execution.t === "personal_action_view" && execution.action.state, "running");
  assert.equal(execution.t === "personal_action_view" && execution.action.awaitingClientAck, true);

  const wrongDevice = await service.handle({ t: "personal_action_handoff_result", requestId: "nav-wrong", planId: plan!.id, success: true }, { ...actor, deviceId: "tablet" });
  assert.equal(wrongDevice.t === "personal_context_result" && wrongDevice.ok, false);
  const completed = await service.handle({ t: "personal_action_handoff_result", requestId: "nav-done", planId: plan!.id, success: true }, actor);
  assert.equal(completed.t === "personal_action_view" && completed.action.state, "succeeded");
});

test("personal state reads reconcile an expired navigation handoff instead of reporting it as running forever", async () => {
  let now = 1_000;
  const root = mkdtempSync(join(tmpdir(), "jarvis-pa-handoff-timeout-"));
  const service = new PersonalAssistantService({ root, now: () => now });
  const actor = { principalId: "alice", deviceId: "phone", owner: true };
  service.store.updateSettings("alice", { enabled: true });
  const preview = await service.handle({
    t: "personal_action_preview", requestId: "preview", kind: "navigation.open",
    payload: { url: "https://maps.example/route" }, idempotencyKey: "stale-handoff",
  }, actor);
  assert.equal(preview.t, "personal_action_view");
  const plan = preview.t === "personal_action_view" ? preview.action : undefined;
  await service.handle({ t: "personal_action_approve", requestId: "approve", planId: plan!.id, challenge: plan!.confirmationChallenge! }, actor);
  const executed = await service.handle({ t: "personal_action_execute", requestId: "execute", planId: plan!.id }, actor);
  assert.equal(executed.t === "personal_action_view" && executed.action.state, "running");
  const deadline = executed.t === "personal_action_view" ? executed.action.clientAckExpiresAt! : 0;

  now = deadline + 1;
  const state = await service.handle({ t: "personal_context_get", requestId: "state" }, actor);
  const action = state.t === "personal_context_state" ? state.state.actions.find((row) => row.id === plan!.id) : undefined;
  assert.equal(action?.state, "uncertain");
  assert.match(action?.error || "", /timed out/);
});

test("export excludes action payloads and erase affects only the authenticated principal", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true }); service.store.updateSettings("bob", { enabled: true });
  const plan = service.actions.preview("alice", "navigation.open", { url: "https://maps.example/a", token: "PRIVATE" });
  assert.ok(plan);
  const exported = await service.handle({ t: "personal_data_export", requestId: "e" }, actor);
  assert.equal(JSON.stringify(exported).includes("PRIVATE"), false);
  await service.handle({ t: "personal_data_erase", requestId: "d", confirmation: "ERASE" }, actor);
  assert.equal(service.store.get("alice").settings.enabled, false);
  assert.equal(service.store.get("bob").settings.enabled, true);
});

test("category erasure requires confirmation at the protocol boundary and enforces owner-only source deletion", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.store.putPreference("alice", { id: "p", principalId: "alice", kind: "explicit", key: "food", value: "sushi", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  let revision = service.store.get("alice").revision;
  const erased = await service.handle({ t: "personal_data_category_erase", requestId: "category", revision, category: "preferences", confirmation: "ERASE_CATEGORY" }, actor);
  assert.equal(erased.t, "personal_context_state");
  assert.equal(service.store.get("alice").preferences.length, 0);
  service.store.putSource("alice", { id: "source", principalId: "alice", type: "open_events", label: "Feed", enabled: false, config: {}, allowedResources: [], allowedActions: [], createdAt: 1, updatedAt: 1 });
  revision = service.store.get("alice").revision;
  const denied = await service.handle({ t: "personal_data_category_erase", requestId: "sources", revision, category: "sources", confirmation: "ERASE_CATEGORY" }, { ...actor, owner: false });
  assert.equal(denied.t === "personal_context_result" && denied.ok, false);
  assert.equal(service.store.get("alice").sources.length, 1);
});

test("configured source adapters with the same id stay scoped to their authenticated principal", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-pa-scope-"));
  const service = new PersonalAssistantService({ root, sourceFactory: (connection) => ({ descriptor: { id: "inner", label: connection.label, purposes: ["events"], costClass: "local", transport: "builtin", certification: "first_party" }, query: async () => [{ id: connection.principalId, kind: "event", title: connection.principalId, data: {}, sources: [{ sourceId: "inner", observedAt: 1, freshness: "fresh" }] }] }) });
  for (const principalId of ["alice", "bob"]) {
    service.store.updateSettings(principalId, { enabled: true }); const state = service.store.get(principalId);
    const actor = { principalId, deviceId: `${principalId}-phone`, owner: true };
    await service.handle({ t: "personal_source_put", requestId: `s-${principalId}`, revision: state.revision, source: { id: "same", type: "open_events", label: principalId, enabled: true, config: {}, allowedResources: [], allowedActions: [] } }, actor);
    service.store.putConsent(principalId, { id: "consent", principalId, sourceId: "same", purposes: ["events"], fields: ["*"], grantedAt: 1 });
  }
  const alice = await service.handle({ t: "personal_context_query", requestId: "qa", query: { purpose: "events" } }, { principalId: "alice", deviceId: "a", owner: true });
  const bob = await service.handle({ t: "personal_context_query", requestId: "qb", query: { purpose: "events" } }, { principalId: "bob", deviceId: "b", owner: true });
  assert.equal(alice.t === "personal_context_suggestions" && alice.suggestions[0].candidate.title, "alice");
  assert.equal(bob.t === "personal_context_suggestions" && bob.suggestions[0].candidate.title, "bob");
});

test("partial settings updates preserve live device context", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true, locationMode: "foreground" });
  service.store.putConsent("alice", { id: "calendar", principalId: "alice", sourceId: "device-calendar", purposes: ["calendar"], fields: ["busy"], deviceId: "phone", grantedAt: 1 });
  await service.handle({ t: "personal_calendar_put", requestId: "put", observation: { observedAt: 900, expiresAt: 2_000, rangeStartAt: 800, rangeEndAt: 1_900, timeZone: "UTC", intervals: [{ startAt: 1_200, endAt: 1_400, allDay: false }], truncated: false, source: "android" } }, actor);
  const revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_context_update", requestId: "settings", revision, patch: { retention: { observationsDays: 7, decisionsDays: 30, inferredPreferencesDays: 90, keepRawLocation: false } } }, actor);
  const result = await service.handle({ t: "personal_context_query", requestId: "query", query: { purpose: "calendar", startAt: 1_000, endAt: 1_800 } }, actor);
  assert.equal(result.t, "personal_context_suggestions");
  assert.ok(result.t === "personal_context_suggestions" && result.suggestions.some((row) => row.candidate.title === "Busy"));
});

test("turn context is bounded, sourced and excludes raw coordinates", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.registerSource({ descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" }, query: async () => [{ id: "p", kind: "place", title: "Cafe", point: { lat: -19.9245, lng: -43.9352 }, data: { category: "cafe", straightLineDistanceM: 200, secretField: "DO_NOT_SEND" }, sources: [{ sourceId: "places", recordId: "p", observedAt: 1_000, freshness: "fresh", attribution: "Fixture" }] }] });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });
  const context = await service.contextForTurn({ purpose: "nearby", text: "cafe" }, actor);
  assert.match(context.agentText, /Cafe/); assert.match(context.agentText, /Fixture/);
  assert.doesNotMatch(context.agentText, /-19\.9245|-43\.9352|DO_NOT_SEND/);
});

for (const row of [
  { profileLocale: "pt_BR", effectiveLocale: "pt-BR", reason: "Aberto no horário solicitado", caveat: "Uma ou mais restrições informadas não puderam ser confirmadas" },
  { profileLocale: "en-US", effectiveLocale: "en-US", reason: "Open at the requested time", caveat: "One or more requested restrictions could not be confirmed" },
  { profileLocale: "es-MX", effectiveLocale: "es-MX", reason: "Abierto a la hora solicitada", caveat: "No se pudieron confirmar una o más restricciones indicadas" },
] as const) {
  test(`device locale ${row.profileLocale} controls ranking copy and adapter locale`, async () => {
    const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
    service.store.putDeviceProfile("alice", { deviceId: "phone", locale: row.profileLocale, timeZone: "UTC", proactiveEnabled: false, updatedAt: 1 });
    let adapterLocale: string | undefined;
    service.registerSource({
      descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" },
      query: async (query) => {
        adapterLocale = query.locale;
        return [{
          id: "place", kind: "place", title: "Place",
          data: { filterContext: { openStatus: "open", restrictions: { vegan: "unknown" } } },
          sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" }],
        }];
      },
    });
    service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });
    const response = await service.handle({ t: "personal_context_query", requestId: "localized", query: { purpose: "nearby" } }, actor);
    assert.equal(response.t, "personal_context_suggestions");
    const suggestion = response.t === "personal_context_suggestions" ? response.suggestions[0] : undefined;
    assert.equal(adapterLocale, row.effectiveLocale);
    assert.ok(suggestion?.reasons.includes(row.reason));
    assert.ok(suggestion?.caveats.includes(row.caveat));
  });
}

test("an explicit query locale overrides the authenticated device locale", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.store.putDeviceProfile("alice", { deviceId: "phone", locale: "en-US", timeZone: "UTC", proactiveEnabled: false, updatedAt: 1 });
  let adapterLocale: string | undefined;
  service.registerSource({
    descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" },
    query: async (query) => {
      adapterLocale = query.locale;
      return [{ id: "place", kind: "place", title: "Place", data: { filterContext: { openStatus: "open" } }, sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" }] }];
    },
  });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });
  const response = await service.handle({ t: "personal_context_query", requestId: "spanish", query: { purpose: "nearby", locale: "es-ES" } }, actor);
  const suggestion = response.t === "personal_context_suggestions" ? response.suggestions[0] : undefined;
  assert.equal(adapterLocale, "es-ES");
  assert.ok(suggestion?.reasons.includes("Abierto a la hora solicitada"));
  assert.equal(suggestion?.reasons.some((reason) => /Open at|Aberto no/.test(reason)), false);
});

test("turn context localizes suggestion, missing-data and discard explanations without exposing provider errors", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.store.putDeviceProfile("alice", { deviceId: "phone", locale: "es-MX", timeZone: "UTC", proactiveEnabled: false, updatedAt: 1 });
  service.registerSource({
    descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [
      { id: "available", kind: "place", title: "Available", data: { filterContext: { openStatus: "open" }, route: { status: "unreachable" } }, sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" }] },
      { id: "closed", kind: "place", title: "Closed", data: {}, hardFailures: ["known_closed_at_requested_time"], sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" }] },
    ],
  });
  service.registerSource({
    descriptor: { id: "offline", label: "Offline", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => { throw new Error("INTERNAL_PROVIDER_FAILURE in English"); },
  });
  for (const sourceId of ["places", "offline"]) service.store.putConsent("alice", { id: sourceId, principalId: "alice", sourceId, purposes: ["nearby"], fields: ["*"], grantedAt: 1 });

  const context = await service.contextForTurn({ purpose: "nearby" }, actor);
  const payload = JSON.parse(context.agentText.split("\n")[1]) as {
    locale: string;
    results: Array<{ reasons: string[]; caveats: string[] }>;
    unavailableSources: string[];
    missingData: Array<{ sourceId: string; explanation: string }>;
    discardedCandidates: Array<{ candidateId: string; kind: string; reasonCodes: string[]; explanations: string[] }>;
  };
  assert.equal(payload.locale, "es");
  assert.ok(payload.results[0].reasons.includes("Abierto a la hora solicitada"));
  assert.ok(payload.results[0].caveats.includes("No se pudo calcular la ruta; solo está disponible la distancia en línea recta"));
  assert.deepEqual(payload.unavailableSources, ["offline"]);
  assert.deepEqual(payload.missingData, [{ sourceId: "offline", explanation: "Los datos de la fuente offline no están disponibles" }]);
  assert.deepEqual(payload.discardedCandidates, [{
    candidateId: "closed",
    kind: "place",
    reasonCodes: ["known_closed_at_requested_time"],
    explanations: ["Cerrado a la hora solicitada"],
  }]);
  assert.doesNotMatch(context.agentText, /INTERNAL_PROVIDER_FAILURE|Aberto no|A rota não|Os dados da fonte|Fechado no/);
});

test("turn context pins its locale while source queries are in flight", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  service.store.putDeviceProfile("alice", { deviceId: "phone", locale: "es-MX", timeZone: "UTC", proactiveEnabled: false, updatedAt: 1 });
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  service.registerSource({
    descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => {
      markStarted(); await gate;
      return [{ id: "place", kind: "place", title: "Place", data: { filterContext: { openStatus: "open" } }, sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" }] }];
    },
  });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });

  const pending = service.contextForTurn({ purpose: "nearby" }, actor);
  await started;
  service.store.putDeviceProfile("alice", { deviceId: "phone", locale: "en-US", timeZone: "UTC", proactiveEnabled: false, updatedAt: 2 });
  release();
  const context = await pending;
  const payload = JSON.parse(context.agentText.split("\n")[1]) as { locale: string; results: Array<{ reasons: string[] }> };
  assert.equal(payload.locale, "es");
  assert.ok(payload.results[0].reasons.includes("Abierto a la hora solicitada"));
});

test("failed adapter replacement rolls back the prior query authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-pa-rollback-"));
  const service = new PersonalAssistantService({ root, sourceFactory: (connection) => connection.label === "broken" ? {
    source: { descriptor: { id: "inner", label: "Broken", purposes: ["events"], costClass: "local", transport: "builtin", certification: "first_party" }, query: async () => [] },
    actions: [
      { kind: "duplicate.action", risk: "read", preview: () => ({}), execute: async () => ({}) },
      { kind: "duplicate.action", risk: "read", preview: () => ({}), execute: async () => ({}) },
    ],
  } : { descriptor: { id: "inner", label: "Working", purposes: ["events"], costClass: "local", transport: "builtin", certification: "first_party" }, query: async () => [{ id: "ok", kind: "event", title: "Working", data: {}, sources: [{ sourceId: "inner", observedAt: 1, freshness: "fresh" }] }] } });
  const actor = { principalId: "alice", deviceId: "phone", owner: true };
  service.store.updateSettings("alice", { enabled: true }); let state = service.store.get("alice");
  await service.handle({ t: "personal_source_put", requestId: "one", revision: state.revision, source: { id: "feed", type: "open_events", label: "working", enabled: true, config: {}, allowedResources: [], allowedActions: [] } }, actor);
  service.store.putConsent("alice", { id: "feed", principalId: "alice", sourceId: "feed", purposes: ["events"], fields: ["*"], grantedAt: 1 }); state = service.store.get("alice");
  const failed = await service.handle({ t: "personal_source_put", requestId: "two", revision: state.revision, source: { id: "feed", type: "open_events", label: "broken", enabled: true, config: {}, allowedResources: [], allowedActions: [] } }, actor);
  assert.equal(failed.t === "personal_context_result" && failed.ok, false);
  const query = await service.handle({ t: "personal_context_query", requestId: "three", query: { purpose: "events" } }, actor);
  assert.equal(query.t === "personal_context_suggestions" && query.suggestions[0].candidate.title, "Working");
});

test("feedback creates explicit memory and only infers a habit after repeated evidence", async () => {
  const { service, actor } = fixture(); service.store.updateSettings("alice", { enabled: true });
  let revision = service.store.get("alice").revision;
  const remember = await service.handle({ t: "personal_feedback_put", requestId: "remember", revision, feedback: { id: "remember-cafe", suggestionId: "s-cafe", purpose: "nearby", kind: "remember", key: "category", value: "cafe", sourceId: "osm" } }, actor);
  assert.equal(remember.t, "personal_context_state");
  assert.equal(service.store.get("alice").preferences.find((row) => row.id === "remember-cafe")?.kind, "explicit");
  for (let index = 0; index < 3; index++) {
    revision = service.store.get("alice").revision;
    await service.handle({ t: "personal_feedback_put", requestId: `like-${index}`, revision, feedback: { id: `like-cafe-${index}`, suggestionId: `suggestion-${index}`, purpose: "nearby", kind: "like", key: "category", value: "bakery", sourceId: "osm" } }, actor);
  }
  const inferred = service.store.get("alice").preferences.find((row) => row.kind === "inferred" && row.value === "bakery");
  assert.ok(inferred); assert.equal(inferred.evidence.length, 3); assert.ok(inferred.confidence > 0 && inferred.confidence < 1);
});

test("source test is owner-only, consented and bypasses the normal cache", async () => {
  const { service, actor } = fixture(); let calls = 0; service.store.updateSettings("alice", { enabled: true });
  service.registerSource({ descriptor: { id: "weather", label: "Weather", purposes: ["weather"], costClass: "free", transport: "http", certification: "first_party" }, cacheTtlMs: 60_000, query: async () => [{ id: String(++calls), kind: "weather", title: `Forecast ${calls}`, data: {}, sources: [{ sourceId: "weather", observedAt: 1_000, freshness: "fresh" }] }] });
  service.store.putConsent("alice", { id: "weather", principalId: "alice", sourceId: "weather", purposes: ["weather"], fields: ["*"], grantedAt: 1 });
  const denied = await service.handle({ t: "personal_source_test", requestId: "denied", sourceId: "weather", purpose: "weather" }, { ...actor, owner: false });
  assert.equal(denied.t === "personal_context_result" && denied.ok, false);
  const first = await service.handle({ t: "personal_source_test", requestId: "one", sourceId: "weather", purpose: "weather" }, actor);
  const second = await service.handle({ t: "personal_source_test", requestId: "two", sourceId: "weather", purpose: "weather" }, actor);
  assert.equal(first.t, "personal_source_test_result"); assert.equal(second.t, "personal_source_test_result"); assert.equal(calls, 2);
});

test("pausing one source revokes runtime authority immediately without deleting consent or configuration", async () => {
  let calls = 0, disposals = 0;
  const service = new PersonalAssistantService({
    root: mkdtempSync(join(tmpdir(), "jarvis-pa-source-pause-")),
    sourceFactory: (connection) => ({
      source: {
        descriptor: { id: connection.id, label: connection.label, purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" },
        query: async () => [{ id: String(++calls), kind: "event", title: "Event", data: {}, sources: [{ sourceId: connection.id, observedAt: 1, freshness: "fresh" }] }],
      },
      dispose: async () => { disposals += 1; },
    }),
  });
  const actor = { principalId: "alice", deviceId: "phone", owner: true };
  service.store.updateSettings("alice", { enabled: true });
  service.store.putConsent("alice", { id: "feed-consent", principalId: "alice", sourceId: "feed", purposes: ["events"], fields: ["*"], grantedAt: 1 });
  let revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_source_put", requestId: "put", revision, source: { id: "feed", type: "open_events", label: "Feed", enabled: true, endpoint: "https://events.example", config: {}, allowedResources: [], allowedActions: [] } }, actor);
  assert.equal((await service.handle({ t: "personal_context_query", requestId: "before", query: { purpose: "events" } }, actor)).t, "personal_context_suggestions");

  revision = service.store.get("alice").revision;
  const paused = await service.handle({ t: "personal_context_update", requestId: "pause-source", revision, patch: { pausedSourceIds: ["feed"] } }, actor);
  assert.equal(paused.t, "personal_context_state");
  assert.equal(disposals, 1);
  assert.equal(service.store.get("alice").sources.length, 1);
  assert.equal(service.store.get("alice").consents.filter((row) => !row.revokedAt).length, 1);
  const blocked = await service.handle({ t: "personal_context_query", requestId: "paused-query", query: { purpose: "events" } }, actor);
  assert.equal(blocked.t, "personal_context_suggestions");
  assert.equal(blocked.t === "personal_context_suggestions" && blocked.suggestions.length, 0);
  assert.equal(calls, 1);

  revision = service.store.get("alice").revision;
  await service.handle({ t: "personal_context_update", requestId: "resume-source", revision, patch: { pausedSourceIds: [] } }, actor);
  const resumed = await service.handle({ t: "personal_context_query", requestId: "after", query: { purpose: "events" } }, actor);
  assert.equal(resumed.t === "personal_context_suggestions" && resumed.suggestions.length, 1);
  assert.equal(calls, 2);
  await service.disposeAll();
});

test("only the owner can pause or resume a context source", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-owner-pause-"));
  try {
    const service = new PersonalAssistantService({ root });
    const actor = { principalId: "alice", deviceId: "phone", owner: true };
    const initial = await service.handle({ t: "personal_context_get", requestId: "get" }, actor);
    assert.equal(initial.t, "personal_context_state");
    const denied = await service.handle({
      t: "personal_context_update",
      requestId: "pause-denied",
      revision: initial.state.revision,
      patch: { pausedSourceIds: ["weather"] },
    }, { ...actor, owner: false });
    assert.equal(denied.t, "personal_context_result");
    assert.match(denied.error || "", /owner/);
    const unchanged = await service.handle({ t: "personal_context_get", requestId: "unchanged" }, actor);
    assert.equal(unchanged.t, "personal_context_state");
    assert.deepEqual(unchanged.state.settings.pausedSourceIds, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preference decisions are persisted and rejected inference is not recreated", async () => {
  const { service, actor } = fixture();
  service.store.putPreference("alice", {
    id: "inferred:alice-food-sushi-prefer", principalId: "alice", kind: "inferred", key: "food", value: "sushi", polarity: "prefer",
    confidence: 0.8, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1,
  });
  const rejected = await service.handle({
    t: "personal_preference_decision", requestId: "reject", revision: service.store.get("alice").revision,
    preferenceId: "inferred:alice-food-sushi-prefer", decision: "reject",
  }, actor);
  assert.equal(rejected.t, "personal_context_state");
  assert.equal(service.store.get("alice").preferences[0]?.decision, "rejected");
  assert.equal(service.store.get("alice").preferences[0]?.confidence, 0);

  for (const id of ["a", "b", "c"]) {
    await service.handle({
      t: "personal_feedback_put", requestId: `feedback-${id}`, revision: service.store.get("alice").revision,
      feedback: { id, suggestionId: `suggestion-${id}`, purpose: "nearby", kind: "like", key: "food", value: "sushi" },
    }, actor);
  }
  const persisted = service.store.get("alice").preferences.find((row) => row.id === "inferred:alice-food-sushi-prefer");
  assert.equal(persisted?.decision, "rejected");
  assert.equal(persisted?.confidence, 0);
});

test("correcting an inferred preference promotes it to an explicit hard rule", async () => {
  const { service, actor } = fixture();
  service.store.putPreference("alice", {
    id: "habit", principalId: "alice", kind: "inferred", key: "food", value: "pizza", polarity: "prefer",
    confidence: 0.6, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1,
  });
  const response = await service.handle({
    t: "personal_preference_decision", requestId: "correct", revision: service.store.get("alice").revision,
    preferenceId: "habit", decision: "correct", correction: { key: "diet", value: "vegan", polarity: "require", purposes: ["nearby"] },
  }, actor);
  assert.equal(response.t, "personal_context_state");
  const corrected = service.store.get("alice").preferences[0];
  assert.equal(corrected.kind, "explicit");
  assert.equal(corrected.decision, "corrected");
  assert.equal(corrected.polarity, "require");
  assert.equal(corrected.value, "vegan");
});

test("context queries expose bounded discard diagnostics and favorites always retain provenance", async () => {
  const { service, actor } = fixture();
  service.store.updateSettings("alice", { enabled: true });
  await service.handle({
    t: "personal_favorite_put", requestId: "favorite", revision: service.store.get("alice").revision,
    favorite: { id: "home", label: "Casa", aliases: [], point: { lat: -19.9, lng: -43.9 }, purposes: ["nearby"] },
  }, actor);
  assert.equal(service.store.get("alice").favorites[0]?.source?.sourceId, "user");
  const view = await service.handle({ t: "personal_context_get", requestId: "summary" }, actor);
  const favoriteSummary = view.t === "personal_context_state" ? view.state.dataSummary.categories.find((row) => row.category === "favorites") : undefined;
  assert.deepEqual(favoriteSummary?.sourceIds, ["user"]);
  assert.equal(favoriteSummary?.count, 1);
  service.store.putPreference("alice", { id: "avoid", principalId: "alice", kind: "explicit", key: "cuisine", value: "sushi", polarity: "avoid", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  service.registerSource({
    descriptor: { id: "places", label: "Places", purposes: ["nearby"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [{ id: "sushi", kind: "restaurant", title: "Sushi", data: { cuisine: "sushi" }, sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" }] }],
  });
  service.store.putConsent("alice", { id: "places", principalId: "alice", sourceId: "places", purposes: ["nearby"], fields: ["*"], grantedAt: 1 });
  const response = await service.handle({ t: "personal_context_query", requestId: "query", query: { purpose: "nearby" } }, actor);
  assert.equal(response.t, "personal_context_suggestions");
  assert.equal(response.t === "personal_context_suggestions" && response.suggestions.length, 0);
  assert.ok(response.t === "personal_context_suggestions" && response.diagnostics?.[0]?.reasons.includes("explicit_preference_avoid:avoid"));
  assert.ok(service.store.get("alice").preferences.find((row) => row.id === "avoid")?.lastUsedAt);
  assert.equal(response.t === "personal_context_suggestions" && response.revision, service.store.get("alice").revision);
});

test("global adaptive policy blocks personal context even when the stored assistant is enabled", async () => {
  const service = new PersonalAssistantService({
    root: mkdtempSync(join(tmpdir(), "jarvis-pa-policy-")),
    allowPersonalContext: () => false,
  });
  service.store.updateSettings("alice", { enabled: true });
  const response = await service.handle({ t: "personal_context_query", requestId: "blocked", query: { purpose: "events" } }, { principalId: "alice", deviceId: "phone", owner: true });
  assert.equal(response.t, "personal_context_result");
  assert.equal(response.t === "personal_context_result" && response.ok, false);
  assert.match(response.t === "personal_context_result" ? response.error || "" : "", /blocked by policy/);
});

test("concurrent source edits serialize disposal and allow only one optimistic revision", async () => {
  let releaseDispose!: () => void;
  let markDisposeStarted!: () => void;
  const disposeStarted = new Promise<void>((resolve) => { markDisposeStarted = resolve; });
  const disposeGate = new Promise<void>((resolve) => { releaseDispose = resolve; });
  const createdLabels: string[] = [];
  const service = new PersonalAssistantService({
    root: mkdtempSync(join(tmpdir(), "jarvis-pa-source-race-")),
    sourceFactory: (connection) => {
      createdLabels.push(connection.label);
      return {
        source: {
          descriptor: { id: connection.id, label: connection.label, purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" },
          query: async () => [],
        },
        dispose: connection.label === "Initial" ? async () => { markDisposeStarted(); await disposeGate; } : undefined,
      };
    },
  });
  const actor = { principalId: "alice", deviceId: "phone", owner: true };
  service.store.updateSettings("alice", { enabled: true });
  service.store.putConsent("alice", { id: "events-consent", principalId: "alice", sourceId: "events", purposes: ["events"], fields: ["*"], grantedAt: 1 });
  await service.handle({
    t: "personal_source_put", requestId: "initial", revision: service.store.get("alice").revision,
    source: { id: "events", type: "open_events", label: "Initial", enabled: true, endpoint: "https://events.example", config: {}, allowedResources: [], allowedActions: [] },
  }, actor);
  const revision = service.store.get("alice").revision;
  const update = (requestId: string, label: string) => service.handle({
    t: "personal_source_put" as const, requestId, revision,
    source: { id: "events", type: "open_events" as const, label, enabled: true, endpoint: "https://events.example", config: {}, allowedResources: [], allowedActions: [] },
  }, actor);
  const first = update("first", "A");
  const second = update("second", "B");
  await disposeStarted;
  releaseDispose();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.t, "personal_context_state");
  assert.equal(secondResult.t === "personal_context_result" && secondResult.ok, false);
  assert.equal(service.store.get("alice").sources[0]?.label, "A");
  assert.deepEqual(createdLabels, ["Initial", "A"]);
  await service.disposeAll();
});
