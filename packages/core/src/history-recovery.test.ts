import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "jarvis-history-recovery-"));
process.env.JARVIS_HOME = root;
process.env.JARVIS_CODEX_DIR = join(root, "codex");
process.env.JARVIS_CLAUDE_DIR = join(root, "claude");
process.env.JARVIS_TRANSCRIPT_READ_CAP_BYTES = String(4 * 1024 * 1024);
mkdirSync(process.env.JARVIS_CODEX_DIR, { recursive: true });
mkdirSync(join(process.env.JARVIS_CLAUDE_DIR, "repo"), { recursive: true });
const { nativeHistory, nativeHistoryForRecovery } = await import("./native.js");
const { recoverSessionHistory, missingNativeReplies, nativeRecoveryReplacements, nativeReplyForUser } = await import("./history-recovery.js");
const { Store } = await import("./store.js");
const { ExecutionStore } = await import("./execution-store.js");
const { ExecutionTracker } = await import("./execution-tracker.js");
const { createEventSequencer } = await import("@jarvis/protocol");
const { createAgentEventBridge } = await import("./agents.js");
const base = Date.parse("2026-11-04T12:00:00Z");
const iso = (offset: number) => new Date(base + offset).toISOString();
const codex = (offset: number, type: string, payload: object) => ({ timestamp: iso(offset), type, payload });
const msg = (offset: number, role: string, content: string) => codex(offset, "response_item", { type: "message", role, content });
const edge = (offset: number, type: string) => codex(offset, "event_msg", { type });
const jsonl = (rows: object[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

test("a single interrupted Codex turn larger than the tail cap is recovered in full, with event-loop yields", async () => {
  const path = join(process.env.JARVIS_CODEX_DIR!, "rollout-long.jsonl");
  writeFileSync(path, jsonl([msg(1, "user", "Continue"), edge(2, "task_started"), msg(3, "assistant", "INÍCIO preservado. ")]));
  const padding = JSON.stringify({ type: "ignored", payload: "x".repeat(8192) }) + "\n";
  for (let i = 0; i < 550; i++) appendFileSync(path, padding);
  appendFileSync(path, jsonl([msg(4, "assistant", "FIM preservado."), edge(5, "turn_aborted")]));
  const tail = nativeHistory("codex:long");
  assert.equal(tail?.truncated, true);
  assert.equal(tail?.messages.some((m) => m.role === "user"), false);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  const full = await nativeHistoryForRecovery("codex:long");
  clearInterval(timer);
  assert.ok(ticks > 1, "streaming must let timers/health checks run");
  assert.equal(full?.truncated, false);
  assert.match(full!.messages[1].text, /INÍCIO.*FIM/);
  assert.equal(full!.messages[1].completion, "interrupted");
  assert.equal(nativeHistory("codex:long"), full, "normal opens reuse the full cached projection");
  appendFileSync(path, jsonl([{ type: "ignored" }])); // invalidate the full cache before Store recovery
  assert.equal(nativeHistory("codex:long")?.messages.some((m) => m.role === "user"), false);
  const dir = join(root, "store-long");
  const store = new Store({ agent: "codex", cwd: root }, dir);
  store.add("s", { role: "user", text: "Continue", ts: base, agent: "codex" });
  store.add("s", { role: "system", text: "Conexão encerrada", ts: base + 1 });
  const input = { store, sessionId: "s", nativeKey: "codex:long", isBusy: () => false };
  assert.equal(await recoverSessionHistory(input), 1);
  assert.equal(store.history("s")[2].interrupted, true);
  store.add("s", { role: "user", text: "Próxima pergunta", ts: base + 100 });
  const reloaded = new Store({ agent: "codex", cwd: root }, dir);
  assert.equal(await recoverSessionHistory({ ...input, store: reloaded }), 0);
  assert.equal(reloaded.history("s").length, 4);
  assert.match(reloaded.history("s")[2].text, /INÍCIO.*FIM/);
  assert.ok(readFileSync(join(dir, "sessions", "s.jsonl.bak"), "utf8").includes("Continue"));
});

test("Claude compaction and meta users do not split the turn; sidechain text is never the root answer", async () => {
  const path = join(process.env.JARVIS_CLAUDE_DIR!, "repo", "claude-recovery.jsonl");
  writeFileSync(path, jsonl([
    { type: "user", timestamp: iso(1), message: { content: "Valide tudo por favor" } },
    { type: "assistant", timestamp: iso(2), message: { content: [{ type: "text", text: "Analisando. " }] } },
    { type: "user", timestamp: iso(3), isCompactSummary: true, message: { content: "This session is being continued…" } },
    { type: "user", timestamp: iso(4), isMeta: true, message: { content: "Provider control message" } },
    { type: "assistant", timestamp: iso(5), isSidechain: true, message: { stop_reason: "end_turn", content: [{ type: "text", text: "child answer" }] } },
    { type: "assistant", timestamp: iso(6), message: { stop_reason: "end_turn", content: [{ type: "text", text: "Validado." }] } },
    { type: "user", timestamp: iso(100), message: { content: "Agora leia os arquivos" } },
    { type: "assistant", timestamp: iso(101), message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "r", name: "Read", input: { file_path: "/repo/x.ts" } }] } },
  ]));
  const h = await nativeHistoryForRecovery("claude:claude-recovery");
  assert.deepEqual(h!.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(h!.messages[1].text, "Analisando.Validado.");
  assert.equal(h!.messages[1].completion, "completed");
  assert.equal(h!.messages[3].completion, undefined, "tool use is not completion");
  const bounded = nativeReplyForUser({ role: "user", text: "Valide tudo por favor", ts: base }, base + 4, h!.messages);
  assert.equal(bounded?.text, "Analisando.", "a later stored user boundary excludes text beyond it even after native compaction grouping");
  assert.equal(bounded?.completion, undefined);
  const missing = missingNativeReplies([
    { role: "user", text: "Valide tudo por favor", ts: base },
    { role: "user", text: "Agora leia os arquivos", ts: base + 99 },
    { role: "user", text: "Outra pergunta", ts: base + 200 },
  ], h!.messages);
  assert.equal(missing.length, 2);
  assert.equal(missing[0].interrupted, false);
  assert.equal(missing[1].text, "");
  assert.equal(missing[1].interrupted, true);
  assert.equal((missing[1].activity![0] as any).path, "/repo/x.ts");
});

