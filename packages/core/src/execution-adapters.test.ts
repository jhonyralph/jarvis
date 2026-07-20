import test from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_ADAPTER_IDS,
  EXECUTION_ADAPTER_PROFILES,
  EXECUTION_FIXTURE_MAPPERS,
  executionAdapterProfileProblems,
  executionProfileForObservation,
  isExecutionCertificationStale,
  mapClaudeExecutionFixture,
  mapCodexExecutionFixture,
  mapCursorExecutionFixture,
  mapGeminiExecutionFixture,
  mapKiroExecutionFixture,
  mapOpenCodeExecutionFixture,
  mapProviderExecutionFixture,
} from "./execution-adapters.js";

test("execution adapter catalog enumerates every production adapter with a valid honest profile", () => {
  assert.equal(EXECUTION_ADAPTER_IDS.length, 12);
  assert.deepEqual(Object.keys(EXECUTION_ADAPTER_PROFILES), [...EXECUTION_ADAPTER_IDS]);
  assert.deepEqual(Object.keys(EXECUTION_FIXTURE_MAPPERS), [...EXECUTION_ADAPTER_IDS]);
  for (const id of EXECUTION_ADAPTER_IDS) {
    const profile = EXECUTION_ADAPTER_PROFILES[id];
    assert.equal(profile.id, id);
    assert.deepEqual(executionAdapterProfileProblems(profile), [], `${id} profile is inconsistent`);
  }
  assert.equal(EXECUTION_ADAPTER_PROFILES.antigravity.tier, "E0");
  assert.equal(EXECUTION_ADAPTER_PROFILES.antigravity.capabilities.source, "none");
  assert.equal(EXECUTION_ADAPTER_PROFILES.continue.capabilities.source, "jarvis_managed");
  assert.equal(EXECUTION_ADAPTER_PROFILES.aider.capabilities.isolatedWorkspace, "jarvis_worktree");
});

test("certification staleness is tuple-based, explicit and does not mutate the source profile", () => {
  const source = {
    ...EXECUTION_ADAPTER_PROFILES.codex,
    certification: "verified" as const,
    adapterVersion: "jarvis-1",
    providerVersion: "codex-1",
    certificationHash: "fixture-a",
  };
  assert.equal(isExecutionCertificationStale(source, { providerVersion: "codex-1" }), false);
  assert.equal(isExecutionCertificationStale(source, { providerVersion: "codex-2" }), true);
  const stale = executionProfileForObservation(source, { adapterVersion: "jarvis-1", providerVersion: "codex-2", certificationHash: "fixture-a" });
  assert.equal(stale.certification, "stale");
  assert.match(stale.reason || "", /providerVersion/);
  assert.equal(source.certification, "verified");
  assert.notEqual(stale.capabilities, source.capabilities);
  assert.equal(executionProfileForObservation(EXECUTION_ADAPTER_PROFILES.continue, { providerVersion: "new" }).certification, "unverified");
});

test("Claude sidechain fixture maps stable Task lifecycle, child text and nested tools", () => {
  const started = mapClaudeExecutionFixture({ type: "assistant", parent_tool_use_id: "parent-task", message: { content: [
    { type: "tool_use", id: "task-1", name: "Task", input: { description: "Revisar API", prompt: "revise", subagent_type: "reviewer" } },
  ] } });
  assert.deepEqual(started.map((event) => event.kind), ["execution_spawn", "execution_state"]);
  assert.equal(started[0].providerId, "task-1");
  assert.equal(started[0].kind === "execution_spawn" && started[0].node.role, "reviewer");
  assert.equal(started[1].kind === "execution_state" && started[1].state, "running");

  const child = mapClaudeExecutionFixture({ type: "assistant", parent_tool_use_id: "task-1", message: { content: [
    { type: "text", text: "analisando" },
    { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "src/a.ts" } },
  ] } });
  assert.deepEqual(child.map((event) => event.kind), ["execution_activity", "execution_activity"]);
  assert.equal(child.every((event) => event.providerId === "task-1"), true);

  const done = mapClaudeExecutionFixture({ type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "task-1", content: "feito", is_error: false },
  ] } });
  assert.equal(done[0].kind === "execution_state" && done[0].state, "succeeded");
});

test("Codex child rollout fixtures require explicit context after session_meta and map terminal/usage", () => {
  const spawned = mapCodexExecutionFixture({ type: "session_meta", payload: {
    id: "child-1", thread_source: "subagent", parent_thread_id: "root-1", agent_path: "/root/reviewer",
    source: { subagent: { thread_spawn: { depth: 1, agent_role: "reviewer" } } },
  } });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].kind === "execution_spawn" && spawned[0].parentProviderId, "root-1");

  assert.deepEqual(mapCodexExecutionFixture({ type: "event_msg", payload: { type: "task_started" } }), [], "a row without a stable child id is not guessed");
  const running = mapCodexExecutionFixture({ type: "event_msg", payload: { type: "task_started" } }, { providerId: "child-1" });
  assert.equal(running[0].kind === "execution_state" && running[0].state, "running");
  const usage = mapCodexExecutionFixture({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 9, output_tokens: 2 } } } }, { providerId: "child-1" });
  assert.equal(usage[0].kind === "execution_usage" && usage[0].usage.inputTokens, 9);
  const aborted = mapCodexExecutionFixture({ type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted by user" } }, { providerId: "child-1" });
  assert.equal(aborted[0].kind === "execution_state" && aborted[0].state, "cancelled");
});

