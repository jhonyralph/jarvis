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
import { MockAgentAdapter, ClaudeCodeAdapter, type AgentAdapter } from "./agents.js";
import { synthesize } from "./tts.js";
import { Store } from "./store.js";

const WEB = fileURLToPath(new URL("../web", import.meta.url));
const PORT = Number(process.env.JARVIS_PORT || 4577);
const CWD = process.env.JARVIS_CWD || process.cwd();
const VOICE = process.env.JARVIS_VOICE || "en_GB-alan-medium";
const agent: AgentAdapter = process.env.JARVIS_AGENT === "claude" ? new ClaudeCodeAdapter() : new MockAgentAdapter();
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
  send(ws, { t: "hello", agent: agent.name });
  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t !== "send" || typeof msg.text !== "string") return;

    const sid = typeof msg.sessionId === "string" ? msg.sessionId : "default";
    const now = Date.now();
    store.add(sid, { role: "user", text: msg.text, ts: now });
    send(ws, { t: "message", message: { sessionId: sid, role: "user", text: msg.text, ts: now } });

    try {
      const reply = await agent.send(sid, msg.text, CWD);
      store.add(sid, { role: "assistant", text: reply.text, ts: Date.now() });
      send(ws, { t: "message", message: { sessionId: sid, role: "assistant", text: reply.text, ts: Date.now() } });

      if (msg.speak) {
        const wav = await synthesize(reply.text.slice(0, 600), VOICE);
        send(ws, { t: "tts", sessionId: sid, audio: wav.toString("base64") });
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
  console.log(`[hub] agent=${agent.name}  cwd=${CWD}  voice=${VOICE}`);
  if (agent.name === "mock") console.log(`[hub] (mock agent — set JARVIS_AGENT=claude after 'claude /login' for real replies)`);
});
