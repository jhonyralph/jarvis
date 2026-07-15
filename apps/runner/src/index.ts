/**
 * Jarvis Runner — headless. Runs agents LOCALLY on this machine and streams to the
 * Hub over an outbound WebSocket. No UI, no voice. Reuses @jarvis/core.
 *
 * The Hub is the single UI + router; a Runner is one machine it can drive. Runners
 * dial the Hub (outbound), so laptops behind NAT / that sleep / roam still work.
 *
 * Env:
 *   JARVIS_HUB     ws(s)://<hub-host>:<port>   (required; "/runner" is appended)
 *   JARVIS_TOKEN   per-runner token minted by the owner (required if Hub auth on)
 *   JARVIS_AGENT   default agent (default: claude-code)
 *   JARVIS_CWD     default cwd for new sessions (default: homedir)
 *   JARVIS_LABEL   friendly hint (the Hub stores/overrides the label)
 */
import WebSocket from "ws";
import { hostname, homedir, platform } from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AgentRegistry, MockAgentAdapter, ClaudeCodeAdapter, CodexAdapter,
  listNative, nativeHistory, nativeInfo, isNativeId, Store,
  type AgentAdapter, type SendOpts,
} from "@jarvis/core";
import type { RunnerInfo, RunnerSession, RunnerToHub } from "@jarvis/protocol";

const HUB = (process.env.JARVIS_HUB || "ws://127.0.0.1:4577").replace(/\/+$/, "");
const HUB_URL = HUB + "/runner";
const TOKEN = process.env.JARVIS_TOKEN || "";
const DEFAULT_AGENT = process.env.JARVIS_AGENT || "claude-code";
const CWD = process.env.JARVIS_CWD || homedir();
const JDIR = join(homedir(), ".jarvis");
try { mkdirSync(JDIR, { recursive: true }); } catch { /* ignore */ }
const ID_FILE = join(JDIR, "runner-id");

function runnerId(): string {
  try { const v = readFileSync(ID_FILE, "utf8").trim(); if (v) return v; } catch { /* new */ }
  const id = randomUUID();
  try { writeFileSync(ID_FILE, id); } catch { /* ignore */ }
  return id;
}
const RUNNER_ID = runnerId();

const agents = new AgentRegistry(DEFAULT_AGENT)
  .register(new ClaudeCodeAdapter())
  .register(new CodexAdapter())
  .register(new MockAgentAdapter());
const store = new Store({ agent: DEFAULT_AGENT, cwd: CWD });
const activeRuns = new Set<string>();

let ws: WebSocket | null = null;
function send(m: RunnerToHub): void { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }

async function availableAgents(): Promise<string[]> {
  const out: string[] = [];
  for (const n of agents.names()) { try { if (await agents.get(n).available()) out.push(n); } catch { /* skip */ } }
  return out.length ? out : agents.names();
}

function allSessions(): RunnerSession[] {
  const own = store.list().map((s: any) => ({ id: s.id, title: s.title, agent: s.agent, cwd: s.cwd, updatedAt: s.updatedAt, source: "managed" as const, writable: true }));
  const ownIds = new Set(own.map((s) => s.id));
  const native = listNative().filter((n) => !ownIds.has(n.id)).map((n) => ({ id: n.id, title: n.title, agent: n.agent, cwd: n.cwd, updatedAt: n.updatedAt, source: "native" as const, writable: n.agent === "claude-code" }));
  return [...own, ...native].sort((a, b) => b.updatedAt - a.updatedAt);
}
function pushSessions(): void { send({ t: "sessions", sessions: allSessions() }); }
function pushRuns(): void { send({ t: "runs", active: [...activeRuns] }); }

async function doHistory(reqId: string, sessionId: string): Promise<void> {
  if (isNativeId(sessionId)) {
    const h = nativeHistory(sessionId);
    if (!h) { send({ t: "error", reqId, message: "sessão nativa não encontrada" }); return; }
    send({ t: "history", reqId, sessionId, title: h.title, agent: h.agent, cwd: h.cwd, writable: h.agent === "claude-code", total: h.messages.length, messages: h.messages.map((m) => ({ role: m.role, text: m.text, ts: m.ts })) });
  } else {
    const s = store.ensure(sessionId);
    const all = store.history(s.id);
    send({ t: "history", reqId, sessionId: s.id, title: s.title, agent: s.agent, cwd: s.cwd, writable: true, total: all.length, messages: all.map((m: any) => ({ role: m.role, text: m.text, ts: m.ts })) });
  }
}

