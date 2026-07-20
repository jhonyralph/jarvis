import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry, AiderAdapter, MockAgentAdapter, codexUsage, codexItemToEvents, codexConfigModel } from "./agents.js";

test("AiderAdapter: name + empty (uninvented) model catalog", async () => {
  const a = new AiderAdapter();
  assert.equal(a.name, "aider");
  const caps = await a.capabilities();
  assert.deepEqual(caps.models, [], "no hardcoded model ids — aider spans many providers");
});

test("AgentRegistry registers aider alongside the built-ins and routes by name", () => {
  const reg = new AgentRegistry("mock").register(new MockAgentAdapter()).register(new AiderAdapter());
  assert.ok(reg.names().includes("aider"));
  assert.equal(reg.get("aider").name, "aider");
  assert.equal(reg.get("nope").name, "mock", "unknown name falls back to the default");
});

// --- Codex config: the user's own default model, top-level key only ---
test("codexConfigModel reads a top-level model=, ignoring models inside tables", () => {
  assert.equal(codexConfigModel('model = "gpt-5.5"\napproval_policy = "never"\n'), "gpt-5.5");
  assert.equal(codexConfigModel('# no default\n[profiles.fast]\nmodel = "gpt-5.6-luna"\n'), undefined, "a profile's model is not the default");
  assert.equal(codexConfigModel('model = "gpt-5.6-terra"\n[projects."x"]\nmodel = "gpt-5.5"\n'), "gpt-5.6-terra", "top-level wins; table entries ignored");
  assert.equal(codexConfigModel(""), undefined);
});

// --- Codex usage: tokens → estimated $ (Codex reports tokens, never a price) ---
test("codexUsage extracts tokens and estimates cost from the default rates", () => {
  // input_tokens is the FULL turn input (incl. cached) — the context-window figure the gauge needs.
  const u = codexUsage({ input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 });
  assert.equal(u!.inputTokens, 1000);
  assert.equal(u!.outputTokens, 100);
  // default: 1.25/1M in, 10/1M out → (1000*1.25 + 100*10)/1e6 = 0.00225
  assert.ok(Math.abs(u!.costUsd! - 0.00225) < 1e-9, `got ${u!.costUsd}`);
});
test("codexUsage bills the cached prefix cheaper (default = 1/10 of input)", () => {
  const u = codexUsage({ input_tokens: 1000, cached_input_tokens: 1000, output_tokens: 0 });
  // all input cached → 1000 * (1.25/10) / 1e6 = 0.000125
  assert.ok(Math.abs(u!.costUsd! - 0.000125) < 1e-9, `got ${u!.costUsd}`);
});
test("codexUsage honors env-configurable prices and ignores an empty turn", () => {
  process.env.JARVIS_CODEX_PRICE_IN = "2"; process.env.JARVIS_CODEX_PRICE_OUT = "20"; process.env.JARVIS_CODEX_PRICE_CACHED = "0";
  try {
    const u = codexUsage({ input_tokens: 500, cached_input_tokens: 100, output_tokens: 50 });
    // (400*2 + 100*0 + 50*20)/1e6 = (800 + 1000)/1e6 = 0.0018
    assert.ok(Math.abs(u!.costUsd! - 0.0018) < 1e-9, `got ${u!.costUsd}`);
  } finally { delete process.env.JARVIS_CODEX_PRICE_IN; delete process.env.JARVIS_CODEX_PRICE_OUT; delete process.env.JARVIS_CODEX_PRICE_CACHED; }
  assert.equal(codexUsage({ input_tokens: 0, output_tokens: 0 }), undefined, "no tokens → no usage");
  assert.equal(codexUsage(undefined), undefined);
});

// --- Codex item → StreamEvent mapping (same vocabulary Claude emits) ---
test("codexItemToEvents: agent_message becomes text (only when completed) and is accumulated", () => {
  const done = codexItemToEvents({ type: "agent_message", text: "feito" }, true);
  assert.deepEqual(done.events, [{ kind: "text", text: "feito" }]);
  assert.equal(done.text, "feito", "text is returned so the caller can accumulate the final reply");
  assert.deepEqual(codexItemToEvents({ type: "agent_message", text: "wip" }, false).events, [], "not emitted on item.started");
  assert.deepEqual(codexItemToEvents({ type: "agent_message", text: "  " }, true).events, [], "blank message emits nothing");
});
test("codexItemToEvents: reasoning → thinking (completed only)", () => {
  assert.deepEqual(codexItemToEvents({ type: "reasoning" }, true).events, [{ kind: "thinking" }]);
  assert.deepEqual(codexItemToEvents({ type: "reasoning" }, false).events, []);
});
test("codexItemToEvents: command_execution → Bash, with untruncated detail only when long", () => {
  const short = codexItemToEvents({ type: "command_execution", command: "echo hi" }, false).events[0];
  assert.equal(short.name, "Bash");
  assert.equal(short.summary, "Bash: echo hi");
  assert.equal(short.detail, undefined, "short command needs no expandable detail");
  const long = "echo " + "x".repeat(120);
  const big = codexItemToEvents({ type: "command_execution", command: long }, true).events[0];
  assert.equal(big.detail, long, "long command keeps the full text in detail");
});
test("codexItemToEvents: file_change → one Edit/Write row per changed path", () => {
  const evs = codexItemToEvents({ type: "file_change", changes: [{ path: "src/a.ts", kind: "modify" }, { path: "src/b.ts", kind: "add" }] }, true).events;
  assert.equal(evs.length, 2);
  assert.equal(evs[0].name, "Edit"); assert.equal(evs[0].path, "src/a.ts"); assert.match(evs[0].summary!, /Editando a\.ts/);
  assert.equal(evs[1].name, "Write"); assert.match(evs[1].summary!, /Criando b\.ts/);
  const single = codexItemToEvents({ type: "patch", path: "only.ts" }, true).events;
  assert.deepEqual(single.map((e) => e.name), ["Edit"]);
});
test("codexItemToEvents: tool calls + web search map to a tool row; unknowns are ignored", () => {
  assert.equal(codexItemToEvents({ type: "mcp_tool_call", name: "fetch" }, false).events[0].summary, "Ferramenta: fetch");
  assert.equal(codexItemToEvents({ type: "custom_tool_call", tool: "apply_patch" }, false).events[0].name, "apply_patch");
  assert.equal(codexItemToEvents({ type: "web_search", query: "typescript enums" }, false).events[0].name, "WebSearch");
  assert.deepEqual(codexItemToEvents({ type: "some_future_kind" }, true).events, [], "unknown item type → no events");
  assert.deepEqual(codexItemToEvents({}, true).events, [], "missing type → no events");
});
