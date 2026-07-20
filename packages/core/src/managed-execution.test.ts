import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentRegistry, type AgentAdapter, type AgentReply, type OnEvent } from "./agents.js";
import { ExecutionStore } from "./execution-store.js";
import type { ManagedExecutionPlan } from "./execution-orchestrator.js";
import type { ManagedWorkspaceLease } from "./execution-worktree.js";
import { ManagedExecutionService, managedChildExecutionId, type ManagedHiddenSessionGateway } from "./managed-execution.js";

class FakeAdapter implements AgentAdapter {
  readonly name = "codex";
  availableValue = true;
  fail?: Error;
  cwd?: string;
  prompt?: string;
  replyText = "feito";
  toolDetail?: string;
  outsideToolPath = false;
  leaveChildRunning = false;
  constructor(private readonly progress = false) {}
  async capabilities() { return { models: [{ id: "gpt", efforts: ["low", "high"], defaultEffort: "low" }], defaultModel: "gpt" }; }
  async available() { return this.availableValue; }
  async send(_sessionId: string, text: string, cwd: string, _opts?: unknown, onEvent?: OnEvent): Promise<AgentReply> {
    this.cwd = cwd; this.prompt = text;
    if (this.fail) throw this.fail;
    onEvent?.({ kind: "tool", name: "Edit", summary: "Editando", detail: this.toolDetail, toolId: "edit-1", status: "completed", path: this.outsideToolPath ? resolve(cwd, "..", "outside", "secret.txt") : join(cwd, "src", "a.ts"), adds: 2, dels: 1 });
    if (this.progress) {
      onEvent?.({ kind: "execution_spawn", providerId: "native-child", node: { title: "Filho nativo" } });
      onEvent?.({ kind: "execution_activity", providerId: "native-child", event: { kind: "text", text: "progresso" } });
      const childUsage = { inputTokens: 3, outputTokens: 2, costUsd: 0.001, costKind: "estimated_api_equivalent" as const, source: "child fixture" };
      onEvent?.({ kind: "execution_usage", providerId: "native-child", usage: childUsage, measure: "cumulative", scope: "self" });
      onEvent?.({ kind: "execution_usage", providerId: "native-child", usage: childUsage, measure: "cumulative", scope: "self" });
      if (!this.leaveChildRunning) onEvent?.({ kind: "execution_state", providerId: "native-child", state: "succeeded", summary: "ok" });
    }
    return { text: this.replyText, usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01, costKind: "estimated_api_equivalent", source: "fixture", model: "gpt", effort: "high" } };
  }
}

class Sessions implements ManagedHiddenSessionGateway {
  created: Array<{ sessionId: string; agent: string; cwd: string }> = [];
  messages: Array<{ sessionId: string; role: string; text: string }> = [];
  async create(input: { idHint: string; agent: string; cwd: string }) {
    const sessionId = input.idHint;
    this.created.push({ sessionId, agent: input.agent, cwd: input.cwd }); return { sessionId };
  }
  append(sessionId: string, message: { role: "user" | "assistant" | "system"; text: string }) { this.messages.push({ sessionId, role: message.role, text: message.text }); }
}

const plan = (patch: Partial<ManagedExecutionPlan> = {}): ManagedExecutionPlan => ({
  rootExecutionId: "workflow-1", runnerId: "local",
  tasks: [{ id: "task-1", title: "Implementar", prompt: "Faça a alteração", agent: "codex", cwd: "C:\\repo", model: "gpt", effort: "high", depth: 1, write: true }],
  ...patch,
});

