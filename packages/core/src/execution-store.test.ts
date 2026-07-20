import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionStore } from "./execution-store.js";
import { NO_EXECUTION_CAPABILITIES, type ExecutionNode } from "@jarvis/protocol";

const rootNode = (id = "root-1"): Omit<ExecutionNode, "schemaVersion" | "journalId"> => ({
  executionId: id, rootExecutionId: id, rootTurnId: "turn-1", sessionId: "session-1", runnerId: "local",
  dependsOn: [], depth: 0, kind: "turn", origin: "jarvis_managed", certification: "verified",
  state: "queued", title: "Turno", queuedAt: 100, capabilities: { ...NO_EXECUTION_CAPABILITIES }, metrics: { self: {} },
});
const childNode = (root = "root-1", id = "child-1"): Omit<ExecutionNode, "schemaVersion" | "journalId"> => ({
  ...rootNode(root), executionId: id, rootExecutionId: root, parentExecutionId: root, depth: 1, kind: "agent",
  title: "Filho", state: "running", startedAt: 101,
});

test("ExecutionStore persists ordered events and rebuilds the same graph after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-store-")); let now = 100;
  const store = new ExecutionStore({ root: dir, now: () => ++now, snapshotEvery: 2 });
  store.create(rootNode());
  store.append("root-1", "root-1", { kind: "state_changed", from: "queued", to: "running" });
  store.appendNode("root-1", childNode());
  store.append("root-1", "child-1", { kind: "message", role: "assistant", text: "trabalhando", published: true });
  store.append("root-1", "child-1", { kind: "usage", usage: { inputTokens: 7, outputTokens: 2, costKind: "tokens_only", source: "fixture" }, measure: "delta", scope: "self" });
  store.append("root-1", "child-1", { kind: "state_changed", from: "running", to: "succeeded" });
  const before = store.snapshot("root-1")!;
  const reopened = new ExecutionStore({ root: dir, now: () => 999 });
  const after = reopened.snapshot("root-1")!;
  assert.equal(after.lastSeq, 6); assert.deepEqual(after.nodes, before.nodes);
  assert.equal(after.nodes.find((n) => n.executionId === "child-1")?.metrics.self.inputTokens, 7);
});

test("ExecutionStore is idempotent, rejects gaps/divergence and preserves terminal state", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-idem-"));
  const store = new ExecutionStore({ root: dir }); const first = store.create(rootNode());
  assert.equal(store.ingest(first).status, "duplicate");
  assert.equal(store.ingest({ ...first, seq: 3, eventId: `${first.journalId}:3` }).status, "gap");
  assert.equal(store.ingest({ ...first, kind: "diagnostic", level: "info", code: "different", message: "different" }).status, "invalid");
  store.append("root-1", "root-1", { kind: "state_changed", from: "queued", to: "running" });
  store.append("root-1", "root-1", { kind: "state_changed", from: "running", to: "succeeded" });
  assert.throws(() => store.append("root-1", "root-1", { kind: "state_changed", from: "succeeded", to: "running" }), /invalid transition/);
});

test("ExecutionStore rejects missing dependencies and cycles", () => {
  const store = new ExecutionStore({ root: mkdtempSync(join(tmpdir(), "jarvis-exec-dag-")) }); store.create(rootNode());
  assert.throws(() => store.appendNode("root-1", { ...childNode(), executionId: "bad", dependsOn: ["missing"] }), /dependency missing/);
  store.appendNode("root-1", childNode());
  store.appendNode("root-1", { ...childNode("root-1", "child-2"), dependsOn: ["child-1"] });
  assert.throws(() => store.append("root-1", "child-1", { kind: "dependency", dependsOn: ["child-2"] }), /dependency cycle/);
});

test("ExecutionStore keeps own and subtree usage separate and archives without deleting transcript", () => {
  const store = new ExecutionStore({ root: mkdtempSync(join(tmpdir(), "jarvis-exec-metrics-")), now: () => 123 }); store.create(rootNode());
  store.append("root-1", "root-1", { kind: "usage", usage: { inputTokens: 10, costUsd: 1, costKind: "billed", source: "self" }, measure: "delta", scope: "self" });
  store.append("root-1", "root-1", { kind: "usage", usage: { inputTokens: 30, costUsd: 3, costKind: "billed", source: "tree" }, measure: "cumulative", scope: "subtree" });
  store.append("root-1", "root-1", { kind: "archived", archived: true });
  const node = store.findNode("root-1")!.node;
  assert.equal(node.metrics.self.inputTokens, 10); assert.equal(node.metrics.subtree?.inputTokens, 30); assert.equal(node.archivedAt, 123);
  assert.equal(store.events("root-1").events.length, 4);
});

