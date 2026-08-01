import test from "node:test";
import assert from "node:assert/strict";
import type { ContextSuggestion, PersonalAssistantSettings } from "@jarvis/protocol";
import { defaultPersonalAssistantSettings } from "@jarvis/core";
import {
  PersonalProactiveScheduler,
  formatPersonalProactiveNotification,
  type PersonalProactiveCandidate,
  type PersonalProactiveDeliveryRecord,
  type PersonalProactiveNotification,
  type PersonalProactiveQuery,
  type PersonalProactiveTarget,
} from "./personalProactiveScheduler.js";

function settings(principalId: string, now: number): PersonalAssistantSettings {
  const value = defaultPersonalAssistantSettings(principalId, now);
  value.enabled = true;
  value.notifications.quietStart = "00:00";
  value.notifications.quietEnd = "00:00";
  value.notifications.cooldownMinutes = 0;
  return value;
}

function target(principalId: string, deviceId: string, now: number, overrides: Partial<PersonalProactiveTarget> = {}): PersonalProactiveTarget {
  return {
    principalId,
    deviceId,
    generation: 0,
    settings: settings(principalId, now),
    proactiveEnabled: true,
    locale: "pt-BR",
    timeZone: "America/Sao_Paulo",
    ...overrides,
  };
}

function suggestion(id: string, score = 0.9, title = "Evento recomendado"): ContextSuggestion {
  return {
    id,
    kind: "event",
    candidate: {
      id: `candidate-${id}`,
      kind: "event",
      title,
      data: {},
      sources: [{ sourceId: "events", observedAt: 1, freshness: "fresh" }],
    },
    score,
    reasons: ["Combina com suas preferências"],
    caveats: [],
    sources: [{ sourceId: "events", observedAt: 1, freshness: "fresh" }],
    actions: [],
  };
}

function candidate(id: string, now: number, score = 0.9): PersonalProactiveCandidate {
  return { suggestion: suggestion(id, score), validUntil: now + 60 * 60_000 };
}

test("sends a short localized notification to the exact principal and device without requesting GPS", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  const queries: PersonalProactiveQuery[] = [];
  const sent: Array<{ notification: PersonalProactiveNotification; target: object }> = [];
  const recorded: PersonalProactiveDeliveryRecord[] = [];
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    createId: () => "delivery-1",
    listTargets: () => [target("alice", "phone", now)],
    query: (request) => { queries.push(request); return [{ ...candidate("show", now), suggestion: suggestion("show", 0.91, "**Show no centro**") }]; },
    send: (notification, deliveryTarget) => { sent.push({ notification, target: deliveryTarget }); return true; },
    recordDelivery: (record) => { recorded.push(record); },
  });

  const report = await scheduler.runOnce();

  assert.equal(report.sent, 1);
  assert.equal(report.queried, 1);
  assert.deepEqual(Object.keys(queries[0]).sort(), ["at", "deviceId", "generation", "locale", "principalId", "timeZone"]);
  assert.equal("point" in queries[0], false);
  assert.equal("location" in queries[0], false);
  assert.deepEqual(sent[0].target, { principalId: "alice", deviceId: "phone", generation: 0 });
  assert.deepEqual(Object.keys(sent[0].target).sort(), ["deviceId", "generation", "principalId"]);
  assert.equal(sent[0].notification.title, "Jarvis · sugestão");
  assert.match(sent[0].notification.body, /^Show no centro/);
  assert.match(sent[0].notification.body, /Válida por 1 h$/);
  assert.equal(sent[0].notification.deepLink, "/#personal-assistant?suggestion=show&notification=delivery-1");
  assert.equal(recorded[0].principalId, "alice");
  assert.equal(recorded[0].deviceId, "phone");
  assert.deepEqual(recorded.map((row) => row.state), ["pending", "delivered"]);
});

test("requires both proactive opt-in and enabled, and respects pause before querying", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  const disabled = target("alice", "off", now, { proactiveEnabled: false });
  const assistantOff = target("alice", "assistant-off", now);
  assistantOff.settings.enabled = false;
  const paused = target("alice", "paused", now);
  paused.settings.paused = true;
  let queries = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    listTargets: () => [disabled, assistantOff, paused],
    query: () => { queries += 1; return []; },
    send: () => { throw new Error("must not send"); },
  });

  const report = await scheduler.runOnce();

  assert.equal(queries, 0);
  assert.deepEqual(report.decisions.map((row) => row.reason), ["disabled", "disabled", "paused"]);
});