test("repeated short prompts, framework wrappers and a later reply cannot mix turns", () => {
  const stored = [
    { role: "user" as const, text: "Continue", ts: base },
    { role: "user" as const, text: "Continue", ts: base + 100 },
    { role: "assistant" as const, text: "existing final", ts: base + 200 },
  ];
  const native = [
    { role: "user" as const, text: "Instruções universais do Framework Jarvis\n…\n\nContinue", ts: base + 1 },
    { role: "assistant" as const, text: "partial first", ts: base + 2 },
    { role: "user" as const, text: "Continue", ts: base + 101 },
    { role: "assistant" as const, text: "second final", ts: base + 102, completion: "completed" as const },
  ];
  assert.deepEqual(missingNativeReplies(stored, native).map((m) => m.text), ["partial first"]);
  assert.deepEqual(missingNativeReplies(stored, native.slice(2)), [], "must not steal the later answer");
  assert.deepEqual(missingNativeReplies(stored, [{ ...native[0], text: "Unrelated context mentions Continue" }, native[1]]), []);
});

test("busy session, or a new message arriving during recovery, is never mutated", async () => {
  const store = new Store({ agent: "codex", cwd: root }, join(root, "busy"));
  store.add("s", { role: "user", text: "Continue", ts: base });
  const input = { store, sessionId: "s", nativeKey: "codex:long", isBusy: () => true };
  assert.equal(await recoverSessionHistory(input), 0);
  const recovering = recoverSessionHistory({ ...input, isBusy: () => false });
  store.add("s", { role: "user", text: "Concurrent message", ts: base + 100 });
  assert.equal(await recovering, 0);
  assert.equal(store.history("s").length, 2);
});

test("legacy tail-only projection is enriched, ordinary replies stay untouched, and later completion upgrades a partial", () => {
  const user = { role: "user" as const, text: "Continue", ts: base };
  const old = { role: "assistant" as const, text: "tail", ts: base + 10, activity: [{ kind: "thinking" as const }] };
  const native = [{ ...user, ts: base + 1 }, { ...old, text: "beginning tail", ts: base + 2, completion: "interrupted" as const }];
  const changes = nativeRecoveryReplacements([user, old], native);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].after.interrupted, true);
  assert.equal(changes[0].after.restored, true);
  assert.equal(nativeRecoveryReplacements([user, changes[0].after], native).length, 0);
  assert.equal(nativeRecoveryReplacements([user, { ...old, usage: {} }], native).length, 0);
  assert.equal(nativeRecoveryReplacements([user, { ...old, activity: [{ kind: "completed" }] }], native).length, 0);
  const final = [{ ...user, ts: base + 1 }, { ...native[1], text: "beginning tail and final", completion: "completed" as const }];
  const upgrade = nativeRecoveryReplacements([user, changes[0].after], final);
  assert.equal(upgrade.length, 1);
  assert.equal(upgrade[0].after.interrupted, false);
});

test("orphaned journal work survives a new turn and Store reload even without a native transcript", async () => {
  const dir = join(root, "journal-store");
  const store = new Store({ agent: "mock", cwd: root }, dir);
  const executions = new ExecutionStore({ root: join(root, "executions") });
  const tracker = new ExecutionTracker(executions, { runnerId: "r", sessionId: "s", turnId: "t1", agent: "mock", cwd: root });
  const bridge = createAgentEventBridge("t1", createEventSequencer("t1", () => base + 1));
  tracker.handleAgentEvent(bridge.accepted()); tracker.handleAgentEvent(bridge.started());
  tracker.handleAgentEvent(bridge.provider({ kind: "text", text: "Trabalho antes da queda." }));
  store.add("s", { role: "user", text: "Continue", ts: base, contextManifest: { turnId: "t1" } as any });
  store.add("s", { role: "user", text: "Continue", ts: base + 100, contextManifest: { turnId: "t2" } as any });
  const input = { store, sessionId: "s", executions, isBusy: () => false };
  assert.equal(await recoverSessionHistory(input), 0, "a running provider must keep its live replay");
  executions.append(tracker.rootExecutionId, tracker.rootExecutionId, { kind: "state_changed", from: "running", to: "orphaned", reason: "process lost" });
  assert.equal(await recoverSessionHistory(input), 1);
  const reloaded = new Store({ agent: "mock", cwd: root }, dir);
  assert.deepEqual(reloaded.history("s").map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(reloaded.history("s")[1].text, "Trabalho antes da queda.");
  assert.equal(reloaded.history("s")[1].interrupted, true);
  assert.equal(await recoverSessionHistory({ ...input, store: reloaded }), 0);
});

test.after(() => rmSync(root, { recursive: true, force: true }));
