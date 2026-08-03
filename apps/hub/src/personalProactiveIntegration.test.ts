import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonalAssistantService } from "./personalAssistant.js";
import { createPersonalProactiveScheduler } from "./personalProactiveIntegration.js";

test("proactive integration queries consented context and delivers only to the opted-in device", async () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-integration-")), now: () => now });
  assistant.store.updateSettings("alice", {
    enabled: true,
    notifications: { quietStart: "22:00", quietEnd: "08:00", maxPerDay: 4, cooldownMinutes: 0, minScore: 0 },
  });
  assistant.store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "America/Sao_Paulo", proactiveEnabled: true, updatedAt: now });
  assistant.registerSource({
    descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [{ id: "event-1", kind: "event", title: "Evento em BH", data: { startAt: now + 3_600_000 }, sources: [{ sourceId: "events", observedAt: now, freshness: "fresh" }] }],
  });
  assistant.store.putConsent("alice", { id: "events", principalId: "alice", sourceId: "events", purposes: ["events"], fields: [], grantedAt: now });

  const deliveries: Array<{ target: { principalId: string; deviceId: string; generation: number }; url: string }> = [];
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async (_title: string, _body: string, _tag: string, url: string, target: { principalId: string; deviceId: string; generation: number }) => { deliveries.push({ target, url }); return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }, { id: "phone", userId: "bob" }],
    now: () => now,
  });
  const report = await scheduler.runOnce();
  assert.equal(report.targets, 1);
  assert.equal(report.sent, 1);
  assert.deepEqual(deliveries[0]?.target, { principalId: "alice", deviceId: "phone", generation: 0 });
  assert.match(deliveries[0]?.url || "", /^\/#personal-assistant\?suggestion=.*&notification=/);
  assert.equal(assistant.store.get("alice").notifications[0]?.deviceId, "phone");
  assert.equal(assistant.store.get("bob").notifications.length, 0);

  const repeated = await scheduler.runOnce();
  assert.equal(repeated.sent, 0);
  assert.equal(deliveries.length, 1);
});

test("proactive integration does not create a target without explicit per-device opt-in", async () => {
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-no-profile-")) });
  assistant.store.updateSettings("alice", { enabled: true });
  let pushed = false;
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async () => { pushed = true; return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }],
  });
  const report = await scheduler.runOnce();
  assert.equal(report.targets, 0);
  assert.equal(report.queried, 0);
  assert.equal(pushed, false);
});

test("proactive integration uses clock and principal-scoped routines without exposing their prompt", async () => {
  const now = new Date(2026, 0, 2, 12, 0, 0).getTime();
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-routine-")), now: () => now });
  assistant.store.updateSettings("alice", { enabled: true, notifications: { quietStart: "00:00", quietEnd: "00:00", maxPerDay: 4, cooldownMinutes: 0, minScore: 0 } });
  assistant.store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "UTC", proactiveEnabled: true, updatedAt: now });
  const bodies: string[] = [];
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async (_title: string, body: string) => { bodies.push(body); return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }],
    listRoutines: (target) => target.principalId === "alice" ? [{
      id: "morning-review", name: "Revisão diária", prompt: "segredo que não pode ir para push", hour: 12, minute: 20,
      enabled: true, createdAt: now, principalId: "alice", deviceId: "phone",
    }] : [],
    now: () => now,
  });

  const report = await scheduler.runOnce();
  assert.equal(report.sent, 1);
  assert.match(bodies[0] || "", /Rotina próxima: Revisão diária.*20 min/);
  assert.doesNotMatch(bodies[0] || "", /segredo/);
  assert.equal(assistant.store.get("alice").notifications[0]?.kind, "routine_reminder");
  assert.equal((await scheduler.runOnce()).sent, 0, "the same routine occurrence is deduplicated");
});

test("erasing a principal while a proactive query is in flight fences every late write and delivery", async () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-erasure-fence-")), now: () => now });
  assistant.store.updateSettings("alice", {
    enabled: true,
    notifications: { quietStart: "00:00", quietEnd: "00:00", maxPerDay: 4, cooldownMinutes: 0, minScore: 0 },
  });
  assistant.store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "UTC", proactiveEnabled: true, updatedAt: now });
  let releaseQuery!: () => void;
  let markStarted!: () => void;
  const queryStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
  assistant.registerSource({
    descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => {
      markStarted();
      await queryGate;
      return [{ id: "late-event", kind: "event", title: "Late event", data: { startAt: now + 3_600_000 }, sources: [{ sourceId: "events", observedAt: now, freshness: "fresh" }] }];
    },
  });
  assistant.store.putConsent("alice", { id: "events", principalId: "alice", sourceId: "events", purposes: ["events"], fields: [], grantedAt: now });
  let pushed = false;
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async () => { pushed = true; return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }],
    now: () => now,
  });

  const generation = assistant.store.generation("alice");
  const run = scheduler.runOnce();
  await queryStarted;
  assistant.store.erase("alice");
  assert.notEqual(assistant.store.generation("alice"), generation);
  releaseQuery();
  const report = await run;

  assert.equal(report.sent, 0);
  assert.equal(pushed, false);
  assert.equal(assistant.store.get("alice").notifications.length, 0);
});

