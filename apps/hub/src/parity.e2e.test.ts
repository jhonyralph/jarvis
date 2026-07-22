import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => resolve(port)); });
  });
}

function child(entry: string, env: NodeJS.ProcessEnv): { process: ChildProcess; logs: () => string } {
  const p = spawn(process.execPath, ["--import", "tsx", entry], { cwd: ROOT, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; const add = (b: Buffer) => { log = (log + b.toString()).slice(-12000); };
  p.stdout?.on("data", add); p.stderr?.on("data", add);
  return { process: p, logs: () => log };
}

async function stopChild(p: ChildProcess | undefined): Promise<void> {
  if (!p || p.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => p.once("exit", () => resolve()));
  if (process.platform === "win32" && p.pid) {
    spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else p.kill();
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
}

async function waitHealth(port: number, logs: () => string): Promise<void> {
  const end = Date.now() + 15_000;
  while (Date.now() < end) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch { /* booting */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Hub did not become healthy:\n" + logs());
}

class Inbox {
  private messages: any[] = [];
  private wake: (() => void) | undefined;
  constructor(readonly ws: WebSocket) { ws.on("message", (raw) => { try { this.messages.push(JSON.parse(raw.toString())); } catch { /* ignore */ } this.wake?.(); }); }
  send(message: unknown): void { this.ws.send(JSON.stringify(message)); }
  async take(predicate: (message: any) => boolean, timeout = 10_000): Promise<any> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const index = this.messages.findIndex(predicate); if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise<void>((resolve) => { const timer = setTimeout(resolve, Math.min(100, end - Date.now())); this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); }; });
    }
    throw new Error("timed out waiting for WebSocket frame; buffered=" + JSON.stringify(this.messages.slice(-8)));
  }
}

