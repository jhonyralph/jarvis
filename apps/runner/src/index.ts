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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  AgentRegistry, MockAgentAdapter, ClaudeCodeAdapter, CodexAdapter, AiderAdapter, GeminiCliAdapter, CursorAgentAdapter, CopilotCliAdapter, OpenCodeAdapter, ClineCliAdapter, QwenCodeAdapter, ContinueCliAdapter, KiroCliAdapter, AntigravityCliAdapter, ABORTED,
  listNative, nativeHistory, nativeInfo, isNativeId, nativeFilePath, nativeIdForAgent, parseNativeEvents, deleteNative, sessionFiles, sessionFileDiff, purgeProbeJunk, purgeScratch, Store,
  updateApply, restartService, readProjectFile, repoCommit, createSeenSet, VERSION, Outbox,
  listCommandsPublic, expandCommand, cmdAgentOf, listMentionFiles, expandBang, appendMemory,
  buildTurnAttachments, imageDataUrl, runManagedTurn, touchedFilesFromMessages, createAgentEventBridge, createEventSequencer,
  type AgentAdapter, type SendOpts, type TurnCtx, type AgentEvent,
} from "@jarvis/core";

const RUNNER_ROOT = fileURLToPath(new URL("../../../", import.meta.url)); // repo root from apps/runner/src
import { RUNNER_PROTOCOL_VERSION, type RunnerInfo, type RunnerSession, type RunnerToHub } from "@jarvis/protocol";

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
  .register(new AiderAdapter())
  .register(new GeminiCliAdapter())
  .register(new CursorAgentAdapter())
  .register(new CopilotCliAdapter())
  .register(new OpenCodeAdapter())
  .register(new ClineCliAdapter())
  .register(new QwenCodeAdapter())
  .register(new ContinueCliAdapter())
  .register(new KiroCliAdapter())
  .register(new AntigravityCliAdapter())
  .register(new MockAgentAdapter());
const store = new Store({ agent: DEFAULT_AGENT, cwd: CWD });
const activeRuns = new Set<string>();
// Idempotency: turnIds already executed here. `activeRuns` only blocks a CONCURRENT duplicate;
// this makes a re-delivered send (reconnect resend / queue re-flush / WS redelivery) run at most once.
const seenTurns = createSeenSet();

let ws: WebSocket | null = null;
// Outbound resilience (turn resume): while the socket is down a mid-turn agent keeps running here
// (only an explicit cancel aborts it), so without this its live stream AND its final reply would be
// silently dropped by send() — the turn finishes into the local store but a viewer on the Hub never
// sees it (it only reappears if they re-open the session). Buffer the turn-OUTPUT messages emitted
// during an outage and replay them on reconnect, so the Hub re-forwards them to whoever's watching.
// Bounded ring (newest kept) so a long turn over a long outage can't grow unbounded — dropping the
// OLDEST preserves the terminal 'done'/'error', which is the one event that must survive. Control/list
// messages (register/pong/sessions/caps/runs) are regenerated on reconnect, so they're never buffered.
const outbox = new Outbox<RunnerToHub>(3000);
function send(m: RunnerToHub): void {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return; }
  if (m.t === "agent_event" || m.t === "stream" || m.t === "message") outbox.push(m);
}
/** Replay turn output buffered during an outage. Called right after a reconnect's `welcome` (socket
 *  OPEN again), before the fresh session/caps push, so the resumed stream lands in order. */
function flushOutbox(): void {
  if (!outbox.size) return;
  const pending = outbox.drain();
  console.log(`[runner] reconectado — reenviando ${pending.length} evento(s) de turno bufferizados`);
  for (const m of pending) send(m);
}