test("each device can override quiet hours and delivery limits independently", async () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-device-policy-")), now: () => now });
  assistant.store.updateSettings("alice", { enabled: true, notifications: { quietStart: "00:00", quietEnd: "00:00", maxPerDay: 4, cooldownMinutes: 0, minScore: 0 } });
  assistant.store.putDeviceProfile("alice", {
    deviceId: "phone", locale: "pt-BR", timeZone: "UTC", proactiveEnabled: true, updatedAt: now,
    notifications: { quietStart: "11:00", quietEnd: "13:00", maxPerDay: 1, cooldownMinutes: 0, minScore: 0 },
  });
  assistant.store.putDeviceProfile("alice", { deviceId: "tablet", locale: "pt-BR", timeZone: "UTC", proactiveEnabled: true, updatedAt: now });
  assistant.registerSource({
    descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [{ id: "event", kind: "event", title: "Evento", data: { startAt: now + 3_600_000 }, sources: [{ sourceId: "events", observedAt: now, freshness: "fresh" }] }],
  });
  assistant.store.putConsent("alice", { id: "events", principalId: "alice", sourceId: "events", purposes: ["events"], fields: ["*"], grantedAt: now });
  const devices: string[] = [];
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async (_title: string, _body: string, _tag: string, _url: string, target: { deviceId: string }) => { devices.push(target.deviceId); return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }, { id: "tablet", userId: "alice" }],
    now: () => now,
  });
  const report = await scheduler.runOnce();
  assert.equal(report.sent, 1);
  assert.deepEqual(devices, ["tablet"]);
  assert.equal(report.decisions.find((row) => row.deviceId === "phone")?.reason, "quiet_hours");
});

test("proactive integration turns only imminent busy calendar facts into a private reminder", async () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-calendar-")), now: () => now });
  assistant.store.updateSettings("alice", { enabled: true, notifications: { quietStart: "22:00", quietEnd: "08:00", maxPerDay: 4, cooldownMinutes: 0, minScore: 0 } });
  assistant.store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "America/Sao_Paulo", proactiveEnabled: true, updatedAt: now });
  assistant.registerSource({
    descriptor: { id: "calendar", label: "Calendar", purposes: ["calendar"], costClass: "local", transport: "device", certification: "first_party" },
    query: async () => [
      { id: "soon", kind: "calendar_availability", title: "Busy", data: { availability: "busy", startAt: now + 30 * 60_000, endAt: now + 90 * 60_000 }, sources: [{ sourceId: "calendar", observedAt: now, freshness: "fresh" }] },
      { id: "later", kind: "calendar_availability", title: "Busy", data: { availability: "busy", startAt: now + 8 * 3_600_000, endAt: now + 9 * 3_600_000 }, sources: [{ sourceId: "calendar", observedAt: now, freshness: "fresh" }] },
    ],
  });
  assistant.store.putConsent("alice", { id: "calendar", principalId: "alice", sourceId: "calendar", purposes: ["calendar"], fields: ["busy"], deviceId: "phone", grantedAt: now });
  const delivered: string[] = [];
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async (_title: string, body: string) => { delivered.push(body); return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }],
    now: () => now,
  });
  const report = await scheduler.runOnce();
  assert.equal(report.sent, 1);
  assert.match(delivered[0], /Compromisso em breve.*30 min/);
  assert.equal(assistant.store.get("alice").notifications[0]?.kind, "calendar_reminder");
});

