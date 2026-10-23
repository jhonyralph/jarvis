import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry, AiderAdapter, CodexAdapter, MockAgentAdapter, agentPermissionMode, normalizePermissionMode, effectivePermissionMode, permissionArgs, managedAdapterSecurityArgs, buildAiderInvocationArgs, codexUsage, codexTelemetryFromLines, codexPlanUsage, codexCommandActivity, codexItemToEvents, codexPatchEventsFromLines, codexConfigModel, normalizeToolName, validateModelSelection, resolveClosestModel, parseGeminiCliEvent, parseCursorCliEvent, parseClineCliEvent, parseQwenCliEvent, parseCopilotCliEvent, parseOpenCodeCliEvent, parseCopilotHelpModels, parseGenericJsonlEvent, isClaudeAsyncAgentLaunch, parseClaudeTaskNotification, finalOnlyText, safeProviderValue, withManagedHistory, createAgentEventBridge, cliLifecycleEvent, buildGeminiArgs, buildCursorArgs, buildCopilotArgs, buildOpenCodeArgs, buildClineArgs, buildQwenArgs, buildContinueArgs, buildKiroArgs, assertNativeSessionBinding, findNativeSessionCollisions, settleOnExit, codexHasPlanWindow, codexRolloutAppend, ROLLOUT_APPEND_MAX_BYTES, codexPromptTokens, managedHistoryBudgetChars, codexRolloutOversized } from "./agents.js";
import { createEventSequencer } from "./agent-contract.js";

test("native continuity rejects one provider thread bound to multiple Jarvis sessions", () => {
  const bindings: Array<[string, string]> = [["jarvis-a", "native-1"], ["jarvis-b", "native-1"], ["jarvis-c", "native-2"]];
  assert.deepEqual(findNativeSessionCollisions(bindings), [{ nativeSessionId: "native-1", managedSessionIds: ["jarvis-a", "jarvis-b"] }]);
  assert.throws(() => assertNativeSessionBinding([["jarvis-a", "native-1"]], "jarvis-b", "native-1"), /colisão de sessão nativa/);
  assert.throws(() => assertNativeSessionBinding([["jarvis-a", "native-1"]], "claude:native-1", "native-1"), /colisão de sessão nativa/, "direct native imports cannot bypass a managed owner");
  assert.doesNotThrow(() => assertNativeSessionBinding([["jarvis-a", "native-1"]], "jarvis-a", "native-1"));
});

test("permission mode is explicit and defaults conservatively to the historical full-access behavior", () => {
  assert.equal(agentPermissionMode(undefined), "bypass");
  assert.equal(agentPermissionMode("full-access"), "bypass");
  assert.equal(agentPermissionMode("provider-default"), "manual");
  assert.equal(agentPermissionMode("provider_default"), "manual");
  assert.equal(agentPermissionMode("typo"), "bypass");
});

test("canonical permission modes map to each provider's native argv without silently escalating to bypass", () => {
  // Claude expresses all five canonical modes natively.
  assert.deepEqual(permissionArgs("claude-code", "plan"), ["--permission-mode", "plan"]);
  assert.deepEqual(permissionArgs("claude-code", "accept_edits"), ["--permission-mode", "acceptEdits"]);
  assert.deepEqual(permissionArgs("claude-code", "auto"), ["--permission-mode", "auto"]);
  assert.deepEqual(permissionArgs("claude-code", "bypass"), ["--permission-mode", "bypassPermissions"]);
  // Codex: plan → read-only sandbox; bypass → the dangerous flag; manual → its own default (no flag).
  assert.deepEqual(permissionArgs("codex", "plan"), ["--sandbox", "read-only"]);
  assert.deepEqual(permissionArgs("codex", "bypass"), ["--dangerously-bypass-approvals-and-sandbox"]);
  assert.deepEqual(permissionArgs("codex", "manual"), []);
  // Providers with only a yolo-style switch: non-bypass adds nothing (their own "ask" default).
  assert.deepEqual(permissionArgs("gemini", "bypass"), ["--yolo"]);
  assert.deepEqual(permissionArgs("gemini", "plan"), []);
  // Providers that always emit an explicit token still resolve to a safe value off-bypass.
  assert.deepEqual(permissionArgs("qwen", "manual"), ["--approval-mode", "default"]);
  assert.deepEqual(permissionArgs("cline", "bypass"), ["--auto-approve", "true"]);
  assert.deepEqual(permissionArgs("cline", "manual"), ["--auto-approve", "false"]);
});

test("effective permission mode lets a per-turn choice override the global default, with legacy normalization", () => {
  assert.equal(effectivePermissionMode({ permissionMode: "plan" }), "plan");
  assert.equal(effectivePermissionMode({}), agentPermissionMode());
  assert.equal(normalizePermissionMode("full_access"), "bypass");
  assert.equal(normalizePermissionMode("provider-default"), "manual");
  assert.equal(normalizePermissionMode("nonsense"), undefined);
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
  // Model DISCOVERY shells out to `codex debug models`; a machine without the codex CLI (e.g. CI)
  // legitimately returns an empty catalog and reports the agent as not_installed. The catalog SHAPE is
  // what this test guards — only require a populated list where the CLI is actually present.
  assert.ok(Array.isArray(codex.models));
  if (codex.support !== "not_installed") assert.ok(codex.models.length > 0);
});

