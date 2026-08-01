import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonalContextStore } from "./personal-store.js";

const dir = () => mkdtempSync(join(tmpdir(), "jarvis-personal-"));

test("personal persistence uses owner-only modes on POSIX filesystems", { skip: process.platform === "win32" }, () => {
  const root = dir();
  const store = new PersonalContextStore({ root, snapshotEvery: 1 });
  store.updateSettings("alice", { enabled: true });
  const principalDir = join(root, readdirSync(root, { withFileTypes: true }).find((entry) => entry.isDirectory())!.name);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(principalDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(principalDir, "journal.jsonl")).mode & 0o777, 0o600);
  assert.equal(statSync(join(principalDir, "snapshot.json")).mode & 0o777, 0o600);
});

test("PersonalContextStore isolates principals and survives restart", () => {
  const root = dir(); let now = 100;
  const store = new PersonalContextStore({ root, now: () => ++now, snapshotEvery: 1 });
  store.updateSettings("alice", { enabled: true });
  store.putFavorite("alice", { id: "home", principalId: "alice", label: "Casa", aliases: [], point: { lat: -19.92, lng: -43.94 }, purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  store.updateSettings("bob", { enabled: true });
  assert.equal(store.get("alice").favorites.length, 1);
  assert.equal(store.get("bob").favorites.length, 0);
  const reopened = new PersonalContextStore({ root });
  assert.equal(reopened.get("alice").favorites[0]?.label, "Casa");
  assert.equal(reopened.get("bob").favorites.length, 0);
});

test("device profiles are scoped, durable and included in a principal export", () => {
  const root = dir();
  const store = new PersonalContextStore({ root, snapshotEvery: 1 });
  store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "America/Sao_Paulo", proactiveEnabled: true, updatedAt: 10 });
  store.putDeviceProfile("alice", { deviceId: "desktop", locale: "en-US", timeZone: "UTC", proactiveEnabled: false, updatedAt: 11 });
  store.putDeviceProfile("bob", { deviceId: "phone", locale: "es-ES", timeZone: "Europe/Madrid", proactiveEnabled: true, updatedAt: 12 });
  const reopened = new PersonalContextStore({ root });
  assert.deepEqual(reopened.get("alice").deviceProfiles.map((row) => row.deviceId).sort(), ["desktop", "phone"]);
  assert.equal(reopened.get("bob").deviceProfiles[0]?.locale, "es-ES");
  assert.equal(reopened.export("alice").deviceProfiles.length, 2);
});

test("vehicle profiles are scoped, durable and keep exactly one default", () => {
  const root = dir(); const store = new PersonalContextStore({ root, snapshotEvery: 1 });
  store.putVehicleProfile("alice", { id: "one", principalId: "alice", label: "One", connectorTypeIds: [25], preferredOperators: [], isDefault: true, createdAt: 1, updatedAt: 1 });
  store.putVehicleProfile("alice", { id: "two", principalId: "alice", label: "Two", connectorTypeIds: [27], preferredOperators: ["Local"], isDefault: true, createdAt: 2, updatedAt: 2 });
  store.putVehicleProfile("bob", { id: "one", principalId: "bob", label: "Other", connectorTypeIds: [2], preferredOperators: [], isDefault: true, createdAt: 1, updatedAt: 1 });
  let alice = new PersonalContextStore({ root }).get("alice");
  assert.deepEqual(alice.vehicleProfiles.map((row) => [row.id, row.isDefault]), [["one", false], ["two", true]]);
  assert.equal(new PersonalContextStore({ root }).export("bob").vehicleProfiles[0]?.label, "Other");
  store.deleteVehicleProfile("alice", "two");
  alice = new PersonalContextStore({ root }).get("alice");
  assert.deepEqual(alice.vehicleProfiles.map((row) => [row.id, row.isDefault]), [["one", true]]);
});

test("deleting a favorite also removes compacted geofence transition evidence", () => {
  const root = dir(); const store = new PersonalContextStore({ root });
  store.putFavorite("alice", { id: "home", principalId: "alice", label: "Home", aliases: [], point: { lat: 1, lng: 2 }, purposes: ["events"], geofenceRadiusM: 100, geofenceTransitions: ["enter"], createdAt: 1, updatedAt: 1 });
  store.putObservation("alice", { id: "geo", principalId: "alice", sourceId: "device-location", kind: "geofence_transition", purpose: "events", observedAt: 1, expiresAt: 100, value: { favoriteId: "home", transition: "enter", deviceId: "phone" }, source: { sourceId: "device-location", observedAt: 1, freshness: "fresh" } });
  store.deleteFavorite("alice", "home");
  assert.equal(new PersonalContextStore({ root }).get("alice").observations.length, 0);
  const principalDir = join(root, readdirSync(root)[0]);
  assert.equal(readdirSync(principalDir).map((name) => readFileSync(join(principalDir, name), "utf8")).join("\n").includes("favoriteId"), false);
});