test("proactive weather stays silent for ordinary forecasts and warns on severe conditions", async () => {
  const now = Date.UTC(2026, 0, 2, 12); let current = now;
  let severe = false;
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-weather-")), now: () => current });
  assistant.store.updateSettings("alice", { enabled: true, notifications: { quietStart: "22:00", quietEnd: "08:00", maxPerDay: 4, cooldownMinutes: 0, minScore: 0 } });
  assistant.store.putDeviceProfile("alice", { deviceId: "phone", locale: "es", timeZone: "America/Sao_Paulo", proactiveEnabled: true, updatedAt: now });
  assistant.registerSource({
    descriptor: { id: "weather", label: "Weather", purposes: ["weather"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [{ id: "forecast", kind: "weather_forecast", title: "Weather", data: { current: { validAt: now, temperatureC: 24, precipitationProbabilityPercent: severe ? 90 : 10, precipitationMm: severe ? 8 : 0, windSpeedKmh: 5 } }, sources: [{ sourceId: "weather", observedAt: now, freshness: "fresh" }] }],
  });
  assistant.store.putConsent("alice", { id: "weather", principalId: "alice", sourceId: "weather", purposes: ["weather"], fields: [], deviceId: "phone", grantedAt: now });
  const delivered: string[] = [];
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async (_title: string, body: string) => { delivered.push(body); return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }],
    now: () => current,
  });
  assert.equal((await scheduler.runOnce()).sent, 0);
  severe = true; current += 16 * 60_000;
  assert.equal((await scheduler.runOnce()).sent, 1);
  assert.match(delivered[0], /Lluvia intensa prevista/);
  const notification = assistant.store.get("alice").notifications[0];
  assert.equal(notification?.kind, "weather_risk_estimate");
});

test("official CAP alerts remain official in proactive notifications", async () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-cap-")), now: () => now });
  assistant.store.updateSettings("alice", { enabled: true, notifications: { quietStart: "22:00", quietEnd: "08:00", maxPerDay: 4, cooldownMinutes: 0, minScore: 0 } });
  assistant.store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "America/Sao_Paulo", proactiveEnabled: true, updatedAt: now });
  assistant.registerSource({
    descriptor: { id: "cap", label: "Defesa Civil", purposes: ["weather"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [{
      id: "cap-1", kind: "weather_alert", title: "Risco de inundação", data: { identifier: "cap-1", officialAlert: true, severity: "Severe", areaDescription: "Belo Horizonte", expiresAt: now + 2 * 3_600_000 },
      sources: [{ sourceId: "cap", observedAt: now, freshness: "live", attribution: "Defesa Civil" }],
    }],
  });
  assistant.store.putConsent("alice", { id: "cap", principalId: "alice", sourceId: "cap", purposes: ["weather"], fields: [], deviceId: "phone", grantedAt: now });
  const delivered: Array<{ title: string; body: string }> = [];
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async (title: string, body: string) => { delivered.push({ title, body }); return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }],
    now: () => now,
  });
  assert.equal((await scheduler.runOnce()).sent, 1);
  assert.equal(delivered[0]?.title, "Jarvis · alerta oficial");
  assert.match(delivered[0]?.body || "", /Risco de inundação.*Alerta oficial.*Belo Horizonte/);
  const notification = assistant.store.get("alice").notifications[0];
  assert.equal(notification?.kind, "weather_alert");
});

test("ignored suggestions reduce repetition without disabling the category", async () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-proactive-ignored-")), now: () => now });
  assistant.store.updateSettings("alice", {
    enabled: true,
    notifications: { quietStart: "00:00", quietEnd: "00:00", maxPerDay: 4, cooldownMinutes: 0, minScore: 0.54 },
  });
  assistant.store.putDeviceProfile("alice", { deviceId: "phone", locale: "pt-BR", timeZone: "UTC", proactiveEnabled: true, updatedAt: now });
  assistant.store.recordNotification("alice", {
    id: "ignored-before",
    principalId: "alice",
    deviceId: "phone",
    suggestionId: "old-event",
    kind: "event",
    channel: "push",
    outcome: "ignored",
    at: now - 86_400_000,
    dedupeKey: "old-event",
    dedupeUntil: now - 1,
  });
  assistant.registerSource({
    descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [{ id: "event-new", kind: "event", title: "Outro evento", data: { startAt: now + 3_600_000 }, sources: [{ sourceId: "events", observedAt: now, freshness: "fresh" }] }],
  });
  assistant.store.putConsent("alice", { id: "events", principalId: "alice", sourceId: "events", purposes: ["events"], fields: [], grantedAt: now });
  let pushed = false;
  const scheduler = createPersonalProactiveScheduler({
    assistant,
    push: { notifyPersonal: async () => { pushed = true; return true; } } as never,
    listDevices: () => [{ id: "phone", userId: "alice" }],
    now: () => now,
  });

  const report = await scheduler.runOnce();
  assert.equal(report.sent, 0);
  assert.equal(report.decisions.some((decision) => decision.reason === "low_score"), true);
  assert.equal(pushed, false);
  assert.deepEqual(assistant.store.get("alice").deviceProfiles[0]?.disabledProactiveKinds, undefined);
});
