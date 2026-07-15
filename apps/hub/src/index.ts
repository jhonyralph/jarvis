/**
 * Jarvis Hub (v1) — local server: serves the chat PWA + a WebSocket that routes
 * messages to an AgentAdapter and (optionally) speaks the reply via local TTS.
 *
 * Runs NATIVELY (no WSL). Cross-platform (Windows/Linux/Mac).
 *
 * Env:
 *   JARVIS_PORT   (default 4577)
 *   JARVIS_CWD    working dir for the agent (default: process.cwd())
 *   JARVIS_VOICE  Piper voice (default en_GB-alan-medium)
 *   JARVIS_AGENT  "claude" to use native Claude Code; anything else => mock
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AgentRegistry, MockAgentAdapter, ClaudeCodeAdapter, CodexAdapter } from "./agents.js";
import { synthesize } from "./tts.js";
import { transcribe } from "./stt.js";
import { speechifyCapped } from "./speechify.js";
import { runSessionSearch, looksLikeCrossSessionQuery } from "./search.js";
import { identifySpeaker, enrollSpeaker, listSpeakers, deleteSpeaker } from "./speaker.js";
import { listNative, nativeHistory, isNativeId } from "./native.js";
import { parseVoiceIntent } from "./voiceIntent.js";
import { Store } from "./store.js";

const WEB = fileURLToPath(new URL("../web", import.meta.url));
const PORT = Number(process.env.JARVIS_PORT || 4577);
const CWD = process.env.JARVIS_CWD || process.cwd();
const VOICE = process.env.JARVIS_VOICE || "en_GB-alan-medium";
// cap how many messages we send/render on open — long sessions were heavy on mobile
const HISTORY_CAP = Number(process.env.JARVIS_HISTORY_CAP || 120);

// Agnostic registry — every agent is registered; clients pick per message.
const DEFAULT_AGENT = process.env.JARVIS_AGENT || "mock";
const agents = new AgentRegistry(DEFAULT_AGENT)
  .register(new ClaudeCodeAdapter())
  .register(new CodexAdapter())
  .register(new MockAgentAdapter());
const WAKE_SESSION = process.env.JARVIS_WAKE_SESSION || "voice";
const store = new Store({ agent: agents.default, cwd: CWD });
// dedicated, locked-agent/cwd session that the machine wake listener injects into
store.ensure(WAKE_SESSION, { agent: process.env.JARVIS_WAKE_AGENT || agents.default, cwd: process.env.JARVIS_WAKE_CWD || CWD, title: "Voz (Jarvis)" });

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

const server = createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  const file = normalize(join(WEB, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = file.slice(file.lastIndexOf("."));
  // no-cache: clients (esp. mobile) must always get the latest UI, never a stale index.html
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache, must-revalidate" });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ server });

// Which session each client is currently viewing — for broadcast + listener mode.
const subs = new Map<WebSocket, string>();
// machine wake-word listener sockets + whether "Hey Jarvis" is armed.
const wakeClients = new Set<WebSocket>();
let wakeEnabled = process.env.JARVIS_WAKE !== "0";
// speaker-id: label voice messages with the enrolled speaker; optionally reject
// unknown voices (gate). Off by default so an un-enrolled user is never locked out.
let voiceGate = process.env.JARVIS_VOICE_GATE === "1";
let voiceThreshold: number | undefined = process.env.JARVIS_VOICE_THRESHOLD ? Number(process.env.JARVIS_VOICE_THRESHOLD) : undefined;
// proactive-voice session setup: which agent/model/effort/folder the wake session
// uses, and a task held while we ask the user "continuar ou nova sessão?".
const voiceConfig: { agent: string; model?: string; effort?: string; cwd: string } = {
  agent: process.env.JARVIS_WAKE_AGENT || DEFAULT_AGENT,
  cwd: process.env.JARVIS_WAKE_CWD || CWD,
};
let voicePending: { task: string } | null = null;
// cheap gate: only spend an LLM intent pass when the utterance plausibly carries a command
const VOICE_HINT = /\b(codex|claude|gpt|opus|sonnet|haiku|fable|terra|luna|sol|modelo|model|esfor[çc]o|effort|pasta|diret[óo]rio|folder|sess[ãa]o|nov[ao]|continu|seguir|trocar|usar?|use|come[çc]ar)\b/i;
const PT_EFFORT: Record<string, string> = { minimal: "mínimo", low: "baixo", medium: "médio", high: "alto", xhigh: "muito alto", max: "máximo", ultra: "ultra", ultracode: "ultracode" };

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
/** to every client currently viewing `sessionId` (keeps desktop + phone in sync) */
function broadcast(sessionId: string, obj: unknown): void {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === c.OPEN && subs.get(c as WebSocket) === sessionId) c.send(s);
}
/** to everyone (e.g. the session list changed) */
function broadcastAll(obj: unknown): void {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(s);
}
/** Jarvis's own sessions merged with imported native Claude/Codex sessions (agent-tagged, newest first). */
function allSessions(): any[] {
  const own = store.list();
  const ownIds = new Set(own.map((s) => s.id));
  const native = listNative()
    .filter((n) => !ownIds.has(n.id))
    .map((n) => ({ id: n.id, title: n.title, agent: n.agent, cwd: n.cwd, createdAt: n.updatedAt, updatedAt: n.updatedAt, lastMessage: "", count: n.count }));
  return [...own, ...native].sort((a, b) => b.updatedAt - a.updatedAt);
}
/** The N most-recently-used distinct working folders (across all sessions) — for the folder picker + voice. */
function recentDirsList(n = 10): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of allSessions()) {
    const d = (s.cwd || "").trim();
    if (d && !seen.has(d)) { seen.add(d); out.push(d); if (out.length >= n) break; }
  }
  return out;
}
function sessionsPayload(): unknown { return { t: "sessions", sessions: allSessions(), recentDirs: recentDirsList() }; }
function pushSessions(): void { broadcastAll(sessionsPayload()); }
function sendSessions(ws: WebSocket): void { send(ws, sessionsPayload()); }