function fixture(options: { progress?: boolean; readonly?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-managed-"));
  const store = new ExecutionStore({ root: dir });
  const adapter = new FakeAdapter(options.progress);
  const agents = new AgentRegistry("codex").register(adapter);
  const sessions = new Sessions();
  const released: Array<{ lease: ManagedWorkspaceLease; terminal: boolean; state?: string; nativeStates: string[] }> = [];
  const worktrees = {
    prepare(input: { executionId: string; cwd: string; write?: boolean }): ManagedWorkspaceLease {
      return { leaseId: "00000000-0000-0000-0000-000000000001", executionId: input.executionId,
        access: input.write ? "isolated_write" as const : "read_only" as const,
        cwd: input.write ? "C:\\managed-worktree" : input.cwd, repoRoot: "C:\\repo", gitRepository: true,
        worktree: input.write ? "C:\\managed-worktree" : undefined, baseCommit: input.write ? "a".repeat(40) : undefined,
        baseIncludesUncommitted: false };
    },
    release(lease: ManagedWorkspaceLease, releaseOptions: { executionTerminal: boolean }) {
      released.push({ lease, terminal: releaseOptions.executionTerminal, state: store.findNode(lease.executionId)?.node.state,
        nativeStates: (store.snapshot("workflow-1")?.nodes || []).filter((node) => node.origin === "native").map((node) => node.state) }); return true;
    },
  };
  const events: unknown[] = [];
  const childUsage: unknown[] = [];
  const service = new ManagedExecutionService({ runnerId: "local", store, agents,
    hiddenSessions: sessions, worktrees, securityFor: (task) => ({ commitPrevention: "command_wrapper", readOnlyEnforcement: task.write ? undefined : "provider_sandbox" }),
    onEvent: (event) => events.push(event), onChildUsage: (usage) => childUsage.push(usage) });
  return { dir, store, adapter, sessions, released, events, childUsage, service, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("managed service persists workflow/child, runs writer only in worktree and cleans after durable terminal", async () => {
  const f = fixture({ progress: true });
  try {
    const report = await f.service.run(plan(), { title: "Entrega" });
    assert.equal(report.state, "succeeded");
    assert.equal(f.adapter.cwd, "C:\\managed-worktree");
    assert.match(f.adapter.prompt || "", /não faça merge\/rebase\/push/);
    assert.equal(f.sessions.created.length, 2, "root and child use hidden-session boundary");
    assert.deepEqual(f.sessions.messages.map((m) => m.role), ["user", "assistant"]);
    const child = f.store.findNode(managedChildExecutionId("workflow-1", "task-1"))!.node;
    const root = f.store.findNode("workflow-1")!.node;
    assert.equal(child.state, "succeeded");
    assert.equal(child.metrics.self.inputTokens, 10);
    assert.equal(root.state, "succeeded");
    assert.equal(root.capabilities.resume, false);
    assert.equal(root.capabilities.transcript, "published_only");
    assert.equal(root.metrics.subtree?.outputTokens, 7, "self-only provider usage includes the child exactly once in the workflow aggregate");
    assert.equal(f.childUsage.length, 1, "unchanged child snapshots reach the billing ledger exactly once");
    assert.equal(f.released.length, 1);
    assert.equal(f.released[0].terminal, true);
    assert.equal(f.released[0].state, "succeeded", "cleanup happens only after terminal was journaled");
    const native = f.store.snapshot("workflow-1")!.nodes.find((node) => node.providerExecutionId === "native-child");
    assert.equal(native?.state, "succeeded");
    assert.equal(native?.summary, "ok");
    assert.equal(native?.metrics.self.outputTokens, 2);
    assert.equal(native?.cwd, "C:\\managed-worktree");
    assert.equal(f.store.snapshot("workflow-1")?.artifacts[0]?.relativePath, "src/a.ts");
    assert.equal(f.store.snapshot("workflow-1")?.artifacts[0]?.adds, 2);
  } finally { f.cleanup(); }
});

test("managed service fails closed before journaling when read-only enforcement is absent", async () => {
  const f = fixture();
  try {
    const unsafe = new ManagedExecutionService({
      runnerId: "local", store: f.store, agents: new AgentRegistry("codex").register(f.adapter), worktrees: { prepare: () => { throw new Error("must not prepare"); }, release: () => false },
      hiddenSessions: f.sessions, securityFor: () => ({ commitPrevention: "provider_config" }),
    });
    await assert.rejects(() => unsafe.run(plan({ tasks: [{ ...plan().tasks[0], write: false }] })), /sem sandbox real/);
    assert.equal(f.store.snapshot("workflow-1"), undefined);
    assert.equal(f.sessions.created.length, 0);
  } finally { f.cleanup(); }
});

test("managed service never chooses or switches machine", async () => {
  const f = fixture();
  try {
    await assert.rejects(() => f.service.run(plan({ runnerId: "remote-1" })), /máquina fixa inválida/);
    assert.equal(f.store.manifest().length, 0);
  } finally { f.cleanup(); }
});

test("managed service validates availability and model/effort before workspace or session side effects", async () => {
  const f = fixture();
  try {
    await assert.rejects(() => f.service.run(plan({ tasks: [{ ...plan().tasks[0], model: "inventado" }] })), /não existe no catálogo/);
    assert.equal(f.sessions.created.length, 0);
    f.adapter.availableValue = false;
    await assert.rejects(() => f.service.run(plan()), /não está disponível/);
    assert.equal(f.store.manifest().length, 0);
  } finally { f.cleanup(); }
});

test("failed adapter is durable and its worktree is still released only after failure terminal", async () => {
  const f = fixture(); f.adapter.fail = new Error("provider caiu");
  try {
    const report = await f.service.run(plan());
    assert.equal(report.state, "failed");
    const child = f.store.findNode(managedChildExecutionId("workflow-1", "task-1"))!.node;
    assert.equal(child.state, "failed");
    assert.match(child.summary || "", /provider caiu/);
    assert.equal(f.released[0].state, "failed");
    assert.equal(f.store.findNode("workflow-1")?.node.state, "failed");
  } finally { f.cleanup(); }
});

test("managed secondary journal redacts prompts, provider details and summaries while hidden history remains canonical", async () => {
  const f = fixture();
  const secret = "sk-abcdefghijklmnopqrstuvwxyz";
  f.adapter.toolDetail = `Authorization ${secret}`;
  f.adapter.replyText = `resultado ${secret}`;
  try {
    await f.service.run(plan({ tasks: [{ ...plan().tasks[0], prompt: `use ${secret}` }] }));
    const journal = JSON.stringify(f.store.snapshot("workflow-1"));
    assert.equal(journal.includes(secret), false);
    assert.match(journal, /REDACTED/);
    assert.equal(f.sessions.messages.some((message) => message.text.includes(secret)), true, "canonical hidden history is not silently rewritten");
  } finally { f.cleanup(); }
});

test("provider children without a published terminal become unknown before workspace cleanup", async () => {
  const f = fixture({ progress: true }); f.adapter.leaveChildRunning = true;
  try {
    await f.service.run(plan());
    const native = f.store.snapshot("workflow-1")!.nodes.find((node) => node.origin === "native");
    assert.equal(native?.state, "unknown");
    assert.deepEqual(f.released[0].nativeStates, ["unknown"]);
    assert.ok(f.store.events("workflow-1").events.some((event) => event.kind === "diagnostic" && event.code === "CHILD_TERMINAL_UNOBSERVED"));
  } finally { f.cleanup(); }
});

test("managed artifacts never expose a path outside the leased workspace", async () => {
  const f = fixture(); f.adapter.outsideToolPath = true;
  try {
    await f.service.run(plan());
    assert.equal(f.store.snapshot("workflow-1")?.artifacts.length, 0);
    assert.equal(JSON.stringify(f.store.events("workflow-1").events).includes("outside"), false);
  } finally { f.cleanup(); }
});