test("Gemini named subagent tools become a lifecycle only when a stable tool id exists", () => {
  assert.deepEqual(mapGeminiExecutionFixture({ type: "tool_use", tool_name: "Agent", parameters: { description: "pesquisar" } }), []);
  const started = mapGeminiExecutionFixture({ type: "tool_use", tool_name: "Agent", tool_id: "g-1", parameters: { description: "pesquisar" } });
  assert.deepEqual(started.map((event) => event.kind), ["execution_spawn", "execution_state"]);
  const failed = mapGeminiExecutionFixture({ type: "tool_result", tool_name: "Agent", tool_id: "g-1", error: "quota" });
  assert.equal(failed[0].kind === "execution_state" && failed[0].state, "failed");
});

test("Cursor recognizes only explicit agent/task tool calls and correlates start/completion", () => {
  const started = mapCursorExecutionFixture({ type: "tool_call", subtype: "started", call_id: "cur-1",
    tool_call: { agentToolCall: { args: { description: "review" } } } });
  assert.deepEqual(started.map((event) => event.kind), ["execution_spawn", "execution_state"]);
  assert.equal(started[0].providerId, "cur-1");
  const done = mapCursorExecutionFixture({ type: "tool_call", subtype: "completed", call_id: "cur-1",
    tool_call: { agentToolCall: { result: "ok" } } });
  assert.equal(done[0].kind === "execution_state" && done[0].state, "succeeded");
  assert.deepEqual(mapCursorExecutionFixture({ type: "tool_call", subtype: "started", call_id: "read-1",
    tool_call: { readToolCall: { args: { path: "task.md" } } } }), [], "an ordinary tool argument containing 'task' is not a child execution");
});

test("explicit provider lifecycle fixtures normalize Copilot, Cline and Qwen without guessing unknown rows", () => {
  for (const id of ["copilot", "cline", "qwen"] as const) {
    const events = mapProviderExecutionFixture(id, { type: "subagent.started", agent_id: `${id}-1`, parent_agent_id: "root", title: "Worker" });
    assert.deepEqual(events.map((event) => event.kind), ["execution_spawn", "execution_state"]);
    assert.equal(events[0].providerId, `${id}-1`);
    assert.deepEqual(mapProviderExecutionFixture(id, { type: "assistant.message", agent_id: `${id}-1`, text: "ordinary" }), []);
    const usage = mapProviderExecutionFixture(id, { type: "subagent.usage", agent_id: `${id}-1`, usage: { input_tokens: 4, output_tokens: 1 } });
    assert.equal(usage[0].kind === "execution_usage" && usage[0].usage.costKind, "tokens_only");
  }
});

test("OpenCode child sessions and Kiro ACP lifecycle updates preserve parent and state", () => {
  const open = mapOpenCodeExecutionFixture({ type: "session.created", properties: { info: {
    id: "oc-child", parentID: "oc-root", title: "reviewer", status: "running",
  } } });
  assert.deepEqual(open.map((event) => event.kind), ["execution_spawn", "execution_state"]);
  assert.equal(open[0].kind === "execution_spawn" && open[0].parentProviderId, "oc-root");
  const updated = mapOpenCodeExecutionFixture({ type: "session.updated", properties: { info: {
    id: "oc-child", parentID: "oc-root", status: "completed",
  } } });
  assert.deepEqual(updated.map((event) => event.kind), ["execution_state"], "an update must not fabricate a second spawn");
  assert.equal(updated[0].kind === "execution_state" && updated[0].state, "succeeded");

  const kiro = mapKiroExecutionFixture({ method: "session/update", params: { update: {
    type: "agent.completed", agentId: "kiro-child", state: "completed", summary: "done",
  } } });
  assert.equal(kiro[0].kind === "execution_state" && kiro[0].state, "succeeded");
});

test("providers without a verified native child surface never fabricate branded events", () => {
  const tempting = { type: "subagent.started", agent_id: "fake", title: "worker" };
  for (const id of ["continue", "antigravity", "aider"] as const) {
    assert.deepEqual(mapProviderExecutionFixture(id, tempting), [], `${id} must use managed fallback or remain unavailable`);
  }
  assert.deepEqual(mapProviderExecutionFixture("copilot", { type: "subagent.started" }), [], "missing stable provider id is rejected");
  assert.deepEqual(mapProviderExecutionFixture("opencode", null), []);
});
