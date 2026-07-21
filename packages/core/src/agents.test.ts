import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry, AiderAdapter, CodexAdapter, MockAgentAdapter, agentPermissionMode, managedAdapterSecurityArgs, buildAiderInvocationArgs, codexUsage, codexTelemetryFromLines, codexPlanUsage, codexCommandActivity, codexItemToEvents, codexPatchEventsFromLines, codexConfigModel, normalizeToolName, validateModelSelection, parseGeminiCliEvent, parseCursorCliEvent, parseClineCliEvent, parseQwenCliEvent, parseCopilotCliEvent, parseOpenCodeCliEvent, parseCopilotHelpModels, parseGenericJsonlEvent, finalOnlyText, safeProviderValue, withManagedHistory, createAgentEventBridge, cliLifecycleEvent, buildGeminiArgs, buildCursorArgs, buildCopilotArgs, buildOpenCodeArgs, buildClineArgs, buildQwenArgs, buildContinueArgs, buildKiroArgs } from "./agents.js";
import { createEventSequencer } from "./agent-contract.js";

test("permission mode is explicit and defaults conservatively to the historical full-access behavior", () => {
  assert.equal(agentPermissionMode(undefined), "full_access");
  assert.equal(agentPermissionMode("provider-default"), "provider_default");
  assert.equal(agentPermissionMode("provider_default"), "provider_default");
  assert.equal(agentPermissionMode("typo"), "full_access");
});

test("managed Claude argv is safe-mode and excludes delegation/shell capabilities", () => {
  const readOnly = managedAdapterSecurityArgs("claude-code", { workspaceAccess: "read_only", preventCommits: true });
  const writer = managedAdapterSecurityArgs("claude-code", { workspaceAccess: "isolated_write", preventCommits: true });
  assert.deepEqual(readOnly, ["--safe-mode", "--permission-mode", "dontAsk", "--tools", "Read,Glob,Grep,WebFetch,WebSearch"]);
  assert.deepEqual(writer, ["--safe-mode", "--permission-mode", "dontAsk", "--tools", "Read,Glob,Grep,Edit,Write,NotebookEdit,WebFetch,WebSearch"]);
  const readTools = readOnly[4].split(","), writeTools = writer[4].split(",");
  assert.ok(readTools.includes("Read"));
  assert.ok(!readTools.some((tool) => ["Edit", "Write", "NotebookEdit", "Bash", "Task", "Agent"].includes(tool)));
  assert.ok(writeTools.includes("Edit") && writeTools.includes("Write"));
  assert.ok(!writeTools.some((tool) => ["Bash", "Task", "Agent"].includes(tool)), "writer cannot escape the worktree through shell/delegation");
  assert.ok(![...readOnly, ...writer].some((arg) => /bypass|dangerously/i.test(arg)), "managed argv never inherits the global full-access bypass");
});

test("managed Codex is read-only sandbox only and rejects writer", () => {
  assert.deepEqual(managedAdapterSecurityArgs("codex", { workspaceAccess: "read_only", preventCommits: true }), ["--sandbox", "read-only"]);
  assert.throws(() => managedAdapterSecurityArgs("codex", { workspaceAccess: "isolated_write", preventCommits: true }), /escrita.*bloqueio de commit/i);
});

test("managed Aider is isolated writer with auto-commits disabled and rejects read-only", () => {
  assert.deepEqual(managedAdapterSecurityArgs("aider", { workspaceAccess: "isolated_write", preventCommits: true }), ["--no-auto-commits"]);
  assert.deepEqual(buildAiderInvocationArgs("prompt.txt", { managed: { workspaceAccess: "isolated_write", preventCommits: true }, model: "sonnet" }, true),
    ["--message-file", "prompt.txt", "--no-stream", "--no-pretty", "--no-auto-commits", "--model", "sonnet"],
    "managed Aider must not inherit --yes-always even when global full access is enabled");
  assert.throws(() => managedAdapterSecurityArgs("aider", { workspaceAccess: "read_only", preventCommits: true }), /somente leitura certificado/i);
});