test("a proactive kind disabled on one device is suppressed without affecting another device", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z"); const sent: string[] = [];
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    listTargets: () => [target("alice", "muted", now, { disabledKinds: ["event"] }), target("alice", "active", now)],
    query: () => [candidate("event", now)],
    send: (_notification, deliveryTarget) => { sent.push(deliveryTarget.deviceId); return true; },
  });
  const report = await scheduler.runOnce();
  assert.deepEqual(sent, ["active"]);
  assert.ok(report.decisions.some((row) => row.deviceId === "muted" && row.reason === "category_disabled"));
});

test("quiet hours use the target timezone and cover both sides of a midnight crossing", async () => {
  let now = Date.parse("2026-08-02T02:30:00Z"); // 23:30 in Sao Paulo
  const row = target("alice", "phone", now);
  row.settings.notifications.quietStart = "22:00";
  row.settings.notifications.quietEnd = "08:00";
  let queries = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    createId: () => "quiet-id",
    listTargets: () => [row],
    query: () => { queries += 1; return [candidate("weather", now)]; },
    send: () => true,
  });

  assert.equal((await scheduler.runOnce()).decisions[0].reason, "quiet_hours");
  now = Date.parse("2026-08-02T10:30:00Z"); // 07:30 in Sao Paulo
  assert.equal((await scheduler.runOnce()).decisions[0].reason, "quiet_hours");
  now = Date.parse("2026-08-02T11:00:00Z"); // 08:00 in Sao Paulo, end is exclusive
  assert.equal((await scheduler.runOnce()).sent, 1);
  assert.equal(queries, 1);
});

test("invalid timezone and malformed notification policy fail closed", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  const badZone = target("alice", "zone", now, { timeZone: "Mars/Olympus_Mons" });
  const badPolicy = target("alice", "policy", now);
  badPolicy.settings.notifications.quietStart = "25:00";
  let queries = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    listTargets: () => [badZone, badPolicy],
    query: () => { queries += 1; return []; },
    send: () => true,
  });

  const report = await scheduler.runOnce();

  assert.equal(queries, 0);
  assert.deepEqual(report.decisions.map((row) => row.reason), ["invalid_timezone", "invalid_policy"]);
});

test("daily cap is isolated by principal and device and follows the target's local date", async () => {
  const now = Date.parse("2026-08-02T02:30:00Z"); // Aug 1 in Sao Paulo
  const phone = target("alice", "phone", now);
  const tablet = target("alice", "tablet", now);
  phone.settings.notifications.maxPerDay = 1;
  tablet.settings.notifications.maxPerDay = 1;
  const prior: PersonalProactiveDeliveryRecord = {
    id: "prior",
    principalId: "alice",
    deviceId: "phone",
    generation: 0,
    suggestionId: "old",
    dedupeKey: "event:old",
    deliveredAt: Date.parse("2026-08-01T12:00:00Z"),
    dedupeUntil: Date.parse("2026-08-01T13:00:00Z"),
  };
  const sentTo: string[] = [];
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    createId: () => "daily-id",
    listTargets: () => [phone, tablet],
    readDeliveries: (deliveryTarget) => deliveryTarget.deviceId === "phone" ? [prior] : [],
    query: (request) => [candidate(`new-${request.deviceId}`, now)],
    send: (_notification, deliveryTarget) => { sentTo.push(deliveryTarget.deviceId); return true; },
  });

  const report = await scheduler.runOnce();

  assert.deepEqual(sentTo, ["tablet"]);
  assert.equal(report.sent, 1);
  assert.equal(report.decisions.find((row) => row.deviceId === "phone")?.reason, "daily_limit");
});

test("cooldown and dedupe are scoped per device", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  const cooldown = target("alice", "cooldown", now);
  cooldown.settings.notifications.cooldownMinutes = 120;
  const duplicate = target("alice", "duplicate", now);
  const clear = target("alice", "clear", now);
  const histories: Record<string, PersonalProactiveDeliveryRecord[]> = {
    cooldown: [{ id: "c", principalId: "alice", deviceId: "cooldown", generation: 0, suggestionId: "other", dedupeKey: "event:other", deliveredAt: now - 60_000, dedupeUntil: now + 60_000 }],
    duplicate: [{ id: "d", principalId: "alice", deviceId: "duplicate", generation: 0, suggestionId: "same", dedupeKey: "event:same", deliveredAt: now - 3 * 60 * 60_000, dedupeUntil: now + 60_000 }],
    clear: [{ id: "e", principalId: "alice", deviceId: "clear", generation: 0, suggestionId: "same", dedupeKey: "event:same", deliveredAt: now - 3 * 60 * 60_000, dedupeUntil: now - 60_000 }],
  };
  const sentTo: string[] = [];
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    createId: () => "scoped-id",
    listTargets: () => [cooldown, duplicate, clear],
    readDeliveries: (deliveryTarget) => histories[deliveryTarget.deviceId],
    query: () => [{ ...candidate("same", now), dedupeKey: "event:same" }],
    send: (_notification, deliveryTarget) => { sentTo.push(deliveryTarget.deviceId); return true; },
  });

  const report = await scheduler.runOnce();

  assert.deepEqual(sentTo, ["clear"]);
  assert.equal(report.decisions.find((row) => row.deviceId === "cooldown")?.reason, "cooldown");
  assert.equal(report.decisions.find((row) => row.deviceId === "duplicate")?.reason, "duplicate");
});