test("AgentRegistry caches UI catalog and refresh forces rediscovery", async () => {
  let calls = 0;
  const adapter = {
    name: "fixture",
    capabilities: async () => { calls++; return { models: [] }; },
    available: async () => true,
    send: async () => ({ text: "" }),
  };
  const reg = new AgentRegistry("fixture").register(adapter as any);
  assert.equal((await reg.describe())[0].name, "fixture");
  assert.equal(calls, 1);
  assert.equal((await reg.describe())[0].name, "fixture");
  assert.equal(calls, 1, "hot describe returns cached catalog");
  await reg.refresh();
  assert.equal(calls, 2, "explicit refresh bypasses cache");
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
test("codexUsage extracts tokens and prices them from the model's own row", () => {
  // input_tokens is the FULL turn input (incl. cached) — the context-window figure the gauge needs.
  const u = codexUsage({ input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }, undefined, undefined, { model: "gpt-5.6-luna" });
  assert.equal(u!.inputTokens, 1000);
  assert.equal(u!.outputTokens, 100);
  // ballpark row: 1.25/1M in, 10/1M out → (1000*1.25 + 100*10)/1e6 = 0.00225
  assert.ok(Math.abs(u!.costUsd! - 0.00225) < 1e-9, `got ${u!.costUsd}`);
  assert.equal(u!.costKind, "estimated_api_equivalent");
});
test("codexUsage bills the cached prefix cheaper", () => {
  const u = codexUsage({ input_tokens: 1000, cached_input_tokens: 1000, output_tokens: 0 }, undefined, undefined, { model: "gpt-5.6-luna" });
  // all input cached → 1000 * 0.125 / 1e6 = 0.000125
  assert.ok(Math.abs(u!.costUsd! - 0.000125) < 1e-9, `got ${u!.costUsd}`);
});
test("codexUsage reports tokens_only instead of guessing a price for an unknown model", () => {
  // The whole point of item A: a model with no defensible rate must NOT be silently under-reported.
  for (const opts of [undefined, { model: "gpt-7-unreleased" }]) {
    const u = codexUsage({ input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }, undefined, undefined, opts);
    assert.equal(u!.costUsd, undefined, `model ${opts?.model ?? "(none)"} must not be priced`);
    assert.equal(u!.costKind, "tokens_only");
    assert.equal(u!.inputTokens, 1000, "tokens are still measured and reported");
    assert.equal(u!.outputTokens, 100);
    assert.match(u!.source!, /sem preço/);
  }
});
test("codexUsage applies Astra's long-context surcharge and fast-tier multiplier", () => {
  const turn = { input_tokens: 400_000, cached_input_tokens: 0, output_tokens: 60_000 };
  // 400k > 272k ⇒ whole prompt at 2x input and 1.5x output: (400k*20 + 60k*75)/1e6 = 12.50
  const long = codexUsage(turn, undefined, undefined, { model: "gpt-6-astra" });
  assert.ok(Math.abs(long!.costUsd! - 12.5) < 1e-9, `got ${long!.costUsd}`);
  assert.match(long!.source!, /contexto longo/);
  // Same turn under the threshold pays the base rate: (200k*10 + 60k*50)/1e6 = 5.00
  const short = codexUsage({ input_tokens: 200_000, cached_input_tokens: 0, output_tokens: 60_000 }, undefined, undefined, { model: "gpt-6-astra" });
  assert.ok(Math.abs(short!.costUsd! - 5) < 1e-9, `got ${short!.costUsd}`);
  // Fast tier doubles the applicable rate — it stacks on top of the long-context surcharge.
  const fast = codexUsage(turn, undefined, undefined, { model: "gpt-6-astra", fastMode: true });
  assert.ok(Math.abs(fast!.costUsd! - 25) < 1e-9, `got ${fast!.costUsd}`);
  assert.match(fast!.source!, /fast ×2/);
});
test("codexUsage prices the SAME turn differently per model (the global rate could not)", () => {
  const turn = { input_tokens: 100_000, cached_input_tokens: 0, output_tokens: 10_000 };
  const astra = codexUsage(turn, undefined, undefined, { model: "gpt-6-astra" });   // (100k*10 + 10k*50)/1e6
  const sol = codexUsage(turn, undefined, undefined, { model: "gpt-5.6-sol" });     // (100k*4  + 10k*20)/1e6
  assert.ok(Math.abs(astra!.costUsd! - 1.5) < 1e-9, `astra ${astra!.costUsd}`);
  assert.ok(Math.abs(sol!.costUsd! - 0.6) < 1e-9, `sol ${sol!.costUsd}`);
  assert.ok(astra!.costUsd! > sol!.costUsd!, "Astra must not be indistinguishable from Sol");
});
test("codexUsage tests the long-context threshold against the real prompt, not the billed delta", () => {
  // Resumed thread: this turn's delta is small, but the prompt actually sent was 400k — the provider
  // surcharges the PROMPT, so a small delta on a huge context must still price at the higher rate.
  const telemetry = codexTelemetryFromLines([
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-6-astra" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 400_000, cached_input_tokens: 0, output_tokens: 10_000 }, last_token_usage: { input_tokens: 400_000, cached_input_tokens: 0, output_tokens: 1_000 }, model_context_window: 1_050_000 } } }),
  ]);
  const u = codexUsage(telemetry!.total, { input_tokens: 390_000, cached_input_tokens: 0, output_tokens: 9_000 }, telemetry);
  assert.equal(u!.inputTokens, 10_000, "cost is billed on the delta");
  assert.equal(u!.model, "gpt-6-astra", "the model comes from rollout telemetry");
  // delta 10k input / 1k output, surcharged: (10k*20 + 1k*75)/1e6 = 0.275
  assert.ok(Math.abs(u!.costUsd! - 0.275) < 1e-9, `got ${u!.costUsd}`);
  assert.match(u!.source!, /contexto longo/);
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

// --- catalog sync: repin a dead model id onto the closest surviving model by family ---
const NEW_CODEX = {
  models: [
    { id: "gpt-5.7-sol", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low" },
    { id: "gpt-5.7-terra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium" },
    { id: "gpt-5.7-luna", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium" },
    { id: "gpt-5.6", efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium" },
  ],
  defaultModel: undefined as string | undefined,
};

test("resolveClosestModel keeps a still-valid pin untouched", () => {
  const r = resolveClosestModel("gpt-5.7-terra", "high", NEW_CODEX);
  assert.equal(r.changed, false);
  assert.equal(r.model, "gpt-5.7-terra");
  assert.equal(r.effort, "high");
});

test("resolveClosestModel maps a dead id to the same variant, newest version, keeping effort", () => {
  const r = resolveClosestModel("gpt-5.6-sol", "max", NEW_CODEX);
  assert.equal(r.changed, true);
  assert.equal(r.model, "gpt-5.7-sol", "same 'sol' family beats other variants that only share 'gpt'");
  assert.equal(r.effort, "max", "effort survives because the replacement still offers it");
});

test("resolveClosestModel reconciles an unsupported effort to the nearest level", () => {
  // gpt-5.7-luna has no 'ultra'; nearest below it on the ladder is 'max'.
  const r = resolveClosestModel("gpt-5.6-luna", "ultra", NEW_CODEX);
  assert.equal(r.model, "gpt-5.7-luna");
  assert.equal(r.effort, "max");
});

test("resolveClosestModel drops an unsupported effort even when the model id still exists", () => {
  const r = resolveClosestModel("gpt-5.6", "ultra", NEW_CODEX); // gpt-5.6 tops out at xhigh
  assert.equal(r.model, "gpt-5.6");
  assert.equal(r.effort, "xhigh");
  assert.equal(r.changed, true);
});

test("resolveClosestModel leaves 'auto' (no pinned model) and empty catalogs untouched", () => {
  assert.deepEqual(resolveClosestModel(undefined, undefined, NEW_CODEX), { model: undefined, effort: undefined, changed: false });
  const empty = resolveClosestModel("gpt-5.6-sol", "high", { models: [] });
  assert.equal(empty.changed, false);
  assert.equal(empty.model, "gpt-5.6-sol", "never invents a replacement when there is no catalog to match against");
});

test("resolveClosestModel ignores non-selectable stale catalog entries", () => {
  const caps = {
    models: [
      { id: "gpt-5.6-sol", efforts: ["low", "high"], defaultEffort: "high", selectable: false },
      { id: "gpt-5.7-sol", efforts: ["low", "high"], defaultEffort: "high", selectable: true },
    ],
    defaultModel: "gpt-5.7-sol",
  };
  const r = resolveClosestModel("gpt-5.6-sol", "high", caps);
  assert.equal(r.changed, true);
  assert.equal(r.model, "gpt-5.7-sol");
  assert.equal(r.effort, "high");
});

test("resolveClosestModel follows provider migration targets before family heuristics", () => {
  const caps = {
    models: [
      { id: "gpt-5.6-sol", efforts: ["low", "medium", "high"], defaultEffort: "low" },
      { id: "gpt-5.6-terra", efforts: ["low", "medium", "high"], defaultEffort: "medium" },
    ],
    defaultModel: "gpt-5.6-sol",
    modelMigrations: { "gpt-5.4": "gpt-5.6-terra" },
  };
  const r = resolveClosestModel("gpt-5.4", "high", caps);
  assert.equal(r.changed, true);
  assert.equal(r.model, "gpt-5.6-terra", "provider migration beats the generic newest-family fallback");
  assert.equal(r.effort, "high");
});

test("resolveClosestModel: when the variant is gone it stays within the provider (never invents an id)", () => {
  const noSol = { models: NEW_CODEX.models.filter((m) => !m.id.includes("sol")), defaultModel: "gpt-5.7-terra" };
  const r = resolveClosestModel("gpt-5.6-sol", "high", noSol);
  assert.equal(r.changed, true);
  assert.ok(noSol.models.some((m) => m.id === r.model), "replacement is always a real id from the fresh catalog");
});

test("resolveClosestModel preserves Claude family aliases (they survive catalog churn)", () => {
  const claude = { models: [{ id: "opus", efforts: ["low", "high"], defaultEffort: "high" }, { id: "sonnet", efforts: ["low", "high"], defaultEffort: "high" }], defaultModel: "opus" };
  const r = resolveClosestModel("opus", "high", claude);
  assert.equal(r.changed, false);
  assert.equal(r.model, "opus");
});

// Regression: Claude subagents are async by default. The Agent/Task tool_result returns a handle in
// ~40ms, NOT the subagent's result. Treating it as terminal closed every background subagent seconds
// after spawn, so Trabalhos showed zero active work while the chat was still waiting on them.
// Payload below is the verbatim handshake + notification captured from session 220db30a.
const ASYNC_LAUNCH = [{ type: "text", text: "Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: a31a75e75a094e385 (internal ID - do not mention to user." }];
const NOTIFICATION = `<task-notification>
<task-id>a31a75e75a094e385</task-id>
<tool-use-id>toolu_013vHNuj2WnMBzfGyiXLRnJ9</tool-use-id>
<status>completed</status>
<summary>Agent "Neutralize nestjs backend+process skills" finished</summary>
<result>All 11 files done.</result>
</task-notification>`;

test("async subagent launch handshake is not mistaken for the subagent's result", () => {
  assert.equal(isClaudeAsyncAgentLaunch(ASYNC_LAUNCH), true);
  assert.equal(isClaudeAsyncAgentLaunch("Async agent launched successfully."), true);
  // A synchronous subagent returns its actual work — that one really is terminal.
  assert.equal(isClaudeAsyncAgentLaunch([{ type: "text", text: "Done. All 13 in-scope files reviewed." }]), false);
  // A sync subagent reporting ON agent code must not be mistaken for a launch handshake.
  assert.equal(isClaudeAsyncAgentLaunch([{ type: "text", text: "Renamed the agentId: field in agents.ts and updated 9 refs." }]), false);
  assert.equal(isClaudeAsyncAgentLaunch(""), false);
  assert.equal(isClaudeAsyncAgentLaunch(undefined), false);
});

test("task-notification resolves the async subagent under the SAME providerId used at spawn", () => {
  const [done] = parseClaudeTaskNotification(NOTIFICATION);
  // tool-use-id — not task-id — is the providerId the execution_spawn was registered under.
  assert.equal(done.providerId, "toolu_013vHNuj2WnMBzfGyiXLRnJ9");
  assert.equal(done.state, "succeeded");
  assert.equal(done.summary, 'Agent "Neutralize nestjs backend+process skills" finished');
});

test("task-notification maps every terminal status, and refuses to guess on the rest", () => {
  const at = (status: string) => parseClaudeTaskNotification(`<task-notification><tool-use-id>t1</tool-use-id><status>${status}</status></task-notification>`);
  assert.equal(at("completed")[0].state, "succeeded");
  assert.equal(at("failed")[0].state, "failed");
  assert.equal(at("stopped")[0].state, "cancelled");
  // Unknown/non-terminal status must leave the child running instead of closing it on a guess.
  assert.deepEqual(at("running"), []);
  assert.deepEqual(at(""), []);
  // No tool-use-id: the node is unaddressable, so it is dropped rather than mapped to the wrong child.
  assert.deepEqual(parseClaudeTaskNotification("<task-notification><task-id>a1</task-id><status>completed</status></task-notification>"), []);
});

test("plain assistant text is never parsed as a task-notification", () => {
  assert.deepEqual(parseClaudeTaskNotification("Faltam 2 agentes: nestjs data/deploy/security e os frontends."), []);
  assert.deepEqual(parseClaudeTaskNotification(undefined), []);
});

test("a batch of notifications in one injected turn closes each child independently", () => {
  const both = parseClaudeTaskNotification(`${NOTIFICATION}\n<task-notification><tool-use-id>toolu_02</tool-use-id><status>failed</status><summary>boom</summary></task-notification>`);
  assert.deepEqual(both.map((d) => [d.providerId, d.state]), [["toolu_013vHNuj2WnMBzfGyiXLRnJ9", "succeeded"], ["toolu_02", "failed"]]);
});

test("boundToolError poe teto no erro de ferramenta, preservando inicio E fim", async () => {
  const { boundToolError, TOOL_ERROR_MAX_CHARS } = await import("./agents.js");
  // Curto passa intacto — nenhum erro normal e afetado.
  assert.equal(boundToolError("falhou: arquivo nao encontrado"), "falhou: arquivo nao encontrado");
  assert.equal(boundToolError(undefined), undefined);
  assert.equal(boundToolError(null), undefined);

  // O caso medido em producao: 1,14 MB num unico tool_failed, gravado inline na mensagem e enviado
  // ao cliente a CADA carga de historico.
  const gigante = "INICIO-DO-ERRO" + "x".repeat(1_200_000) + "CAUSA-REAL-NO-FIM";
  const cortado = boundToolError(gigante)!;
  assert.ok(cortado.length < TOOL_ERROR_MAX_CHARS + 300, "cabe no teto (+ a marca de corte)");
  assert.ok(cortado.length < gigante.length / 100, "reduz em mais de 100x");
  assert.ok(cortado.startsWith("INICIO-DO-ERRO"), "mantem o comeco (tipo do erro)");
  assert.ok(cortado.endsWith("CAUSA-REAL-NO-FIM"), "mantem o fim — e onde costuma estar a causa");
  assert.match(cortado, /caracteres omitidos pelo Jarvis/, "o corte e declarado, nao silencioso");
});

test("withConfiguredModel: o modelo escolhido no config.toml nao some quando a CLI nao o publica", async () => {
  const { withConfiguredModel } = await import("./agents.js");
  // Caso real: config.toml pede gpt-6-astra, mas o catalogo da CLI 0.146.0 so vai ate gpt-5.6.
  const catalogo = [
    { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", efforts: ["low", "high"] },
    { id: "gpt-5.5", label: "GPT-5.5", efforts: ["low", "high"] },
  ];
  const com = withConfiguredModel(catalogo, "gpt-6-astra");
  assert.equal(com.length, 3);
  assert.equal(com[0].id, "gpt-6-astra", "entra PRIMEIRO — e a escolha declarada da pessoa");
  assert.equal(com[0].source, "config", "marcado como vindo do config, nao do provedor");
  assert.equal(com[0].effortsVerified, false, "esforcos nao confirmados pelo provedor");
  assert.equal(com[0].contextVerified, false);

  // Ja no catalogo: nada muda, e nao duplica.
  const semDup = withConfiguredModel(catalogo, "gpt-5.5");
  assert.equal(semDup, catalogo, "mesma referencia — sem copia desnecessaria");

  // Sem config: lista intacta.
  assert.equal(withConfiguredModel(catalogo, undefined), catalogo);

  // Catalogo vazio (CLI fora do ar) + config: sobra o configurado, que era o comportamento do catch.
  assert.deepEqual(withConfiguredModel([], "gpt-6-astra").map((m) => m.id), ["gpt-6-astra"]);
});

// --- fim de processo: `exit` manda, `close` é só um bônus -----------------------------------------
// Regressão do incidente de 2026-09-23 (sessão codex 6fda1c58): `close` só dispara quando o filho
// saiu E todo stdio herdado fechou. Três dev servers que o agente deixou de pé herdaram o pipe e
// seguraram a ponta de escrita; o turno ficou "rodando" por 2h15 depois de a resposta estar pronta,
// e foi descartado no fim. Estes testes fixam a regra nova: quem encerra o turno é o `exit`.

test("turno encerra no exit mesmo quando um neto segura o pipe e o close nunca vem", async () => {
  const handlers = new Map<string, (...a: any[]) => void>();
  const emitter = { on: (ev: string, fn: (...a: any[]) => void) => handlers.set(ev, fn) };
  let destroyed = 0;
  const p = { stdout: { destroy: () => { destroyed++; } }, stderr: { destroy: () => { destroyed++; } } };
  const seen: Array<{ code: number | null; drained: boolean }> = [];
  settleOnExit(p, emitter, (code, drained) => seen.push({ code, drained }), 5);

  handlers.get("exit")!(0);                                    // processo morreu...
  assert.deepEqual(seen, [], "não encerra na hora: ainda pode haver bytes no buffer do pipe");
  await new Promise((r) => setTimeout(r, 25));                 // ...e o `close` nunca chega
  assert.deepEqual(seen, [{ code: 0, drained: false }]);
  assert.equal(destroyed, 2, "solta a nossa ponta do pipe que o neto órfão mantinha aberta");
});

test("close normal continua ganhando, e sem destruir o stdio no meio da drenagem", async () => {
  const handlers = new Map<string, (...a: any[]) => void>();
  const emitter = { on: (ev: string, fn: (...a: any[]) => void) => handlers.set(ev, fn) };
  let destroyed = 0;
  const p = { stdout: { destroy: () => { destroyed++; } }, stderr: { destroy: () => { destroyed++; } } };
  const seen: Array<{ code: number | null; drained: boolean }> = [];
  settleOnExit(p, emitter, (code, drained) => seen.push({ code, drained }), 5);

  handlers.get("exit")!(3);
  handlers.get("close")!(3);                                   // chegou dentro da janela
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(seen, [{ code: 3, drained: true }], "encerra UMA vez só, pelo caminho drenado");
  assert.equal(destroyed, 0, "o pipe fechou sozinho — nada a destruir");
});

// --- limites do plano quando NADA esta rodando ---------------------------------------------------
// Sintoma relatado em 2026-09-25: o painel so mostrava os limites do Codex enquanto um turno estava
// em andamento. Causa: `rate_limits` vive ao lado de `info` (nao dentro), e o parser exigia `info`;
// somado a isso, os one-shots que o Jarvis dispara o tempo todo (titulo, roteamento) ficam no topo
// por mtime e publicam `rate_limits` com todas as janelas NULAS.

test("rate_limits e lido mesmo na linha de token_count que nao traz `info`", () => {
  const t = codexTelemetryFromLines([
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", rate_limits: { plan_type: "pro", primary: { used_percent: 40, window_minutes: 300 } } } }),
  ]);
  assert.equal(codexHasPlanWindow(t?.rateLimits), true);
  assert.equal(codexPlanUsage(t)!.fiveHour!.pct, 40);
});

test("token_count COM info continua preenchendo total/janela de contexto", () => {
  const t = codexTelemetryFromLines([
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 7 }, model_context_window: 200000 }, rate_limits: { primary: { used_percent: 1, window_minutes: 300 } } } }),
  ]);
  assert.equal(t!.total!.input_tokens, 7);
  assert.equal(t!.contextWindow, 200000);
  assert.equal(codexHasPlanWindow(t!.rateLimits), true);
});

test("janelas todas nulas sao AUSENCIA de dado, nao plano zerado", () => {
  // Exatamente o que os one-shots de `~/.jarvis/oneshot` gravam.
  const t = codexTelemetryFromLines([
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", rate_limits: { limit_id: "premium", primary: null, secondary: null, plan_type: null } } }),
  ]);
  assert.equal(codexHasPlanWindow(t?.rateLimits), false, "nao serve para o painel");
  assert.equal(codexPlanUsage(t), null, "devolver objeto vazio faria a UI dizer 'sem dados' como se o provedor tivesse respondido");
  assert.equal(codexHasPlanWindow(undefined), false);
  assert.equal(codexHasPlanWindow({}), false);
});

/* INC-02 (2026-10-14): o Hub congelava e o watchdog o matava, deixando 13-15 min de queda. Um dos
 * caminhos era este: `codexRolloutAppend` com `offset = 0` (primeira adocao do arquivo no turno) ou
 * com o arquivo encolhido pedia o rollout INTEIRO numa alocacao unica. Havia um rollout de 718 MB
 * aqui: alocava 718 MB, falhava na decodificacao, jogava fora e repetia a cada tique de 750 ms. */
test("codexRolloutAppend limita UMA leitura e nunca materializa o rollout inteiro", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-rollout-"));
  const file = join(dir, "rollout.jsonl");

  // Arquivo maior que o teto, lido "do zero" — o caso que travava o event loop.
  const line = JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }) + "\n";
  const big = line.repeat(Math.ceil((ROLLOUT_APPEND_MAX_BYTES + 1_000_000) / line.length));
  writeFileSync(file, big);

  const first = codexRolloutAppend(file, 0);
  assert.ok(first.data.length <= ROLLOUT_APPEND_MAX_BYTES, `leu ${first.data.length} B; o teto e ${ROLLOUT_APPEND_MAX_BYTES} B`);
  assert.ok(first.data.length > 0, "a janela tem de trazer a cauda, nao vir vazia");
  assert.equal(first.reset, true, "saltar a janela precisa sinalizar reset: o chamador tem de descartar o carry e recriar o StringDecoder");
  assert.equal(first.offset, Buffer.byteLength(big), "mesmo saltando, o offset termina no fim do arquivo");

  // A partir dai volta a ser incremental: so o que foi anexado, sem reset.
  const appended = JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }) + "\n";
  appendFileSync(file, appended);
  const second = codexRolloutAppend(file, first.offset);
  assert.equal(second.data.toString("utf8"), appended, "a leitura seguinte traz exatamente o apendice");
  assert.equal(second.reset, false, "apendice normal nao e reset");

  // Arquivo que encolhe (rotacionado) continua sendo reparseado do zero — e tambem limitado.
  truncateSync(file, 10);
  const shrunk = codexRolloutAppend(file, 10_000_000);
  assert.equal(shrunk.reset, true, "arquivo menor que o offset = reset");
  assert.equal(shrunk.data.length, 10, "le o arquivo encolhido inteiro quando ele cabe no teto");

  // Arquivo pequeno segue com o comportamento antigo, byte a byte.
  const small = join(dir, "small.jsonl");
  writeFileSync(small, appended);
  const whole = codexRolloutAppend(small, 0);
  assert.equal(whole.data.toString("utf8"), appended, "arquivo pequeno e lido inteiro, sem salto");
  assert.equal(whole.reset, false, "sem salto, sem reset");
});

