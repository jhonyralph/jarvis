import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runManagedExecutionPlan,
  validateManagedExecutionPlan,
  ManagedExecutionPlanError,
  type ManagedExecutionExecutor,
  type ManagedExecutionPlan,
} from "./execution-orchestrator.js";
import { createManagedExecutionPolicy } from "./execution-policy.js";

const task = (id: string, patch: Partial<ManagedExecutionPlan["tasks"][number]> = {}): ManagedExecutionPlan["tasks"][number] => ({
  id,
  title: id,
  prompt: `execute ${id}`,
  agent: "codex",
  cwd: "C:/repo",
  depth: 1,
  ...patch,
});

const plan = (tasks: ManagedExecutionPlan["tasks"]): ManagedExecutionPlan => ({ rootExecutionId: "root-1", runnerId: "local", tasks });

test("plan validation rejects absent dependencies, self edges and cycles before execution", () => {
  const policy = createManagedExecutionPolicy();
  assert.throws(() => validateManagedExecutionPlan(plan([task("a", { dependsOn: ["missing"] })]), policy), (error: unknown) => error instanceof ManagedExecutionPlanError && error.code === "MISSING_DEPENDENCY");
  assert.throws(() => validateManagedExecutionPlan(plan([task("a", { dependsOn: ["a"] })]), policy), (error: unknown) => error instanceof ManagedExecutionPlanError && error.code === "SELF_DEPENDENCY");
  assert.throws(() => validateManagedExecutionPlan(plan([task("a", { dependsOn: ["b"] }), task("b", { dependsOn: ["a"] })]), policy), (error: unknown) => error instanceof ManagedExecutionPlanError && error.code === "DEPENDENCY_CYCLE");
});

test("plan validation checks parent ownership and derives depth before execution", () => {
  const policy = createManagedExecutionPolicy();
  assert.throws(() => validateManagedExecutionPlan(plan([task("child", { parentExecutionId: "foreign", depth: 1 })]), policy), (error: unknown) => error instanceof ManagedExecutionPlanError && error.code === "INVALID_PARENT");
  assert.throws(() => validateManagedExecutionPlan(plan([task("parent"), task("child", { parentExecutionId: "parent", depth: 1 })]), policy), (error: unknown) => error instanceof ManagedExecutionPlanError && error.code === "INVALID_DEPTH");
  assert.doesNotThrow(() => validateManagedExecutionPlan(plan([task("parent"), task("child", { parentExecutionId: "parent", depth: 2 })]), policy));
});

test("plan validation fails closed on malformed runtime policy fields", () => {
  const policy = createManagedExecutionPolicy();
  assert.throws(() => validateManagedExecutionPlan(plan([task("bad", { reservation: { costUsd: -1 } })]), policy), (error: unknown) => error instanceof ManagedExecutionPlanError && error.code === "INVALID_TASK");
  assert.throws(() => validateManagedExecutionPlan(plan([task("bad", { dependencyPolicy: "unknown" as "all_terminal" })]), policy), (error: unknown) => error instanceof ManagedExecutionPlanError && error.code === "INVALID_TASK");
});

