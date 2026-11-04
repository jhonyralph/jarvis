import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { Store, ExecutionStore, ExecutionTracker, createAgentEventBridge } from "@jarvis/core";
import { createEventSequencer } from "@jarvis/protocol";
import { stopChild } from "../../../packages/core/src/fixtures/stop-child.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const result = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return result;
}
function launch(entry: string, env: NodeJS.ProcessEnv) {
  const process = spawn(globalThis.process.execPath, ["--import", "tsx", entry], { cwd: repo, env: { ...globalThis.process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const record = (b: Buffer) => { output = (output + b.toString()).slice(-12_000); };
  process.stdout.on("data", record); process.stderr.on("data", record);
  return { process, logs: () => output };
}
class Inbox {
  rows: any[] = [];
  constructor(readonly ws: WebSocket) { ws.on("message", (raw) => { this.rows.push(JSON.parse(String(raw))); }); }
  send(value: unknown) { this.ws.send(JSON.stringify(value)); }
  async take(predicate: (value: any) => boolean): Promise<any> {
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      const i = this.rows.findIndex(predicate);
      if (i >= 0) return this.rows.splice(i, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("missing frame: " + JSON.stringify(this.rows.slice(-12).map((m) => ({ t: m.t, sessionId: m.sessionId, error: m.message, sessions: m.sessions?.map((s: any) => ({ id: s.id, count: s.count, last: s.lastMessage })) }))));
  }
}
function seed(home: string) {
  const base = Date.now() - 10 * 24 * 60 * 60_000; // old sessions: opening must recover, not just boot
  const dir = join(home, ".jarvis"); mkdirSync(dir, { recursive: true });
  const store = new Store({ agent: "mock", cwd: home }, join(dir, "hub"));
  const bindings: Record<string, Record<string, string>> = { codex: {}, "claude-code": {} };
  for (const agent of ["codex", "claude-code"]) {
    const sid = "recover-" + agent, nid = "native-" + agent;
    store.ensure(sid, { agent, cwd: home });
    store.add(sid, { role: "user", text: "Continue", ts: base, agent });
    // A newer message used to make the earlier activity disappear permanently.
    store.add(sid, { role: "user", text: "O que aconteceu?", ts: base + 1000, agent });
    store.add(sid, { role: "assistant", text: "Resposta preservada", ts: base + 2000, agent, usage: {} });
    bindings[agent][sid] = nid;
    const transcript = agent === "codex" ? [
      { type: "response_item", timestamp: new Date(base + 1), payload: { type: "message", role: "user", content: "Continue" } },
      { type: "response_item", timestamp: new Date(base + 2), payload: { type: "message", role: "assistant", content: "Trabalho parcial Codex" } },
      { type: "event_msg", timestamp: new Date(base + 3), payload: { type: "turn_aborted" } },
    ] : [
      { type: "user", timestamp: new Date(base + 1), message: { content: "Continue" } },
      { type: "assistant", timestamp: new Date(base + 2), message: { stop_reason: "tool_use", content: [{ type: "text", text: "Trabalho parcial Claude" }, { type: "tool_use", id: "read", name: "Read", input: { file_path: join(home, "example.ts") } }] } },
    ];
    const folder = agent === "codex" ? join(home, "codex") : join(home, "claude", "repo");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, agent === "codex" ? `rollout-${nid}.jsonl` : `${nid}.jsonl`), transcript.map((v) => JSON.stringify(v)).join("\n") + "\n");
  }
  writeFileSync(join(dir, "codex-sessions.json"), JSON.stringify(bindings.codex));
  writeFileSync(join(dir, "claude-sessions.json"), JSON.stringify(bindings["claude-code"]));
  const journal = new ExecutionStore({ root: join(dir, "executions") });
  const tracker = new ExecutionTracker(journal, { runnerId: "local", sessionId: "journal-only", turnId: "interrupted-turn", agent: "mock", cwd: home });
  const bridge = createAgentEventBridge("interrupted-turn", createEventSequencer("interrupted-turn", () => base + 2));
  tracker.handleAgentEvent(bridge.accepted()); tracker.handleAgentEvent(bridge.started());
  tracker.handleAgentEvent(bridge.provider({ kind: "text", text: "Texto anterior ao reinício" }));
  journal.append(tracker.rootExecutionId, tracker.rootExecutionId, { kind: "state_changed", from: "running", to: "orphaned", reason: "test crash" });
  store.add("journal-only", { role: "user", text: "Trabalhe", ts: base, agent: "mock", contextManifest: { turnId: "interrupted-turn" } as any });
}

for (const remote of [false, true]) test(`history recovery survives real ${remote ? "Runner" : "Hub"} restart and a new message`, { timeout: 90_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-recovery-e2e-"));
  const home = join(root, "owner"), hubHome = remote ? join(root, "hub") : home;
  seed(home);
  const hubPort = await port(); let adminPort = await port(); while (adminPort === hubPort) adminPort = await port();
  const environment = (h: string) => ({ JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_CWD: repo, JARVIS_HOME: h, HOME: h, USERPROFILE: h, NODE_ENV: "test", JARVIS_CODEX_DIR: join(h, "codex"), JARVIS_CLAUDE_DIR: join(h, "claude") });
  let hub: ReturnType<typeof launch> | undefined, runner: ReturnType<typeof launch> | undefined, ws: WebSocket | undefined;
  try {
    for (let round = 0; round < 2; round++) {
      hub = launch("apps/hub/src/index.ts", { ...environment(hubHome), JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort) });
      const until = Date.now() + 20_000;
      while (true) {
        try { if ((await fetch(`http://127.0.0.1:${hubPort}/health`)).ok) break; } catch { /* booting */ }
        if (Date.now() >= until) throw new Error("Hub failed to start");
        await new Promise((r) => setTimeout(r, 100));
      }
      if (remote) runner = launch("apps/runner/src/index.ts", { ...environment(home), JARVIS_HUB: `ws://127.0.0.1:${hubPort}`, JARVIS_TOKEN: "" });
      ws = new WebSocket(`ws://127.0.0.1:${hubPort}`); const inbox = new Inbox(ws);
      await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
      await inbox.take((m) => m.t === "version");
      if (remote) {
        const machines = await inbox.take((m) => m.t === "machines" && m.machines.some((x: any) => !x.local && x.online));
        const runnerId = machines.machines.find((x: any) => !x.local && x.online).id;
        inbox.send({ t: "runner", runnerId }); await inbox.take((m) => m.t === "sessions" && m.runnerId === runnerId);
      }
      for (const agent of ["codex", "claude-code"]) {
        inbox.send({ t: "open", sessionId: "recover-" + agent });
        const h = await inbox.take((m) => m.t === "history" && m.sessionId === "recover-" + agent);
        assert.deepEqual(h.messages.map((m: any) => m.role), ["user", "assistant", "user", "assistant"]);
        assert.equal(h.messages[1].interrupted, true); assert.equal(h.messages[1].restored, true);
        assert.match(h.messages[1].text, /Trabalho parcial/);
        assert.equal(h.messages[3].text, "Resposta preservada");
      }
      if (!round) {
        // Send WITHOUT opening this session first: prior recovery must happen before a new user
        // message can hide the orphaned journal or pollute the next turn's context.
        inbox.send({ t: "send", sessionId: "journal-only", text: "Novo pedido", msgId: "new-after-crash" });
        if (remote) await inbox.take((m) => m.t === "agent_event" && m.sessionId === "journal-only" && m.event?.kind === "completed");
        else await inbox.take((m) => m.t === "sessions" && m.sessions?.some((s: any) => s.id === "journal-only" && s.count === 4 && /Novo pedido/.test(s.lastMessage)));
      }
      inbox.send({ t: "open", sessionId: "journal-only" });
      const h = await inbox.take((m) => m.t === "history" && m.sessionId === "journal-only");
      assert.deepEqual(h.messages.map((m: any) => m.role), ["user", "assistant", "user", "assistant"]);
      assert.equal(h.messages[1].text, "Texto anterior ao reinício");
      assert.equal(h.messages[1].interrupted, true);
      assert.equal(h.messages[2].contextManifest.continuity.historyMessages, 2, "the new turn's context includes recovered work BEFORE dispatch");
      ws.close(); ws = undefined;
      await stopChild(runner?.process); runner = undefined;
      await stopChild(hub.process); hub = undefined;
    }
  } catch (error) { throw new Error(`${error}\nHub: ${hub?.logs()}\nRunner: ${runner?.logs()}`); }
  finally { ws?.close(); await stopChild(runner?.process); await stopChild(hub?.process); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