/* INC-03 (2026-10-17): o ledger desta instalacao guardou "contexto" de 46 M, 905 M e 1,15 BILHAO de
 * tokens, sempre com a janela nula — era o total CUMULATIVO vazando para o campo de contexto por
 * turno, porque sem telemetria o codigo caia no delta e, sem snapshot anterior, o delta E o total.
 * Alem de mentir no medidor, inflava `promptTokens` e cobrava sobretaxa de contexto longo. */
test("contexto do codex nunca reporta total cumulativo nem valor acima da janela", () => {
  // Medida real: passa.
  assert.equal(codexPromptTokens({ last: { input_tokens: 107928 }, contextWindow: 258400 } as any), 107928);
  // Perto do limite ainda passa (provedor as vezes reporta um pouco acima).
  assert.equal(codexPromptTokens({ last: { input_tokens: 262000 }, contextWindow: 258400 } as any), 262000);
  // Absurdo em relacao a janela: descartado.
  assert.equal(codexPromptTokens({ last: { input_tokens: 1157311016 }, contextWindow: 258400 } as any), undefined,
    "1,15 bilhao numa janela de 258 mil e total cumulativo, nao contexto");
  // Sem telemetria nenhuma: nao inventa.
  assert.equal(codexPromptTokens(undefined), undefined);
  assert.equal(codexPromptTokens({} as any), undefined);
  assert.equal(codexPromptTokens({ contextWindow: 258400 } as any), undefined, "janela sem medida nao vira contexto");

  // O caminho que produzia o lixo: sem telemetria E sem snapshot anterior, `input_tokens` do turno
  // e o total acumulado da thread. Antes isso virava contextTokens; agora fica sem dado.
  const semTelemetria = codexUsage({ input_tokens: 1157311016, output_tokens: 240 }, undefined, undefined, {} as any);
  assert.equal(semTelemetria?.contextTokens, undefined, "sem telemetria nao se declara contexto");
  assert.equal(semTelemetria?.contextWindowTokens, undefined);
  assert.equal(semTelemetria?.inputTokens, 1157311016, "o total cumulativo segue valendo como inputTokens do turno");

  // Com telemetria boa, o medidor recebe a medida real (e nao o delta).
  const comTelemetria = codexUsage(
    { input_tokens: 1157311016, output_tokens: 240 }, undefined,
    { last: { input_tokens: 107928 }, contextWindow: 258400, model: "gpt-6-astra" } as any, {} as any,
  );
  assert.equal(comTelemetria?.contextTokens, 107928);
  assert.equal(comTelemetria?.contextWindowTokens, 258400);
});