/** One full turn against a session's agent: store+broadcast the user msg, get the reply, speak if asked. */
async function deliverTurn(sid: string, opts: { showText: string; agentText?: string; model?: string; effort?: string; speak?: boolean; speaker?: string }): Promise<void> {
  const session = store.ensure(sid);
  const agent = agents.get(session.agent);
  const now = Date.now();
  store.add(sid, { role: "user", text: opts.showText, ts: now, agent: agent.name, speaker: opts.speaker });
  broadcast(sid, { t: "message", message: { sessionId: sid, role: "user", text: opts.showText, ts: now, agent: agent.name, speaker: opts.speaker } });
  pushSessions();
  try {
    const reply = await agent.send(sid, opts.agentText ?? opts.showText, session.cwd, { model: opts.model, effort: opts.effort });
    const rt = Date.now();
    store.add(sid, { role: "assistant", text: reply.text, ts: rt, agent: agent.name });
    broadcast(sid, { t: "message", message: { sessionId: sid, role: "assistant", text: reply.text, ts: rt, agent: agent.name } });
    if (reply.usage) broadcast(sid, { t: "usage", sessionId: sid, usage: reply.usage });
    pushSessions();
    if (opts.speak) {
      const spoken = speechifyCapped(reply.text);
      if (spoken) { const wav = await synthesize(spoken, VOICE); broadcast(sid, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: spoken }); }
    }
  } catch (e: any) {
    const message = String(e?.message ?? e);
    broadcast(sid, { t: "error", message, limit: /limit|rate|quota|exceeded|usage/i.test(message) });
  }
}

/** Jarvis speaks a short control line into the voice session (not from the agent). */
async function voiceSay(text: string): Promise<void> {
  broadcast(WAKE_SESSION, { t: "message", message: { sessionId: WAKE_SESSION, role: "assistant", text, ts: Date.now(), agent: "jarvis" } });
  try { const wav = await synthesize(text, VOICE); broadcast(WAKE_SESSION, { t: "tts", sessionId: WAKE_SESSION, audio: wav.toString("base64"), text }); } catch { /* tts optional */ }
}
function resetVoiceSession(): void {
  const s = store.reset(WAKE_SESSION, { agent: voiceConfig.agent, cwd: voiceConfig.cwd, title: "Voz (Jarvis)" });
  broadcast(WAKE_SESSION, { t: "history", sessionId: s.id, session: { agent: s.agent, cwd: s.cwd, title: s.title }, messages: [] });
  pushSessions();
}
async function runVoiceTask(task: string, speak: boolean, speaker?: string): Promise<void> {
  const s = store.ensure(WAKE_SESSION);
  if (s.messages.length === 0) store.reconfigure(WAKE_SESSION, { agent: voiceConfig.agent, cwd: voiceConfig.cwd });
  await deliverTurn(WAKE_SESSION, { showText: task, model: voiceConfig.model, effort: voiceConfig.effort, speak, speaker });
}