test("remote Runner preserves the same progress, terminal and rich history lifecycle", { timeout: 35_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-parity-e2e-"));
  mkdirSync(join(home, ".jarvis"), { recursive: true });
  writeFileSync(join(home, ".jarvis", "policies.json"), JSON.stringify({
    schemaVersion: 1,
    global: {
      schemaVersion: 1, id: "global", scope: "global", label: "Global",
      memory: { writeTarget: "repo_allowed", namespaces: ["project", "session", "task"], allowPersonalContext: false, allowProjectContext: true, repoFiles: ["AGENTS.md"] },
      autonomy: { mode: "assisted", allowQueueAutoplay: false, allowBackgroundTurns: false, requireApprovalAboveRisk: "medium" },
      budget: { unknownEstimate: "ask" }, write: { allowRepoWrites: true, requireDiffPreview: false }, updatedAt: Date.now(),
    },
    projects: [], sessions: [], tasks: [],
  }));
  mkdirSync(join(home, ".agents", "skills", "remote-only"), { recursive: true });
  writeFileSync(join(home, ".agents", "skills", "remote-only", "SKILL.md"), `---
name: remote-only
description: Remote cwd only test skill.
---
Use only for runner cwd parity tests.`);
  const hubPort = await freePort(), adminPort = await freePort();
  const common = { JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock", JARVIS_CWD: ROOT, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test" };
  const hub = child("apps/hub/src/index.ts", { ...common, JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort) });
  let runner: ReturnType<typeof child> | undefined; let ws: WebSocket | undefined; let ws2: WebSocket | undefined;
  try {
    await waitHealth(hubPort, hub.logs);
    runner = child("apps/runner/src/index.ts", { ...common, JARVIS_HUB: `ws://127.0.0.1:${hubPort}`, JARVIS_TOKEN: "" });
    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const inbox = new Inbox(ws);
    const version = await inbox.take((m) => m.t === "version");
    assert.equal(version.contractVersion, 1);
    const machines = await inbox.take((m) => m.t === "machines" && m.machines?.some((x: any) => !x.local && x.online), 15_000);
    const remote = machines.machines.find((x: any) => !x.local && x.online);
    assert.ok(remote.agents.includes("mock"));
    assert.ok(remote.agentDescriptors?.some((x: any) => x.name === "mock" && x.support === "limited"));
    assert.ok(remote.agentDescriptors?.some((x: any) => x.name === "antigravity"), "Runner publishes unavailable descriptors too");

    inbox.send({ t: "runner", runnerId: remote.id });
    await inbox.take((m) => m.t === "sessions" && m.runnerId === remote.id);
    inbox.send({ t: "new", agent: "mock", cwd: home });
    const created = await inbox.take((m) => m.t === "history" && m.session?.agent === "mock");
    const sid = created.sessionId;
    inbox.send({ t: "list" });
    const listedAfterCreate = await inbox.take((m) => m.t === "sessions" && m.runnerId === remote.id && m.sessions?.some((s: any) => s.id === sid));
    assert.ok(listedAfterCreate.recentDirs?.includes(home), "remote sessions publish cwd history for the folder picker");
    inbox.send({ t: "open", sessionId: sid });
    await inbox.take((m) => m.t === "history" && m.sessionId === sid);
    inbox.send({ t: "commands", sessionId: sid });
    const remoteCommands = await inbox.take((m) => m.t === "command_list" && m.runnerId === remote.id && m.cwd === home);
    assert.ok(remoteCommands.commands.some((c: any) => c.name === "remote-only" && c.source === "project"), "remote slash commands use the session cwd");

    inbox.send({ t: "send", sessionId: sid, text: "paridade", msgId: "e2e-turn-1" });
    const firstUser = await inbox.take((m) => m.t === "message" && m.message?.sessionId === sid && m.message?.role === "user");
    const firstManifest = await inbox.take((m) => m.t === "context_manifest" && m.sessionId === sid && m.manifest?.turnId === "e2e-turn-1");
    assert.equal(firstManifest.manifest.runnerId, remote.id);
    assert.equal(firstManifest.manifest.cwd, home);
    assert.equal(firstManifest.manifest.actor?.source, "user");
    assert.equal(firstManifest.manifest.semanticMemory.injected, false);
    assert.equal(firstManifest.manifest.prompt.agentSha256.length, 64);
    assert.doesNotMatch(JSON.stringify(firstManifest.manifest), /paridade/, "the audit manifest never persists prompt contents");
    assert.deepEqual(firstUser.message.contextManifest, firstManifest.manifest, "the live user message carries the exact audited manifest");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "started");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "thinking");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "tool_started" && m.event?.tool?.name === "FixtureTool");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "text_delta");
    const usage = await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "usage");
    assert.equal(usage.event.usage.costKind, "tokens_only");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "completed");
    const createdExecution = await inbox.take((m) => m.t === "execution_delta" && m.event?.kind === "node_created" && m.event?.node?.sessionId === sid);
    const executionId = createdExecution.event.node.executionId;
    await inbox.take((m) => m.t === "execution_delta" && m.event?.executionId === executionId && m.event?.kind === "state_changed" && m.event?.to === "succeeded");
    inbox.send({ t: "executions_list", scope: "session", sessionId: sid, limit: 50 });
    const executions = await inbox.take((m) => m.t === "executions_snapshot" && m.scope === "session");
    assert.ok(executions.nodes.some((n: any) => n.executionId === executionId && n.runnerId === remote.id && n.state === "succeeded"));
    inbox.send({ t: "execution_open", executionId, limit: 100 });
    const transcript = await inbox.take((m) => m.t === "execution_transcript" && m.executionId === executionId);
    assert.ok(transcript.events.some((e: any) => e.kind === "agent_event" && e.event?.kind === "tool_started"));
    assert.ok(transcript.events.some((e: any) => e.kind === "agent_event" && e.event?.kind === "usage"));

    let history: any;
    for (let i = 0; i < 20; i++) {
      inbox.send({ t: "open", sessionId: sid }); history = await inbox.take((m) => m.t === "history" && m.sessionId === sid);
      if (history.messages?.some((m: any) => m.role === "assistant" && m.activity?.some((e: any) => e.kind === "completed"))) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const assistant = history.messages.find((m: any) => m.role === "assistant");
    const persistedUser = history.messages.find((m: any) => m.role === "user" && m.text === "paridade");
    assert.deepEqual(persistedUser.contextManifest, firstManifest.manifest, "remote history preserves context provenance after reload");
    assert.deepEqual(assistant.activity.map((e: any) => e.kind), ["accepted", "started", "thinking", "tool_started", "text_delta", "usage", "completed"], "reload preserves the complete canonical lifecycle in order");
    assert.equal(assistant.usage.costKind, "tokens_only");

    // HITL memory is owned by Jarvis, not by provider-specific interaction support. The exact same
    // preview is broadcast to every device on the session, performs no write, remains bound to the
    // original runner if the requesting device switches machines, and is consumable only once.
    ws2 = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws2!.once("open", resolve); ws2!.once("error", reject); });
    const inbox2 = new Inbox(ws2);
    await inbox2.take((m) => m.t === "version");
    inbox2.send({ t: "runner", runnerId: remote.id });
    await inbox2.take((m) => m.t === "sessions" && m.runnerId === remote.id);
    inbox2.send({ t: "open", sessionId: sid });
    await inbox2.take((m) => m.t === "history" && m.sessionId === sid);

    // Leaving and reopening while a remote turn is running must reconstruct the exact activity
    // from the Runner's fsynced journal. The two Read chunks intentionally remain distinct in the
    // audit stream; the browser projection folds them into one clickable file row.
    inbox2.send({ t: "runner", runnerId: "local" });
    await inbox2.take((m) => m.t === "sessions" && (m.runnerId === undefined || m.runnerId === "local"));
    inbox.send({ t: "send", sessionId: sid, text: "[fixture:replay]", msgId: "e2e-live-replay" });
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "tool_started" && m.event?.tool?.callId === "replay-read-2");
    inbox2.send({ t: "runner", runnerId: remote.id });
    await inbox2.take((m) => m.t === "sessions" && m.runnerId === remote.id);
    inbox2.send({ t: "open", sessionId: sid });
    const liveHistory = await inbox2.take((m) => m.t === "history" && m.sessionId === sid && m.messages?.at(-1)?.text === "[fixture:replay]");
    assert.equal(liveHistory.messages.at(-1).role, "user");
    await inbox2.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.turnId === "e2e-live-replay" && m.event?.kind === "accepted");
    await inbox2.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.turnId === "e2e-live-replay" && m.event?.kind === "started");
    await inbox2.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.turnId === "e2e-live-replay" && m.event?.kind === "thinking");
    const replayReads = [
      await inbox2.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.turnId === "e2e-live-replay" && m.event?.tool?.callId === "replay-read-1"),
      await inbox2.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.turnId === "e2e-live-replay" && m.event?.tool?.callId === "replay-read-2"),
    ];
    assert.equal(new Set(replayReads.map((frame) => frame.event.tool.path)).size, 1, "chunked reads preserve one stable file target for UI compaction");
    inbox.send({ t: "cancel", sessionId: sid });
    const cancelledReplay = await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.turnId === "e2e-live-replay" && m.event?.kind === "cancelled");
    assert.match(cancelledReplay.event.text, /solicitação do usuário/);
    inbox.send({ t: "dropLast", sessionId: sid });
    inbox.send({ t: "open", sessionId: sid });
    const cleanHistory = await inbox.take((m) => m.t === "history" && m.sessionId === sid && !m.messages?.some((message: any) => message.text === "[fixture:replay]"));
    assert.equal(cleanHistory.messages.some((message: any) => message.text === "[fixture:replay]"), false);

    const memoryFile = join(home, "AGENTS.md"), memoryNote = "isolamento HITL entre dispositivos";
    assert.equal(existsSync(memoryFile), false);
    inbox.send({ t: "memory_preview", sessionId: sid, text: "prévia que será descartada" });
    const cancelledPreview = await inbox.take((m) => m.t === "memory_preview" && m.sessionId === sid && m.note === "prévia que será descartada");
    await inbox2.take((m) => m.t === "memory_preview" && m.token === cancelledPreview.token);
    inbox2.send({ t: "memory_cancel", token: cancelledPreview.token });
    await inbox.take((m) => m.t === "memory_cancelled" && m.token === cancelledPreview.token && m.ok === true);
    await inbox2.take((m) => m.t === "memory_cancelled" && m.token === cancelledPreview.token && m.ok === true);
    inbox.send({ t: "memory_apply", token: cancelledPreview.token });
    assert.match((await inbox.take((m) => m.t === "memory_applied" && m.token === cancelledPreview.token && m.ok === false)).error, /inexistente|expirada|já aplicada/);
    assert.equal(existsSync(memoryFile), false, "cancelling on either device invalidates the shared preview without writing");
    inbox.send({ t: "memory_preview", sessionId: sid, text: memoryNote });
    const preview1 = await inbox.take((m) => m.t === "memory_preview" && m.sessionId === sid && m.note === memoryNote);
    const preview2 = await inbox2.take((m) => m.t === "memory_preview" && m.sessionId === sid && m.note === memoryNote);
    assert.equal(preview1.token, preview2.token, "all devices confirm the same one-time operation");
    assert.equal(preview1.runnerId, remote.id);
    assert.equal(preview1.target, memoryFile);
    assert.equal(preview1.appendText, `- ${memoryNote}\n`, "preview exposes the exact bytes that will be appended");
    assert.equal(existsSync(memoryFile), false, "preview is side-effect free");
    inbox.send({ t: "runner", runnerId: "local" });
    await inbox.take((m) => m.t === "sessions" && (m.runnerId === undefined || m.runnerId === "local"));
    inbox.send({ t: "memory_apply", token: preview1.token });
    const applied1 = await inbox.take((m) => m.t === "memory_applied" && m.ok === true && m.target === memoryFile);
    const applied2 = await inbox2.take((m) => m.t === "memory_applied" && m.ok === true && m.target === memoryFile);
    assert.equal(applied1.runnerId, remote.id); assert.equal(applied2.runnerId, remote.id);
    assert.equal(applied1.token, preview1.token); assert.equal(applied2.token, preview1.token);
    assert.match(readFileSync(memoryFile, "utf8"), /isolamento HITL entre dispositivos/);
    inbox2.send({ t: "memory_apply", token: preview1.token });
    assert.match((await inbox2.take((m) => m.t === "memory_applied" && m.ok === false)).error, /inexistente|expirada|já aplicada/);
    inbox.send({ t: "runner", runnerId: remote.id });
    await inbox.take((m) => m.t === "sessions" && m.runnerId === remote.id);
    inbox.send({ t: "open", sessionId: sid });
    await inbox.take((m) => m.t === "history" && m.sessionId === sid);

    // Jarvis owns post-turn HITL independently of provider input APIs. It reaches every device,
    // replays on a later open, and never holds the queue hostage: a newer queued instruction clears
    // the old question everywhere and starts normally.
    inbox.send({ t: "send", sessionId: sid, text: "[fixture:decision]", msgId: "e2e-decision" });
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "completed" && /fixture:decision/.test(m.event?.text || ""));
    const ask1 = await inbox.take((m) => m.t === "ask" && m.runnerId === remote.id && m.sessionId === sid);
    const ask2 = await inbox2.take((m) => m.t === "ask" && m.runnerId === remote.id && m.sessionId === sid);
    assert.deepEqual(ask1.questions, ask2.questions);
    inbox2.send({ t: "runner", runnerId: "local" });
    await inbox2.take((m) => m.t === "sessions" && (m.runnerId === undefined || m.runnerId === "local"));
    inbox2.send({ t: "runner", runnerId: remote.id });
    await inbox2.take((m) => m.t === "sessions" && m.runnerId === remote.id);
    inbox2.send({ t: "open", sessionId: sid });
    await inbox2.take((m) => m.t === "history" && m.sessionId === sid);
    await inbox2.take((m) => m.t === "ask" && m.runnerId === remote.id && m.sessionId === sid, 5_000);
    inbox.send({ t: "enqueue", sessionId: sid, text: "fila depois do HITL", msgId: "e2e-hitl-queue" });
    await inbox.take((m) => m.t === "ask_cleared" && m.runnerId === remote.id && m.sessionId === sid);
    await inbox2.take((m) => m.t === "ask_cleared" && m.runnerId === remote.id && m.sessionId === sid);
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === sid && m.message?.role === "user" && m.message?.text === "fila depois do HITL");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "completed" && /fila depois do HITL/.test(m.event?.text || ""));

    inbox.send({ t: "stage_text", sessionId: sid, text: "[fixture:stage]" });
    const staged1 = await inbox.take((m) => m.t === "stage" && m.runnerId === remote.id && m.sessionId === sid && m.draft === "refino remoto confirmado", 8_000);
    const staged2 = await inbox2.take((m) => m.t === "stage" && m.runnerId === remote.id && m.sessionId === sid && m.draft === staged1.draft, 8_000);
    assert.equal(staged2.draft, staged1.draft, "remote voice staging is shared on the owning runner");
    inbox.send({ t: "stage_confirm", sessionId: sid });
    await inbox.take((m) => m.t === "stage" && m.runnerId === remote.id && m.sessionId === sid && m.done === true);
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === sid && m.message?.role === "user" && m.message?.text === "refino remoto confirmado");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "completed" && /refino remoto confirmado/.test(m.event?.text || ""));

    // Provider-native child activity must also use the canonical chat lifecycle. The same event is
    // persisted once in the execution journal and once in the assistant message activity, with the
    // canonical execution id that powers the inline "abrir" link.
    inbox.send({ t: "send", sessionId: sid, text: "[fixture:child]", msgId: "e2e-turn-child" });
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === sid && m.message?.role === "user" && m.message?.text === "[fixture:child]");
    const childCreated = await inbox.take((m) => m.t === "execution_delta" && m.event?.kind === "node_created" && m.event?.node?.providerExecutionId === "mock-child-1");
    const childExecutionId = childCreated.event.node.executionId;
    const childThinking = await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "thinking" && m.event?.parentId === "mock-child-1");
    assert.equal(childThinking.event.executionId, childExecutionId);
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "tool_completed" && m.event?.tool?.parentId === "mock-child-1" && m.event?.executionId === childExecutionId);
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "text_delta" && m.event?.parentId === "mock-child-1" && m.event?.executionId === childExecutionId);
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "completed");
    inbox.send({ t: "open", sessionId: sid });
    const childHistory = await inbox.take((m) => m.t === "history" && m.sessionId === sid && m.messages?.some((x: any) => x.role === "assistant" && x.activity?.some((e: any) => e.executionId === childExecutionId)));
    const childAssistant = childHistory.messages.find((m: any) => m.role === "assistant" && m.activity?.some((e: any) => e.executionId === childExecutionId));
    const inline = childAssistant.activity.filter((e: any) => e.executionId === childExecutionId);
    assert.deepEqual(inline.map((e: any) => e.kind), ["thinking", "tool_completed", "text_delta"], "native child activity survives reload without duplicate snapshot rows");
    assert.ok(inline.every((e: any) => e.parentId === "mock-child-1" || e.tool?.parentId === "mock-child-1"));

    // Automatic routing itself runs on the Hub, consumes the selected remote machine's catalog,
    // and forwards only a validated/fallback decision to the Runner. Mock deliberately returns
    // non-JSON here, exercising the fail-open compatible fallback end to end.
    inbox.send({ t: "send", sessionId: sid, text: "rota automática", auto: { agent: true, model: true, effort: true }, msgId: "e2e-turn-auto" });
    await inbox.take((m) => m.t === "auto_route" && m.sessionId === sid && m.state === "started");
    const routed = await inbox.take((m) => m.t === "auto_route" && m.sessionId === sid && m.state === "completed");
    assert.equal(routed.decision.agent, "mock", "a started remote session never changes agent");
    assert.equal(routed.decision.fallback, true);
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === sid && m.event?.kind === "completed");

    // Provider-neutral managed fallback runs on the explicitly selected remote machine, is visible
    // through the same durable execution graph and keeps its internal sessions out of chat lists.
    const managedRoot = "managed-e2e-root", delegateRequest = "managed-e2e-request";
    inbox.send({ t: "execution_delegate", requestId: delegateRequest, title: "Workflow E2E", plan: { rootExecutionId: managedRoot, runnerId: remote.id,
      tasks: [{ id: "read-1", title: "Inspecionar", prompt: "responda fixture", agent: "mock", cwd: home, depth: 1, write: false }] } });
    const accepted = await inbox.take((m) => m.t === "execution_delegate_result" && m.requestId === delegateRequest);
    assert.equal(accepted.ok, true); assert.equal(accepted.rootExecutionId, managedRoot);
    await inbox.take((m) => m.t === "execution_delta" && m.event?.rootExecutionId === managedRoot && m.event?.kind === "state_changed" && m.event?.executionId === managedRoot && m.event?.to === "succeeded");
    const managedListRequest = "managed-e2e-list";
    inbox.send({ t: "executions_list", requestId: managedListRequest, scope: "all", rootExecutionId: managedRoot, runnerId: remote.id, limit: 500 });
    const managedSnapshot = await inbox.take((m) => m.t === "executions_snapshot" && m.requestId === managedListRequest);
    assert.ok(managedSnapshot.nodes.length > 0 && managedSnapshot.nodes.every((n: any) => n.rootExecutionId === managedRoot && n.runnerId === remote.id), "root/machine-filtered snapshots are explicitly correlated");
    assert.ok(managedSnapshot.nodes.some((n: any) => n.rootExecutionId === managedRoot && n.runnerId === remote.id && n.origin === "jarvis_managed"));
    const remoteInternalSession = managedSnapshot.nodes.find((n: any) => n.rootExecutionId === managedRoot)?.sessionId;
    assert.ok(remoteInternalSession);
    inbox.send({ t: "open", sessionId: remoteInternalSession });
    assert.match((await inbox.take((m) => m.t === "error" && /sessão interna/.test(m.message || ""))).message, /painel Trabalhos/);
    inbox.send({ t: "list" });
    const afterManaged = await inbox.take((m) => m.t === "sessions" && m.runnerId === remote.id);
    assert.equal(afterManaged.sessions.some((session: any) => /Workflow E2E|\[Trabalho\]/.test(session.title || "")), false);

    const localRoot = "managed-e2e-local", localRequest = "managed-e2e-local-request";
    const localFrame = { t: "execution_delegate", requestId: localRequest, title: "Workflow local", plan: { rootExecutionId: localRoot, runnerId: "local",
      tasks: [{ id: "read-local", title: "Inspecionar local", prompt: "responda fixture", agent: "mock", cwd: home, depth: 1, write: false }] } };
    inbox.send(localFrame);
    assert.equal((await inbox.take((m) => m.t === "execution_delegate_result" && m.requestId === localRequest)).ok, true);
    await inbox.take((m) => m.t === "execution_delta" && m.event?.rootExecutionId === localRoot && m.event?.kind === "state_changed" && m.event?.executionId === localRoot && m.event?.to === "succeeded");
    inbox.send(localFrame);
    const duplicate = await inbox.take((m) => m.t === "execution_delegate_result" && m.requestId === localRequest);
    assert.equal(duplicate.ok, true); assert.equal(duplicate.rootExecutionId, localRoot, "requestId redelivered is idempotent");
    inbox.send({ t: "executions_list", scope: "all", limit: 500 });
    const localSnapshot = await inbox.take((m) => m.t === "executions_snapshot" && m.nodes?.some((n: any) => n.rootExecutionId === localRoot));
    const localInternalSession = localSnapshot.nodes.find((n: any) => n.rootExecutionId === localRoot)?.sessionId;
    assert.ok(localInternalSession);
    inbox.send({ t: "runner", runnerId: "local" });
    await inbox.take((m) => m.t === "sessions" && (m.runnerId === undefined || m.runnerId === "local"));
    inbox.send({ t: "open", sessionId: localInternalSession });
    assert.match((await inbox.take((m) => m.t === "error" && /sessão interna/.test(m.message || ""))).message, /não pode ser aberta/);

    inbox.send({ t: "new", agent: "mock", cwd: home });
    const localCreated = await inbox.take((m) => m.t === "history" && m.session?.agent === "mock" && m.sessionId !== sid);
    const localSid = localCreated.sessionId;
    inbox.send({ t: "send", sessionId: localSid, text: "[fixture:child]", msgId: "e2e-local-child" });
    const localChildCreated = await inbox.take((m) => m.t === "execution_delta" && m.event?.kind === "node_created" && m.event?.node?.sessionId === localSid && m.event?.node?.providerExecutionId === "mock-child-1");
    const localChildId = localChildCreated.event.node.executionId;
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === localSid && m.event?.executionId === localChildId && m.event?.kind === "text_delta" && m.event?.parentId === "mock-child-1");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === localSid && m.event?.kind === "completed");
    inbox.send({ t: "open", sessionId: localSid });
    await inbox.take((m) => m.t === "history" && m.sessionId === localSid && m.messages?.some((x: any) => x.activity?.some((e: any) => e.executionId === localChildId)), 8_000);

    // Remote deletion is acknowledged by the Runner before the Hub removes its execution mirror.
    // This prevents an optimistic UI success from hiding a session the owner refused to delete.
    inbox.send({ t: "runner", runnerId: remote.id });
    await inbox.take((m) => m.t === "sessions" && m.runnerId === remote.id);
    inbox.send({ t: "new", agent: "mock", cwd: home });
    const queueCreated = await inbox.take((m) => m.t === "history" && m.session?.agent === "mock" && m.sessionId !== sid && m.sessionId !== localSid);
    const queueSid = queueCreated.sessionId;
    inbox.send({ t: "send", sessionId: queueSid, text: "primeiro turno remoto", msgId: "e2e-queue-first" });
    inbox.send({ t: "enqueue", sessionId: queueSid, text: "fila remota", msgId: "e2e-queue-second" });
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === queueSid && m.message?.role === "user" && m.message?.text === "primeiro turno remoto");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === queueSid && m.event?.kind === "completed" && /primeiro turno remoto/.test(m.event?.text || ""));
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === queueSid && m.message?.role === "user" && m.message?.text === "fila remota");
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === queueSid && m.event?.kind === "completed" && /fila remota/.test(m.event?.text || ""));
    inbox.send({ t: "search", query: "fila remota" });
    const remoteSearch = await inbox.take((m) => m.t === "searchResult" && m.done === true && m.hits?.some((h: any) => h.id === queueSid && h.runnerId === remote.id), 12_000);
    assert.ok(remoteSearch.hits.some((h: any) => h.id === queueSid && h.runnerId === remote.id), "literal search includes remote runner histories with routing metadata");

    // A native/provider id can legitimately be identical on two machines. Queue and live activity
    // must therefore use runner + session identity, never the bare session id.
    inbox2.send({ t: "open", sessionId: queueSid });
    await inbox2.take((m) => m.t === "history" && m.sessionId === queueSid);
    inbox2.send({ t: "send", sessionId: queueSid, text: "[fixture:slow] remoto", msgId: "e2e-collision-remote-running" });
    await inbox2.take((m) => m.t === "message" && m.message?.sessionId === queueSid && m.message?.role === "user" && m.message?.text === "[fixture:slow] remoto");
    inbox2.send({ t: "enqueue", sessionId: queueSid, text: "fila exclusiva remota", msgId: "e2e-collision-remote-queued" });
    const remoteQueue = await inbox2.take((m) => m.t === "queue" && m.sessionId === queueSid && m.items?.some((item: any) => item.text === "fila exclusiva remota"));
    assert.deepEqual(remoteQueue.items.map((item: any) => item.text), ["fila exclusiva remota"]);

    inbox.send({ t: "runner", runnerId: "local" });
    await inbox.take((m) => m.t === "sessions" && (m.runnerId === undefined || m.runnerId === "local"));
    inbox.send({ t: "open", sessionId: queueSid });
    const localCollisionOpened = await inbox.take((m) => m.t === "history" && m.sessionId === queueSid);
    assert.equal(localCollisionOpened.session?.sessionUsage?.inputTokens || 0, 0, "equal-id remote usage is not exposed on a fresh local session");
    inbox.send({ t: "send", sessionId: queueSid, text: "[fixture:slow] local", msgId: "e2e-collision-local-running" });
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === queueSid && m.message?.role === "user" && m.message?.text === "[fixture:slow] local");
    inbox.send({ t: "enqueue", sessionId: queueSid, text: "fila exclusiva local", msgId: "e2e-collision-local-queued" });
    const localQueue = await inbox.take((m) => m.t === "queue" && m.sessionId === queueSid && m.items?.some((item: any) => item.text === "fila exclusiva local"));
    assert.deepEqual(localQueue.items.map((item: any) => item.text), ["fila exclusiva local"]);

    await inbox2.take((m) => m.t === "message" && m.message?.sessionId === queueSid && m.message?.role === "user" && m.message?.text === "fila exclusiva remota", 12_000);
    await inbox2.take((m) => m.t === "agent_event" && m.sessionId === queueSid && m.event?.kind === "completed" && /fila exclusiva remota/.test(m.event?.text || ""));
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === queueSid && m.message?.role === "user" && m.message?.text === "fila exclusiva local", 12_000);
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === queueSid && m.event?.kind === "completed" && /fila exclusiva local/.test(m.event?.text || ""));
    inbox2.send({ t: "open", sessionId: queueSid });
    const remoteCollisionHistory = await inbox2.take((m) => m.t === "history" && m.sessionId === queueSid && m.messages?.some((entry: any) => entry.text === "fila exclusiva remota"));
    inbox.send({ t: "open", sessionId: queueSid });
    const localCollisionHistory = await inbox.take((m) => m.t === "history" && m.sessionId === queueSid && m.messages?.some((entry: any) => entry.text === "fila exclusiva local"));
    assert.equal(remoteCollisionHistory.messages.some((entry: any) => entry.text === "fila exclusiva local"), false, "local queue never reaches the equal-id remote session");
    assert.equal(localCollisionHistory.messages.some((entry: any) => entry.text === "fila exclusiva remota"), false, "remote queue never reaches the equal-id local session");

    inbox.send({ t: "runner", runnerId: remote.id });
    await inbox.take((m) => m.t === "sessions" && m.runnerId === remote.id);
    inbox.send({ t: "new", agent: "mock", cwd: home });
    const cancelCreated = await inbox.take((m) => m.t === "history" && m.session?.agent === "mock" && ![sid, localSid, queueSid].includes(m.sessionId));
    const cancelSid = cancelCreated.sessionId;
    inbox.send({ t: "send", sessionId: cancelSid, text: "[fixture:slow]", msgId: "e2e-drop-last" });
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === cancelSid && m.message?.role === "user" && m.message?.text === "[fixture:slow]");
    inbox.send({ t: "cancel", sessionId: cancelSid });
    inbox.send({ t: "dropLast", sessionId: cancelSid });
    await inbox.take((m) => m.t === "agent_event" && m.sessionId === cancelSid && m.event?.kind === "cancelled");
    inbox.send({ t: "open", sessionId: cancelSid });
    const afterDropLast = await inbox.take((m) => m.t === "history" && m.sessionId === cancelSid);
    assert.equal(afterDropLast.messages.some((message: any) => message.role === "user" && message.text === "[fixture:slow]"), false, "remote dropLast removes the cancelled trailing user message");
    inbox.send({ t: "delete", sessionId: sid });
    const deleted = await inbox.take((m) => m.t === "deleted");
    assert.equal(deleted.ok, true); assert.deepEqual(deleted.ids, [sid]);
    inbox.send({ t: "executions_list", scope: "session", sessionId: sid, limit: 50 });
    const afterDelete = await inbox.take((m) => m.t === "executions_snapshot" && m.scope === "session");
    assert.equal(afterDelete.nodes.some((node: any) => node.sessionId === sid), false);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.stack : error}\n--- hub ---\n${hub.logs()}\n--- runner ---\n${runner?.logs() || "not started"}`);
  } finally {
    try { ws2?.close(); } catch { /* ignore */ }
    try { ws?.close(); } catch { /* ignore */ }
    await stopChild(runner?.process);
    await stopChild(hub.process);
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("remote live activity survives a Hub restart and replays from the Runner journal", { timeout: 40_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-restart-e2e-"));
  const hubPort = await freePort(), adminPort = await freePort();
  const common = { JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_CWD: ROOT, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test" };
  let hub = child("apps/hub/src/index.ts", { ...common, JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort) });
  let runner: ReturnType<typeof child> | undefined, ws: WebSocket | undefined;
  try {
    await waitHealth(hubPort, hub.logs);
    runner = child("apps/runner/src/index.ts", { ...common, JARVIS_HUB: `ws://127.0.0.1:${hubPort}`, JARVIS_TOKEN: "" });
    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    let inbox = new Inbox(ws);
    await inbox.take((message) => message.t === "version");
    let machines = await inbox.take((message) => message.t === "machines" && message.machines?.some((machine: any) => !machine.local && machine.online), 15_000);
    const runnerId = machines.machines.find((machine: any) => !machine.local && machine.online).id;
    inbox.send({ t: "runner", runnerId });
    await inbox.take((message) => message.t === "sessions" && message.runnerId === runnerId);
    inbox.send({ t: "new", agent: "mock", cwd: home });
    const created = await inbox.take((message) => message.t === "history" && message.session?.agent === "mock");
    const sid = created.sessionId;
    inbox.send({ t: "send", sessionId: sid, text: "[fixture:replay-long]", msgId: "restart-live-turn" });
    await inbox.take((message) => message.t === "agent_event" && message.sessionId === sid && message.event?.tool?.callId === "replay-read-2");

    ws.close(); ws = undefined;
    await stopChild(hub.process);
    hub = child("apps/hub/src/index.ts", { ...common, JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort) });
    await waitHealth(hubPort, hub.logs);
    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    inbox = new Inbox(ws);
    await inbox.take((message) => message.t === "version");
    machines = await inbox.take((message) => message.t === "machines" && message.machines?.some((machine: any) => machine.id === runnerId && machine.online), 15_000);
    assert.ok(machines.machines.some((machine: any) => machine.id === runnerId && machine.online));
    inbox.send({ t: "runner", runnerId });
    await inbox.take((message) => message.t === "sessions" && message.runnerId === runnerId);
    inbox.send({ t: "open", sessionId: sid });
    const history = await inbox.take((message) => message.t === "history" && message.sessionId === sid);
    assert.equal(history.messages.at(-1)?.role, "user", "the in-flight turn remains pending after Hub restart");
    await inbox.take((message) => message.t === "agent_event" && message.sessionId === sid && message.event?.turnId === "restart-live-turn" && message.event?.kind === "accepted");
    await inbox.take((message) => message.t === "agent_event" && message.sessionId === sid && message.event?.turnId === "restart-live-turn" && message.event?.kind === "thinking");
    const replayedRead = await inbox.take((message) => message.t === "agent_event" && message.sessionId === sid && message.event?.turnId === "restart-live-turn" && message.event?.tool?.callId === "replay-read-2");
    assert.match(replayedRead.event.tool.path, /fixture-replay\.ts$/);
    inbox.send({ t: "cancel", sessionId: sid });
    const cancelled = await inbox.take((message) => message.t === "agent_event" && message.sessionId === sid && message.event?.turnId === "restart-live-turn" && message.event?.kind === "cancelled");
    assert.match(cancelled.event.text, /solicitação do usuário/);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.stack : error}\n--- hub ---\n${hub.logs()}\n--- runner ---\n${runner?.logs() || "not started"}`);
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    await stopChild(runner?.process);
    await stopChild(hub.process);
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
