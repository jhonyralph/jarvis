import test from "node:test";
import assert from "node:assert/strict";
import { JARVIS_DELEGATE_INPUT_SCHEMA, normalizeDelegateRequest } from "./delegate.js";

const valid = () => ({
  machine: "runner-office",
  rootExecutionId: "root-1",
  title: "Auditoria",
  tasks: [
    { id: "inspect", title: "Inspecionar", prompt: "Leia o projeto", agent: "codex", cwd: "C:\\repo", depth: 1, write: false, reservation: { tokens: 1000 } },
    { id: "fix", title: "Corrigir", prompt: "Corrija os gaps", agent: "claude-code", cwd: "C:\\repo", depth: 1, write: true, dependsOn: ["inspect"], model: "model-x", effort: "high" },
  ],
  policy: { maxConcurrency: 2, budget: { maxTokens: 5000, unknownEstimate: "allow" } },
});

test("delegate schema requires an explicit fixed machine and a task DAG", () => {
  assert.deepEqual(JARVIS_DELEGATE_INPUT_SCHEMA.required, ["machine", "tasks"]);
  const task = ((JARVIS_DELEGATE_INPUT_SCHEMA.properties as any).tasks.items);
  assert.equal(task.additionalProperties, false);
  assert.ok(task.properties.agent.enum.includes("aider"));
  assert.ok(task.properties.agent.enum.includes("antigravity"));
});

test("delegate input normalizes a complete provider-neutral plan without changing machine", () => {
  const out = normalizeDelegateRequest(valid());
  assert.equal(out.machine, "runner-office");
  assert.equal(out.tasks[0].write, false);
  assert.deepEqual(out.tasks[0].reservation, { tokens: 1000 });
  assert.deepEqual(out.tasks[1].dependsOn, ["inspect"]);
  assert.equal(out.tasks[1].model, "model-x");
  assert.equal(out.policy?.budget?.maxTokens, 5000);
  assert.equal(out.mode, "wait"); assert.equal(out.waitTimeoutMs, 60_000);
});

test("delegate input rejects missing machine, duplicate ids and foreign dependencies", () => {
  assert.throws(() => normalizeDelegateRequest({ ...valid(), machine: undefined }), /machine/);
  const duplicate = valid(); duplicate.tasks[1].id = "inspect";
  assert.throws(() => normalizeDelegateRequest(duplicate), /IDs duplicados/);
  const foreign = valid(); foreign.tasks[1].dependsOn = ["not-here"];
  assert.throws(() => normalizeDelegateRequest(foreign), /depend.*ausente/);
});

test("delegate input rejects malformed budgets, depths and repeated dependencies", () => {
  const budget = valid(); budget.policy.budget.maxTokens = -1;
  assert.throws(() => normalizeDelegateRequest(budget), /maxTokens/);
  const depth = valid(); depth.tasks[0].depth = 0;
  assert.throws(() => normalizeDelegateRequest(depth), /depth/);
  const deps = valid(); deps.tasks[1].dependsOn = ["inspect", "inspect"];
  assert.throws(() => normalizeDelegateRequest(deps), /repetidos/);
  assert.throws(() => normalizeDelegateRequest({ ...valid(), mode: "forever" }), /mode/);
  assert.throws(() => normalizeDelegateRequest({ ...valid(), waitTimeoutMs: 600_001 }), /waitTimeoutMs/);
});

test("delegate supports an explicit background mode and bounded wait", () => {
  const out = normalizeDelegateRequest({ ...valid(), mode: "background", waitTimeoutMs: 5_000 });
  assert.equal(out.mode, "background"); assert.equal(out.waitTimeoutMs, 5_000);
});