// --- live mirror of native CLI sessions: tail the jsonl and push new turns as an
//     EXTERNAL Claude Code (or us) appends them, so the Hub UI updates without refresh. ---
interface Tail { path: string; claude: boolean; offset: number; buf: string; paused: boolean; timer: ReturnType<typeof setInterval>; }
const tails = new Map<string, Tail>();
const MAX_TAILS = 4;
function pollTail(sid: string): void {
  const t = tails.get(sid); if (!t || t.paused) return;
  let size = 0; try { size = statSync(t.path).size; } catch { return; }
  if (size <= t.offset) return;
  const len = size - t.offset; const fd = openSync(t.path, "r"); const b = Buffer.alloc(len);
  try { readSync(fd, b, 0, len, t.offset); } finally { closeSync(fd); }
  t.offset = size; t.buf += b.toString("utf8");
  const lines = t.buf.split("\n"); t.buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    for (const e of parseNativeEvents(line, t.claude)) {
      if (e.kind === "message") send({ t: "message", sessionId: sid, message: { role: e.role, text: e.text, ts: e.ts } });
      else send({ t: "activity", sessionId: sid, name: e.name, summary: e.summary, path: e.path, adds: e.adds, dels: e.dels, rows: e.rows });
    }
  }
}
function startTail(sid: string): void {
  if (tails.has(sid)) return;
  const f = nativeFilePath(sid); if (!f) return;
  if (tails.size >= MAX_TAILS) { const oldest = tails.keys().next().value; if (oldest) stopTail(oldest); }
  let size = 0; try { size = statSync(f.path).size; } catch { /* new file */ }
  tails.set(sid, { path: f.path, claude: f.claude, offset: size, buf: "", paused: false, timer: setInterval(() => pollTail(sid), 1000) });
}
function stopTail(sid: string): void { const t = tails.get(sid); if (t) { clearInterval(t.timer); tails.delete(sid); } }

// Availability is cached because register runs on every reconnect. Probes are read-only
// version/login-status checks and must never create an inference turn or throwaway session.
// A negative result must NOT stick: probing right before the user runs `claude auth login` would
// otherwise pin the machine to "no AI" for the whole TTL. Success is cached for an hour, failure
// only long enough to avoid a probe storm, so the machine recovers on its own after a login.
let agentsCache: { at: number; list: string[] } | null = null;
const OK_TTL = 3_600_000, FAIL_TTL = 30_000;
async function availableAgents(): Promise<string[]> {
  if (agentsCache && Date.now() - agentsCache.at < (agentsCache.list.length ? OK_TTL : FAIL_TTL)) return agentsCache.list;
  const out: string[] = [];
  for (const n of agents.names()) { try { if (await agents.get(n).available()) out.push(n); } catch { /* skip */ } }
  // Report HONESTLY: an empty list means nothing here is usable (e.g. `claude login` missing /
  // token expired → 401). The old fallback listed every agent anyway, which made the machine
  // look healthy in the UI and turned a clear auth problem into a mystery 401 on send.
  if (!out.length) console.warn('[runner] nenhuma IA disponível — autentique nesta máquina (ex.: `claude login`)');
  agentsCache = { at: Date.now(), list: out };
  return out;
}

function allSessions(): RunnerSession[] {
  const own = store.list().map((s: any) => ({ id: s.id, title: s.title, agent: s.agent, cwd: s.cwd, updatedAt: s.updatedAt, source: "managed" as const, writable: true }));
  const ownIds = new Set(own.map((s) => s.id));
  const native = listNative().filter((n) => !ownIds.has(n.id)).map((n) => ({ id: n.id, title: n.title, agent: n.agent, cwd: n.cwd, updatedAt: n.updatedAt, source: "native" as const, writable: n.agent === "claude-code" || n.agent === "codex" }));
  return [...own, ...native].sort((a, b) => b.updatedAt - a.updatedAt);
}
function pushSessions(): void { send({ t: "sessions", sessions: allSessions() }); }
function pushRuns(): void { send({ t: "runs", active: [...activeRuns] }); }

