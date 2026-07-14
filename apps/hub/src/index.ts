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

wss.on("connection", (ws: WebSocket) => {
  send(ws, { t: "hello", agents: agents.names(), default: agents.default });
  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const sid = typeof msg.sessionId === "string" ? msg.sessionId : "default";
    const agent = agents.get(typeof msg.agent === "string" ? msg.agent : undefined);

    // Resolve the user's text — typed ("send") or spoken ("voice" → local STT).
    let text: string | null = null;
    if (msg.t === "send" && typeof msg.text === "string") {
      text = msg.text;
    } else if (msg.t === "voice" && typeof msg.audio === "string") {
      try {
        text = await transcribe(Buffer.from(msg.audio, "base64"), msg.lang, msg.ext);
        send(ws, { t: "transcript", sessionId: sid, text });
      } catch (e: any) {
        send(ws, { t: "error", message: "STT: " + String(e?.message ?? e) });
        return;
      }
    }
    if (!text) return;

    const now = Date.now();
    store.add(sid, { role: "user", text, ts: now });
    send(ws, { t: "message", message: { sessionId: sid, role: "user", text, ts: now, agent: agent.name } });

    try {
      const reply = await agent.send(sid, text, CWD);
      store.add(sid, { role: "assistant", text: reply.text, ts: Date.now() });
      send(ws, { t: "message", message: { sessionId: sid, role: "assistant", text: reply.text, ts: Date.now() } });

      if (msg.speak) {
        const spoken = speechifyCapped(reply.text); // speak clean text, not raw markdown
        if (spoken) {
          const wav = await synthesize(spoken, VOICE);
          send(ws, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: spoken });
        }
      }
    } catch (e: any) {
      send(ws, { t: "error", message: String(e?.message ?? e) });
    }
  });
});

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

server.listen(PORT, () => {
  console.log(`[hub] http+ws  http://127.0.0.1:${PORT}`);
  console.log(`[hub] agents=[${agents.names().join(", ")}]  default=${agents.default}  cwd=${CWD}  voice=${VOICE}`);
});