test("category erasure is durable and does not remove another principal", () => {
  const root = dir(); const store = new PersonalContextStore({ root });
  store.putPreference("alice", { id: "private", principalId: "alice", kind: "explicit", key: "food", value: "PRIVATE-CATEGORY", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  store.putPreference("bob", { id: "keep", principalId: "bob", kind: "explicit", key: "food", value: "KEEP", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  store.eraseCategory("alice", "preferences");
  const reopened = new PersonalContextStore({ root });
  assert.equal(reopened.get("alice").preferences.length, 0);
  assert.equal(reopened.get("bob").preferences[0]?.value, "KEEP");
  const principalDir = join(root, readdirSync(root).find((name) => readdirSync(join(root, name)).includes("snapshot.json"))!);
  assert.equal(readdirSync(principalDir).map((name) => readFileSync(join(principalDir, name), "utf8")).join("\n").includes("PRIVATE-CATEGORY"), false);
});

test("category erasure also removes records derived from the erased category", () => {
  const root = dir(); const store = new PersonalContextStore({ root });
  store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "UTC", proactiveEnabled: true, updatedAt: 1 });
  store.putConsent("alice", { id: "device", principalId: "alice", sourceId: "device-location", purposes: ["nearby"], fields: ["point"], deviceId: "phone", grantedAt: 1 });
  store.putObservation("alice", { id: "visit", principalId: "alice", sourceId: "open-events", kind: "feedback", purpose: "events", observedAt: 1, expiresAt: Date.now() + 60_000, value: { deviceId: "phone" }, source: { sourceId: "open-events", observedAt: 1, freshness: "fresh" } });
  store.putPreference("alice", { id: "inferred", principalId: "alice", kind: "inferred", key: "event", value: "music", polarity: "prefer", confidence: 0.7, evidence: [{ id: "visit", kind: "visit_summary", at: 1, summary: "visit", sourceId: "open-events" }], purposes: ["events"], createdAt: 1, updatedAt: 1 });
  store.recordNotification("alice", { id: "notice", principalId: "alice", suggestionId: "s", channel: "push", outcome: "shown", deviceId: "phone", at: 1 });
  store.eraseCategory("alice", "device_profiles");
  let state = store.get("alice");
  assert.equal(state.deviceProfiles.length, 0);
  assert.equal(state.consents.length, 0);
  assert.equal(state.observations.length, 0);
  assert.equal(state.notifications.length, 0);
  store.putObservation("alice", { id: "again", principalId: "alice", sourceId: "open-events", kind: "feedback", purpose: "events", observedAt: 2, expiresAt: Date.now() + 60_000, value: {}, source: { sourceId: "open-events", observedAt: 2, freshness: "fresh" } });
  store.eraseCategory("alice", "observations");
  state = store.get("alice");
  assert.equal(state.observations.length, 0);
  assert.equal(state.preferences.length, 0);
});

test("deletion compacts journals so removed private values cannot resurrect", () => {
  const root = dir(); const store = new PersonalContextStore({ root });
  store.putPreference("alice", { id: "p1", principalId: "alice", kind: "explicit", key: "food", value: "SECRET-SUSHI", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  store.deletePreference("alice", "p1");
  const principalDir = join(root, readdirSync(root)[0]);
  const files = readdirSync(principalDir);
  assert.equal(files.some((name) => name.endsWith(".bak")), false);
  assert.equal(files.map((name) => readFileSync(join(principalDir, name), "utf8")).join("\n").includes("SECRET-SUSHI"), false);
  assert.equal(new PersonalContextStore({ root }).get("alice").preferences.length, 0);
});

test("recovery ignores an incomplete journal tail", () => {
  const root = dir(); const store = new PersonalContextStore({ root, snapshotEvery: 1 });
  store.updateSettings("alice", { enabled: true });
  const principalDir = join(root, readdirSync(root)[0]);
  appendFileSync(join(principalDir, "journal.jsonl"), "{partial");
  assert.equal(new PersonalContextStore({ root }).get("alice").settings.enabled, true);
});

test("a compacted checkpoint wins over an old higher-revision snapshot after a crash", () => {
  const root = dir(); const store = new PersonalContextStore({ root, snapshotEvery: 1 });
  store.putPreference("alice", { id: "p1", principalId: "alice", kind: "explicit", key: "food", value: "OLD-PRIVATE-VALUE", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  const principalDir = join(root, readdirSync(root)[0]);
  const oldSnapshot = readFileSync(join(principalDir, "snapshot.json"), "utf8");
  store.deletePreference("alice", "p1");
  // Simulates power loss after journal generation swap but before the old snapshot was removed.
  writeFileSync(join(principalDir, "snapshot.json"), oldSnapshot);
  assert.equal(new PersonalContextStore({ root }).get("alice").preferences.length, 0);
});

test("revocation removes source-derived data and location persistence is minimized", () => {
  const root = dir(); const store = new PersonalContextStore({ root });
  store.updateSettings("alice", { enabled: true, locationPrecision: "precise", retention: { observationsDays: 14, decisionsDays: 30, inferredPreferencesDays: 90, keepRawLocation: false } });
  store.putConsent("alice", { id: "c", principalId: "alice", sourceId: "device-location", purposes: ["nearby"], fields: ["position"], grantedAt: 1 });
  store.putObservation("alice", { id: "o", principalId: "alice", sourceId: "device-location", kind: "device_location", purpose: "nearby", observedAt: 1, expiresAt: 99, value: { lat: -19.924501, lng: -43.935237, accuracyM: 5 }, source: { sourceId: "device-location", observedAt: 1, freshness: "live" } });
  assert.deepEqual(store.get("alice").observations[0].value, { lat: -19.92, lng: -43.94, accuracyM: 1_000 });
  store.revokeConsent("alice", "c");
  assert.equal(store.get("alice").observations.length, 0);
  assert.equal(new PersonalContextStore({ root }).get("alice").observations.length, 0);
});

test("source deletion durably removes status, observations and inferred evidence", () => {
  const root = dir(); const store = new PersonalContextStore({ root });
  store.putSource("alice", { id: "feed", principalId: "alice", type: "open_events", label: "Feed", enabled: true, config: {}, allowedResources: [], allowedActions: [], createdAt: 1, updatedAt: 1 });
  store.putSourceStatus("alice", { descriptor: { id: "feed", label: "Feed", purposes: ["events"], costClass: "free", transport: "http", certification: "audited" }, state: "ready", checkedAt: 1, failures: 0 });
  store.putObservation("alice", { id: "event", principalId: "alice", sourceId: "feed", kind: "event", purpose: "events", observedAt: 1, expiresAt: 100, value: {}, source: { sourceId: "feed", observedAt: 1, freshness: "fresh" } });
  store.putPreference("alice", { id: "habit", principalId: "alice", kind: "inferred", key: "event", value: "music", polarity: "prefer", confidence: 0.7, evidence: [{ id: "event", kind: "choice", at: 1, summary: "selected", sourceId: "feed" }], purposes: ["events"], createdAt: 1, updatedAt: 1 });
  store.deleteSource("alice", "feed");
  const state = new PersonalContextStore({ root }).get("alice");
  assert.equal(state.sources.length, 0);
  assert.equal(state.sourceStatuses.length, 0);
  assert.equal(state.observations.length, 0);
  assert.equal(state.preferences.length, 0);
});

test("an erase tombstone defeats an old directory restored after an interrupted delete", () => {
  const root = dir(); const store = new PersonalContextStore({ root, snapshotEvery: 1 });
  store.putPreference("alice", { id: "p", principalId: "alice", kind: "explicit", key: "private", value: "MUST-NOT-RETURN", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  const principalName = readdirSync(root).find((name) => !name.startsWith(".erased-"))!;
  const principalDir = join(root, principalName), backup = dir();
  cpSync(principalDir, join(backup, principalName), { recursive: true });
  assert.equal(store.erase("alice"), true);
  cpSync(join(backup, principalName), principalDir, { recursive: true });

  const reopened = new PersonalContextStore({ root });
  assert.equal(reopened.get("alice").preferences.length, 0);
  assert.equal(existsSync(principalDir), false);
  reopened.updateSettings("alice", { enabled: true });
  const fresh = new PersonalContextStore({ root }).get("alice");
  assert.equal(fresh.settings.enabled, true);
  assert.equal(fresh.preferences.length, 0);
});

test("erasure fences delayed writers until an explicit settings update revives the principal", () => {
  const root = dir(); const store = new PersonalContextStore({ root });
  store.updateSettings("alice", { enabled: true });
  const generation = store.generation("alice");
  store.erase("alice");
  assert.equal(store.isGenerationCurrent("alice", generation), false);
  assert.throws(() => store.recordNotification("alice", { id: "late", principalId: "alice", suggestionId: "s", channel: "push", outcome: "pending", deviceId: "phone", at: 1 }, generation), /generation changed/);
  assert.throws(() => store.recordNotification("alice", { id: "late", principalId: "alice", suggestionId: "s", channel: "push", outcome: "pending", deviceId: "phone", at: 1 }), /explicitly enabled/);
  store.updateSettings("alice", { enabled: true });
  store.recordNotification("alice", { id: "fresh", principalId: "alice", suggestionId: "s", channel: "push", outcome: "shown", deviceId: "phone", at: 2 }, store.generation("alice"));
  assert.deepEqual(store.get("alice").notifications.map((row) => row.id), ["fresh"]);
});

test("retention prunes expired observations, inferred preferences and old decisions", () => {
  const root = dir(); let now = 200 * 86_400_000;
  const store = new PersonalContextStore({ root, now: () => now });
  store.updateSettings("alice", { enabled: true, retention: { observationsDays: 1, decisionsDays: 1, inferredPreferencesDays: 1, keepRawLocation: false } });
  store.putObservation("alice", { id: "o", principalId: "alice", sourceId: "x", kind: "place", purpose: "nearby", observedAt: now - 2 * 86_400_000, expiresAt: now + 100, value: {}, source: { sourceId: "x", observedAt: now, freshness: "fresh" } });
  store.putPreference("alice", { id: "p", principalId: "alice", kind: "inferred", key: "food", value: "pizza", polarity: "prefer", confidence: 0.5, evidence: [], purposes: ["nearby"], createdAt: now - 2 * 86_400_000, updatedAt: now - 2 * 86_400_000 });
  assert.equal(store.prune("alice", now).observations.length, 0);
  assert.equal(store.get("alice").preferences.length, 0);
});

test("preference usage is persisted as one principal-scoped event without changing evidence", () => {
  const root = dir(); const store = new PersonalContextStore({ root, now: () => 1_000 });
  store.putPreference("alice", { id: "food", principalId: "alice", kind: "explicit", key: "food", value: "sushi", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 });
  const before = store.get("alice").revision;
  const used = store.markPreferencesUsed("alice", ["food", "missing", "food"], 900);
  assert.equal(used.revision, before + 1);
  assert.equal(used.preferences[0].lastUsedAt, 900);
  assert.deepEqual(used.preferences[0].evidence, []);
  assert.equal(store.markPreferencesUsed("alice", ["food"], 900).revision, used.revision);
  assert.equal(new PersonalContextStore({ root }).get("alice").preferences[0].lastUsedAt, 900);
});

test("export omits action payloads and erase removes only the requested principal", () => {
  const root = dir(); const store = new PersonalContextStore({ root });
  store.putAction("alice", { id: "a", principalId: "alice", idempotencyKey: "i", kind: "calendar.create", risk: "external_reversible", preview: { title: "Preview" }, payload: { token: "NEVER-EXPORT" }, createdAt: 1, expiresAt: 2, state: "pending" });
  store.putSourceStatus("alice", { descriptor: { id: "calendar", label: "Calendar", purposes: ["calendar"], costClass: "local", transport: "device", certification: "first_party" }, state: "ready", checkedAt: 1, failures: 0 });
  store.recordNotification("alice", { id: "n", principalId: "alice", suggestionId: "s", kind: "calendar_reminder", channel: "push", outcome: "shown", title: "Reminder", body: "Starts soon", deepLink: "/#personal-assistant", expiresAt: 2, at: 1 });
  store.updateSettings("bob", { enabled: true });
  const exported = store.export("alice");
  assert.equal(JSON.stringify(exported).includes("NEVER-EXPORT"), false);
  assert.equal(exported.sourceStatuses[0]?.descriptor.id, "calendar");
  assert.equal(exported.notifications[0]?.title, "Reminder");
  assert.equal(store.erase("alice"), true);
  assert.equal(store.get("bob").settings.enabled, true);
});