async function doHistory(reqId: string, sessionId: string): Promise<void> {
  if (isNativeId(sessionId)) {
    const h = nativeHistory(sessionId);
    if (!h) { send({ t: "error", reqId, message: "sessão nativa não encontrada" }); return; }
    send({ t: "history", reqId, sessionId, title: h.title, agent: h.agent, cwd: h.cwd, writable: h.agent === "claude-code" || h.agent === "codex", inputTokens: h.inputTokens, contextWindowTokens: h.contextWindowTokens, model: h.model, total: h.messages.length, messages: h.messages.map((m) => ({ role: m.role, text: m.text, ts: m.ts, name: m.name, detail: m.detail, path: m.path, adds: m.adds, dels: m.dels, rows: m.rows, activity: m.activity })), files: sessionFiles(sessionId) });
    startTail(sessionId); // live-mirror new turns (external CLI) to the Hub
  } else {
    const s = store.ensure(sessionId);
    const all = store.history(s.id);
    const nid = agents.get(s.agent).nativeSessionId?.(s.id);
    const nativeKey = nid ? nativeIdForAgent(s.agent, nid) : null, nh = nativeKey ? nativeHistory(nativeKey) : null;
    const nativeFiles = nativeKey ? sessionFiles(nativeKey) : [], derivedFiles = touchedFilesFromMessages(all), paths = new Set(nativeFiles.map((f) => f.path));
    send({
      t: "history", reqId, sessionId: s.id, title: s.title, agent: s.agent, cwd: s.cwd,
      writable: true, total: all.length, nativeId: nid, inputTokens: nh?.inputTokens, contextWindowTokens: nh?.contextWindowTokens, model: nh?.model,
      messages: all.map((m: any) => ({
        role: m.role, text: m.text, ts: m.ts, agent: m.agent, speaker: m.speaker,
        images: m.images, files: m.files, activity: m.activity, usage: m.usage,
      })),
      files: [...nativeFiles, ...derivedFiles.filter((f) => !paths.has(f.path))],
    });
  }
}

/** cwd / agent of a session on THIS machine (managed or native), for "@" search, "!" and "#" memory. */
function sessCwd(sid?: string): string { if (!sid) return CWD; if (isNativeId(sid)) return nativeInfo(sid)?.cwd || CWD; return store.get(sid)?.cwd || CWD; }
function sessAgent(sid?: string): string | undefined { if (!sid) return undefined; if (isNativeId(sid)) return nativeInfo(sid)?.agent; return store.get(sid)?.agent; }

// Live turns on this machine, so a {t:cancel} from the Hub can kill the actual agent process.
const runAborts = new Map<string, AbortController>();

async function executeRunnerAgentTurn(sessionId: string, selected: AgentAdapter, agentInput: string, cwd: string, opts: SendOpts, ctrl: AbortController): Promise<Awaited<ReturnType<AgentAdapter["send"]>> & { activity: AgentEvent[] }> {
  const turnId = opts.turnId || randomUUID();
  const sequencer = createEventSequencer(turnId);
  const bridge = createAgentEventBridge(turnId, sequencer);
  const activity: AgentEvent[] = [];
  const emit = (event: AgentEvent): void => {
    if (activity.length < 600) activity.push(event);
    send({ t: "agent_event", sessionId, agent: selected.name, event });
  };
  emit(bridge.accepted()); emit(bridge.started());
  try {
    const prior = store.history(sessionId).slice(0, -1).filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    const reply = await selected.send(sessionId, agentInput, cwd, { ...opts, turnId, history: prior, signal: ctrl.signal }, (ev) => emit(bridge.provider(ev)));
    if (reply.usage) emit(bridge.usage(reply.usage));
    emit(bridge.completed(reply.text));
    return { ...reply, activity };
  } catch (e: any) {
    if (ctrl.signal.aborted || String(e?.message) === ABORTED) { if (!sequencer.terminal) emit(bridge.cancelled()); }
    else if (!sequencer.terminal) emit(bridge.failed(String(e?.message ?? e), "PROVIDER_ERROR"));
    throw e;
  }
}

