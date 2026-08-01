import test from "node:test";
import assert from "node:assert/strict";
import { defaultPersonalAssistantSettings } from "./personal-context.js";
import { evaluateProactiveSuggestion } from "./personal-proactive.js";

const suggestion = { id: "s", kind: "event", candidate: { id: "c", kind: "event", title: "Show", data: {}, sources: [] }, score: 0.9, reasons: [], caveats: [], sources: [], actions: [] };

test("proactive policy enforces opt-in, quiet time, duplicate, cooldown and daily cap", () => {
  const now = new Date(2026, 0, 1, 12).getTime(); const settings = defaultPersonalAssistantSettings("u", now);
  assert.equal(evaluateProactiveSuggestion({ settings, suggestion, notifications: [], now }).reason, "disabled");
  settings.enabled = true;
  assert.equal(evaluateProactiveSuggestion({ settings, suggestion, notifications: [], now }).allowed, true);
  settings.notifications.quietStart = "11:00"; settings.notifications.quietEnd = "13:00";
  assert.equal(evaluateProactiveSuggestion({ settings, suggestion, notifications: [], now }).reason, "quiet_hours");
  settings.notifications.quietStart = "22:00"; settings.notifications.quietEnd = "08:00";
  const shown = [{ id: "n", principalId: "u", suggestionId: "other", channel: "push" as const, outcome: "shown" as const, at: now - 1_000 }];
  assert.equal(evaluateProactiveSuggestion({ settings, suggestion, notifications: shown, now }).reason, "cooldown");
  shown[0].suggestionId = "s";
  assert.equal(evaluateProactiveSuggestion({ settings, suggestion, notifications: shown, now }).reason, "duplicate");
});
