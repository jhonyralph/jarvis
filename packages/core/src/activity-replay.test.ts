import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSequencer } from "@jarvis/protocol";
import { createAgentEventBridge } from "./agents.js";
import { pendingActivityReplay } from "./activity-replay.js";
import { ExecutionStore } from "./execution-store.js";
import { ExecutionTracker } from "./execution-tracker.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "jarvis-activity-replay-"));
  const store = new ExecutionStore({ root });
  const tracker = new ExecutionTracker(store, {
    runnerId: "runner-a", sessionId: "same-session", turnId: "turn-a", agent: "mock", cwd: root,
  });
  const sequencer = createEventSequencer("turn-a", (() => { let at = 100; return () => ++at; })());
  const bridge = createAgentEventBridge("turn-a", sequencer);
  return { root, store, tracker, bridge };
}

test("pending activity is rebuilt from the fsynced journal after a process reload", () => {
  const { root, tracker, bridge } = fixture();
  tracker.handleAgentEvent(bridge.accepted());
  tracker.handleAgentEvent(bridge.started());
  tracker.handleAgentEvent(bridge.provider({ kind: "tool", name: "Read", summary: "Lendo arquivo", toolId: "read-1", path: join(root, "a.ts"), status: "started" }));

  const reloaded = new ExecutionStore({ root });
  const replay = pendingActivityReplay(reloaded, "same-session", [{ role: "user", ts: 99, contextManifest: { turnId: "turn-a" } }]);
  assert.deepEqual(replay?.events.map((event) => event.kind), ["accepted", "started", "tool_started"]);
  assert.equal(replay?.state, "running");
  assert.equal(replay?.events[2].tool?.path, join(root, "a.ts"));
  assert.equal(pendingActivityReplay(reloaded, "same-session", [
    { role: "user", ts: 99, contextManifest: { turnId: "turn-a" } },
    { role: "assistant", ts: 200 },
  ]), undefined, "a stored assistant reply closes the replay window");
});

test("an orphaned journal replays the preserved work and an explicit restart reason", () => {
  const { store, tracker, bridge } = fixture();
  tracker.handleAgentEvent(bridge.accepted());
  tracker.handleAgentEvent(bridge.started());
  store.append(tracker.rootExecutionId, tracker.rootExecutionId, {
    kind: "state_changed", from: "running", to: "orphaned", reason: "Runner reiniciou sem binding verificável para este processo",
  });
  const replay = pendingActivityReplay(store, "same-session", [{ role: "user", contextManifest: { turnId: "turn-a" } }]);
  assert.equal(replay?.state, "orphaned");
  assert.equal(replay?.events.at(-1)?.kind, "failed");
  assert.match(replay?.events.at(-1)?.text || "", /reiniciou sem binding/);
  assert.equal(replay?.events.at(-1)?.errorCode, "PROCESS_BINDING_LOST");
});
