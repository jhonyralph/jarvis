import test from "node:test";
import assert from "node:assert/strict";
import { autoRouteFallback, buildAutoRoutePrompt, normalizeAutoRouteAgents, parseAutoRouteDecision, type AutoRouteRequest } from "./autoRoute.js";

const agents = normalizeAutoRouteAgents([
  { name: "claude-code", support: "complete", modelControl: "per_turn", defaultModel: "fast", models: [{ id: "fast", efforts: ["low", "high"], defaultEffort: "low", context: 200_000 }, { id: "deep", efforts: ["high"], defaultEffort: "high" }] },
  { name: "codex", support: "limited", capabilities: { modelControl: "per_turn" }, defaultModel: "gpt", models: [{ id: "gpt", efforts: ["medium", "high"], defaultEffort: "medium" }] },
  { name: "missing", support: "not_installed", models: [{ id: "x" }] },
]);

function req(patch: Partial<AutoRouteRequest> = {}): AutoRouteRequest {
  return { message: "corrija o bug", started: false, currentAgent: "claude-code", flags: { agent: true, model: true, effort: true }, agents, ...patch };
}

test("automatic route normalizes only executable agents and canonical model control", () => {
  assert.deepEqual(agents.map((a) => a.name), ["claude-code", "codex"]);
  assert.equal(agents[1].modelControl, "per_turn");
  assert.equal(agents[0].models[0].contextWindow, 200_000);
  assert.deepEqual(normalizeAutoRouteAgents([{ name: "limited", support: "limited", models: [] }], []), [], "an explicitly empty machine allow-list must never expose a non-executable adapter");
});

test("automatic route accepts a catalogued decision and rejects invented values", () => {
  assert.deepEqual(parseAutoRouteDecision('{"agent":"codex","model":"gpt","effort":"high","reason":"debug difícil"}', req()), { agent: "codex", model: "gpt", effort: "high", reason: "debug difícil", fallback: false });
  assert.equal(parseAutoRouteDecision('{"agent":"codex","model":"inventado","effort":"high"}', req()), null);
  assert.equal(parseAutoRouteDecision('{"agent":"inventada","model":null,"effort":null}', req()), null);
});

test("started session and manual fields are absolute constraints", () => {
  const fixed = req({ started: true, currentModel: "deep", currentEffort: "high", flags: { agent: true, model: false, effort: false } });
  assert.equal(parseAutoRouteDecision('{"agent":"codex","model":"gpt","effort":"medium"}', fixed), null);
  assert.deepEqual(parseAutoRouteDecision('{"agent":"claude-code","model":"deep","effort":"high","reason":"mantido"}', fixed), { agent: "claude-code", model: "deep", effort: "high", reason: "mantido", fallback: false });
  assert.match(buildAutoRoutePrompt(fixed), /Sessão iniciada/);
});

test("malformed routing reply falls back to a compatible catalog default", () => {
  assert.equal(parseAutoRouteDecision("not json", req()), null);
  assert.deepEqual(autoRouteFallback(req()), { agent: "claude-code", model: "fast", effort: "low", reason: "roteador indisponível; usado o padrão compatível", fallback: true });
});

test("fallback never changes a started session agent and respects a manual effort", () => {
  assert.deepEqual(autoRouteFallback(req({ started: true, currentAgent: "removed", currentModel: "legacy", currentEffort: "high" })), { agent: "removed", model: "legacy", effort: "high", reason: "catálogo atual indisponível; mantida a sessão existente", fallback: true });
  const fixedEffort = autoRouteFallback(req({ currentEffort: "high", flags: { agent: false, model: true, effort: false } }));
  assert.equal(fixedEffort.effort, "high");
  assert.ok(agents[0].models.find((m) => m.id === fixedEffort.model)?.efforts.includes("high"));
});
