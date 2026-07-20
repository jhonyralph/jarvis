import test from "node:test";
import assert from "node:assert/strict";
import { isExecutionEvent, NO_EXECUTION_CAPABILITIES } from "./execution.js";

const base = {
  schemaVersion: 1 as const,
  journalId: "journal-1",
  eventId: "journal-1:1",
  executionId: "root-1",
  rootExecutionId: "root-1",
  rootTurnId: "turn-1",
  seq: 1,
  at: 1,
};

const node = {
  schemaVersion: 1 as const,
  journalId: "journal-1",
  executionId: "root-1",
  rootExecutionId: "root-1",
  rootTurnId: "turn-1",
  sessionId: "session-1",
  runnerId: "runner-1",
  dependsOn: [],
  depth: 0,
  kind: "workflow" as const,
  origin: "jarvis_managed" as const,
  certification: "verified" as const,
  state: "running" as const,
  title: "Workflow",
  queuedAt: 1,
  capabilities: { ...NO_EXECUTION_CAPABILITIES },
  metrics: { self: {} },
};

test("execution wire validator accepts a complete canonical event", () => {
  assert.equal(isExecutionEvent({ ...base, kind: "node_created", node }), true);
});

test("execution wire validator rejects unknown kinds instead of advancing the journal", () => {
  assert.equal(isExecutionEvent({ ...base, kind: "provider_future_payload", payload: {} }), false);
});

test("execution wire validator rejects malformed discriminated payloads", () => {
  assert.equal(isExecutionEvent({ ...base, kind: "node_created", node: { ...node, dependsOn: "not-an-array" } }), false);
  assert.equal(isExecutionEvent({ ...base, kind: "node_created", node: { ...node, parentExecutionId: "foreign-parent" } }), false);
  assert.equal(isExecutionEvent({ ...base, kind: "artifact", artifact: { artifactId: "a", executionId: "other", kind: "file", name: "a.ts" } }), false);
  assert.equal(isExecutionEvent({ ...base, kind: "usage", measure: "delta", scope: "self", usage: { inputTokens: "12", costKind: "billed", source: "provider" } }), false);
});