test("scheduler runs independent tasks concurrently up to the configured cap", async () => {
  let active = 0;
  let peak = 0;
  const release: Array<() => void> = [];
  const executor: ManagedExecutionExecutor = {
    execute: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active--;
      return { state: "succeeded" };
    },
  };
  const running = runManagedExecutionPlan(plan([task("a"), task("b"), task("c")]), executor, { policy: { maxConcurrency: 2 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  release.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2, "third task starts only after one slot is released");
  while (release.length) release.shift()?.();
  const report = await running;
  assert.equal(report.state, "succeeded");
  assert.equal(peak, 2);
});

test("DAG waits for successful dependencies and preserves stable task order", async () => {
  const starts: string[] = [];
  const executor: ManagedExecutionExecutor = { execute: async (current) => { starts.push(current.id); return { summary: `${current.id} ok` }; } };
  const report = await runManagedExecutionPlan(plan([
    task("research"),
    task("tests"),
    task("synthesis", { dependsOn: ["research", "tests"] }),
  ]), executor);
  assert.deepEqual(starts.slice(0, 2), ["research", "tests"]);
  assert.equal(starts[2], "synthesis");
  assert.deepEqual(report.tasks.map((record) => record.task.id), ["research", "tests", "synthesis"]);
});

test("failed dependency blocks normal children but all_terminal explicitly continues", async () => {
  const starts: string[] = [];
  const executor: ManagedExecutionExecutor = {
    execute: async (current) => {
      starts.push(current.id);
      return current.id === "source" ? { state: "failed", error: "boom" } : { state: "succeeded" };
    },
  };
  const report = await runManagedExecutionPlan(plan([
    task("source"),
    task("blocked", { dependsOn: ["source"] }),
    task("cleanup", { dependsOn: ["source"], dependencyPolicy: "all_terminal" }),
  ]), executor);
  assert.deepEqual(starts, ["source", "cleanup"]);
  assert.equal(report.tasks.find((record) => record.task.id === "blocked")?.errorCode, "DEPENDENCY_FAILED");
  assert.equal(report.state, "failed");
});

test("budget reservations prevent parallel oversubscription and fail denied work visibly", async () => {
  const executor: ManagedExecutionExecutor = { execute: async () => ({ usage: { costUsd: 0.6 } }) };
  const report = await runManagedExecutionPlan(plan([
    task("first", { reservation: { costUsd: 0.6 } }),
    task("second", { reservation: { costUsd: 0.6 } }),
  ]), executor, { policy: { budget: { maxCostUsd: 1 } } });
  assert.equal(report.tasks[0].state, "succeeded");
  assert.equal(report.tasks[1].state, "failed");
  assert.equal(report.tasks[1].errorCode, "COST_BUDGET_EXCEEDED");
  assert.equal(report.usage.costUsd, 0.6);
});

test("cancellation reaches running executors and prevents queued dependents from spawning", async () => {
  const abort = new AbortController();
  const starts: string[] = [];
  const executor: ManagedExecutionExecutor = {
    execute: (current, context) => new Promise((resolve, reject) => {
      starts.push(current.id);
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  };
  const running = runManagedExecutionPlan(plan([task("a"), task("b", { dependsOn: ["a"] })]), executor, { signal: abort.signal });
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  const report = await running;
  assert.deepEqual(starts, ["a"]);
  assert.equal(report.state, "cancelled");
  assert.deepEqual(report.tasks.map((record) => record.state), ["cancelled", "cancelled"]);
});

test("workspace requirement is passed to the executor without choosing a machine", async () => {
  const observed: Array<{ runner: string; access: string }> = [];
  const executor: ManagedExecutionExecutor = { execute: async (_current, context) => { observed.push({ runner: context.runnerId, access: context.workspaceAccess }); return {}; } };
  await runManagedExecutionPlan({ rootExecutionId: "root", runnerId: "chosen-machine", tasks: [task("read"), task("write", { write: true })] }, executor);
  assert.deepEqual(observed, [{ runner: "chosen-machine", access: "read_only" }, { runner: "chosen-machine", access: "isolated_write" }]);
});

test("malformed executor outcome becomes a visible failure instead of stalling", async () => {
  const executor: ManagedExecutionExecutor = { execute: async () => ({ state: "running" as "succeeded" }) };
  const report = await runManagedExecutionPlan(plan([task("bad-outcome")]), executor);
  assert.equal(report.state, "failed");
  assert.equal(report.tasks[0].errorCode, "MALFORMED_OUTCOME");
});

test("expired workflow deadline cancels queued work without calling the executor", async () => {
  let calls = 0;
  const executor: ManagedExecutionExecutor = { execute: async () => { calls++; return {}; } };
  const report = await runManagedExecutionPlan(plan([task("late")]), executor, { policy: { budget: { deadlineAt: 1_000 } }, now: () => 1_000 });
  assert.equal(calls, 0);
  assert.equal(report.state, "cancelled");
  assert.equal(report.tasks[0].errorCode, "DEADLINE_EXCEEDED");
});
