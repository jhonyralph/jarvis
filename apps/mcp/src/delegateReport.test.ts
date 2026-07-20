import test from "node:test";
import assert from "node:assert/strict";
import { NO_EXECUTION_CAPABILITIES, type ExecutionNode } from "@jarvis/protocol";
import {
  formatDelegateTerminalReport,
  isCorrelatedExecutionSnapshot,
  readExecutionTree,
  rootTerminalState,
} from "./delegateReport.js";

function node(id: string, overrides: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    schemaVersion: 1,
    journalId: "journal",
    executionId: id,
    rootExecutionId: "root",
    rootTurnId: "turn",
    sessionId: `session-${id}`,
    runnerId: "local",
    parentExecutionId: id === "root" ? undefined : "root",
    dependsOn: [],
    depth: id === "root" ? 0 : 1,
    kind: id === "root" ? "workflow" : "agent",
    origin: "jarvis_managed",
    certification: "verified",
    state: "succeeded",
    title: id,
    queuedAt: 1,
    capabilities: { ...NO_EXECUTION_CAPABILITIES },
    metrics: { self: {} },
    ...overrides,
  };
}

test("terminal matcher accepts only a terminal state transition for the exact root", () => {
  const terminal = (to: string, executionId = "root", rootExecutionId = "root", runnerId = "local") => ({
    t: "execution_delta", runnerId, event: { kind: "state_changed", executionId, rootExecutionId, to },
  });
  assert.equal(rootTerminalState(terminal("succeeded"), "root"), "succeeded");
  assert.equal(rootTerminalState(terminal("failed"), "root"), "failed");
  assert.equal(rootTerminalState(terminal("cancelled"), "root"), "cancelled");
  assert.equal(rootTerminalState(terminal("unknown"), "root"), undefined);
  assert.equal(rootTerminalState(terminal("succeeded", "child"), "root"), undefined);
  assert.equal(rootTerminalState(terminal("succeeded", "other", "other"), "root"), undefined);
  assert.equal(rootTerminalState(terminal("succeeded", "root", "root", "other"), "root", "local"), undefined);
});

test("snapshot correlation is explicit and therefore safe for empty and concurrent results", () => {
  assert.equal(isCorrelatedExecutionSnapshot({ t: "executions_snapshot", requestId: "a", nodes: [] }, "a", "root"), true);
  assert.equal(isCorrelatedExecutionSnapshot({ t: "executions_snapshot", requestId: "b", nodes: [] }, "a", "root"), false);
  assert.equal(isCorrelatedExecutionSnapshot({ t: "executions_snapshot", requestId: "a", nodes: [node("a"), node("b", { rootExecutionId: "other" })] }, "a", "root"), false);
});

test("execution tree reader follows every cursor and deduplicates overlapping pages", async () => {
  const cursors: Array<string | undefined> = [];
  const out = await readExecutionTree("root", "local", async (request) => {
    cursors.push(request.cursor);
    const pages: Record<string, { nodes: ExecutionNode[]; nextCursor?: string }> = {
      first: { nodes: [node("root"), node("a")], nextCursor: "500" },
      "500": { nodes: [node("a"), node("b")], nextCursor: "1000" },
      "1000": { nodes: [node("c")] },
    };
    const page = pages[request.cursor || "first"];
    return { t: "executions_snapshot", requestId: request.requestId, ...page };
  });
  assert.deepEqual(cursors, [undefined, "500", "1000"]);
  assert.deepEqual(out.map((item) => item.executionId), ["root", "a", "b", "c"]);
});

test("execution tree reader rejects malformed roots and cyclic pagination", async () => {
  await assert.rejects(() => readExecutionTree("root", "local", async (request) => ({
    t: "executions_snapshot", requestId: request.requestId, nodes: [],
  })), /não contém a raiz/);
  await assert.rejects(() => readExecutionTree("root", "local", async (request) => ({
    t: "executions_snapshot", requestId: request.requestId, nodes: [node("x", { rootExecutionId: "other" })],
  })), /inválido|correlacionado/);
  await assert.rejects(() => readExecutionTree("root", "local", async (request) => ({
    t: "executions_snapshot", requestId: request.requestId, nodes: [], nextCursor: "same",
  })), /cíclica/);
});

test("terminal report is deterministic, redacts secrets and excludes native nodes", () => {
  const report = formatDelegateTerminalReport({
    acceptedText: "Aceito.", rootExecutionId: "root", state: "failed",
    nodes: [
      node("root"),
      node("later", { queuedAt: 2, state: "failed", title: "Corrigir\ncoisa", summary: "API_KEY=abcdef123456" }),
      node("first", { queuedAt: 1, state: "succeeded", summary: "Tudo certo" }),
      node("native", { origin: "native", summary: "não deve aparecer" }),
    ],
  });
  assert.match(report, /Estado final: failed/);
  assert.match(report, /Tarefas: 2 \(failed=1, succeeded=1\)/);
  assert.ok(report.indexOf("- first") < report.indexOf("- Corrigir coisa"));
  assert.match(report, /API_KEY=\[REDACTED\]/);
  assert.doesNotMatch(report, /abcdef123456|não deve aparecer/);
});

test("terminal report states snapshot failure and bounds very large tool results", () => {
  const unavailable = formatDelegateTerminalReport({ acceptedText: "Aceito.", rootExecutionId: "root", state: "succeeded", snapshotUnavailable: true });
  assert.match(unavailable, /temporariamente indisponíveis/);
  const many = Array.from({ length: 80 }, (_, index) => node(`child-${index}`, { summary: "x".repeat(2_000), queuedAt: index }));
  const bounded = formatDelegateTerminalReport({ acceptedText: "Aceito.", rootExecutionId: "root", state: "succeeded", nodes: many });
  assert.ok(bounded.length < 101_000);
  assert.match(bounded, /omitida\(s\) por limite/);
});