/** Proactive-voice router: pick agent/model/effort/folder from speech, and confirm
 *  new-vs-continue when a conversation is already in progress. */
async function handleVoiceTurn(text: string, speak: boolean, speaker?: string): Promise<void> {
  const inProgress = store.ensure(WAKE_SESSION).messages.length > 0;
  // answering a pending "continuar ou nova?" (cheap, no LLM)
  if (voicePending) {
    const t = voicePending.task;
    if (/\bnov[ao]\b|come[çc]ar|do zero|outra/i.test(text)) { voicePending = null; resetVoiceSession(); await runVoiceTask(t, speak, speaker); return; }
    if (/\bcontinu|\bsegu|\bmesm[ao]\b|manter/i.test(text)) { voicePending = null; await runVoiceTask(t, speak, speaker); return; }
    voicePending = { task: text }; await voiceSay("Não entendi. Diga 'continuar' para seguir, ou 'nova' para começar do zero."); return;
  }
  // plain task, fresh session -> run directly (no LLM)
  if (!inProgress && !VOICE_HINT.test(text)) { await runVoiceTask(text, speak, speaker); return; }
  // plain task, in progress -> ask new-vs-continue
  if (inProgress && !VOICE_HINT.test(text)) { voicePending = { task: text }; await voiceSay("Já tenho uma conversa em andamento. Quer continuar ou começar uma nova?"); return; }
  // command-ish utterance -> one LLM intent pass
  const desc = await agents.describe();
  const catalog = desc.map((a) => `${a.name} — modelos: ${a.models.map((m) => m.id).join(", ")} — esforços: ${[...new Set(a.models.flatMap((m) => m.efforts))].join(", ")}`).join("\n");
  const intent = await parseVoiceIntent({ text, catalog, recent: recentDirsList(20), inProgress, config: voiceConfig, agents });
  const empty = store.ensure(WAKE_SESSION).messages.length === 0;
  if (intent.agent && desc.some((a) => a.name === intent.agent) && empty) voiceConfig.agent = intent.agent;
  const acaps = desc.find((a) => a.name === voiceConfig.agent);
  if (intent.model && acaps?.models.some((m) => m.id === intent.model)) voiceConfig.model = intent.model;
  const efs = acaps?.models.find((m) => m.id === voiceConfig.model)?.efforts ?? acaps?.models.flatMap((m) => m.efforts) ?? [];
  if (intent.effort && efs.includes(intent.effort)) voiceConfig.effort = intent.effort;
  if (intent.folder && recentDirsList(20).includes(intent.folder) && empty) voiceConfig.cwd = intent.folder;
  const action = intent.sessionAction;
  const task = (intent.task || "").trim();
  if (!task) {
    if (action === "new") resetVoiceSession();
    const parts = [`Ok, ${voiceConfig.agent}`];
    if (voiceConfig.model) parts.push(`modelo ${voiceConfig.model}`);
    if (voiceConfig.effort) parts.push(`esforço ${PT_EFFORT[voiceConfig.effort] || voiceConfig.effort}`);
    if (voiceConfig.cwd) parts.push(`pasta ${voiceConfig.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}`);
    await voiceSay(parts.join(", ") + ". Pode falar.");
    return;
  }
  if (action === "new") { resetVoiceSession(); await runVoiceTask(task, speak, speaker); return; }
  if (inProgress && action !== "continue") { voicePending = { task }; await voiceSay("Já tenho uma conversa em andamento. Quer continuar ou começar uma nova?"); return; }
  await runVoiceTask(task, speak, speaker);
}
/** Cross-session search: reason over recent sessions, reply only to the asker (optionally spoken). */
async function runAndSendSearch(ws: WebSocket, query: string, speak: boolean): Promise<void> {
  const r = await runSessionSearch({ query, store, agents });
  let audio: string | undefined;
  if (speak) {
    const spoken = speechifyCapped(r.answer);
    if (spoken) audio = (await synthesize(spoken, VOICE)).toString("base64");
  }
  send(ws, { t: "searchResult", query, answer: r.answer, matches: r.matches, action: r.action, audio });
}
/** Current speaker-id config + enrolled voiceprints (listing is cheap — no torch). */
async function sendVoiceState(ws: WebSocket): Promise<void> {
  send(ws, { t: "voice_state", gate: voiceGate, threshold: voiceThreshold ?? null, speakers: await listSpeakers() });
}
async function broadcastVoiceState(): Promise<void> {
  const speakers = await listSpeakers();
  broadcastAll({ t: "voice_state", gate: voiceGate, threshold: voiceThreshold ?? null, speakers });
}

