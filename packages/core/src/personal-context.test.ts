import test from "node:test";
import assert from "node:assert/strict";
import { activeConsent, defaultPersonalAssistantSettings, emptyPersonalContextState, isQuietTime, normalizeGeoPoint } from "./personal-context.js";

test("personal context defaults to disabled, approximate and privacy-preserving", () => {
  const settings = defaultPersonalAssistantSettings("user-1", 10);
  assert.equal(settings.enabled, false);
  assert.equal(settings.locationMode, "off");
  assert.equal(settings.locationPrecision, "approximate");
  assert.deepEqual(settings.pausedSourceIds, []);
  assert.equal(settings.retention.keepRawLocation, false);
  assert.equal(settings.updatedAt, 10);
});

test("consent requires enabled state, exact purpose, fields, device and validity", () => {
  const state = emptyPersonalContextState("user-1", 1);
  state.settings.enabled = true;
  state.consents.push({ id: "c1", principalId: "user-1", sourceId: "device-location", purposes: ["nearby"], fields: ["position"], deviceId: "phone", grantedAt: 2, expiresAt: 20 });
  assert.ok(activeConsent(state, { principalId: "user-1", sourceId: "device-location", purpose: "nearby", fields: ["position"], deviceId: "phone" }, 10));
  assert.equal(activeConsent(state, { principalId: "user-1", sourceId: "device-location", purpose: "weather", fields: ["position"], deviceId: "phone" }, 10), undefined);
  assert.equal(activeConsent(state, { principalId: "user-1", sourceId: "device-location", purpose: "nearby", fields: ["position"], deviceId: "other" }, 10), undefined);
  assert.equal(activeConsent(state, { principalId: "user-1", sourceId: "device-location", purpose: "nearby", fields: ["position"], deviceId: "phone" }, 21), undefined);
  state.settings.pausedSourceIds = ["device-location"];
  assert.equal(activeConsent(state, { principalId: "user-1", sourceId: "device-location", purpose: "nearby", fields: ["position"], deviceId: "phone" }, 10), undefined);
});

test("wildcard consent covers ordinary fields but not explicitly sensitive fields", () => {
  const state = emptyPersonalContextState("user-1", 1); state.settings.enabled = true;
  state.consents.push({ id: "calendar", principalId: "user-1", sourceId: "caldav", purposes: ["calendar"], fields: ["*"], grantedAt: 2 });
  assert.ok(activeConsent(state, { principalId: "user-1", sourceId: "caldav", purpose: "calendar", fields: ["busy", "time"] }, 10));
  assert.equal(activeConsent(state, { principalId: "user-1", sourceId: "caldav", purpose: "calendar", fields: ["busy"], exactFields: ["details"] }, 10), undefined);
  state.consents[0].fields.push("details");
  assert.ok(activeConsent(state, { principalId: "user-1", sourceId: "caldav", purpose: "calendar", fields: ["busy"], exactFields: ["details"] }, 10));
});

test("approximate locations cannot retain device-level precision", () => {
  assert.deepEqual(normalizeGeoPoint({ lat: -19.9245012, lng: -43.9352371, accuracyM: 8 }, "approximate"), { lat: -19.92, lng: -43.94, accuracyM: 1_000 });
  assert.deepEqual(normalizeGeoPoint({ lat: -19.9245012, lng: -43.9352371 }, "precise"), { lat: -19.924501, lng: -43.935237 });
  assert.throws(() => normalizeGeoPoint({ lat: 91, lng: 0 }, "precise"), /invalid geographic/);
});

test("quiet hours support ranges that cross midnight", () => {
  assert.equal(isQuietTime(new Date(2026, 0, 1, 23, 0), "22:00", "08:00"), true);
  assert.equal(isQuietTime(new Date(2026, 0, 1, 12, 0), "22:00", "08:00"), false);
  assert.equal(isQuietTime(new Date(2026, 0, 1, 12, 0), "09:00", "13:00"), true);
});
