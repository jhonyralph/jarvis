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
  const common = { JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_CWD: ROOT, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test" };
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

    let history: any;
    for (let i = 0; i < 20; i++) {
      inbox.send({ t: "open", sessionId: sid }); history = await inbox.take((m) => m.t === "history" && m.sessionId === sid);
      if (history.messages?.some((m: any) => m.role === "assistant" && m.activity?.some((e: any) => e.kind === "completed"))) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const assistant = history.messages.find((m: any) => m.role === "assistant");
    assert.deepEqual(assistant.activity.map((e: any) => e.kind), ["accepted", "started", "thinking", "tool_started", "text_delta", "usage", "completed"], "reload preserves the complete canonical lifecycle in order");
    assert.equal(assistant.usage.costKind, "tokens_only");
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.stack : error}\n--- hub ---\n${hub.logs()}\n--- runner ---\n${runner?.logs() || "not started"}`);
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    await stopChild(runner?.process);
    await stopChild(hub.process);
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