/* INC-03: o historico gerenciado cortava em 16.000 chars FIXOS (≈6% de uma janela de 258k tokens) e,
 * pior, descartava os turnos antigos em SILENCIO — o modelo recebia um comeco de conversa que nao era
 * o comeco e respondia como se fosse tudo. */
test("historico gerenciado usa a janela real do modelo e avisa o que foi cortado", () => {
  // Sem janela conhecida (o caso comum: CLI com autoModel) => teto fixo conservador.
  assert.equal(managedHistoryBudgetChars(undefined), 16_000, "sem janela, mantem o teto historico");
  assert.equal(managedHistoryBudgetChars(0), 16_000);
  // Janela grande => orcamento cresce (258.400 * 3,5 * 0,35).
  const grande = managedHistoryBudgetChars(258_400);
  assert.ok(grande > 300_000, `esperado >300k chars numa janela de 258k tokens, veio ${grande}`);
  // Janela minuscula/mal reportada nunca encolhe abaixo do teto fixo.
  assert.equal(managedHistoryBudgetChars(100), 16_000, "janela absurdamente pequena nao reduz o orcamento");

  // Nada cortado: cabecalho normal, sem aviso.
  const curto = withManagedHistory("agora", [{ role: "user", text: "oi" }, { role: "assistant", text: "ola" }]);
  assert.ok(!/omitidos/.test(curto), "sem corte nao deve haver aviso");
  assert.ok(curto.includes("Usuário: oi") && curto.includes("Mensagem atual do usuário:\nagora"));

  // Com corte: o aviso tem de dizer QUANTOS turnos faltam.
  const muitos = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `turno ${i} ` + "x".repeat(400) }));
  const cortado = withManagedHistory("agora", muitos, 2_000);
  const m = cortado.match(/os (\d+) turno\(s\) mais antigos foram omitidos/);
  assert.ok(m, "corte silencioso: o aviso de turnos omitidos nao apareceu");
  assert.ok(Number(m![1]) > 0 && Number(m![1]) < 40, `contagem de omitidos implausivel: ${m![1]}`);
  assert.ok(cortado.includes("turno 39"), "a cauda recente tem de sobreviver ao corte");

  // A janela grande faz CABER o que o teto fixo cortaria — o ganho concreto da mudanca.
  const comJanela = withManagedHistory("agora", muitos, { contextWindowTokens: 258_400 });
  assert.ok(!/omitidos/.test(comJanela), "com janela de 258k tokens esse historico inteiro deveria caber");
  assert.ok(comJanela.includes("turno 0"), "o turno mais antigo deveria sobreviver com a janela real");
});