async function doSend(
  sessionId: string,
  text: string,
  agentName?: string,
  cwd?: string,
  opts?: SendOpts,
  attachments: Array<{ name: string; content: string; image?: boolean }> = [],
  turnId?: string,
): Promise<void> {
  if (turnId && !seenTurns.add(turnId)) { console.log(`[runner] turno duplicado ignorado (turnId=${turnId})`); return; }
  // One turn per session (authoritative): a second send while one runs = two agents on one repo.
  if (activeRuns.has(sessionId)) { send({ t: "busy", message: "Já há um processamento nesta sessão — aguarde terminar ou toque em Parar." }); return; }
  const ctrl = new AbortController();
  runAborts.set(sessionId, ctrl);
  activeRuns.add(sessionId); pushRuns();
  // pause the native tail so our own turn isn't double-broadcast (already streamed below)
  const tail = isNativeId(sessionId) ? tails.get(sessionId) : undefined;
  if (tail) tail.paused = true;
  let streamAgent: string | undefined;
  try {
    let agent: AgentAdapter, useCwd: string;
    if (isNativeId(sessionId)) {
      const info = nativeInfo(sessionId);
      if (!info) throw new Error("sessão nativa não encontrada");
      agent = agents.get(info.agent); streamAgent = agent.name; useCwd = info.cwd || CWD;
      const built = buildTurnAttachments(attachments, text, {
        saveImage: (name, bytes) => {
          const dir = join(JDIR, "pasted"); mkdirSync(dir, { recursive: true });
          const p = join(dir, `${Date.now()}-${String(name || "img").replace(/[^\w.-]/g, "_")}`);
          writeFileSync(p, bytes); return p;
        },
        previewImage: (name, bytes) => imageDataUrl(name, bytes),
      });
      send({ t: "message", sessionId, message: { role: "user", text: built.showText, ts: Date.now(), agent: agent.name, images: built.images, files: built.files } });
      const bang = await expandBang(built.agentText, useCwd);
      const cmdExp = bang ? null : expandCommand(built.agentText, useCwd, cmdAgentOf(agent.name));
      const agentInput = bang ? bang.expanded : (cmdExp ? cmdExp.expanded : built.agentText);
      await executeRunnerAgentTurn(sessionId, agent, agentInput, useCwd, { ...opts, turnId }, ctrl);
    } else {
      const s = store.ensure(sessionId, agentName ? { agent: agentName, cwd: cwd || CWD } : undefined);
      agent = agents.get(s.agent); streamAgent = agent.name; useCwd = s.cwd || CWD;
      const built = buildTurnAttachments(attachments, text, {
        saveImage: (name, bytes) => {
          const dir = join(JDIR, "pasted"); mkdirSync(dir, { recursive: true });
          const p = join(dir, `${Date.now()}-${String(name || "img").replace(/[^\w.-]/g, "_")}`);
          writeFileSync(p, bytes); return p;
        },
        previewImage: (name, bytes) => imageDataUrl(name, bytes),
      });
      const ctx: TurnCtx = {
        ensure: (sid) => store.ensure(sid),
        resolveAgentName: (name) => agents.get(name).name,
        add: (sid, msg) => store.add(sid, msg),
        broadcast: (sid, message) => send({ t: "message", sessionId: sid, message: (message as any).message }),
        pushSessions,
        now: () => Date.now(),
        speak: async () => {},
        runAgentTurn: async (sid, name, agentText, turnCwd, turnOpts) => {
          const selected = agents.get(name);
          const bang = await expandBang(agentText, turnCwd);
          const cmdExp = bang ? null : expandCommand(agentText, turnCwd, cmdAgentOf(selected.name));
          const agentInput = bang ? bang.expanded : (cmdExp ? cmdExp.expanded : agentText);
          return executeRunnerAgentTurn(sid, selected, agentInput, turnCwd, turnOpts, ctrl);
        },
      };
      await runManagedTurn(ctx, sessionId, {
        showText: built.showText, agentText: built.agentText, model: opts?.model, effort: opts?.effort, turnId,
        images: built.images, files: built.files,
        onError: (message) => {
          if (!(ctrl.signal.aborted || message === ABORTED)) send({ t: "error", message });
        },
      });
    }
  } catch (e: any) {
    // User-initiated cancel: not an error — tell the UI it stopped and stay quiet otherwise.
    if (!(ctrl.signal.aborted || String(e?.message) === ABORTED)) {
      send({ t: "error", message: String(e?.message ?? e) });
    }
  } finally {
    if (runAborts.get(sessionId) === ctrl) runAborts.delete(sessionId);
    activeRuns.delete(sessionId); pushRuns();
    if (tail) { try { tail.offset = statSync(tail.path).size; tail.buf = ""; } catch { /* ignore */ } tail.paused = false; }
  }
}

