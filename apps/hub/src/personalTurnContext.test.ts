import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonalAssistantService } from "./personalAssistant.js";
import { preparePersonalTurnContext } from "./personalTurnContext.js";

test("turn context is opt-in and deterministic code work never triggers personal sources", async () => {
  let calls = 0;
  const assistant = { contextForTurn: async () => { calls += 1; throw new Error("must not run"); } };
  const actor = { principalId: "alice", deviceId: "phone", owner: false };
  assert.equal(await preparePersonalTurnContext({ assistant: assistant as never, text: "Quais eventos em BH amanhã?", actor, allowed: false }), undefined);
  assert.equal(await preparePersonalTurnContext({ assistant: assistant as never, text: "Revise o event handler no arquivo app.ts", actor, allowed: true }), undefined);
  assert.equal(calls, 0);
});

test("turn context routes an event request, returns sourced suggestions and keeps coordinates out of the prefix", async () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const assistant = new PersonalAssistantService({ root: mkdtempSync(join(tmpdir(), "jarvis-turn-context-")), now: () => now });
  assistant.store.updateSettings("alice", { enabled: true });
  assistant.registerSource({
    descriptor: { id: "events", label: "Events", purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" },
    query: async () => [{ id: "e1", kind: "event", title: "Festival em BH", data: { startAt: now + 25 * 3_600_000, point: { lat: -19.92, lng: -43.94 } }, sources: [{ sourceId: "events", observedAt: now, freshness: "fresh", url: "https://example.test/e1" }] }],
  });
  assistant.store.putConsent("alice", { id: "events", principalId: "alice", sourceId: "events", purposes: ["events"], fields: ["query", "time", "filters"], grantedAt: now });
  const prepared = await preparePersonalTurnContext({ assistant, text: "Quais eventos em BH amanhã?", actor: { principalId: "alice", deviceId: "phone", owner: false }, allowed: true });
  assert.equal(prepared?.purpose, "events");
  assert.equal(prepared?.response.suggestions[0]?.candidate.title, "Festival em BH");
  assert.match(prepared?.contextPrefix || "", /Festival em BH/);
  assert.doesNotMatch(prepared?.contextPrefix || "", /-19\.92|-43\.94|\"point\"/);
});

test("source failures degrade to ordinary chat instead of blocking the turn", async () => {
  let observed = "";
  const prepared = await preparePersonalTurnContext({
    assistant: { contextForTurn: async () => { throw new Error("offline"); } } as never,
    text: "Vai chover amanhã?",
    actor: { principalId: "alice", deviceId: "phone", owner: false },
    allowed: true,
    onError: (error) => { observed = String((error as Error).message); },
  });
  assert.equal(prepared, undefined);
  assert.equal(observed, "offline");
});

test("stopping a turn propagates the same abort signal through personal context preparation", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  let observedError = "";
  const pending = preparePersonalTurnContext({
    assistant: { contextForTurn: async (_input: unknown, _actor: unknown, signal?: AbortSignal) => {
      observedSignal = signal;
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
        if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      });
      throw new Error("unreachable");
    } } as never,
    text: "Quais eventos existem em BH hoje?",
    actor: { principalId: "alice", deviceId: "phone", owner: false },
    allowed: true,
    signal: controller.signal,
    onError: (error) => { observedError = String((error as Error).message); },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new Error("stopped by user"));

  assert.equal(await pending, undefined);
  assert.equal(observedSignal, controller.signal);
  assert.equal(observedError, "stopped by user");
});

test("nearby intent maps distance and duration slots to adapter filter contracts", async () => {
  let observed: Record<string, unknown> | undefined; let purpose: unknown;
  await preparePersonalTurnContext({
    assistant: { contextForTurn: async (input: { purpose?: unknown; filters?: Record<string, unknown> }) => {
      purpose = input.purpose;
      observed = input.filters;
      return { response: { t: "personal_context_suggestions", requestId: "r", results: [], errors: [], suggestions: [] }, agentText: "context" };
    } } as never,
    text: "Find cafes near me within 2 km and under 15 minutes",
    actor: { principalId: "alice", deviceId: "phone", owner: false },
    allowed: true,
  });
  assert.equal(purpose, "nearby");
  assert.equal(observed?.radiusM, 2_000);
  assert.equal(observed?.radiusKm, 2);
  assert.equal(observed?.maxDurationMinutes, 15);
});

test("nearby intent maps opening hours and explicit restrictions to server filters", async () => {
  let observed: Record<string, unknown> | undefined;
  await preparePersonalTurnContext({
    assistant: { contextForTurn: async (input: { filters?: Record<string, unknown> }) => {
      observed = input.filters;
      return { response: { t: "personal_context_suggestions", requestId: "r", results: [{}], errors: [], suggestions: [] }, agentText: "context" };
    } } as never,
    text: "Encontre restaurante vegano aberto agora perto de mim",
    actor: { principalId: "alice", deviceId: "phone", owner: false },
    allowed: true,
  });
  assert.equal(observed?.requireOpen, true);
  assert.deepEqual(observed?.restrictions, ["vegan"]);
});
