import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
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
  const hubPort = await freePort(), adminPort = await freePort();
  const common = { JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock", JARVIS_CWD: ROOT, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test" };
  const hub = child("apps/hub/src/index.ts", { ...common, JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort) });
  let runner: ReturnType<typeof child> | undefined; let ws: WebSocket | undefined;
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
    inbox.send({ t: "open", sessionId: sid });
    await inbox.take((m) => m.t === "history" && m.sessionId === sid);

    inbox.send({ t: "send", sessionId: sid, text: "paridade", msgId: "e2e-turn-1" });
    await inbox.take((m) => m.t === "message" && m.message?.sessionId === sid && m.message?.role === "user");
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
    assert.deepEqual(assistant.activity.map((e: any) => e.kind), ["accepted", "started", "thinking", "tool_started", "text_delta", "usage", "completed"], "reload preserves the complete canonical lifecycle in order");
    assert.equal(assistant.usage.costKind, "tokens_only");

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
    inbox.send({ t: "delete", sessionId: sid });
    const deleted = await inbox.take((m) => m.t === "deleted");
    assert.equal(deleted.ok, true); assert.deepEqual(deleted.ids, [sid]);
    inbox.send({ t: "executions_list", scope: "session", sessionId: sid, limit: 50 });
    const afterDelete = await inbox.take((m) => m.t === "executions_snapshot" && m.scope === "session");
    assert.equal(afterDelete.nodes.some((node: any) => node.sessionId === sid), false);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.stack : error}\n--- hub ---\n${hub.logs()}\n--- runner ---\n${runner?.logs() || "not started"}`);
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    await stopChild(runner?.process);
    await stopChild(hub.process);
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
