import test from "node:test";
import assert from "node:assert/strict";
import { buildCouncilPlan, formatCouncilFinalMessage, selectCouncilAgents } from "./council.js";

const agents = [
  { name: "gemini", models: [{ id: "g" }] },
  { name: "codex", defaultModel: "gpt", models: [{ id: "gpt", efforts: ["low", "high"], defaultEffort: "low" }] },
  { name: "claude-code", models: [{ id: "sonnet", efforts: ["low"] }] },
];

test("council selects only managed read-only capable agents and honors preferred first", () => {
  assert.deepEqual(selectCouncilAgents(agents, "claude-code").map((agent) => agent.name), ["claude-code", "codex"]);
});

test("quick council builds independent roles plus dependent synthesis", () => {
  const out = buildCouncilPlan({
    runnerId: "local", sessionId: "s1", cwd: "C:\\repo", topic: "Decidir arquitetura",
    mode: "quick", agents, preferredAgent: "codex", model: "gpt", effort: "high",
  });
  assert.equal(out.finalTaskId, "sintese");
  assert.equal(out.plan.tasks.length, 3);
  assert.deepEqual(out.plan.tasks.find((task) => task.id === "sintese")?.dependsOn, ["analise", "critica"]);
  assert.equal(out.plan.tasks[0].write, false);
  assert.equal(out.plan.tasks[0].model, "gpt");
  assert.equal(out.plan.tasks[0].effort, "high");
  assert.match(out.plan.tasks[2].prompt, /Veredito, consenso, dissensos/);
});

test("deep council adds a confrontation round before final synthesis", () => {
  const out = buildCouncilPlan({ runnerId: "r1", sessionId: "s1", cwd: "/repo", topic: "Plano amplo", mode: "deep", agents });
  assert.ok(out.plan.tasks.some((task) => task.id === "confronto" && task.dependsOn?.length === 4));
  assert.ok((out.plan.tasks.find((task) => task.id === "sintese")?.dependsOn || []).includes("confronto"));
  assert.equal(out.policy.maxDepth, 2);
});

test("council rejects empty topics and unavailable read-only agents", () => {
  assert.throws(() => buildCouncilPlan({ runnerId: "local", sessionId: "s1", cwd: "C:\\repo", topic: " ", mode: "quick", agents }), /tema/);
  assert.throws(() => buildCouncilPlan({ runnerId: "local", sessionId: "s1", cwd: "C:\\repo", topic: "x", mode: "quick", agents: [{ name: "gemini" }] }), /nenhum agente/);
});

test("final message keeps work link id and failure note", () => {
  const text = formatCouncilFinalMessage({ mode: "critical", rootExecutionId: "council:1", summary: "Veredito", failed: true });
  assert.match(text, /Sintese do Conselho/);
  assert.match(text, /`council:1`/);
  assert.match(text, /falha\/cancelamento/);
});
