import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexChildRollouts, parseCodexChildRollout } from "./codex-executions.js";

const meta = (id = "child-1", parent = "parent-1") => JSON.stringify({
  type: "session_meta", payload: { id, session_id: parent, thread_source: "subagent", parent_thread_id: parent,
    agent_path: "/root/reviewer", agent_nickname: "Nash", source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: "/root/reviewer" } } } },
});

test("Codex child rollout ignores forked history and projects only the latest child turn", () => {
  const lines = [
    meta(),
    JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 1 } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "histórico do pai" }] } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete", completed_at: 2, last_agent_message: "antigo" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 10 } }),
    JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "c1", input: JSON.stringify({ command: "npm test" }) } }),
    JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c1", output: "ok" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "revisão pronta" }] } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 3 }, model_context_window: 100 } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete", completed_at: 12, last_agent_message: "feito" } }),
  ];
  const child = parseCodexChildRollout(lines)!;
  assert.equal(child.id, "child-1"); assert.equal(child.parentId, "parent-1"); assert.equal(child.title, "reviewer");
  assert.equal(child.state, "succeeded"); assert.equal(child.startedAt, 10_000); assert.equal(child.endedAt, 12_000);
  assert.deepEqual(child.activities.map((event) => event.kind), ["tool", "tool", "text"]);
  assert.equal(child.activities.find((event) => event.kind === "text")?.text, "revisão pronta");
  assert.equal(child.usage?.inputTokens, 12); assert.equal(child.usage?.contextWindowTokens, 100);
});

test("Codex child rollout exposes honest running/cancelled states and rejects ordinary rollouts", () => {
  assert.equal(parseCodexChildRollout([JSON.stringify({ type: "session_meta", payload: { id: "normal", thread_source: "user" } })]), undefined);
  const running = parseCodexChildRollout([meta(), JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 3 } })])!;
  assert.equal(running.state, "running");
  const cancelled = parseCodexChildRollout([meta(), JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 3 } }), JSON.stringify({ timestamp: "2026-07-20T12:00:00Z", type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted by user" } })])!;
  assert.equal(cancelled.state, "cancelled");
});

test("Codex child discovery filters by parent and accepts incomplete JSONL tails", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-codex-child-"));
  const day = join(root, "2026", "07", "20"); mkdirSync(day, { recursive: true });
  writeFileSync(join(day, "one.jsonl"), [meta("one", "wanted"), JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 1 } }), "{incomplete"].join("\n"));
  writeFileSync(join(day, "two.jsonl"), [meta("two", "other"), JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 2 } })].join("\n"));
  const children = codexChildRollouts("wanted", { root });
  assert.deepEqual(children.map((child) => child.id), ["one"]);
});
