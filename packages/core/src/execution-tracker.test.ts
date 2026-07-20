import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSequencer, NO_EXECUTION_CAPABILITIES } from "@jarvis/protocol";
import { createAgentEventBridge } from "./agents.js";
import { ExecutionStore } from "./execution-store.js";
import { ExecutionTracker } from "./execution-tracker.js";

const setup = (usageScope: "self" | "subtree" = "self") => {
  const store = new ExecutionStore({ root: mkdtempSync(join(tmpdir(), "jarvis-tracker-")) });
  const events: any[] = [];
  const childUsage: any[] = [];
  const tracker = new ExecutionTracker(store, { runnerId: "local", sessionId: "s1", turnId: "t1", agent: "codex", cwd: process.cwd(), model: "m", effort: "high",
    profile: { tier: "E3", certification: "partial", acquisitionSurface: "fixture", capabilities: { ...NO_EXECUTION_CAPABILITIES, source: "native_stream", observe: "live", transcript: "published_only", tools: true, files: "metadata", usage: usageScope } } }, (e) => events.push(e), (usage) => childUsage.push(usage));
  return { store, tracker, events, childUsage };
};

test("ExecutionTracker maps one canonical turn and Task nesting without mixing child activity", () => {
  const { store, tracker, events } = setup();
  const seq = createEventSequencer("t1", (() => { let n = 10; return () => ++n; })()); const bridge = createAgentEventBridge("t1", seq);
  tracker.handleAgentEvent(bridge.accepted()); tracker.handleAgentEvent(bridge.started());
  tracker.handleAgentEvent(bridge.provider({ kind: "tool", name: "Task", summary: "Revisar", toolId: "task-1", status: "started" }));
  const childText = bridge.provider({ kind: "text", text: "achado", parentId: "task-1" }); tracker.handleAgentEvent(childText);
  tracker.handleAgentEvent(bridge.provider({ kind: "tool", name: "Edit", summary: "Editando a.ts", toolId: "edit-1", parentId: "task-1", path: "src/a.ts", adds: 2, dels: 1, status: "completed" }));
  tracker.handleAgentEvent(bridge.provider({ kind: "tool", name: "Task", summary: "Revisar", toolId: "task-1", status: "completed" }));
  tracker.handleAgentEvent(bridge.completed("fim"));
  const snapshot = store.rootsForSession("s1")[0];
  assert.equal(snapshot.nodes.length, 2);
  const child = snapshot.nodes.find((n) => n.providerExecutionId === "task-1")!;
  assert.equal(childText.executionId, child.executionId, "live inline event links to the same canonical child");
  assert.equal(child.state, "succeeded"); assert.equal(child.metrics.self.toolCalls, undefined, "completed-only Edit does not invent a start");
  assert.equal(snapshot.artifacts[0].relativePath, "src/a.ts"); assert.equal(snapshot.artifacts[0].adds, 2);
  const childEvents = store.events(snapshot.rootExecutionId).events.filter((e) => e.executionId === child.executionId);
  assert.ok(childEvents.some((e) => e.kind === "agent_event" && e.event.text === "achado"));
  assert.ok(events.length >= 8);
});

test("ExecutionTracker labels inclusive parent usage as subtree and never adds child usage twice", () => {
  const { store, tracker, childUsage } = setup("subtree");
  const seq = createEventSequencer("t1"); const bridge = createAgentEventBridge("t1", seq);
  tracker.handleAgentEvent(bridge.accepted()); tracker.handleAgentEvent(bridge.started());
  tracker.handleProviderEvent({ kind: "execution_spawn", providerId: "included-child", node: { title: "Filho" } });
  tracker.handleProviderEvent({ kind: "execution_usage", providerId: "included-child", usage: { inputTokens: 4, costKind: "tokens_only", source: "child fixture" }, measure: "cumulative" });
  const parentUsage = bridge.usage({ inputTokens: 10, costKind: "tokens_only", source: "inclusive fixture" });
  tracker.handleAgentEvent(parentUsage);
  const root = store.findNode(tracker.rootExecutionId)!.node;
  assert.equal(parentUsage.usageScope, "subtree");
  assert.equal(root.metrics.subtree?.inputTokens, 10);
  assert.equal(childUsage.length, 0, "inclusive parent usage is the only additive ledger record");
});