test("ExecutionStore ignores an incomplete JSONL tail during recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-tail-")); const store = new ExecutionStore({ root: dir }); store.create(rootNode());
  const file = readdirSync(dir).find((name) => name.endsWith(".jsonl")); assert.ok(file);
  const journal = join(dir, file);
  appendFileSync(journal, "{partial");
  assert.equal(new ExecutionStore({ root: dir }).snapshot("root-1")?.lastSeq, 1);
});

test("ExecutionStore serves durable replay before its bounded in-memory window", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-replay-"));
  const store = new ExecutionStore({ root: dir, maxEventsPerRoot: 100 });
  const rootCreated = store.create(rootNode());
  store.append("root-1", "root-1", { kind: "state_changed", from: "queued", to: "running" });
  for (let i = 0; i < 110; i++) store.append("root-1", "root-1", { kind: "diagnostic", level: "info", code: `ROW_${i}`, message: String(i) });
  const first = store.events("root-1", 0, 2);
  assert.deepEqual(first.events.map((event) => event.seq), [1, 2]);
  assert.equal(first.nextSeq, 2);
  const second = store.events("root-1", first.nextSeq, 10);
  assert.deepEqual(second.events.map((event) => event.seq), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(second.nextSeq, 12);
  assert.equal(store.ingest(rootCreated).status, "duplicate", "a redelivery remains idempotent after its event left memory");
});

test("ExecutionStore retention compacts only old terminal roots and preserves summaries and aggregates", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-retention-")); let now = 100;
  const store = new ExecutionStore({ root: dir, now: () => ++now });
  const created = store.create({ ...rootNode(), prompt: "detalhe que deve expirar" });
  store.append("root-1", "root-1", { kind: "state_changed", from: "queued", to: "running" });
  store.append("root-1", "root-1", { kind: "message", role: "assistant", text: "resposta detalhada", published: true });
  store.append("root-1", "root-1", { kind: "usage", usage: { inputTokens: 11, outputTokens: 3, costUsd: 0.2, costKind: "billed", source: "fixture" }, measure: "delta", scope: "self" });
  store.append("root-1", "root-1", { kind: "state_changed", from: "running", to: "succeeded", reason: "resumo final" });
  const result = store.compactBefore(1_000);
  assert.equal(result.roots, 1); assert.equal(result.droppedEvents, 4);
  const snapshot = store.snapshot("root-1")!;
  assert.notEqual(snapshot.journalId, created.journalId);
  assert.equal(snapshot.nodes[0].state, "succeeded"); assert.equal(snapshot.nodes[0].summary, "resumo final");
  assert.equal(snapshot.nodes[0].metrics.self.inputTokens, 11); assert.equal(snapshot.nodes[0].prompt, undefined);
  assert.equal(snapshot.truncated, true);
  assert.deepEqual(store.events("root-1").events.map((event) => event.kind), ["node_created", "truncated"]);
  const reopened = new ExecutionStore({ root: dir });
  assert.equal(reopened.snapshot("root-1")?.nodes[0].metrics.self.costUsd, 0.2);
  assert.equal(reopened.compactBefore(2_000).roots, 0, "a retention marker makes compaction idempotent");
});

test("ExecutionStore deletes only journals belonging to the requested session", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-delete-")); const store = new ExecutionStore({ root: dir });
  store.create(rootNode("root-1")); store.create({ ...rootNode("root-2"), rootTurnId: "turn-2", sessionId: "session-2" });
  assert.equal(store.deleteSession("session-1"), 1);
  assert.equal(store.snapshot("root-1"), undefined); assert.ok(store.snapshot("root-2"));
  const reopened = new ExecutionStore({ root: dir });
  assert.equal(reopened.snapshot("root-1"), undefined); assert.ok(reopened.snapshot("root-2"));
});