test("all uncertified managed adapters fail closed; mock requires an explicit read-only fixture opt-in", () => {
  for (const agent of ["gemini", "cursor", "copilot", "opencode", "cline", "qwen", "continue", "kiro", "antigravity", "future-agent"]) {
    for (const workspaceAccess of ["read_only", "isolated_write"] as const) {
      assert.throws(() => managedAdapterSecurityArgs(agent, { workspaceAccess, preventCommits: true }), new RegExp(`adapter ${agent}.*não possui sandbox`, "i"));
    }
  }
  assert.throws(() => managedAdapterSecurityArgs("mock", { workspaceAccess: "read_only", preventCommits: true }), /não possui sandbox/i);
  assert.deepEqual(managedAdapterSecurityArgs("mock", { workspaceAccess: "read_only", preventCommits: true }, true), []);
  assert.throws(() => managedAdapterSecurityArgs("mock", { workspaceAccess: "isolated_write", preventCommits: true }, true), /não possui sandbox/i);
  const malformed = { workspaceAccess: "read_only", preventCommits: false } as unknown as Parameters<typeof managedAdapterSecurityArgs>[1];
  assert.throws(() => managedAdapterSecurityArgs("claude-code", malformed), /política.*inválida/i);
});

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
  assert.throws(() => reg.get("nope"), /não registrado/, "an explicit unknown provider never silently runs the default");
});

test("AgentRegistry UI catalog exposes modelControl at the legacy top level and canonically nested", async () => {
  const [codex] = await new AgentRegistry("codex").register(new CodexAdapter()).describe();
  assert.equal(codex.modelControl, "per_turn");
  assert.equal(codex.capabilities?.modelControl, "per_turn");
  assert.equal(codex.capabilities?.stream, "delta", "Codex emits live NDJSON items and rollout enrichment");
  assert.equal(codex.capabilities?.subagents, true, "Codex must advertise the child-rollout lifecycle its adapter observes");
  assert.ok(codex.models.length > 0);
});

test("model selection rejects a stale model or unsupported effort before spawn", () => {
  const caps = { models: [{ id: "m1", efforts: ["low", "high"] }] };
  assert.throws(() => validateModelSelection(caps, { model: "gone" }), /não existe/);
  assert.throws(() => validateModelSelection(caps, { model: "m1", effort: "ultra" }), /não é suportado/);
  assert.doesNotThrow(() => validateModelSelection(caps, { model: "m1", effort: "high" }));
  assert.doesNotThrow(() => validateModelSelection({ models: [] }, { model: "provider/configured" }));
});

test("Gemini stream-json maps assistant, tool, terminal usage and errors", () => {
  assert.equal(parseGeminiCliEvent({ type: "init", session_id: "g1" }).sessionId, "g1");
  assert.equal(parseGeminiCliEvent({ type: "message", role: "assistant", content: "oi" }).text, "oi");
  const read = parseGeminiCliEvent({ type: "tool_use", tool_name: "read_file", parameters: { path: "a.ts" }, tool_id: "t1" }).events?.[0];
  assert.deepEqual({ id: read?.toolId, name: read?.name, path: read?.path }, { id: "t1", name: "Read", path: "a.ts" });
  assert.equal(parseGeminiCliEvent({ type: "tool_result", tool_name: "read_file", tool_id: "t1" }).events?.[0].status, "completed");
  assert.equal(parseGeminiCliEvent({ type: "result", response: "fim", stats: { input_tokens: 7, output_tokens: 2 } }).usage?.inputTokens, 7);
  assert.match(parseGeminiCliEvent({ type: "error", message: "quota" }).error || "", /quota/);
});