test("ExecutionTracker consumes provider-native child snapshots idempotently and marks honest unknown terminals", () => {
  const { store, tracker, childUsage } = setup(); tracker.ensureRoot();
  tracker.handleProviderEvent({ kind: "execution_spawn", providerId: "native-child", node: { title: "Auditor", depth: 1 } });
  const first = tracker.handleProviderEvent({ kind: "execution_activity", providerId: "native-child", event: { kind: "text", text: "um", providerEvent: "snapshot:0" } });
  const duplicate = tracker.handleProviderEvent({ kind: "execution_activity", providerId: "native-child", event: { kind: "text", text: "um", providerEvent: "snapshot:0" } });
  const usage = { inputTokens: 5, costKind: "tokens_only" as const, source: "fixture" };
  tracker.handleProviderEvent({ kind: "execution_usage", providerId: "native-child", usage, measure: "cumulative" });
  tracker.handleProviderEvent({ kind: "execution_usage", providerId: "native-child", usage, measure: "cumulative" });
  const root = store.rootsForSession("s1")[0]; const child = root.nodes.find((n) => n.providerExecutionId === "native-child")!;
  assert.equal(store.events(root.rootExecutionId).events.filter((e) => e.kind === "message" && e.executionId === child.executionId).length, 1);
  assert.equal(store.findNode(child.executionId)?.node.metrics.self.inputTokens, 5);
  assert.equal(store.findNode(root.rootExecutionId)?.node.metrics.subtree?.inputTokens, 5);
  assert.equal(childUsage.length, 1, "unchanged cumulative child usage reaches the additive ledger once");
  assert.equal(first.executionId, child.executionId);
  assert.equal(first.activity?.text, "um", "new published activity can be mirrored into the chat");
  assert.equal(duplicate.activity, undefined, "snapshot replay is not mirrored twice into the chat");
});

test("ExecutionTracker never exposes a file outside the configured cwd", () => {
  const { store, tracker } = setup(); tracker.ensureRoot();
  tracker.handleProviderEvent({ kind: "execution_spawn", providerId: "c", node: { title: "c" } });
  const projected = tracker.handleProviderEvent({ kind: "execution_activity", providerId: "c", event: { kind: "tool", name: "Read", summary: "fora", path: join(tmpdir(), "secret.txt"), status: "completed" } });
  assert.equal(store.rootsForSession("s1")[0].artifacts.length, 0);
  assert.equal(projected.activity?.path, undefined, "the chat projection cannot reveal a path outside cwd");
});

test("ExecutionTracker redacts credentials before the secondary journal and broadcast", () => {
  const { store, tracker, events } = setup(); tracker.ensureRoot();
  tracker.handleProviderEvent({ kind: "execution_spawn", providerId: "secret-child", node: { title: "Auditor", prompt: "TOKEN=super-secret-value revise" } });
  const projected = tracker.handleProviderEvent({ kind: "execution_activity", providerId: "secret-child", event: { kind: "tool", name: "Bash", summary: "curl", detail: "Authorization: Bearer abcdefghijklmnop", status: "started" } });
  const root = store.rootsForSession("s1")[0], child = root.nodes.find((node) => node.providerExecutionId === "secret-child")!;
  assert.equal(child.prompt?.includes("super-secret-value"), false);
  assert.equal(JSON.stringify(store.events(root.rootExecutionId).events).includes("abcdefghijklmnop"), false);
  assert.equal(JSON.stringify(events).includes("super-secret-value"), false);
  assert.equal(JSON.stringify(projected.activity).includes("abcdefghijklmnop"), false, "chat projection uses the same redaction boundary as the journal");
});