/* INC-03: compactar NAO encolhe o rollout do Codex — ele e append-only, e o arquivo desta instalacao
 * chegou a 733 MB COM 101 eventos `compacted` dentro. O que encolhe e aposentar a thread. */
test("thread do codex e aposentada so quando o rollout passa do teto", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-rotate-"));
  const pequeno = join(dir, "pequeno.jsonl");
  const grande = join(dir, "grande.jsonl");
  writeFileSync(pequeno, "x".repeat(1024));
  writeFileSync(grande, "x".repeat(4096));
  const resolve = (id: string) => (id === "t-grande" ? grande : id === "t-pequeno" ? pequeno : undefined);

  assert.equal(codexRolloutOversized("t-pequeno", 2048, resolve), undefined, "abaixo do teto nao aposenta");
  const ret = codexRolloutOversized("t-grande", 2048, resolve);
  assert.ok(ret, "acima do teto tem de aposentar");
  assert.equal(ret!.size, 4096);
  assert.equal(ret!.path, grande);

  // Casos em que NAO se pode aposentar: sem thread, ou thread cujo rollout nem existe mais.
  assert.equal(codexRolloutOversized(undefined, 2048, resolve), undefined);
  assert.equal(codexRolloutOversized("inexistente", 2048, resolve), undefined, "sem arquivo resolvido nao se decide nada");

  // O teto real nunca pode ser baixo o bastante para aposentar conversa grande e saudavel: um
  // transcript de 28 MB (o maior do Claude nesta maquina) tem de passar longe.
  const normal = join(dir, "normal.jsonl");
  writeFileSync(normal, "x".repeat(4096));
  assert.equal(codexRolloutOversized("t-normal", 256 * 1024 * 1024, () => normal), undefined,
    "o teto de producao nao pode aposentar rollout de tamanho normal");
});