async function doSend(sessionId: string, text: string, agentName?: string, cwd?: string, opts?: SendOpts): Promise<void> {
  activeRuns.add(sessionId); pushRuns();
  send({ t: "stream", sessionId, ev: { kind: "start" } });
  try {
    let agent: AgentAdapter, useCwd: string;
    if (isNativeId(sessionId)) {
      const info = nativeInfo(sessionId);
      if (!info) throw new Error("sessão nativa não encontrada");
      agent = agents.get(info.agent); useCwd = info.cwd || CWD;
      send({ t: "message", sessionId, message: { role: "user", text, ts: Date.now() } });
    } else {
      const s = store.ensure(sessionId, agentName ? { agent: agentName, cwd: cwd || CWD } : undefined);
      agent = agents.get(s.agent); useCwd = s.cwd || CWD;
      store.add(sessionId, { role: "user", text, ts: Date.now(), agent: agent.name });
      send({ t: "message", sessionId, message: { role: "user", text, ts: Date.now() } });
      pushSessions();
    }
    const reply = await agent.send(sessionId, text, useCwd, opts, (ev) => send({ t: "stream", sessionId, ev }));
    if (!isNativeId(sessionId)) { store.add(sessionId, { role: "assistant", text: reply.text, ts: Date.now(), agent: agent.name }); pushSessions(); }
    send({ t: "stream", sessionId, ev: { kind: "done", text: reply.text, usage: reply.usage } });
  } catch (e: any) {
    send({ t: "stream", sessionId, ev: { kind: "error", text: String(e?.message ?? e) } });
    send({ t: "error", message: String(e?.message ?? e) });
  } finally {
    activeRuns.delete(sessionId); pushRuns();
  }
}

let reconnectDelay = 1000;
function connect(): void {
  const sock = new WebSocket(HUB_URL);
  ws = sock;
  sock.on("open", async () => {
    reconnectDelay = 1000;
    const info: RunnerInfo = { runnerId: RUNNER_ID, host: hostname(), os: platform(), agents: await availableAgents(), version: "0.1.0" };
    send({ t: "register", token: TOKEN, info });
  });
  sock.on("message", async (data) => {
    let m: any; try { m = JSON.parse(data.toString()); } catch { return; }
    try {
      if (m.t === "welcome") { console.log(`[runner] registered as ${RUNNER_ID} (${hostname()})`); pushSessions(); send({ t: "caps", agent: DEFAULT_AGENT, caps: await agents.describe() }); return; }
      if (m.t === "reject") { console.error(`[runner] rejected by hub: ${m.reason}`); sock.close(); return; }
      if (m.t === "ping") { send({ t: "pong" }); return; }
      if (m.t === "list") { pushSessions(); return; }
      if (m.t === "new") {
        const id = randomUUID();
        const agentName = agents.names().includes(m.agent) ? m.agent : agents.default;
        const s = store.ensure(id, { agent: agentName, cwd: (typeof m.cwd === "string" && m.cwd) ? m.cwd : CWD });
        send({ t: "history", reqId: m.reqId, sessionId: id, title: s.title, agent: s.agent, cwd: s.cwd, writable: true, total: 0, messages: [] });
        pushSessions();
        return;
      }
      if (m.t === "open" && typeof m.sessionId === "string") { await doHistory(m.reqId, m.sessionId); return; }
      if (m.t === "send" && typeof m.sessionId === "string") { await doSend(m.sessionId, String(m.text ?? ""), m.agent, m.cwd, m.opts); return; }
      if (m.t === "caps") { send({ t: "caps", agent: m.agent || DEFAULT_AGENT, caps: await agents.describe() }); return; }
      if (m.t === "stop") { /* adapter kill not wired yet */ return; }
    } catch (e: any) { send({ t: "error", reqId: m?.reqId, message: String(e?.message ?? e) }); }
  });
  sock.on("close", () => { ws = null; setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); console.log(`[runner] disconnected; retrying in ${reconnectDelay / 1000}s`); });
  sock.on("error", (e: any) => { console.error("[runner] ws error:", e?.message ?? e); });
}

console.log(`[runner] id=${RUNNER_ID} host=${hostname()} os=${platform()} -> ${HUB_URL}`);
connect();
// keep native/managed session list fresh (native sessions can change out-of-band)
setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) pushSessions(); }, 6000);
