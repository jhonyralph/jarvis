import test from "node:test";
import assert from "node:assert/strict";
import { buildCouncilRoutePrompt, councilRouteFallback, parseCouncilRouteDecision } from "./councilRoute.js";

test("council route keeps explicit user mode", () => {
  assert.deepEqual(councilRouteFallback({ requestedMode: "critical", topic: "simples" }), {
    mode: "critical", reason: "modo escolhido pelo usuário", fallback: true,
  });
});

test("council route fallback classifies technical and risk topics", () => {
  assert.equal(councilRouteFallback({ requestedMode: "auto", topic: "vamos mudar o protocolo do runner" }).mode, "technical");
  assert.equal(councilRouteFallback({ requestedMode: "auto", topic: "isso pode expor token e segredo" }).mode, "critical");
});

test("council route prompt and parser accept only valid JSON modes", () => {
  const req = { requestedMode: "auto" as const, topic: "decidir arquitetura" };
  assert.match(buildCouncilRoutePrompt(req), /APENAS JSON/);
  assert.equal(parseCouncilRouteDecision('{"mode":"technical","reason":"arquitetura"}', req)?.mode, "technical");
  assert.equal(parseCouncilRouteDecision('{"mode":"inventado","reason":"x"}', req), null);
  assert.equal(parseCouncilRouteDecision('{"mode":"quick","reason":"x"}', { ...req, requestedMode: "deep" }), null);
});