// --- JRV-42: o primeiro `result` do processo nao e o fim do turno -------------------------------
// Incidente de 2026-10-19 (sessao 9ecf7b75, nativa 6b84d10e): no `--resume`, o claude processou o
// aviso velho de 3 shells em segundo plano como um mini-turno sem API, emitiu um `result` vazio em
// 35 ms e so entao rodou o pedido real. O adaptador tomou aquele `result` como fim, armou o prazo de
// 60 s e derrubou o trabalho real (`ms: 60939`, `outputTokens: 0`). As linhas abaixo tem a forma
// exata das medidas no CLI 2.1.288 (reproducao com haiku), reduzidas aos campos que importam.

const SID = "a41bbae9-4e67-4713-bb72-7b56851a3572";
const cl = {
  init: () => ({ type: "system", subtype: "init", session_id: SID }),
  staleNotice: (taskId: string) => ({ type: "system", subtype: "task_notification", task_id: taskId, tool_use_id: `toolu_old_${taskId}`, status: "stopped", output_file: "", summary: "Background shell command didn't finish before the previous session ended" }),
  // Mini-turno do aviso velho: zero chamadas de API; o total e o custo RESTAURADO da sessao.
  miniResult: (restored: number) => ({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 0, duration_ms: 45, total_cost_usd: restored, origin: { kind: "task-notification" }, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, iterations: [] }, session_id: SID }),
  say: (text: string, ctx = [10, 715, 30601], model = "claude-haiku-4-5-20251001") => ({ type: "assistant", message: { model, content: [{ type: "text", text }], usage: { input_tokens: ctx[0], cache_creation_input_tokens: ctx[1], cache_read_input_tokens: ctx[2], output_tokens: 2 } } }),
  tool: (id: string, name = "Bash") => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input: { command: "echo hi" } }], usage: { input_tokens: 10, cache_creation_input_tokens: 715, cache_read_input_tokens: 30601, output_tokens: 6 } } }),
  toolResult: (id: string) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "hi" }] } }),
  result: (text: string, total: number, out: number, last = [8, 1002, 31316], extra: Record<string, unknown> = {}) => ({ type: "result", subtype: "success", is_error: false, result: text, num_turns: 2, total_cost_usd: total, usage: { input_tokens: 18, cache_creation_input_tokens: 1717, cache_read_input_tokens: 61917, output_tokens: out, iterations: [{ input_tokens: last[0], cache_creation_input_tokens: last[1], cache_read_input_tokens: last[2], output_tokens: out }] }, session_id: SID, ...extra }),
  // Teardown que a CLI emite DEPOIS do `result` final (medido): nao e turno novo.
  teardown: () => [
    { type: "system", subtype: "background_tasks_changed", tasks: [] },
    { type: "system", subtype: "task_updated", task_id: "brfhwhvbn", patch: { status: "killed" } },
    { type: "system", subtype: "task_notification", task_id: "brfhwhvbn", tool_use_id: "toolu_bg", status: "stopped", summary: "sleep 200" },
  ],
};

async function feed(lines: unknown[]) {
  const { ClaudeTurnAccount } = await import("./agents.js");
  const account = new ClaudeTurnAccount();
  const signals = lines.map((o) => account.line(o));
  return { account, signals };
}

