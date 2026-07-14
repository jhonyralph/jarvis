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
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AgentRegistry, MockAgentAdapter, ClaudeCodeAdapter, CodexAdapter } from "./agents.js";
import { synthesize } from "./tts.js";
import { transcribe } from "./stt.js";
import { speechifyCapped } from "./speechify.js";
import { Store } from "./store.js";

const WEB = fileURLToPath(new URL("../web", import.meta.url));
const PORT = Number(process.env.JARVIS_PORT || 4577);
const CWD = process.env.JARVIS_CWD || process.cwd();
const VOICE = process.env.JARVIS_VOICE || "en_GB-alan-medium";

// Agnostic registry — every agent is registered; clients pick per message.
const DEFAULT_AGENT = process.env.JARVIS_AGENT || "mock";
const agents = new AgentRegistry(DEFAULT_AGENT)
  .register(new ClaudeCodeAdapter())
  .register(new CodexAdapter())
  .register(new MockAgentAdapter());
const store = new Store();

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
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ server });

// Which session each client is currently viewing — for broadcast + listener mode.
const subs = new Map<WebSocket, string>();

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

wss.on("connection", (ws: WebSocket) => {
  send(ws, { t: "hello", agents: agents.describe(), default: agents.default });
  send(ws, { t: "sessions", sessions: store.list() });
  ws.on("close", () => subs.delete(ws));

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // --- session management (shared across every client) ---
    if (msg.t === "list") {
      send(ws, { t: "sessions", sessions: store.list() });
      return;
    }
    if (msg.t === "open" && typeof msg.sessionId === "string") {
      subs.set(ws, msg.sessionId);
      store.ensure(msg.sessionId);
      send(ws, { t: "history", sessionId: msg.sessionId, messages: store.history(msg.sessionId) });
      return;
    }
    if (msg.t === "new") {
      const id = randomUUID();
      store.ensure(id, "Nova conversa");
      subs.set(ws, id);
      send(ws, { t: "history", sessionId: id, messages: [] });
      broadcastAll({ t: "sessions", sessions: store.list() });
      return;
    }

    // --- conversation (text or voice) ---
    const sid = subs.get(ws) || (typeof msg.sessionId === "string" ? msg.sessionId : "default");
    subs.set(ws, sid);
    const agent = agents.get(typeof msg.agent === "string" ? msg.agent : undefined);

    let text: string | null = null;
    if (msg.t === "send" && typeof msg.text === "string") {
      text = msg.text;
    } else if (msg.t === "voice" && typeof msg.audio === "string") {
      try {
        text = await transcribe(Buffer.from(msg.audio, "base64"), msg.lang, msg.ext);
      } catch (e: any) {
        send(ws, { t: "error", message: "STT: " + String(e?.message ?? e) });
        return;
      }
    }
    if (!text) return;

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
    store.add(sid, { role: "user", text, ts: now, agent: agent.name });
    broadcast(sid, { t: "message", message: { sessionId: sid, role: "user", text, ts: now, agent: agent.name } });
    broadcastAll({ t: "sessions", sessions: store.list() });

    try {
      const opts = { model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined };
      const reply = await agent.send(sid, agentText, CWD, opts);
      const rt = Date.now();
      store.add(sid, { role: "assistant", text: reply.text, ts: rt, agent: agent.name });
      broadcast(sid, { t: "message", message: { sessionId: sid, role: "assistant", text: reply.text, ts: rt, agent: agent.name } });
      if (reply.usage) broadcast(sid, { t: "usage", sessionId: sid, usage: reply.usage });
      broadcastAll({ t: "sessions", sessions: store.list() });

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
});

server.listen(PORT, () => {
  console.log(`[hub] http+ws  http://127.0.0.1:${PORT}`);
  console.log(`[hub] agents=[${agents.names().join(", ")}]  default=${agents.default}  cwd=${CWD}  voice=${VOICE}`);
});