let reconnectDelay = 1000;
function connect(): void {
  const sock = new WebSocket(HUB_URL);
  ws = sock;
  // Inverse heartbeat / half-open detection. The Hub pings every 20s; ANY inbound frame refreshes
  // this clock. A dead TCP half-open (Hub crashed, NAT dropped the mapping) never fires 'close', so
  // the socket would sit "OPEN" for minutes while every turn event is written into the void (send()
  // only buffers to the outbox when readyState !== OPEN). If three ping cycles pass with no traffic,
  // terminate the socket ourselves — that fires 'close', which reconnects and re-arms the outbox.
  let lastInbound = Date.now();
  const hb = setInterval(() => {
    if (sock.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastInbound > 60000) { console.warn("[runner] Hub sem ping há 60s — encerrando socket meio-aberto"); try { sock.terminate(); } catch { /* ignore */ } }
  }, 20000);
  hb.unref?.();
  sock.on("open", async () => {
    reconnectDelay = 1000;
    const available = await availableAgents();
    // Publish the full catalog (including not_installed/unauthenticated reasons). `agents` remains
    // the executable allow-list; descriptors let the UI explain why another adapter is unavailable.
    const descriptors = await agents.describe();
    const agentUsage: Record<string, unknown | null> = {};
    for (const name of agents.names()) { const a = agents.get(name); try { agentUsage[name] = a.usage ? await a.usage() : null; } catch { agentUsage[name] = null; } }
    const info: RunnerInfo = {
      runnerId: RUNNER_ID, host: hostname(), os: platform(), agents: available,
      agentDescriptors: descriptors, agentUsage, protocolVersion: RUNNER_PROTOCOL_VERSION,
      version: VERSION, commit: await repoCommit(RUNNER_ROOT), label: process.env.JARVIS_LABEL || undefined,
    };
    send({ t: "register", token: TOKEN, info });
  });
  sock.on("message", async (data) => {
    lastInbound = Date.now();
    let m: any; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== "object" || typeof m.t !== "string") return; // drop junk / non-object frames
    try {
      if (m.t === "welcome") { console.log(`[runner] registered as ${RUNNER_ID} (${hostname()})`); flushOutbox(); pushSessions(); pushRuns(); send({ t: "caps", agent: DEFAULT_AGENT, caps: await agents.describe() }); return; }
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
      if (m.t === "readfile" && typeof m.path === "string") { send({ t: "filecontent", reqId: m.reqId, ...readProjectFile(m.path, m.cwd) }); return; }
      if (m.t === "readdiff" && typeof m.path === "string" && typeof m.sessionId === "string") {
        const diffId = isNativeId(m.sessionId) ? m.sessionId : (() => { const s = store.get(m.sessionId); const nid = s && agents.get(s.agent).nativeSessionId?.(s.id); return s && nid ? (nativeIdForAgent(s.agent, nid) || "") : ""; })();
        send({ t: "filediff", reqId: m.reqId, ...(diffId ? sessionFileDiff(diffId, m.path) : { path: m.path, name: m.path.split(/[\\/]/).pop() || m.path, error: "sem sessão nativa vinculada" }) });
        return;
      }
      if (m.t === "delete" && (typeof m.sessionId === "string" || Array.isArray(m.sessionIds))) {
        const ids: string[] = Array.isArray(m.sessionIds) ? m.sessionIds.filter((x: any) => typeof x === "string") : [m.sessionId];
        for (const sid of ids) {
          if (isNativeId(sid)) { stopTail(sid); deleteNative(sid); }
          else {
            const s = store.get(sid);
            if (s) {
              const ag = agents.get(s.agent);
              if (m.alsoNative && ag.nativeSessionId) { const nid = ag.nativeSessionId(sid); const key = nid && nativeIdForAgent(s.agent, nid); if (key) deleteNative(key); }
              ag.forgetSession?.(sid);
            }
            store.delete(sid);
          }
        }
        pushSessions();
        return;
      }
      if (m.t === "open" && typeof m.sessionId === "string") { await doHistory(m.reqId, m.sessionId); return; }
      if (m.t === "listdir") {
        const base = (typeof m.path === "string" && m.path) ? m.path : homedir();
        try {
          const entries = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort((a, b) => a.localeCompare(b));
          send({ t: "dirs", reqId: m.reqId, path: base, parent: dirname(base), entries });
        } catch (e: any) { send({ t: "error", reqId: m.reqId, message: "listdir: " + String(e?.message ?? e) }); }
        return;
      }
      if (m.t === "configure" && typeof m.sessionId === "string") {
        const s = store.get(m.sessionId);
        if (!s) { send({ t: "error", reqId: m.reqId, message: "sessão não encontrada" }); return; }
        const agentName = agents.names().includes(m.agent) ? m.agent : undefined;
        const cwd = (typeof m.cwd === "string" && m.cwd && existsSync(m.cwd)) ? m.cwd : undefined;
        if (!store.reconfigure(s.id, { agent: agentName, cwd })) { send({ t: "error", reqId: m.reqId, message: "sessão já iniciada — agente e pasta travados" }); return; }
        const ns = store.get(s.id)!;
        const all = store.history(ns.id);
        send({ t: "history", reqId: m.reqId, sessionId: ns.id, title: ns.title, agent: ns.agent, cwd: ns.cwd, writable: true, total: all.length, messages: all.map((x: any) => ({ role: x.role, text: x.text, ts: x.ts })) });
        pushSessions();
        return;
      }
      if (m.t === "send" && typeof m.sessionId === "string") {
        await doSend(
          m.sessionId, String(m.text ?? ""), m.agent, m.cwd,
          { model: m.model ?? m.opts?.model, effort: m.effort ?? m.opts?.effort },
          Array.isArray(m.attachments) ? m.attachments : [],
          typeof m.turnId === "string" ? m.turnId : undefined,
        );
        return;
      }
      if (m.t === "caps") { send({ t: "caps", agent: m.agent || DEFAULT_AGENT, caps: await agents.describe() }); return; }
      if (m.t === "commands") { send({ t: "command_list", reqId: m.reqId, commands: listCommandsPublic(CWD) }); return; }
      if (m.t === "mention") { send({ t: "mention_list", reqId: m.reqId, files: listMentionFiles(sessCwd(m.sessionId), typeof m.q === "string" ? m.q : "") }); return; }
      if (m.t === "memory_append" && typeof m.text === "string") {
        try { const r = appendMemory(m.text, sessCwd(m.sessionId), cmdAgentOf(sessAgent(m.sessionId))); if (m.sessionId) send({ t: "message", sessionId: m.sessionId, message: { role: "assistant", text: "📝 Anotado em " + r.file, ts: Date.now() } }); }
        catch (e: any) { send({ t: "error", message: "memória: " + String(e?.message ?? e) }); }
        return;
      }
      if (m.t === "update") {
        console.log("[runner] update solicitado pelo Hub...", m.force ? "(forçado)" : "");
        const r = await updateApply(RUNNER_ROOT, { force: !!m.force });
        console.log("[runner] update:", r.ok ? "ok" : "falhou", "-", r.log.replace(/\n/g, " ").slice(0, 160));
        // Report back: this used to land only in THIS machine's console, so the Hub said
        // "atualizando N máquinas" and an abort here was invisible — you'd find out days later.
        send({ t: "update_done", ok: r.ok, dirty: !!r.dirty, behind: r.behind ?? 0, log: r.log.slice(0, 600) });
        if (r.ok && ((r.behind ?? 0) > 0 || m.force)) void drainAndExit();
        return;
      }
      if ((m.t === "cancel" || m.t === "stop") && typeof m.sessionId === "string") { runAborts.get(m.sessionId)?.abort(); return; }
    } catch (e: any) { send({ t: "error", reqId: m?.reqId, message: String(e?.message ?? e) }); }
  });
  sock.on("close", () => { clearInterval(hb); ws = null; setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); console.log(`[runner] disconnected; retrying in ${reconnectDelay / 1000}s`); });
  sock.on("error", (e: any) => { console.error("[runner] ws error:", e?.message ?? e); });
}

