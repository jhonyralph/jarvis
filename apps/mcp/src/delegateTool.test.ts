import test from "node:test";
import assert from "node:assert/strict";
import { NO_EXECUTION_CAPABILITIES, type ExecutionNode } from "@jarvis/protocol";
import { normalizeDelegateRequest } from "./delegate.js";
import { executeDelegate, managedRootExecutionId, type DelegateToolBridge } from "./delegateTool.js";
import { HubReplyWaiters } from "./replyWaiters.js";

const input = (overrides: Record<string, unknown> = {}) => normalizeDelegateRequest({
  machine: "local",
  rootExecutionId: "root",
  tasks: [{ id: "task", title: "Task", prompt: "Do it", agent: "codex", cwd: "C:\\repo", depth: 1, write: false }],
  ...overrides,
});

const ROOT = managedRootExecutionId("local", "root");

function node(id: string): ExecutionNode {
  return {
    schemaVersion: 1, journalId: "journal", executionId: id, rootExecutionId: ROOT, rootTurnId: "turn",
    sessionId: `session-${id}`, runnerId: "local", parentExecutionId: id === ROOT ? undefined : ROOT,
    dependsOn: [], depth: id === ROOT ? 0 : 1, kind: id === ROOT ? "workflow" : "agent",
    origin: "jarvis_managed", certification: "verified", state: "succeeded", title: id,
    summary: id === ROOT ? undefined : `summary-${id}`, queuedAt: 1,
    capabilities: { ...NO_EXECUTION_CAPABILITIES }, metrics: { self: {} },
  };
}

type Wire = Record<string, unknown>;
const wire = (value: unknown): Wire => value as Wire;

function harness(onRequest: (message: Wire, replyType: string) => unknown | Promise<unknown>): { bridge: DelegateToolBridge; waiters: HubReplyWaiters } {
  const waiters = new HubReplyWaiters();
  let id = 0;
  return {
    waiters,
    bridge: {
      createId: () => `request-${++id}`,
      waitFor: (type, timeoutMs, match) => waiters.add(type, timeoutMs, match),
      request: async (message, replyType) => onRequest(wire(message), replyType),
    },
  };
}

test("background mode returns after correlated acceptance without a terminal waiter", async () => {
  const calls: unknown[] = [];
  const h = harness((message) => { calls.push(message); return { t: "execution_delegate_result", requestId: message.requestId, ok: true, rootExecutionId: ROOT }; });
  const result = await executeDelegate(input({ mode: "background" }), h.bridge);
  assert.match(result, /Workflow aceito/); assert.match(result, /Acompanhe em Trabalhos/);
  assert.equal(h.waiters.size, 0); assert.equal(calls.length, 1);
  assert.equal(wire(calls[0]).plan && wire(wire(calls[0]).plan).rootExecutionId, ROOT);
});

test("wait mode cannot miss a terminal delta emitted before the accept reply and reads every snapshot page", async () => {
  const cursors: Array<string | undefined> = [];
  let h!: ReturnType<typeof harness>;
  h = harness((message, replyType) => {
    if (replyType === "execution_delegate_result") {
      assert.equal(h.waiters.resolve({ t: "execution_delta", runnerId: "local", event: { kind: "state_changed", rootExecutionId: ROOT, executionId: ROOT, to: "succeeded" } }), true);
      return { t: "execution_delegate_result", requestId: message.requestId, ok: true, rootExecutionId: ROOT };
    }
    cursors.push(typeof message.cursor === "string" ? message.cursor : undefined);
    return message.cursor
      ? { t: "executions_snapshot", requestId: message.requestId, nodes: [node("task-2")] }
      : { t: "executions_snapshot", requestId: message.requestId, nodes: [node(ROOT), node("task")], nextCursor: "500" };
  });
  const result = await executeDelegate(input(), h.bridge);
  assert.deepEqual(cursors, [undefined, "500"]);
  assert.match(result, /Estado final: succeeded/);
  assert.match(result, /- task: succeeded — summary-task/);
  assert.match(result, /- task-2: succeeded — summary-task-2/);
  assert.equal(h.waiters.size, 0);
});

test("wait timeout while acceptance is pending is handled and leaves the workflow asynchronous", async () => {
  const h = harness(async (message) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { t: "execution_delegate_result", requestId: message.requestId, ok: true, rootExecutionId: ROOT };
  });
  const result = await executeDelegate(input({ waitTimeoutMs: 1 }), h.bridge);
  assert.match(result, /tempo de espera terminou/); assert.match(result, /workflow continua/);
  assert.equal(h.waiters.size, 0);
});

test("disconnect is not mislabeled as timeout", async () => {
  let h!: ReturnType<typeof harness>;
  h = harness((message) => {
    setTimeout(() => h.waiters.rejectAll(new Error("offline")), 0);
    return { t: "execution_delegate_result", requestId: message.requestId, ok: true, rootExecutionId: ROOT };
  });
  const result = await executeDelegate(input(), h.bridge);
  assert.match(result, /conexão com o Hub foi perdida/);
  assert.doesNotMatch(result, /tempo de espera terminou/);
});

test("rejection and mismatched accepted roots cancel the pre-registered waiter", async () => {
  const rejected = harness((message) => ({ t: "execution_delegate_result", requestId: message.requestId, ok: false, error: "denied" }));
  await assert.rejects(() => executeDelegate(input(), rejected.bridge), /denied/);
  assert.equal(rejected.waiters.size, 0);

  const mismatch = harness((message) => ({ t: "execution_delegate_result", requestId: message.requestId, ok: true, rootExecutionId: "other" }));
  await assert.rejects(() => executeDelegate(input(), mismatch.bridge), /raiz diferente/);
  assert.equal(mismatch.waiters.size, 0);
});

test("terminal state remains authoritative when the post-terminal snapshot is unavailable", async () => {
  let h!: ReturnType<typeof harness>;
  h = harness((message, replyType) => {
    if (replyType === "execution_delegate_result") {
      h.waiters.resolve({ t: "execution_delta", runnerId: "local", event: { kind: "state_changed", rootExecutionId: ROOT, executionId: ROOT, to: "failed" } });
      return { t: "execution_delegate_result", requestId: message.requestId, ok: true, rootExecutionId: ROOT };
    }
    throw new Error("snapshot offline");
  });
  const result = await executeDelegate(input(), h.bridge);
  assert.match(result, /Estado final: failed/);
  assert.match(result, /resumos dos filhos estão temporariamente indisponíveis/);
});

test("managed root IDs are deterministic per seed and namespaced by machine", () => {
  assert.equal(managedRootExecutionId("local", "root"), ROOT);
  assert.notEqual(managedRootExecutionId("runner-2", "root"), ROOT);
  assert.notEqual(managedRootExecutionId("local", "other"), ROOT);
});

test("a task explicitly parented to the caller seed is rewired to the canonical root", async () => {
  let sent: Wire | undefined;
  const h = harness((message) => { sent = message; return { t: "execution_delegate_result", requestId: message.requestId, ok: true, rootExecutionId: ROOT }; });
  await executeDelegate(input({ mode: "background", tasks: [{ id: "task", title: "Task", prompt: "Do it", agent: "codex", cwd: "C:\\repo", depth: 1, write: false, parentExecutionId: "root" }] }), h.bridge);
  const plan = wire(sent?.plan), task = Array.isArray(plan.tasks) ? wire(plan.tasks[0]) : {};
  assert.equal(task.parentExecutionId, ROOT);
});