test("JRV-42 (a) turno normal: so o `result` anuncia o fim; texto, contexto e custo do turno", async () => {
  const { account, signals } = await feed([cl.init(), cl.tool("t1"), cl.toolResult("t1"), cl.say("PONG", [8, 1002, 31316]), cl.result("PONG", 0.0419112, 150), ...cl.teardown()]);
  assert.deepEqual(signals.map((s) => s ?? null), [null, null, null, null, true, null, null, null], "teardown depois do result nao desarma o prazo");
  assert.equal(account.text, "PONG");
  assert.equal(account.contextTokens, 8 + 1002 + 31316, "contexto = ultima chamada, nao a soma do turno");
  assert.equal(account.outputTokens, 150);
  assert.equal(account.restoredCost, undefined, "sem mini-turno o processo nao revela a base");
  assert.equal(Number(account.turnCost(0.0315175)!.toFixed(7)), 0.0103937, "custo = total acumulado - restaurado do transcript");
  assert.equal(account.turnCost(undefined), undefined, "sem base, custo desconhecido — nunca o acumulado");
});

test("JRV-42 (b) mini-turno do aviso velho + turno real: o real NAO e derrubado e e ele que conta", async () => {
  const { account, signals } = await feed([
    cl.staleNotice("bko6jw51a"), cl.init(), cl.miniResult(36.9696274),
    cl.init(), cl.say("Vou seguir para a F2.", [6, 2_000, 300_000]), cl.tool("t1"), cl.toolResult("t1"), cl.say(" Feito."), cl.result("Feito.", 37.2196274, 5288),
  ]);
  assert.equal(signals[2], true, "o mini-turno anuncia fim...");
  assert.equal(signals[3], "resumed", "...e o init seguinte DESARMA o prazo: e outro turno no mesmo processo");
  assert.equal(signals.filter((s) => s === "resumed").length, 1);
  assert.equal(signals.at(-1), true, "o result real anuncia o fim de verdade");
  assert.equal(account.text, "Vou seguir para a F2. Feito.", "o texto e o do pedido real");
  assert.equal(account.restoredCost, 36.9696274, "o mini-turno revela o custo restaurado pela CLI");
  assert.equal(Number(account.turnCost(1)!.toFixed(7)), 0.25, "base do processo vence a do transcript; custo e do turno, nao os 36,97 acumulados");
  assert.equal(account.outputTokens, 5288);
});

test("JRV-42 (c) so o mini-turno e a CLI sai: anuncia fim (sem pendurar) e nao inventa texto nem custo", async () => {
  const { account, signals } = await feed([cl.staleNotice("x"), cl.init(), cl.miniResult(1.5)]);
  assert.equal(signals.at(-1), true);
  assert.equal(account.text, "");
  assert.equal(account.turnCost(), 0, "turno sem chamada de API custa zero");
  assert.equal(account.contextTokens, undefined, "uso zerado nao vira leitura de contexto");
});

test("JRV-42 (e) varios avisos velhos (varios mini-turnos) antes do pedido real", async () => {
  const { account, signals } = await feed([
    cl.staleNotice("a"), cl.staleNotice("b"), cl.init(), cl.miniResult(2),
    cl.staleNotice("c"), cl.init(), cl.miniResult(2),
    cl.init(), cl.say("ok"), cl.result("ok", 2.1, 40),
  ]);
  assert.deepEqual(signals.map((s) => s ?? null), [null, null, null, true, null, "resumed", true, "resumed", null, true]);
  assert.equal(account.text, "ok");
  assert.equal(Number(account.turnCost()!.toFixed(6)), 0.1);
  assert.equal(account.results, 3);
});

test("JRV-42: varios turnos da CLI no mesmo processo (subagente em segundo plano) somam texto e saida", async () => {
  // Medido: com subagente em segundo plano a CLI espera ele terminar, roda outro turno para o aviso
  // e solta os dois `result` juntos no fim (result_index 0 e 1).
  const { account } = await feed([cl.init(), cl.say("LAUNCHED"), cl.init(), cl.say("Agente terminou."), cl.result("LAUNCHED", 0.05, 575), cl.result("Agente terminou.", 0.0648, 153)]);
  assert.equal(account.text, "LAUNCHED\n\nAgente terminou.", "cada turno da CLI vira um paragrafo, nada some");
  assert.equal(account.outputTokens, 575 + 153);
  assert.equal(Number(account.turnCost(0)!.toFixed(4)), 0.0648, "o ULTIMO result da o total");
});

test("JRV-42: mensagem sintetica (limite de sessao) nao troca o contexto pela soma do turno", async () => {
  // Turno 3 da sessao 9ecf7b75: terminou num "You've hit your session limit" sintetico com uso
  // zerado, e o contexto caiu para a soma do turno (1.967.066 tokens) — mais que a janela inteira.
  const synthetic = { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit" }], usage: { input_tokens: 0, output_tokens: 0 } } };
  const sum = { type: "result", subtype: "success", is_error: false, result: "You've hit your session limit", num_turns: 40, total_cost_usd: 15.67, usage: { input_tokens: 66, cache_creation_input_tokens: 67_000, cache_read_input_tokens: 1_900_000, output_tokens: 20776, iterations: [] } };
  const { account } = await feed([cl.init(), cl.say("trabalhando", [5, 1_000, 299_000]), synthetic, sum]);
  assert.equal(account.contextTokens, 300_005);
  assert.match(account.text, /session limit/, "o aviso sintetico continua visivel");
});

test("JRV-42: 'No response requested.' sintetico nao vira texto da resposta", async () => {
  const noResponse = { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "No response requested." }], usage: { input_tokens: 0, output_tokens: 0 } } };
  const { account } = await feed([cl.init(), noResponse, cl.say("Resposta real."), cl.result("Resposta real.", 1, 3)]);
  assert.equal(account.text, "Resposta real.");
});

test("JRV-42: erro de um turno anterior nao condena o turno seguinte que deu certo", async () => {
  const { account } = await feed([cl.init(), { ...cl.miniResult(1), is_error: true, result: "API Error: overloaded" }, cl.init(), cl.say("ok"), cl.result("ok", 1.1, 3)]);
  assert.equal(account.error, "");
  assert.equal(account.text, "ok");
});

test("claudeTurnCost: diferenca do acumulado; total que cai e sessao recomecada; sem base, sem custo", async () => {
  const { claudeTurnCost } = await import("./agents.js");
  assert.equal(claudeTurnCost(36.9696274, 36.9696274), 0);
  assert.equal(Number(claudeTurnCost(0.046193, 0.0419112)!.toFixed(7)), 0.0042818);
  assert.equal(claudeTurnCost(0.5, 36.97), 0.5);
  assert.equal(claudeTurnCost(0.5, undefined), undefined);
  assert.equal(claudeTurnCost(undefined, 0), undefined);
});