test("structured providers inherit provider-neutral file paths and computed +/- metadata", () => {
  const edit = parseGeminiCliEvent({ type: "tool_use", tool_name: "Edit", tool_id: "e1", parameters: { file_path: "src/a.ts", old_string: "old\nkeep", new_string: "new\nkeep\nmore" } }).events?.[0];
  assert.deepEqual({ path: edit?.path, adds: edit?.adds, dels: edit?.dels }, { path: "src/a.ts", adds: 2, dels: 1 });
  const write = parseQwenCliEvent({ type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/new.ts", content: "one\ntwo" } }] } }).events?.[0];
  assert.deepEqual({ path: write?.path, adds: write?.adds, dels: write?.dels }, { path: "src/new.ts", adds: 2, dels: 0 });
});

test("all structured adapters share the same canonical tool vocabulary without hiding unknown tools", () => {
  assert.deepEqual(["read_file", "readToolCall", "read"].map(normalizeToolName), ["Read", "Read", "Read"]);
  assert.deepEqual(["write_file", "replace_in_file", "search_files", "list_files", "execute_command"].map(normalizeToolName), ["Write", "Edit", "Grep", "Glob", "Bash"]);
  assert.equal(normalizeToolName("provider_new_tool"), "provider_new_tool");
  assert.equal(parseCursorCliEvent({ type: "tool_call", subtype: "started", tool_call: { readToolCall: { args: { path: "README.md" } } } }).events?.[0].name, "Read");
  assert.equal(parseOpenCodeCliEvent({ type: "tool_use", part: { type: "tool", tool: "read", state: { status: "completed", input: { path: "a" } } } }).events?.[0].name, "Read");
});

test("Cursor stream-json correlates the full tool lifecycle", () => {
  const started = parseCursorCliEvent({ type: "tool_call", subtype: "started", call_id: "c1", tool_call: { readToolCall: { args: { path: "README.md" } } } });
  assert.equal(started.events?.[0].toolId, "c1");
  assert.equal(parseCursorCliEvent({ type: "tool_call", subtype: "completed", call_id: "c1" }).events?.[0].status, "completed");
  assert.equal(parseCursorCliEvent({ type: "result", subtype: "success", result: "ok", session_id: "s" }).finalText, "ok");
});

test("Cline JSONL surfaces reasoning, interaction requests and text", () => {
  const p = parseClineCliEvent({ type: "say", say: "text", text: "fazendo", reasoning: "internal", partial: true });
  assert.equal(p.text, "fazendo"); assert.equal(p.events?.[0].kind, "thinking");
  assert.equal(parseClineCliEvent({ type: "ask", ask: "followup", text: "qual arquivo?" }).events?.[0].name, "InputRequired");
  assert.equal(parseClineCliEvent({ type: "say", say: "text", text: "snapshot", partial: true }).textMode, "snapshot");
});

test("Qwen stream-json maps message tools and terminal usage", () => {
  const p = parseQwenCliEvent({ type: "assistant", message: { content: [{ type: "text", text: "vou " }, { type: "tool_use", id: "q1", name: "Read", input: { file_path: "a" } }], usage: { input_tokens: 9 } } });
  assert.equal(p.text, "vou "); assert.equal(p.events?.[0].toolId, "q1"); assert.equal(p.usage?.inputTokens, 9);
  assert.equal(parseQwenCliEvent({ type: "result", result: "fim", session_id: "q" }).sessionId, "q");
  assert.equal(parseQwenCliEvent({ event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } }).text, "x");
});

test("Copilot and OpenCode documented JSONL fixtures preserve lifecycle and usage", () => {
  assert.equal(parseCopilotCliEvent({ type: "tool_call", status: "completed", call_id: "cp1", name: "shell" }).events?.[0].status, "completed");
  assert.equal(parseOpenCodeCliEvent({ type: "tool_use", sessionID: "oc", part: { type: "tool", callID: "o1", tool: "read", state: { status: "completed", input: { path: "a" } } } }).events?.[0].toolId, "o1");
  assert.equal(parseOpenCodeCliEvent({ type: "step_finish", part: { type: "step-finish", tokens: { input: 3, output: 2 } } }).providerEvent, "step_finish");
});

test("dynamic model and prompt inputs accept provider slugs but reject argv injection", () => {
  assert.equal(safeProviderValue("openai/gpt-5:fast"), "openai/gpt-5:fast");
  assert.equal(safeProviderValue("--danger"), undefined);
  assert.equal(parseCopilotHelpModels("  --model=<model> one of: auto, gpt-5.1, claude-sonnet-4").length, 3);
  const prompt = withManagedHistory("nova", [{ role: "user", text: "antiga" }, { role: "assistant", text: "resposta" }], 1000);
  assert.match(prompt, /antiga/); assert.match(prompt, /resposta/); assert.match(prompt, /nova/);
});

test("documented argv contracts are deterministic for every external headless CLI", () => {
    assert.deepEqual(buildGeminiArgs("p", "C:/w", "g1", { model: "gemini-2" }), ["--output-format", "stream-json", "--yolo", "--resume", "g1", "--model", "gemini-2", "--prompt", "p"]);
    assert.deepEqual(buildCursorArgs("p", "C:/w", "c1", { model: "auto" }), ["--print", "--output-format", "stream-json", "--force", "--resume", "c1", "--model", "auto", "p"]);
    assert.deepEqual(buildCopilotArgs("p", "C:/w", "cp1", { model: "gpt-5", effort: "high" }), ["--prompt", "p", "--output-format=json", "--stream=on", "--no-ask-user", "-C", "C:/w", "--yolo", "--resume=cp1", "--model=gpt-5", "--effort=high"]);
    assert.deepEqual(buildOpenCodeArgs("p", "C:/w", "o1", { model: "openai/gpt", effort: "fast" }), ["run", "--format", "json", "--auto", "--session", "o1", "--model", "openai/gpt", "--variant", "fast", "p"]);
    assert.ok(!buildClineArgs("p", "C:/w", "ignored", {}).includes("--id"), "Cline has no invented resume flag");
    assert.deepEqual(buildQwenArgs("p", "C:/w", "q1", {}), ["--output-format", "stream-json", "--include-partial-messages", "--approval-mode", "yolo", "--resume", "q1", "--prompt", "p"]);
    assert.deepEqual(buildContinueArgs("p", { model: "m" }), ["-p", "p", "--format", "json", "--auto", "--model", "m"]);
    assert.deepEqual(buildKiroArgs("p", { effort: "high" }), ["chat", "--no-interactive", "--trust-all-tools", "--effort", "high", "p"]);
});

test("provider events bridge to one canonical ordered lifecycle", () => {
  const seq = createEventSequencer("turn-x", () => 1);
  const bridge = createAgentEventBridge("turn-x", seq);
  assert.equal(bridge.accepted().kind, "accepted"); assert.equal(bridge.started().kind, "started");
  assert.equal(bridge.provider({ kind: "tool", name: "Read", summary: "lendo", toolId: "r1", status: "completed" })?.kind, "tool_completed");
  assert.equal(bridge.completed("ok").kind, "completed");
  assert.throws(() => bridge.failed("late"), /terminated/);
});

test("generic JSONL parser is forward-compatible and only labels explicit costs as billed", () => {
  assert.deepEqual(parseGenericJsonlEvent({ type: "future_event", payload: 1 }, "fixture"), { sessionId: undefined });
  const command = parseGenericJsonlEvent({ type: "command_execution", id: "cmd-1", command: "echo ok", status: "completed" }, "fixture").events?.[0];
  assert.deepEqual({ name: command?.name, summary: command?.summary, status: command?.status }, { name: "Bash", summary: "Bash: echo ok", status: "completed" });
  const done = parseGenericJsonlEvent({ type: "result", result: "ok", usage: { input_tokens: 2, cost: 0.1 } }, "opencode", true);
  assert.equal(done.usage?.costKind, "billed"); assert.equal(done.usage?.costUsd, 0.1);
  const unverified = parseGenericJsonlEvent({ type: "result", result: "ok", usage: { cost: 0.1 } }, "fixture");
  assert.equal(unverified.usage?.costKind, "estimated_api_equivalent", "an unlabeled dollar is never promoted to billed");
});

test("all non-native CLI adapters share a visible Jarvis process lifecycle event", () => {
  const started = cliLifecycleEvent("gemini", "Google Gemini CLI", "started", undefined, "turn-1");
  assert.deepEqual({ kind: started.kind, name: started.name, status: started.status, toolId: started.toolId }, { kind: "tool", name: "JarvisCLI", status: "started", toolId: "turn-1:cli" });
  assert.match(started.summary || "", /Executando Google Gemini CLI/);
  const failed = cliLifecycleEvent("continue", "Continue CLI", "failed", "exit 1", "turn-2");
  assert.equal(failed.error, "exit 1");
  assert.match(failed.providerEvent || "", /jarvis\.continue\.cli\.failed/);
});

test("final-only adapters unwrap common JSON envelopes but preserve unknown output", () => {
  assert.equal(finalOnlyText('{"response":"feito"}'), "feito");
  assert.equal(finalOnlyText('{"data":[{"message":{"content":"último"}}]}'), '{"data":[{"message":{"content":"último"}}]}', "unknown envelope is not guessed");
  assert.equal(finalOnlyText("texto simples"), "texto simples");
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

test("Codex usage uses per-turn deltas while context and plan come from rollout telemetry", () => {
  const telemetry = codexTelemetryFromLines([
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1500, cached_input_tokens: 700, output_tokens: 140 }, last_token_usage: { input_tokens: 600, cached_input_tokens: 500, output_tokens: 40 }, model_context_window: 258400 }, rate_limits: { plan_type: "pro", primary: { used_percent: 12, window_minutes: 10080, resets_at: 1800000000 } } } }),
  ]);
  const usage = codexUsage(telemetry!.total, { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100 }, telemetry);
  assert.equal(usage!.inputTokens, 500); assert.equal(usage!.contextTokens, 600); assert.equal(usage!.contextWindowTokens, 258400); assert.equal(usage!.model, "gpt-5.6-sol");
  const plan = codexPlanUsage(telemetry); assert.equal(plan!.sevenDay!.pct, 12); assert.equal(plan!.sevenDay!.remainingPct, 88); assert.match(plan!.label || "", /pro/);
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
test("Codex command executions expose unambiguous reads, searches and listings with provider-neutral names", () => {
  const read = codexCommandActivity('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-Content -Raw packages/core/src/agents.ts"');
  assert.deepEqual({ name: read.name, summary: read.summary, path: read.path }, { name: "Read", summary: "Lendo agents.ts", path: "packages/core/src/agents.ts" });
  assert.match(read.detail || "", /Get-Content/);
  assert.deepEqual(codexCommandActivity("pwsh -Command \"$p='x.ts'; Get-Content $p\"").path, undefined, "a shell variable is not invented as a file path");
  assert.equal(codexCommandActivity('pwsh -Command "rg -n TODO packages"').name, "Grep");
  assert.equal(codexCommandActivity('pwsh -Command "Get-ChildItem -Recurse"').name, "Glob");
  assert.equal(codexCommandActivity("echo hi").name, "Bash");
  const event = codexItemToEvents({ id: "read-1", type: "command_execution", command: "Get-Content -LiteralPath 'src/a.ts'" }, false).events[0];
  assert.deepEqual({ name: event.name, path: event.path, status: event.status }, { name: "Read", path: "src/a.ts", status: "started" });
});
test("codexItemToEvents: file_change → one Edit/Write row per changed path", () => {
  const evs = codexItemToEvents({ type: "file_change", changes: [{ path: "src/a.ts", kind: "modify", unified_diff: "@@ -1 +1 @@\n-old\n+new" }, { path: "src/b.ts", kind: "add", unified_diff: "@@ -0,0 +1 @@\n+new" }] }, true).events;
  assert.equal(evs.length, 2);
  assert.equal(evs[0].name, "Edit"); assert.equal(evs[0].path, "src/a.ts"); assert.match(evs[0].summary!, /Editando a\.ts/);
  assert.equal(evs[1].name, "Write"); assert.match(evs[1].summary!, /Criando b\.ts/);
  const single = codexItemToEvents({ type: "patch", path: "only.ts", unified_diff: "@@ -1 +1 @@\n-a\n+b" }, true).events;
  assert.deepEqual(single.map((e) => e.name), ["Edit"]);
});
test("Codex transcript patch completion supplies authoritative file paths and +/- counts", () => {
  const lines = [JSON.stringify({ type: "event_msg", payload: { type: "patch_apply_end", call_id: "p1", success: true, changes: {
    "src/a.ts": { type: "update", unified_diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n-old\n keep\n+new\n+more" },
    "src/new.ts": { type: "add", unified_diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+one\n+two" },
  } } })];
  const events = codexPatchEventsFromLines(lines);
  assert.equal(events.length, 2);
  assert.deepEqual({ path: events[0].path, adds: events[0].adds, dels: events[0].dels, status: events[0].status }, { path: "src/a.ts", adds: 2, dels: 1, status: "completed" });
  assert.deepEqual({ name: events[1].name, path: events[1].path, adds: events[1].adds, dels: events[1].dels }, { name: "Write", path: "src/new.ts", adds: 2, dels: 0 });
  const old = JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", type: "event_msg", payload: { type: "patch_apply_end", call_id: "old", success: true, changes: { "old.ts": { type: "add", unified_diff: "+old" } } } });
  assert.equal(codexPatchEventsFromLines([old], Date.parse("2026-01-02T00:00:00Z")).length, 0, "live tail never replays edits from resumed history");
});
test("codexItemToEvents: tool calls + web search map to a tool row; unknowns are ignored", () => {
  assert.equal(codexItemToEvents({ type: "mcp_tool_call", name: "fetch" }, false).events[0].summary, "Ferramenta: fetch");
  assert.equal(codexItemToEvents({ type: "custom_tool_call", tool: "apply_patch" }, false).events[0].name, "apply_patch");
  assert.equal(codexItemToEvents({ type: "web_search", query: "typescript enums" }, false).events[0].name, "WebSearch");
  assert.deepEqual(codexItemToEvents({ type: "some_future_kind" }, true).events, [], "unknown item type → no events");
  assert.deepEqual(codexItemToEvents({}, true).events, [], "missing type → no events");
});