wss.on("connection", (ws: WebSocket) => {
  // Attach listeners SYNCHRONOUSLY (before any await) so a client message sent
  // right after connect is never dropped. The initial state below is async
  // (agent caps + speaker list, which spawns Python), so pushing it before the
  // message listener was attached created a window where "open" etc. were lost.
  ws.on("close", () => {
    subs.delete(ws);
    wakeClients.delete(ws);
  });

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // --- session management (shared across every client) ---
    if (msg.t === "list") {
      sendSessions(ws);
      return;
    }
    // wake-word control (machine listener <-> browsers)
    if (msg.t === "wake_hello") { wakeClients.add(ws); send(ws, { t: "wake_state", enabled: wakeEnabled }); return; }
    if (msg.t === "wake") { wakeEnabled = !!msg.enabled; for (const c of wakeClients) send(c, { t: "wake_state", enabled: wakeEnabled }); broadcastAll({ t: "wake_state", enabled: wakeEnabled }); return; }
    if (msg.t === "wake_event") { broadcast(WAKE_SESSION, { t: "wake_event", phase: msg.phase }); return; }
    // speaker identification: enroll voiceprints, list them, toggle the unknown-voice gate
    if (msg.t === "speakers") { await sendVoiceState(ws); return; }
    if (msg.t === "voicecfg") {
      if (typeof msg.gate === "boolean") voiceGate = msg.gate;
      if (typeof msg.threshold === "number") voiceThreshold = msg.threshold;
      await broadcastVoiceState();
      return;
    }
    if (msg.t === "enroll" && typeof msg.name === "string" && Array.isArray(msg.samples)) {
      try {
        const bufs = msg.samples.filter((s: any) => typeof s === "string").map((s: string) => Buffer.from(s, "base64"));
        if (!bufs.length) { send(ws, { t: "error", message: "enroll: nenhum áudio recebido" }); return; }
        const r = await enrollSpeaker(msg.name, bufs, typeof msg.ext === "string" ? msg.ext : "webm");
        send(ws, { t: "enrolled", name: r.name, samples: r.samples });
        await broadcastVoiceState();
      } catch (e: any) {
        send(ws, { t: "error", message: "enroll: " + String(e?.message ?? e) });
      }
      return;
    }
    if (msg.t === "delspk" && typeof msg.name === "string") {
      await deleteSpeaker(msg.name);
      await broadcastVoiceState();
      return;
    }
    // folder browser for the "new conversation" dialog (Hub machine)
    if (msg.t === "listdir") {
      const base = typeof msg.path === "string" && msg.path ? msg.path : homedir();
      try {
        const entries = readdirSync(base, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b));
        send(ws, { t: "dirs", path: base, parent: dirname(base), entries });
      } catch (e: any) {
        send(ws, { t: "error", message: "listdir: " + String(e?.message ?? e) });
      }
      return;
    }
    if (msg.t === "open" && typeof msg.sessionId === "string" && isNativeId(msg.sessionId)) {
      subs.set(ws, msg.sessionId);
      const h = nativeHistory(msg.sessionId);
      if (!h) { send(ws, { t: "error", message: "sessão nativa não encontrada" }); return; }
      send(ws, {
        t: "history",
        sessionId: msg.sessionId,
        session: { agent: h.agent, cwd: h.cwd, title: h.title, native: true },
        total: h.messages.length,
        messages: h.messages.slice(-HISTORY_CAP).map((m) => ({ sessionId: msg.sessionId, role: m.role, text: m.text, ts: m.ts, agent: h.agent })),
      });
      return;
    }
    if (msg.t === "open" && typeof msg.sessionId === "string") {
      subs.set(ws, msg.sessionId);
      const s = store.ensure(msg.sessionId);
      const all = store.history(s.id);
      send(ws, { t: "history", sessionId: s.id, session: { agent: s.agent, cwd: s.cwd, title: s.title }, total: all.length, messages: all.slice(-HISTORY_CAP) });
      return;
    }
    if (msg.t === "new") {
      const id = randomUUID();
      const agentName = agents.names().includes(msg.agent) ? msg.agent : agents.default;
      const cwd = typeof msg.cwd === "string" && existsSync(msg.cwd) ? msg.cwd : CWD;
      const s = store.ensure(id, { agent: agentName, cwd });
      subs.set(ws, id);
      send(ws, { t: "history", sessionId: id, session: { agent: s.agent, cwd: s.cwd, title: s.title }, messages: [] });
      pushSessions();
      return;
    }
    // Change agent/folder of a session that has not started yet (locked-session rule).
    if (msg.t === "configure" && typeof msg.sessionId === "string") {
      const s = store.get(msg.sessionId);
      if (!s) { send(ws, { t: "error", message: "sessão não encontrada" }); return; }
      const agent = agents.names().includes(msg.agent) ? msg.agent : undefined;
      const cwd = typeof msg.cwd === "string" && existsSync(msg.cwd) ? msg.cwd : undefined;
      if (!store.reconfigure(s.id, { agent, cwd })) {
        send(ws, { t: "error", message: "sessão já iniciada — agente e pasta estão travados" });
        return;
      }
      const ns = store.get(s.id)!;
      send(ws, { t: "history", sessionId: ns.id, session: { agent: ns.agent, cwd: ns.cwd, title: ns.title }, messages: store.history(ns.id) });
      pushSessions();
      return;
    }

    // cross-session search (explicit) + execute-in-a-specific-session
    if (msg.t === "search" && typeof msg.query === "string") {
      await runAndSendSearch(ws, msg.query, !!msg.speak);
      return;
    }
    if (msg.t === "sendTo" && typeof msg.sessionId === "string" && typeof msg.text === "string") {
      const s = store.get(msg.sessionId);
      if (!s) { send(ws, { t: "error", message: "sessão não encontrada" }); return; }
      const ag = agents.get(s.agent);
      const now = Date.now();
      store.add(s.id, { role: "user", text: msg.text, ts: now, agent: s.agent });
      broadcast(s.id, { t: "message", message: { sessionId: s.id, role: "user", text: msg.text, ts: now, agent: s.agent } });
      pushSessions();
      try {
        const reply = await ag.send(s.id, msg.text, s.cwd, { model: msg.model, effort: msg.effort });
        const rt = Date.now();
        store.add(s.id, { role: "assistant", text: reply.text, ts: rt, agent: s.agent });
        broadcast(s.id, { t: "message", message: { sessionId: s.id, role: "assistant", text: reply.text, ts: rt, agent: s.agent } });
        pushSessions();
      } catch (e: any) {
        send(ws, { t: "error", message: String(e?.message ?? e) });
      }
      return;
    }

    // --- conversation (text or voice) ---
    const sid = subs.get(ws) || (typeof msg.sessionId === "string" ? msg.sessionId : "default");
    subs.set(ws, sid);
    if (isNativeId(sid)) {
      // imported native CLI session — read-only in Jarvis for now (no write-back bridge yet)
      send(ws, { t: "error", message: "Sessão nativa (somente leitura). Crie uma sessão do Jarvis para conversar." });
      return;
    }
    const session = store.ensure(sid); // agent + cwd are LOCKED to the session (chosen at creation)
    const agent = agents.get(session.agent);

    let text: string | null = null;
    let speaker: string | undefined; // enrolled speaker for voice messages (or wake-injected)
    if (msg.t === "send" && typeof msg.text === "string") {
      text = msg.text;
      if (typeof msg.speaker === "string") speaker = msg.speaker; // wake listener already identified it
    } else if (msg.t === "voice" && typeof msg.audio === "string") {
      const audio = Buffer.from(msg.audio, "base64");
      try {
        text = await transcribe(audio, msg.lang, msg.ext);
      } catch (e: any) {
        send(ws, { t: "error", message: "STT: " + String(e?.message ?? e) });
        return;
      }
      // who spoke? label the message and, if the gate is on, reject unknown voices.
      try {
        const id = await identifySpeaker(audio, msg.ext || "webm", voiceThreshold);
        if (id.known && id.name) speaker = id.name;
        if (voiceGate && !id.known) {
          send(ws, { t: "error", message: "voz não reconhecida", denied: true, score: id.score });
          if (msg.speak) {
            const wav = await synthesize("Desculpe, não reconheci a sua voz.", VOICE);
            send(ws, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: "Desculpe, não reconheci a sua voz." });
          }
          return;
        }
      } catch (e: any) {
        console.error("[speaker]", String(e?.message ?? e)); // speaker-id must never block the conversation
      }
    }
    if (!text) return;

    // Meta-question about other sessions? -> cross-session search (typed or spoken).
    if (looksLikeCrossSessionQuery(text)) {
      await runAndSendSearch(ws, text, !!msg.speak);
      return;
    }

    // Proactive-voice router: the wake session lets the user pick the agent/model/effort/
    // folder by speech, and asks new-vs-continue when a conversation is already going.
    if (sid === WAKE_SESSION) {
      await handleVoiceTurn(text, !!msg.speak, speaker);
      return;
    }

    // Attachments: what we SEND to the agent includes file contents; what we SHOW
    // stays the user's text + a small chip (files are viewable in the chat).
    const attachments: Array<{ name: string; content: string }> = Array.isArray(msg.attachments) ? msg.attachments : [];
    let agentText = text;
    if (attachments.length) {
      const block = attachments.map((a) => `--- arquivo anexado: ${a.name} ---\n${a.content}`).join("\n\n");
      agentText = `${block}\n\n${text}`;
      text = `${text}\n\n📎 ${attachments.map((a) => a.name).join(", ")}`;
    }

    const now = Date.now();
    // User message -> store + broadcast to everyone on this session (so all UIs show it).
    store.add(sid, { role: "user", text, ts: now, agent: agent.name, speaker });
    broadcast(sid, { t: "message", message: { sessionId: sid, role: "user", text, ts: now, agent: agent.name, speaker } });
    pushSessions();

    try {
      const opts = { model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined };
      const reply = await agent.send(sid, agentText, session.cwd, opts);
      const rt = Date.now();
      store.add(sid, { role: "assistant", text: reply.text, ts: rt, agent: agent.name });
      broadcast(sid, { t: "message", message: { sessionId: sid, role: "assistant", text: reply.text, ts: rt, agent: agent.name } });
      if (reply.usage) broadcast(sid, { t: "usage", sessionId: sid, usage: reply.usage });
      pushSessions();

      if (msg.speak) {
        const spoken = speechifyCapped(reply.text); // clean text, not raw markdown
        if (spoken) {
          const wav = await synthesize(spoken, VOICE);
          broadcast(sid, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: spoken });
        }
      }
    } catch (e: any) {
      const message = String(e?.message ?? e);
      const limit = /limit|rate|quota|exceeded|usage/i.test(message);
      send(ws, { t: "error", message, limit });
    }
  });

  // Initial state — pushed AFTER the message listener is attached (async: agent
  // capabilities + speaker list). Any client message that races in is now handled.
  void (async () => {
    send(ws, { t: "hello", agents: await agents.describe(), default: agents.default });
    sendSessions(ws);
    await sendVoiceState(ws);
  })();
});

server.listen(PORT, () => {
  console.log(`[hub] http+ws  http://127.0.0.1:${PORT}`);
  console.log(`[hub] agents=[${agents.names().join(", ")}]  default=${agents.default}  cwd=${CWD}  voice=${VOICE}`);
});