test("enforces score threshold and suggestion validity before delivery", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  const low = target("alice", "low", now);
  low.settings.notifications.minScore = 0.8;
  const validity = target("alice", "validity", now);
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    createId: () => "validity-id",
    listTargets: () => [low, validity],
    query: (request) => request.deviceId === "low"
      ? [candidate("low", now, 0.79)]
      : [
          { suggestion: suggestion("expired", 0.99), validUntil: now - 1 },
          { suggestion: suggestion("future", 0.98), validFrom: now + 1, validUntil: now + 60_000 },
          candidate("valid", now, 0.9),
        ],
    send: () => true,
  });

  const report = await scheduler.runOnce();

  assert.equal(report.sent, 1);
  assert.ok(report.decisions.some((row) => row.suggestionId === "low" && row.reason === "low_score"));
  assert.ok(report.decisions.some((row) => row.suggestionId === "expired" && row.reason === "expired"));
  assert.ok(report.decisions.some((row) => row.suggestionId === "future" && row.reason === "not_yet_valid"));
  assert.ok(report.decisions.some((row) => row.suggestionId === "valid" && row.allowed));
});

test("notification formatter supports pt, en and es, clips text and rejects external deep links", () => {
  const longTitle = "A".repeat(140);
  const locales = [
    ["pt-BR", "Jarvis · sugestão"],
    ["en-US", "Jarvis · suggestion"],
    ["es-MX", "Jarvis · sugerencia"],
  ] as const;
  for (const [locale, expectedTitle] of locales) {
    const notification = formatPersonalProactiveNotification({
      id: "id",
      suggestion: suggestion("safe-id", 0.9, longTitle),
      locale,
      createdAt: 1,
      expiresAt: 2,
      deepLink: "https://phishing.example/",
    });
    assert.equal(notification.title, expectedTitle);
    assert.ok([...notification.body].length <= 96);
    assert.match(notification.body, /Expir/);
    assert.equal(notification.deepLink, "/#personal-assistant?suggestion=safe-id&notification=id");
  }
});

test("notification formatter labels verified weather alerts as official", () => {
  const base = suggestion("official-alert", 0.99, "Risco de inundação");
  const notification = formatPersonalProactiveNotification({
    id: "official",
    suggestion: { ...base, candidate: { ...base.candidate, data: { officialAlert: true } } },
    locale: "en-US",
    createdAt: 1,
    expiresAt: 3_600_001,
  });
  assert.equal(notification.title, "Jarvis · official alert");
});

test("start and stop are idempotent and use the injected timer", () => {
  let callback: (() => void) | undefined;
  let intervals = 0;
  let clears = 0;
  const handle = { timer: true };
  const scheduler = new PersonalProactiveScheduler({
    runImmediately: false,
    intervalMs: 1_234,
    listTargets: () => [],
    query: () => [],
    send: () => true,
    setInterval: (next, intervalMs) => { callback = next; intervals += 1; assert.equal(intervalMs, 1_234); return handle; },
    clearInterval: (value) => { clears += 1; assert.equal(value, handle); },
  });

  assert.equal(scheduler.start(), true);
  assert.equal(scheduler.start(), false);
  assert.equal(scheduler.isStarted(), true);
  assert.equal(typeof callback, "function");
  assert.equal(intervals, 1);
  assert.equal(scheduler.stop(), true);
  assert.equal(scheduler.stop(), false);
  assert.equal(scheduler.isStarted(), false);
  assert.equal(clears, 1);
});

test("stop aborts an in-flight cycle before it can send", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  let resolveQuery!: (rows: PersonalProactiveCandidate[]) => void;
  let sends = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    listTargets: () => [target("alice", "phone", now)],
    query: () => new Promise((resolve) => { resolveQuery = resolve; }),
    send: () => { sends += 1; return true; },
    setInterval: () => ({ timer: true }),
    clearInterval: () => undefined,
  });

  assert.equal(scheduler.start(), true);
  const active = scheduler.runOnce();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(scheduler.stop(), true);
  resolveQuery([candidate("cancelled", now)]);
  const report = await active;

  assert.equal(sends, 0);
  assert.equal(report.decisions.at(-1)?.reason, "aborted");
});