test("parseClaudeSystemTaskNotification: terminal do subagente na forma do stream-json", async () => {
  const { parseClaudeSystemTaskNotification } = await import("./agents.js");
  assert.deepEqual(parseClaudeSystemTaskNotification({ type: "system", subtype: "task_notification", tool_use_id: "toolu_1", status: "completed", summary: "ok" }), { providerId: "toolu_1", state: "succeeded", summary: "ok" });
  assert.equal(parseClaudeSystemTaskNotification({ type: "system", subtype: "task_notification", tool_use_id: "toolu_1", status: "stopped" })!.state, "cancelled");
  assert.equal(parseClaudeSystemTaskNotification({ type: "system", subtype: "task_notification", status: "completed" }), undefined, "sem tool_use_id nao ha no a enderecar");
  assert.equal(parseClaudeSystemTaskNotification({ type: "system", subtype: "task_progress", tool_use_id: "toolu_1" }), undefined);
});

test("claudeRestoredCostFromFile: o ULTIMO cost-state, lido de tras para frente em blocos", async () => {
  const { claudeRestoredCostFromFile } = await import("./agents.js");
  const dir = mkdtempSync(join(tmpdir(), "jarvis-cost-state-"));
  const f = join(dir, `${SID}.jsonl`);
  const filler = (n: number) => Array.from({ length: n }, (_, i) => JSON.stringify({ type: "user", message: { content: `linha ${i} ` + "x".repeat(50) } })).join("\n");
  const cost = (v: number, sessionId = SID) => JSON.stringify({ type: "cost-state", sessionId, totalCostUSD: v, modelUsage: {} });
  // Processo derrubado depois do ultimo cost-state: ele fica LONGE do fim — bloco de 64 B obriga a
  // costurar linhas entre blocos.
  writeFileSync(f, [cost(1.47), filler(5), cost(4.99), filler(40), cost(99, "outra-sessao"), filler(3)].join("\n") + "\n");
  assert.equal(await claudeRestoredCostFromFile(f, SID, 32 * 1024 * 1024, 64), 4.99);
  const none = join(dir, "none.jsonl"); writeFileSync(none, filler(3) + "\n");
  assert.equal(await claudeRestoredCostFromFile(none, SID, 1024 * 1024, 64), 0, "arquivo inteiro sem cost-state: a CLI comeca do zero");
  assert.equal(await claudeRestoredCostFromFile(f, SID, 128, 64), undefined, "teto atingido antes de achar: base desconhecida");
  assert.equal(await claudeRestoredCostFromFile(join(dir, "nao-existe.jsonl"), SID), undefined);
});

test("claudeRestoredCost acha o transcript pelo nome que a CLI da ao cwd, e procura se o cwd veio grafado diferente", async () => {
  const { claudeRestoredCost, claudeProjectDirName } = await import("./agents.js");
  assert.equal(claudeProjectDirName("C:\\Users\\Jonathan\\AppData\\Local\\Temp\\jrv42\\cwd"), "C--Users-Jonathan-AppData-Local-Temp-jrv42-cwd");
  const projects = mkdtempSync(join(tmpdir(), "jarvis-projects-"));
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(projects, claudeProjectDirName("C:\\w\\proj")));
  writeFileSync(join(projects, claudeProjectDirName("C:\\w\\proj"), `${SID}.jsonl`), JSON.stringify({ type: "cost-state", sessionId: SID, totalCostUSD: 3.5 }) + "\n");
  assert.equal(await claudeRestoredCost("C:\\w\\proj", SID, projects), 3.5);
  assert.equal(await claudeRestoredCost("/outro/caminho", SID, projects), 3.5, "fallback: procura <id>.jsonl nos projetos");
  assert.equal(await claudeRestoredCost("C:\\w\\proj", "00000000-0000-0000-0000-000000000000", projects), undefined);
});

// runStream com processo REAL: o prazo de verdade, encurtado para 300 ms.
const nodeScript = (body: string) => [process.execPath, ["-e", body]] as const;
const emit = (o: unknown) => `process.stdout.write(${JSON.stringify(JSON.stringify(o) + "\n")});`;

async function runClaudeLike(body: string, graceMs = 300) {
  const { runStream, ClaudeTurnAccount } = await import("./agents.js");
  const account = new ClaudeTurnAccount();
  const [cmd, args] = nodeScript(body);
  const t0 = Date.now();
  const out = await runStream(cmd, [...args], tmpdir(), "", (line) => { try { return account.line(JSON.parse(line)); } catch { return; } }, undefined, graceMs);
  return { out, account, ms: Date.now() - t0 };
}

test("JRV-42 (b) processo real: mini-turno + turno real mais longo que o prazo NAO e derrubado", async () => {
  const { out, account, ms } = await runClaudeLike(
    emit(cl.staleNotice("a")) + emit(cl.init()) + emit(cl.miniResult(36.97)) + emit(cl.init())
    + `setTimeout(() => { ${emit(cl.say("resposta real"))}${emit(cl.result("resposta real", 37.0, 7))} setTimeout(() => process.exit(0), 20); }, 900);`,
  );
  assert.ok(ms >= 900, `o turno real correu inteiro (${ms} ms), muito alem do prazo de 300 ms`);
  assert.match(out, /resposta real/);
  assert.equal(account.text, "resposta real");
  assert.equal(Number(account.turnCost()!.toFixed(2)), 0.03);
});

test("JRV-42 (c) processo real: so o mini-turno e a CLI sai sozinha — resolve na hora, sem pendurar", async () => {
  const { account, ms } = await runClaudeLike(emit(cl.init()) + emit(cl.miniResult(1)) + "setTimeout(() => process.exit(0), 20);", 5_000);
  assert.ok(ms < 4_000, `resolveu pelo exit, sem esperar o prazo (${ms} ms)`);
  assert.equal(account.results, 1);
});

test("JRV-42 (d) processo real: depois do result REAL, CLI pendurada com neto no pipe ainda e derrubada (9c4222e)", async () => {
  // O neto herda o stdout e se mataria sozinho em 15 s — rede de seguranca para nao deixar orfao.
  const grandchild = `require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: ["ignore", "inherit", "inherit"] });`;
  const { out, account, ms } = await runClaudeLike(grandchild + emit(cl.init()) + emit(cl.say("pronto")) + emit(cl.result("pronto", 1, 1)) + "setInterval(() => {}, 1000);");
  assert.ok(ms < 10_000, `derrubado pelo prazo, nao pendurado (${ms} ms)`);
  assert.match(out, /pronto/, "a resposta que ja tinha chegado e entregue, nao descartada");
  assert.equal(account.text, "pronto");
});
