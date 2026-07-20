import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createManagedExecutionPolicy,
  evaluateManagedSpawn,
  requiredManagedWorkspaceAccess,
  type ManagedPolicyRuntime,
} from "./execution-policy.js";

const idle = (patch: Partial<ManagedPolicyRuntime> = {}): ManagedPolicyRuntime => ({
  now: 1_000,
  running: 0,
  dispatched: 0,
  consumed: {},
  reserved: {},
  ...patch,
});

test("managed execution defaults to read-only and requires isolated workspace for explicit writes", () => {
  assert.equal(requiredManagedWorkspaceAccess({}), "read_only");
  assert.equal(requiredManagedWorkspaceAccess({ write: false }), "read_only");
  assert.equal(requiredManagedWorkspaceAccess({ write: true }), "isolated_write");
});

test("policy defaults match the approved concurrency and depth limits", () => {
  const policy = createManagedExecutionPolicy();
  assert.equal(policy.maxConcurrency, 6);
  assert.equal(policy.maxDepth, 3);
  assert.equal(policy.maxTasks, 100);
  assert.deepEqual(evaluateManagedSpawn(policy, { depth: 1 }, idle()), { allowed: true, workspaceAccess: "read_only" });
});

test("depth and task limits are terminal while concurrency is retryable", () => {
  const policy = createManagedExecutionPolicy({ maxConcurrency: 2, maxDepth: 2, maxTasks: 3 });
  const deep = evaluateManagedSpawn(policy, { depth: 3 }, idle());
  const exhausted = evaluateManagedSpawn(policy, { depth: 1 }, idle({ dispatched: 3 }));
  assert.equal(deep.allowed, false);
  assert.equal(exhausted.allowed, false);
  if (!deep.allowed) assert.equal(deep.code, "DEPTH_LIMIT");
  if (!exhausted.allowed) assert.equal(exhausted.code, "TASK_LIMIT");
  const concurrent = evaluateManagedSpawn(policy, { depth: 1 }, idle({ running: 2 }));
  assert.equal(concurrent.allowed, false);
  if (!concurrent.allowed) assert.equal(concurrent.retryable, true);
});

test("hard budgets reserve in-flight work before another task can spawn", () => {
  const policy = createManagedExecutionPolicy({ budget: { maxCostUsd: 2, maxTokens: 1_000 } });
  const decision = evaluateManagedSpawn(
    policy,
    { depth: 1, reservation: { costUsd: 0.75, tokens: 300 } },
    idle({ consumed: { costUsd: 0.5, tokens: 250 }, reserved: { costUsd: 1, tokens: 500 } }),
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, "COST_BUDGET_EXCEEDED");
});

test("hard budgets reject unknown estimates by default but can explicitly allow them", () => {
  const strict = createManagedExecutionPolicy({ budget: { maxTokens: 1_000 } });
  const strictDecision = evaluateManagedSpawn(strict, { depth: 1 }, idle());
  assert.equal(strictDecision.allowed, false);
  if (!strictDecision.allowed) assert.equal(strictDecision.code, "TOKEN_ESTIMATE_REQUIRED");

  const permissive = createManagedExecutionPolicy({ budget: { maxTokens: 1_000, unknownEstimate: "allow" } });
  assert.equal(evaluateManagedSpawn(permissive, { depth: 1 }, idle()).allowed, true);
});

test("invalid configuration fails closed", () => {
  assert.throws(() => createManagedExecutionPolicy({ maxConcurrency: 0 }), /inteiro positivo/);
  assert.throws(() => createManagedExecutionPolicy({ budget: { maxCostUsd: Number.NaN } }), /finito/);
  assert.throws(() => createManagedExecutionPolicy({ budget: { deadlineAt: -1 } }), /não negativo/);
});