test("a rejected send persists its failed state, is not counted and can be retried", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  let sends = 0;
  let records = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    listTargets: () => [target("alice", "phone", now)],
    query: () => [candidate("retry", now)],
    send: () => { sends += 1; return false; },
    recordDelivery: () => { records += 1; },
  });

  assert.equal((await scheduler.runOnce()).sent, 0);
  assert.equal((await scheduler.runOnce()).sent, 0);
  assert.equal(sends, 2);
  assert.equal(records, 4);
});

test("a notification is never sent when its durable outbox entry cannot be written", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  let sends = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    listTargets: () => [target("alice", "phone", now)],
    query: () => [candidate("blocked", now)],
    recordDelivery: () => { throw new Error("disk unavailable"); },
    send: () => { sends += 1; return true; },
  });

  const report = await scheduler.runOnce();
  assert.equal(sends, 0);
  assert.equal(report.sent, 0);
  assert.equal(report.errors, 1);
  assert.equal(report.decisions[0]?.reason, "outbox_error");
});

test("a crash after push acceptance leaves a pending outbox record that prevents duplicate delivery", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  const durable: PersonalProactiveDeliveryRecord[] = [];
  let sends = 0;
  const first = new PersonalProactiveScheduler({
    now: () => now,
    createId: () => "crash-safe-id",
    listTargets: () => [target("alice", "phone", now)],
    query: () => [{ ...candidate("same", now), dedupeKey: "event:same" }],
    send: () => { sends += 1; return true; },
    recordDelivery: (record) => {
      if (record.state === "delivered") throw new Error("crash before acknowledgement");
      durable.splice(0, durable.length, structuredClone(record));
    },
  });
  const firstReport = await first.runOnce();
  assert.equal(firstReport.sent, 1);
  assert.equal(firstReport.errors, 1);
  assert.equal(durable[0]?.state, "pending");

  const restarted = new PersonalProactiveScheduler({
    now: () => now + 1_000,
    listTargets: () => [target("alice", "phone", now + 1_000)],
    readDeliveries: () => structuredClone(durable),
    query: () => [{ ...candidate("same", now + 1_000), dedupeKey: "event:same" }],
    send: () => { sends += 1; return true; },
  });
  const restartedReport = await restarted.runOnce();
  assert.equal(restartedReport.sent, 0);
  assert.equal(restartedReport.decisions[0]?.reason, "duplicate");
  assert.equal(sends, 1);
});

test("an accepted suggestion is deduplicated on the next in-memory cycle", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  let sends = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    createId: () => "accepted",
    listTargets: () => [target("alice", "phone", now)],
    query: () => [candidate("same", now)],
    send: () => { sends += 1; return true; },
  });

  assert.equal((await scheduler.runOnce()).sent, 1);
  const repeated = await scheduler.runOnce();

  assert.equal(repeated.sent, 0);
  assert.equal(repeated.decisions[0].reason, "duplicate");
  assert.equal(sends, 1);
});

test("history failures suppress delivery instead of bypassing limits", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  let sends = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    listTargets: () => [target("alice", "phone", now)],
    readDeliveries: () => { throw new Error("storage unavailable"); },
    query: () => [candidate("unsafe", now)],
    send: () => { sends += 1; return true; },
  });

  const report = await scheduler.runOnce();

  assert.equal(sends, 0);
  assert.equal(report.errors, 1);
  assert.equal(report.decisions[0].reason, "history_error");
});

test("cross-device history is rejected instead of weakening per-device limits", async () => {
  const now = Date.parse("2026-08-01T15:00:00Z");
  let sends = 0;
  const scheduler = new PersonalProactiveScheduler({
    now: () => now,
    listTargets: () => [target("alice", "phone", now)],
    readDeliveries: () => [{
      id: "other-device",
      principalId: "alice",
      deviceId: "tablet",
      generation: 0,
      suggestionId: "old",
      dedupeKey: "event:old",
      deliveredAt: now - 1_000,
      dedupeUntil: now + 60_000,
    }],
    query: () => [candidate("unsafe", now)],
    send: () => { sends += 1; return true; },
  });

  const report = await scheduler.runOnce();

  assert.equal(sends, 0);
  assert.equal(report.errors, 1);
  assert.equal(report.decisions[0].reason, "history_error");
});