/** Wait for in-flight turns to finish (up to a deadline), then restart via the service manager. A
 *  restart mid-turn kills the agent's process tree — draining lets the running turn land its reply
 *  first; the deadline stops a stuck turn from blocking the update forever. */
async function drainAndExit(deadlineMs = 120000): Promise<void> {
  const start = Date.now();
  while (activeRuns.size && Date.now() - start < deadlineMs) await new Promise((r) => setTimeout(r, 1000));
  if (activeRuns.size) console.warn(`[runner] reiniciando com ${activeRuns.size} turno(s) ainda ativo(s) — deadline atingido`);
  try { restartService("runner"); } catch { /* ignore */ }
  process.exit(0);
}
// Graceful shutdown: a service stop / SIGTERM otherwise leaves the spawned agent CLIs (running with
// bypassPermissions) orphaned — still working, still spending tokens, with nothing to collect the
// result. Abort every live turn (killTree fires via the AbortSignal) before exiting.
let shuttingDown = false;
function shutdown(sig: string): void {
  if (shuttingDown) return; shuttingDown = true;
  if (runAborts.size) console.log(`[runner] ${sig} — abortando ${runAborts.size} turno(s) em andamento`);
  for (const [, ctrl] of runAborts) { try { ctrl.abort(); } catch { /* ignore */ } }
  setTimeout(() => process.exit(0), 300); // brief grace so killTree's taskkill can spawn
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`[runner] id=${RUNNER_ID} host=${hostname()} os=${platform()} -> ${HUB_URL}`);
// Surface the #1 misconfig at boot instead of as a silent reject 20s later: an empty token means the
// Hub drops the register unless it runs with JARVIS_AUTH=off. Warn (not exit) so the auth-off case
// still works. Louder still when pointing at a REMOTE hub, where a missing token is almost never intended.
if (!TOKEN) {
  const remote = !/^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(HUB);
  console.warn(`[runner] ⚠ JARVIS_TOKEN vazio — com auth ligada (padrão) o Hub vai rejeitar o registro.`);
  if (remote) console.warn(`[runner] ⚠ Hub remoto (${HUB}) sem token: gere um com \`jarvis machine "<label>"\` no Hub e grave JARVIS_TOKEN=... em ~/.jarvis/runner.env.`);
}
try { const purged = purgeProbeJunk(); if (purged) console.log(`[runner] limpei ${purged} sessão(ões) de sondagem "ok"`); } catch { /* ignore */ }
try { const s = purgeScratch(); if (s) console.log(`[runner] limpei ${s} transcript(s) descartável(is) de one-shot`); } catch { /* ignore */ }
connect();
// keep native/managed session list fresh (native sessions can change out-of-band)
setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) pushSessions(); }, 6000);
