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
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, normalize, dirname, basename } from "node:path";
import QRCode from "qrcode";
import webpush from "web-push";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AgentRegistry, MockAgentAdapter, ClaudeCodeAdapter, CodexAdapter, type AgentAdapter, type AgentReply, type SendOpts } from "@jarvis/core";
import { synthesize } from "./tts.js";
import { transcribe } from "./stt.js";
import { speechify, speechifyCapped } from "./speechify.js";
import { runSessionSearch, looksLikeCrossSessionQuery } from "./search.js";
import { identifySpeaker, enrollSpeaker, listSpeakers, deleteSpeaker } from "./speaker.js";
import { listNative, nativeHistory, isNativeId, nativeInfo, nativeFilePath, parseNativeEvents, deleteNative, sessionFiles, sessionFileDiff, purgeProbeJunk } from "@jarvis/core";
import { parseVoiceIntent } from "./voiceIntent.js";
import { Store, updateCheck, updateApply, updateRollback, restartService, repoRemoteUrl, readProjectFile } from "@jarvis/core";
import type { RunnerInfo } from "@jarvis/protocol";
import * as auth from "./auth.js";
import * as guard from "./guard.js";

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

// ---- Web Push: notify when a turn finishes (works on a locked Android). VAPID keys
// + subscriptions live locally; the push protocol relays via the browser's FCM/APNs
// (payload is encrypted). ----
const JARVIS_DIR = join(homedir(), ".jarvis");
const VAPID_FILE = join(JARVIS_DIR, "vapid.json");
const SUBS_FILE = join(JARVIS_DIR, "push-subs.json");

// Summary/digest one-shot config — cheap by default (it's a light task), user-tunable in Settings.
const SUMMARY_FILE = join(JARVIS_DIR, "summary.json");
const summaryCfg: { agent: string; model: string; effort: string } = (() => {
  const d = { agent: process.env.JARVIS_SEARCH_AGENT || "claude-code", model: process.env.JARVIS_SUMMARY_MODEL || process.env.JARVIS_SEARCH_MODEL || "haiku", effort: "low" };
  try { mkdirSync(JARVIS_DIR, { recursive: true }); return { ...d, ...JSON.parse(readFileSync(SUMMARY_FILE, "utf8")) }; } catch { return d; }
})();
function saveSummaryCfg(): void { try { mkdirSync(JARVIS_DIR, { recursive: true }); writeFileSync(SUMMARY_FILE, JSON.stringify(summaryCfg, null, 2)); } catch { /* ignore */ } }
let vapid: { publicKey: string; privateKey: string };
try {
  vapid = JSON.parse(readFileSync(VAPID_FILE, "utf8"));
} catch {
  vapid = webpush.generateVAPIDKeys();
  try { mkdirSync(JARVIS_DIR, { recursive: true }); writeFileSync(VAPID_FILE, JSON.stringify(vapid)); } catch { /* ignore */ }
}
webpush.setVapidDetails("mailto:jarvis@localhost", vapid.publicKey, vapid.privateKey);
let pushSubs: any[] = [];
try { pushSubs = JSON.parse(readFileSync(SUBS_FILE, "utf8")); } catch { pushSubs = []; }
function saveSubs(): void { try { mkdirSync(JARVIS_DIR, { recursive: true }); writeFileSync(SUBS_FILE, JSON.stringify(pushSubs)); } catch { /* ignore */ } }
function addSub(sub: any): void { if (sub?.endpoint && !pushSubs.some((s) => s.endpoint === sub.endpoint)) { pushSubs.push(sub); saveSubs(); } }
function removeSub(endpoint: string): void { const n = pushSubs.length; pushSubs = pushSubs.filter((s) => s.endpoint !== endpoint); if (pushSubs.length !== n) saveSubs(); }
async function pushNotify(sid: string, text: string): Promise<void> {
  if (!pushSubs.length) return;
  const title = store.get(sid)?.title || (isNativeId(sid) ? "Sessão da máquina" : "Jarvis");
  const payload = JSON.stringify({ title: "Jarvis · " + title, body: (text || "").replace(/[#*`>_~]/g, "").replace(/\s+/g, " ").trim().slice(0, 140), sid, tag: sid });
  await Promise.all(pushSubs.map((sub) => webpush.sendNotification(sub, payload).catch((err: any) => { if (err?.statusCode === 404 || err?.statusCode === 410) removeSub(sub.endpoint); })));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// Hardening headers on every response — clickjacking, sniffing, referrer leak,
// and a CSP that keeps the self-hosted single-origin app locked to itself. The
// HTML's single inline <script> runs under a per-response NONCE (no 'unsafe-inline'
// for scripts), so an injected inline script can't execute — real XSS mitigation,
// which matters because a device token lives in the page's localStorage.
function csp(nonce?: string): string {
  const script = nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'";
  return `default-src 'self'; ${script}; style-src 'self' 'unsafe-inline'; ` +
    "connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self' blob: data:; " +
    "font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
}
function secHeaders(nonce?: string): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "microphone=(self), camera=(), geolocation=()",
    "content-security-policy": csp(nonce),
  };
}
const PASTED_DIR = join(homedir(), ".jarvis", "pasted");
const server = createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  // pasted/attached images, served for the in-chat preview — basename only (no traversal)
  if (urlPath.startsWith("/pasted/")) {
    const name = basename(decodeURIComponent(urlPath.slice("/pasted/".length)));
    const pf = join(PASTED_DIR, name);
    if (name && pf.startsWith(PASTED_DIR) && existsSync(pf) && statSync(pf).isFile()) {
      const pext = pf.slice(pf.lastIndexOf(".")).toLowerCase();
      res.writeHead(200, { ...secHeaders(), "content-type": MIME[pext] || "application/octet-stream", "cache-control": "max-age=86400" });
      res.end(readFileSync(pf));
    } else res.writeHead(404, secHeaders()).end("not found");
    return;
  }
  const file = normalize(join(WEB, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, secHeaders()).end("not found");
    return;
  }
  const ext = file.slice(file.lastIndexOf("."));
  if (ext === ".html") {
    const nonce = randomBytes(16).toString("base64");
    const html = readFileSync(file, "utf8").replace(/<script(?![^>]*\bsrc=)/gi, `<script nonce="${nonce}"`);
    res.writeHead(200, { ...secHeaders(nonce), "content-type": MIME[ext], "cache-control": "no-cache, must-revalidate" });
    res.end(html);
    return;
  }
  // no-cache: clients (esp. mobile) must always get the latest UI, never a stale file
  res.writeHead(200, { ...secHeaders(), "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache, must-revalidate" });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ server, maxPayload: guard.MAX_PAYLOAD });
wss.on("error", (e: any) => console.error("[hub] wss error:", e?.message ?? e));
// Last-resort safety net: a stray socket/parse error must not take the hub down
// (a crash is a denial-of-service). Log loudly and keep serving.
process.on("uncaughtException", (e: any) => console.error("[hub] uncaughtException (mantendo no ar):", e?.stack ?? e));
process.on("unhandledRejection", (e: any) => console.error("[hub] unhandledRejection:", e));

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
/** to every UI client (skips runner sockets) */
function broadcastAll(obj: unknown): void {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === c.OPEN && !runnerSockets.has(c as WebSocket)) c.send(s);
}

// sessions with an in-flight Jarvis-driven turn — powers the "rodando agora" panel.
const activeRuns = new Set<string>();
// runs/sessions are per-machine: only clients viewing the LOCAL machine get local ones.
function broadcastRuns(): void { const s = JSON.stringify({ t: "runs", active: [...activeRuns] }); for (const c of clientsOn(LOCAL_ID)) if (c.readyState === c.OPEN) c.send(s); }
// single-flight global para operações de voz (resumo/digest): só 1 por vez em toda a instância,
// independente de qual chat/cliente pediu. Guard no servidor complementa a trava de UI (multi-device).
let voiceOpBusy = false;

// --- auth: per-connection principal (device pairing; see auth.ts). JARVIS_AUTH=off bypasses. ---
type Conn = { userId: string; role: auth.Role; name: string; deviceId: string | null; verified: boolean };
const principals = new WeakMap<WebSocket, Conn>();
const unauthTimers = new WeakMap<WebSocket, ReturnType<typeof setTimeout>>();
function isAuthed(ws: WebSocket): boolean { return !auth.AUTH_ENABLED || principals.has(ws); }
function principalOf(ws: WebSocket): Conn | undefined { return principals.get(ws); }
/** Fully authed = token accepted AND (no owner passphrase OR this session verified it). */
function fullyAuthed(ws: WebSocket): boolean { if (!auth.AUTH_ENABLED) return true; const p = principals.get(ws); return !!p && (!auth.hasPassphrase() || p.verified); }
function clearUnauthTimer(ws: WebSocket): void { const t = unauthTimers.get(ws); if (t) { clearTimeout(t); unauthTimers.delete(ws); } }
function uaOf(req: any): string | undefined { const ua = req?.headers?.["user-agent"]; return typeof ua === "string" ? ua.slice(0, 200) : undefined; }
function clientMeta(req: any): { ip: string; ua?: string } { return { ip: guard.clientIp(req), ua: uaOf(req) }; }
let warnedInsecure = false;
function maybeWarnInsecure(req: any): void {
  if (!warnedInsecure && auth.AUTH_ENABLED && guard.isInsecurePublic(req)) {
    warnedInsecure = true;
    console.warn(`[hub] AVISO: conexão não-loopback sem TLS (${guard.clientIp(req)}). Em servidor público use HTTPS/WSS via proxy — tokens não devem trafegar em texto puro.`);
  }
}
/** Owner-only gate for the security/admin messages. Returns the principal or null (and errors). */
function requireOwner(ws: WebSocket): Conn | null {
  if (!auth.AUTH_ENABLED) return { userId: "local", role: "owner", name: "Local", deviceId: null };
  const p = principalOf(ws);
  if (!p || p.role !== "owner") { send(ws, { t: "error", message: "apenas o dono pode gerenciar dispositivos" }); return null; }
  return p;
}
/** Current devices + pending invites, marking THIS connection's device as "me". */
function secState(ws: WebSocket): void {
  const p = principalOf(ws);
  const onlineRunners = new Set([...runners.values()].filter((r) => !r.local && r.ws && r.ws.readyState === WebSocket.OPEN).map((r) => r.id));
  // Show the runner's REGISTERED/renamed label (runnerLabels), not the stale mint-time token
  // label — otherwise a machine that connected as "Luby" still reads "nova máquina" here.
  const runnerTokens = auth.listRunnerTokens().map((rt) => ({ ...rt, label: runnerLabels[rt.runnerId] || rt.label, online: onlineRunners.has(rt.runnerId) }));
  // The main machine (the Hub itself, "machine 0") — always shown, never removable.
  const lr = runners.get(LOCAL_ID);
  const localMachine = { id: LOCAL_ID, label: runnerLabels[LOCAL_ID] || lr?.info.host || "Servidor (esta máquina)", host: lr?.info.host };
  send(ws, { t: "sec_state", devices: auth.listDevices(), invites: auth.listInvites(), me: p?.deviceId || null, role: p?.role || (auth.AUTH_ENABLED ? "member" : "owner"), hasPass: auth.hasPassphrase(), runnerTokens, localMachine, onlineRunners: [...onlineRunners], repoUrl });
}
/** Update the live role of any connected session for this device (so the owner UI
 *  appears/disappears without a reconnect). */
function refreshPrincipalRole(deviceId: string, role: auth.Role): void {
  for (const client of wss.clients) {
    const pr = principals.get(client as WebSocket);
    if (pr && pr.deviceId === deviceId) { pr.role = role; try { send(client as WebSocket, { t: "authed", user: { id: pr.userId, role, name: pr.name } }); } catch { /* ignore */ } }
  }
}
/** Boot any currently-connected device whose token was just revoked. */
function dropRevoked(): void {
  const valid = new Set(auth.listDevices().map((d) => d.id));
  for (const client of wss.clients) {
    const pr = principals.get(client as WebSocket);
    if (pr && pr.deviceId && !valid.has(pr.deviceId)) {
      try { send(client as WebSocket, { t: "unauth", reason: "revogado", claimed: true }); (client as WebSocket).close(); } catch { /* ignore */ }
    }
  }
}

// ---- runner registry: machine 0 (this host, in-process) + remote runners (dial /runner) ----
const RUNNERS_FILE = join(JARVIS_DIR, "runners.json");
const runnerLabels: Record<string, string> = (() => { try { return JSON.parse(readFileSync(RUNNERS_FILE, "utf8")); } catch { return {}; } })();
function saveRunnerLabels(): void { try { writeFileSync(RUNNERS_FILE, JSON.stringify(runnerLabels, null, 2)); } catch { /* ignore */ } }
interface RunnerConn { id: string; ws: WebSocket | null; info: RunnerInfo; lastSeen: number; local: boolean; }
const runners = new Map<string, RunnerConn>();
const runnerSockets = new Set<WebSocket>();
const LOCAL_ID = "local";
runners.set(LOCAL_ID, { id: LOCAL_ID, ws: null, local: true, lastSeen: Date.now(), info: { runnerId: LOCAL_ID, host: hostname(), os: process.platform, agents: agents.names(), local: true } });
const clientRunner = new WeakMap<WebSocket, string>();
const runnerActive = new Map<string, Set<string>>(); // runnerId -> session ids running there
const pendingReq = new Map<string, WebSocket>();
let reqSeq = 0;
// which agents are actually usable on THIS (local) machine — probes availability, so the
// UI can disable agents that aren't installed/authenticated here.
let localAgents: string[] = agents.names();
async function refreshLocalAgents(): Promise<void> {
  const out: string[] = [];
  for (const n of agents.names()) { try { if (await agents.get(n).available()) out.push(n); } catch { /* skip */ } }
  const next = out.length ? out : agents.names();
  if (next.join() !== localAgents.join()) { localAgents = next; broadcastMachines(); }
  else localAgents = next;
}

// --- self-update (git): "new version" = new commits on origin/<branch>. ---
const UPDATE_ROOT = fileURLToPath(new URL("../../../", import.meta.url)); // repo root from apps/hub/src
let repoUrl = "";
void repoRemoteUrl(UPDATE_ROOT).then((u) => { repoUrl = u; });
let updateStatus: any = { supported: true, behind: 0 };
async function refreshUpdate(doBroadcast = true): Promise<void> {
  try { updateStatus = await updateCheck(UPDATE_ROOT, true); } catch (e: any) { updateStatus = { supported: false, error: String(e?.message ?? e) }; }
  if (doBroadcast) broadcastAll({ t: "update_status", status: updateStatus });
}
/** Apply the Hub update and restart (via the service manager) so the new code takes effect. */
function scheduleRestart(): void { broadcastAll({ t: "update_progress", message: "Nova versão aplicada — reiniciando." }); setTimeout(() => { try { restartService("hub"); } catch { /* ignore */ } process.exit(0); }, 900); }
function activeRunner(ws: WebSocket): string { return clientRunner.get(ws) || LOCAL_ID; }
/** Client sockets (not runner sockets) currently viewing a given machine. */
function clientsOn(runnerId: string): WebSocket[] {
  const out: WebSocket[] = [];
  for (const c of wss.clients) { const w = c as WebSocket; if (!runnerSockets.has(w) && activeRunner(w) === runnerId) out.push(w); }
  return out;
}
function machineList(): any[] {
  return [...runners.values()].map((r) => ({ id: r.id, label: runnerLabels[r.id] || r.info.host || r.id, host: r.info.host, os: r.info.os, agents: r.local ? localAgents : (r.info.agents || []), online: r.local || (!!r.ws && r.ws.readyState === WebSocket.OPEN), local: !!r.local }));
}
function broadcastMachines(): void { for (const c of wss.clients) { const w = c as WebSocket; if (!runnerSockets.has(w)) send(w, { t: "machines", machines: machineList() }); } }
function sendToRunner(rc: RunnerConn, obj: unknown): boolean { if (rc.ws && rc.ws.readyState === WebSocket.OPEN) { rc.ws.send(JSON.stringify(obj)); return true; } return false; }

// admin: waiters for a runner's next session list (used by the remote "ok" purge)
const pendingRunnerList = new Map<string, (sessions: any[]) => void>();

/** Relay a message from a remote runner to the clients currently viewing that machine. */
function relayRunner(rc: RunnerConn, m: any): void {
  if (m.t === "sessions") { const cb = pendingRunnerList.get(rc.id); if (cb) { pendingRunnerList.delete(rc.id); cb(m.sessions || []); } for (const c of clientsOn(rc.id)) send(c, { t: "sessions", sessions: m.sessions, recentDirs: [] }); return; }
  if (m.t === "history") { const c = pendingReq.get(m.reqId); if (c) { pendingReq.delete(m.reqId); const native = /^(claude:|codex:)/.test(m.sessionId || ""); send(c, { t: "history", sessionId: m.sessionId, session: { agent: m.agent, cwd: m.cwd, title: m.title, native, writable: m.writable, nativeId: m.nativeId }, total: m.total, messages: (m.messages || []).map((x: any) => ({ sessionId: m.sessionId, role: x.role, text: x.text, ts: x.ts, agent: m.agent, name: x.name, path: x.path, adds: x.adds, dels: x.dels, rows: x.rows })), files: m.files }); } return; }
  if (m.t === "filediff") { const c = pendingReq.get(m.reqId); if (c) { pendingReq.delete(m.reqId); send(c, { t: "filediff", path: m.path, name: m.name, rows: m.rows, adds: m.adds, dels: m.dels, error: m.error }); } return; }
  if (m.t === "stream") { for (const c of clientsOn(rc.id)) send(c, { t: "stream", sessionId: m.sessionId, ev: m.ev, usage: m.ev?.usage }); return; }
  if (m.t === "message") { for (const c of clientsOn(rc.id)) send(c, { t: "message", message: { sessionId: m.sessionId, role: m.message?.role, text: m.message?.text, ts: m.message?.ts } }); return; }
  if (m.t === "activity") { for (const c of clientsOn(rc.id)) send(c, { t: "activity", sessionId: m.sessionId, name: m.name, summary: m.summary }); return; }
  if (m.t === "runs") { runnerActive.set(rc.id, new Set(m.active || [])); for (const c of clientsOn(rc.id)) send(c, { t: "runs", active: m.active || [] }); return; }
  if (m.t === "dirs") { const c = pendingReq.get(m.reqId); if (c) { pendingReq.delete(m.reqId); send(c, { t: "dirs", path: m.path, parent: m.parent, entries: m.entries }); } return; }
  if (m.t === "filecontent") { const c = pendingReq.get(m.reqId); if (c) { pendingReq.delete(m.reqId); send(c, { t: "filecontent", path: m.path, name: m.name, content: m.content, size: m.size, truncated: m.truncated, error: m.error }); } return; }
  if (m.t === "error") { const c = m.reqId && pendingReq.get(m.reqId); if (c) { pendingReq.delete(m.reqId); send(c, { t: "error", message: m.message }); } else for (const cc of clientsOn(rc.id)) send(cc, { t: "error", message: m.message }); return; }
}

/** A remote runner connected on /runner: register (token) then relay its stream to clients. */
function handleRunnerConnection(ws: WebSocket, ip: string): void {
  runnerSockets.add(ws);
  let rid: string | null = null;
  const ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) send(ws, { t: "ping" }); else clearInterval(ping); }, 20000);
  // drop runners that never register (token) within 20s
  const regTimer = setTimeout(() => { if (!rid) { try { ws.close(1008, "no register"); } catch { /* ignore */ } } }, 20000);
  ws.on("close", () => { clearInterval(ping); clearTimeout(regTimer); runnerSockets.delete(ws); if (rid) { const rc = runners.get(rid); if (rc && rc.ws === ws) { rc.ws = null; console.log(`[hub] runner offline: ${rid}`); broadcastMachines(); } } });
  ws.on("error", () => { /* close handles cleanup */ });
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "register") {
      if (guard.blockedFor(ip) > 0) { send(ws, { t: "reject", reason: "muitas tentativas" }); try { ws.close(); } catch { /* ignore */ } return; }
      if (auth.AUTH_ENABLED) { const rt = auth.authenticateRunner(m.token); if (!rt) { const r = guard.recordFail(ip); auth.audit(r.blocked ? "auth_blocked" : "runner_reject", { ip, detail: `runner token${r.blocked ? " — bloqueado" : ""}` }); send(ws, { t: "reject", reason: "token de runner inválido" }); try { ws.close(); } catch { /* ignore */ } return; } }
      clearTimeout(regTimer); guard.recordSuccess(ip);
      const info: RunnerInfo = m.info || {}; rid = info.runnerId || null;
      if (!rid) { send(ws, { t: "reject", reason: "sem runnerId" }); try { ws.close(); } catch { /* ignore */ } return; }
      runners.set(rid, { id: rid, ws, local: false, lastSeen: Date.now(), info });
      if (!runnerLabels[rid]) { runnerLabels[rid] = info.label || info.host || rid; saveRunnerLabels(); }
      // align the auth token with the runner's real id so the machines list reconciles
      if (auth.AUTH_ENABLED) auth.bindRunnerToken(m.token, rid, runnerLabels[rid]);
      send(ws, { t: "welcome", runnerId: rid });
      auth.audit("runner_online", { runnerId: rid, detail: info.host });
      console.log(`[hub] runner online: ${rid} (${info.host})`);
      broadcastMachines();
      return;
    }
    if (!rid) return;
    const rc = runners.get(rid); if (!rc) return; rc.lastSeen = Date.now();
    relayRunner(rc, m);
  });
}

// Live mirror of native CLI sessions: tail the jsonl and broadcast new turns as they're
// appended by an EXTERNAL Claude Code (or by us), so viewers update without refreshing.
interface Tail { path: string; claude: boolean; offset: number; buf: string; paused: boolean; timer: ReturnType<typeof setInterval>; }
const nativeTails = new Map<string, Tail>();
function pollTail(sid: string): void {
  const t = nativeTails.get(sid);
  if (!t || t.paused) return;
  let size: number;
  try { size = statSync(t.path).size; } catch { return; }
  if (size <= t.offset) return;
  let chunk: Buffer;
  try {
    const fd = openSync(t.path, "r");
    chunk = Buffer.alloc(size - t.offset);
    readSync(fd, chunk, 0, chunk.length, t.offset);
    closeSync(fd);
  } catch { return; }
  t.offset = size;
  const parts = (t.buf + chunk.toString("utf8")).split("\n");
  t.buf = parts.pop() || ""; // keep the last (possibly partial) line
  for (const line of parts) {
    if (!line.trim()) continue;
    for (const e of parseNativeEvents(line, t.claude)) {
      if (e.kind === "message") broadcast(sid, { t: "message", message: { sessionId: sid, role: e.role, text: e.text, ts: e.ts, agent: t.claude ? "claude-code" : "codex" } });
      else broadcast(sid, { t: "activity", sessionId: sid, name: e.name, summary: e.summary });
    }
  }
}
function startTail(sid: string): void {
  if (nativeTails.has(sid)) return;
  const f = nativeFilePath(sid);
  if (!f) return;
  let size = 0;
  try { size = statSync(f.path).size; } catch { /* new file */ }
  nativeTails.set(sid, { path: f.path, claude: f.claude, offset: size, buf: "", paused: false, timer: setInterval(() => pollTail(sid), 900) });
}
function stopTail(sid: string): void {
  const t = nativeTails.get(sid);
  if (t) { clearInterval(t.timer); nativeTails.delete(sid); }
}
/** Keep a tail running for every native session at least one client is currently viewing. */
function syncTails(): void {
  const viewed = new Set<string>();
  for (const s of subs.values()) if (isNativeId(s)) viewed.add(s);
  for (const sid of [...nativeTails.keys()]) if (!viewed.has(sid)) stopTail(sid);
  for (const sid of viewed) startTail(sid);
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
function pushSessions(): void { const p = sessionsPayload(); for (const c of clientsOn(LOCAL_ID)) send(c, p); }
function sendSessions(ws: WebSocket): void { send(ws, sessionsPayload()); }

/** What to SPEAK for an agent reply: short answers are read verbatim (cleaned); long ones are
 *  condensed to a 1–3 sentence spoken summary (cheap model) so the audio doesn't drag on. */
async function speechForReply(replyText: string): Promise<string> {
  const spoken = speechify(replyText || "");
  if (spoken.length <= 600) return spoken; // already short when spoken → read as-is
  const prompt = `Resuma em 1 a 3 frases CURTAS e faladas (português do Brasil, sem markdown, sem listas, sem código) o texto abaixo — como quem conta o resultado em voz alta, direto ao ponto:\n\n${(replyText || "").slice(0, 4000)}`;
  try {
    const agent = agents.get(summaryCfg.agent) || agents.searchAgent();
    const opts = { model: summaryCfg.model, effort: summaryCfg.effort };
    const reply = agent.oneShot ? await agent.oneShot(prompt, opts) : await agent.send("__speaksum__", prompt, process.cwd(), opts);
    const s = speechify((reply.text || "").trim());
    return s || speechifyCapped(replyText);
  } catch { return speechifyCapped(replyText); }
}

/** One full turn against a session's agent: store+broadcast the user msg, get the reply, speak if asked. */
async function deliverTurn(sid: string, opts: { showText: string; agentText?: string; model?: string; effort?: string; speak?: boolean; speaker?: string }): Promise<void> {
  const session = store.ensure(sid);
  const agent = agents.get(session.agent);
  const now = Date.now();
  store.add(sid, { role: "user", text: opts.showText, ts: now, agent: agent.name, speaker: opts.speaker });
  broadcast(sid, { t: "message", message: { sessionId: sid, role: "user", text: opts.showText, ts: now, agent: agent.name, speaker: opts.speaker } });
  pushSessions();
  try {
    const reply = await agentTurn(sid, agent, opts.agentText ?? opts.showText, session.cwd, { model: opts.model, effort: opts.effort });
    store.add(sid, { role: "assistant", text: reply.text, ts: Date.now(), agent: agent.name });
    pushSessions();
    if (opts.speak) {
      const spoken = await speechForReply(reply.text);
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
/** One agent turn with LIVE streaming (tool activity + text) broadcast to session viewers.
 *  Returns the final reply. The stream 'done' event carries the final text + usage, so
 *  callers must NOT also broadcast a {t:message} assistant (they only persist it). */
async function agentTurn(sid: string, agent: AgentAdapter, agentText: string, cwd: string, opts: SendOpts): Promise<AgentReply> {
  activeRuns.add(sid); broadcastRuns();
  broadcast(sid, { t: "stream", sessionId: sid, ev: { kind: "start" } });
  try {
    const reply = await agent.send(sid, agentText, cwd, opts, (ev) => broadcast(sid, { t: "stream", sessionId: sid, ev }));
    broadcast(sid, { t: "stream", sessionId: sid, ev: { kind: "done", text: reply.text }, usage: reply.usage });
    // Surface the just-bound native session id (real claude/codex session) so the UI chip appears live.
    const nativeId = agent.nativeSessionId?.(sid);
    if (nativeId) broadcast(sid, { t: "session", sessionId: sid, nativeId });
    void pushNotify(sid, reply.text); // notifica quando termina (SW suprime se a aba estiver focada)
    return reply;
  } catch (e) {
    broadcast(sid, { t: "stream", sessionId: sid, ev: { kind: "error" } });
    throw e;
  } finally {
    activeRuns.delete(sid); broadcastRuns();
  }
}
/** Turn attachments into (a) the text the AGENT sees — text files inlined, images decoded to
 *  ~/.jarvis/pasted and referenced by path for the Read tool — and (b) the text/images SHOWN in
 *  the chat (a 📎 chip for files, a served /pasted URL preview for images). Used by every turn. */
function buildAttachments(attachments: Array<{ name: string; content: string; image?: boolean }>, text: string): { agentText: string; showText: string; images?: string[] } {
  if (!attachments.length) return { agentText: text, showText: text };
  const parts: string[] = [], imgPaths: string[] = [], imageUrls: string[] = [];
  for (const a of attachments) {
    if (a.image) {
      try {
        mkdirSync(PASTED_DIR, { recursive: true });
        const p = join(PASTED_DIR, `${Date.now()}-${String(a.name || "img").replace(/[^\w.-]/g, "_")}`);
        writeFileSync(p, Buffer.from(a.content, "base64"));
        imgPaths.push(p); imageUrls.push("/pasted/" + basename(p));
      } catch { /* skip */ }
    } else parts.push(`--- arquivo anexado: ${a.name} ---\n${a.content}`);
  }
  if (imgPaths.length) parts.push(`Imagens anexadas — use a ferramenta Read para vê-las:\n${imgPaths.join("\n")}`);
  const txtNames = attachments.filter((a) => !a.image).map((a) => a.name);
  return {
    agentText: parts.length ? `${parts.join("\n\n")}\n\n${text}` : text,
    showText: txtNames.length ? `${text}\n\n📎 ${txtNames.join(", ")}` : text,
    images: imageUrls.length ? imageUrls : undefined,
  };
}

/** Continue a NATIVE CLI session (claude:<uuid>) by resuming the real claude session.
 *  Persists in the CLI's own jsonl (same file), so re-opening shows the new turns. */
async function deliverNativeTurn(ws: WebSocket, sid: string, text: string, opts: { model?: string; effort?: string; speak?: boolean; speaker?: string; attachments?: Array<{ name: string; content: string; image?: boolean }> }): Promise<void> {
  const info = nativeInfo(sid);
  if (!info) { send(ws, { t: "error", message: "sessão nativa não encontrada" }); return; }
  if (info.agent !== "claude-code") { send(ws, { t: "error", message: "continuar sessão nativa só é suportado no claude-code por enquanto" }); return; }
  const agent = agents.get(info.agent);
  const now = Date.now();
  const { agentText, showText, images } = buildAttachments(Array.isArray(opts.attachments) ? opts.attachments : [], text);
  // pause the live tail so it doesn't re-broadcast our own turn (already shown via streaming)
  const tail = nativeTails.get(sid);
  if (tail) tail.paused = true;
  broadcast(sid, { t: "message", message: { sessionId: sid, role: "user", text: showText, ts: now, agent: info.agent, speaker: opts.speaker, images } });
  try {
    const reply = await agentTurn(sid, agent, agentText, info.cwd || CWD, { model: opts.model, effort: opts.effort });
    if (opts.speak) {
      const spoken = await speechForReply(reply.text);
      if (spoken) { const wav = await synthesize(spoken, VOICE); broadcast(sid, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: spoken }); }
    }
  } catch (e: any) {
    const message = String(e?.message ?? e);
    send(ws, { t: "error", message, limit: /limit|rate|quota|exceeded|usage/i.test(message) });
  } finally {
    if (tail) { try { tail.offset = statSync(tail.path).size; tail.buf = ""; } catch { /* ignore */ } tail.paused = false; }
  }
}
/** Cross-session search: reason over recent sessions, reply only to the asker (optionally spoken). */
async function runAndSendSearch(ws: WebSocket, query: string, speak: boolean): Promise<void> {
  const extra = listNative(24).map((n) => ({ id: n.id, agent: n.agent, cwd: n.cwd, title: n.title, updatedAt: n.updatedAt, lastUser: "", lastAssistant: "" }));
  const r = await runSessionSearch({ query, store, agents, extra });
  let audio: string | undefined;
  if (speak) {
    const spoken = speechifyCapped(r.answer);
    if (spoken) audio = (await synthesize(spoken, VOICE)).toString("base64");
  }
  send(ws, { t: "searchResult", query, answer: r.answer, matches: r.matches, action: r.action, audio });
}
/** Summarize ONE session with the cheapest model + lowest effort, speak it, and reply
 *  only to the asker. NOT stored in history — it's a standalone "read it to me" action. */
async function summarizeAndSpeak(ws: WebSocket, sid: string, speak: boolean): Promise<void> {
  let msgs: Array<{ role: string; text: string }> = [];
  let title = "";
  if (isNativeId(sid)) { const h = nativeHistory(sid); if (h) { msgs = h.messages; title = h.title; } }
  else { const s = store.get(sid); if (s) { msgs = store.history(sid); title = s.title; } }
  if (!msgs.length) { send(ws, { t: "summary", sessionId: sid, text: "Conversa vazia." }); return; }
  // foca na ÚLTIMA resposta (referente ao último comando) — resumo curto, não a conversa toda
  const lastA = [...msgs].reverse().find((m) => m.role === "assistant")?.text || "";
  const lastU = [...msgs].reverse().find((m) => m.role === "user")?.text || "";
  const prompt =
    `Resuma em 1 a 3 frases CURTAS e faladas (português do Brasil, sem markdown, sem listas) a ÚLTIMA resposta desta conversa — ` +
    `referente ao último comando enviado. Vá direto ao ponto; NÃO resuma a conversa inteira.\n\n` +
    `Título: ${title}\n\nÚltimo comando: ${lastU.slice(0, 800)}\n\nÚltima resposta: ${lastA.slice(0, 2500)}`;
  const agent = agents.get(summaryCfg.agent) || agents.searchAgent();
  const sendOpts = { model: summaryCfg.model, effort: summaryCfg.effort };
  let text = "";
  try {
    const reply = agent.oneShot ? await agent.oneShot(prompt, sendOpts) : await agent.send("__summary__", prompt, process.cwd(), sendOpts);
    text = (reply.text || "").trim();
  } catch (e: any) {
    send(ws, { t: "error", message: "resumo: " + String(e?.message ?? e) });
    return;
  }
  let audio: string | undefined;
  if (speak && text) { const spoken = speechifyCapped(text); if (spoken) audio = (await synthesize(spoken, VOICE)).toString("base64"); }
  send(ws, { t: "summary", sessionId: sid, text, audio });
}
/** Cross-agent digest ("what's happening across your sessions") — cheap, spoken, not stored. */
async function digestAndSpeak(ws: WebSocket, speak: boolean): Promise<void> {
  const own = store.digest(10, 200);
  const nat = listNative(8).map((n) => ({ id: n.id, agent: n.agent, title: n.title, updatedAt: n.updatedAt, lastAssistant: "", lastUser: "" }));
  const all = [...own, ...nat].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  // "active now" = a Jarvis-driven turn in flight OR a native session whose jsonl was
  // just written (an EXTERNAL claude/codex working in a terminal shows up here too).
  const ACTIVE_MS = 120_000;
  const isActive = (s: any) => activeRuns.has(s.id) || (isNativeId(s.id) && Date.now() - (s.updatedAt || 0) < ACTIVE_MS);
  const activeCount = all.filter(isActive).length;
  const lines = all
    .map((s) => `- ${s.title}${isActive(s) ? " [ATIVA AGORA]" : ""} (${s.agent}): ${(s.lastAssistant || s.lastUser || "").slice(0, 160)}`)
    .join("\n") || "(nenhuma sessão)";
  // remote machines' running counts (from their {t:runs})
  const remoteLines = [...runners.values()]
    .filter((r) => !r.local && r.ws && r.ws.readyState === WebSocket.OPEN)
    .map((r) => { const n = (runnerActive.get(r.id) || new Set()).size; return `- Máquina "${runnerLabels[r.id] || r.info.host || r.id}": ${n} sessão(ões) em execução`; })
    .join("\n");
  const prompt =
    `Você é o painel de status do Jarvis. Em português do Brasil, 2 a 4 frases FALADAS (sem markdown, sem listas), ` +
    `diga rapidamente o que está acontecendo. Há ${activeCount} sessão(ões) marcada(s) [ATIVA AGORA] (em execução/atividade neste momento) — ` +
    `destaque-as primeiro se houver; depois um resumo do resto. SEMPRE produza um status com base nos dados abaixo; NUNCA diga que faltam informações. Seja direto.\n\n` +
    `SESSÕES DESTA MÁQUINA (título · agente · [ATIVA AGORA] se em execução):\n${lines}` +
    (remoteLines ? `\n\nOUTRAS MÁQUINAS:\n${remoteLines}` : "");
  const agent = agents.get(summaryCfg.agent) || agents.searchAgent();
  const sendOpts = { model: summaryCfg.model, effort: summaryCfg.effort };
  let text = "";
  try {
    const reply = agent.oneShot ? await agent.oneShot(prompt, sendOpts) : await agent.send("__digest__", prompt, process.cwd(), sendOpts);
    text = (reply.text || "").trim();
  } catch (e: any) {
    send(ws, { t: "error", message: "digest: " + String(e?.message ?? e) });
    return;
  }
  let audio: string | undefined;
  if (speak && text) { const spoken = speechifyCapped(text); if (spoken) audio = (await synthesize(spoken, VOICE)).toString("base64"); }
  send(ws, { t: "summary", sessionId: "__digest__", text, audio });
}
/** Current speaker-id config + enrolled voiceprints (listing is cheap — no torch). */
async function sendVoiceState(ws: WebSocket): Promise<void> {
  send(ws, { t: "voice_state", gate: voiceGate, threshold: voiceThreshold ?? null, speakers: await listSpeakers() });
}
async function broadcastVoiceState(): Promise<void> {
  const speakers = await listSpeakers();
  broadcastAll({ t: "voice_state", gate: voiceGate, threshold: voiceThreshold ?? null, speakers });
}

/** Push the app's initial state to a (now authenticated) client. */
async function sendInitialState(ws: WebSocket): Promise<void> {
  send(ws, { t: "hello", agents: await agents.describe(), default: agents.default });
  send(ws, { t: "machines", machines: machineList() });
  send(ws, { t: "update_status", status: updateStatus });
  sendSessions(ws);
  send(ws, { t: "runs", active: [...activeRuns] });
  await sendVoiceState(ws);
}

/** Auth handshake — the ONLY messages a connection may send before it is authenticated.
 *  Device pairing: authinfo (claim state) / claim (owner bootstrap) / redeem (invite) / auth (token). */
async function handleAuth(ws: WebSocket, msg: any, req: any): Promise<void> {
  const { ip, ua } = clientMeta(req);
  if (msg.t === "authinfo") { send(ws, { t: "authinfo", claimed: auth.isClaimed() }); return; }
  const isAttempt = msg.t === "claim" || msg.t === "redeem" || msg.t === "auth";
  if (!isAttempt) { send(ws, { t: "unauth", claimed: auth.isClaimed() }); return; }
  // brute-force throttle (per IP) — the auth gate is the ONLY wall on a public server.
  const blk = guard.blockedFor(ip);
  if (blk > 0) { send(ws, { t: "unauth", reason: `muitas tentativas — aguarde ${Math.ceil(blk / 1000)}s`, claimed: auth.isClaimed() }); return; }
  const fail = (why: string) => {
    const r = guard.recordFail(ip);
    auth.audit(r.blocked ? "auth_blocked" : "auth_fail", { ip, detail: `${msg.t}: ${why}${r.blocked ? ` — bloqueado (${r.fails} tentativas)` : ""}` });
    send(ws, { t: "unauth", reason: r.blocked ? "muitas tentativas — tente mais tarde" : why, claimed: auth.isClaimed() });
  };
  // After a valid token, if an owner passphrase is set the session is authed but
  // NOT verified — hold back app state until the 2nd factor is entered.
  const enterAuthed = async (payload: any, conn: Conn) => {
    guard.recordSuccess(ip); clearUnauthTimer(ws);
    principals.set(ws, conn);
    if (auth.hasPassphrase() && !conn.verified) { send(ws, { t: "need_pass" }); armVerifyTimer(ws); }
    else { send(ws, payload); await sendInitialState(ws); }
  };
  try {
    if (msg.t === "claim" || msg.t === "redeem") {
      if (typeof msg.code !== "string" || !msg.code) return fail("sem código");
      const r = msg.t === "claim"
        ? auth.claim(msg.code, msg.label || "Dispositivo", { ip, ua })
        : auth.redeem(msg.code, msg.label || "Dispositivo", { ip, ua });
      // a device that just paired via a code is inherently 2FA (had the code) -> verified
      await enterAuthed({ t: "authed", token: r.token, user: r.user }, { userId: r.user.id, role: r.user.role, name: r.user.name, deviceId: r.deviceId, verified: true });
      return;
    }
    // msg.t === "auth"
    if (typeof msg.token !== "string" || !msg.token) return fail("sem token");
    const p = auth.authenticate(msg.token, { ip, ua });
    if (!p) return fail("token inválido");
    await enterAuthed({ t: "authed", user: { id: p.user.id, role: p.user.role, name: p.user.name } }, { userId: p.user.id, role: p.user.role, name: p.user.name, deviceId: p.device.id, verified: false });
  } catch (e: any) {
    fail(String(e?.message ?? e));
  }
}
function armVerifyTimer(ws: WebSocket): void {
  clearUnauthTimer(ws);
  unauthTimers.set(ws, setTimeout(() => { if (!fullyAuthed(ws)) { try { send(ws, { t: "need_pass", error: "tempo esgotado" }); ws.close(); } catch { /* ignore */ } } }, 90000));
}
/** 2nd factor: verify the owner passphrase for a token-authed-but-unverified session. */
async function handleVerify(ws: WebSocket, msg: any, req: any): Promise<void> {
  const { ip } = clientMeta(req);
  const p = principalOf(ws);
  if (!p) return;
  if (guard.blockedFor(ip) > 0) { send(ws, { t: "need_pass", error: "muitas tentativas — aguarde" }); return; }
  if (typeof msg.pass !== "string" || !auth.verifyPassphrase(msg.pass)) {
    const r = guard.recordFail(ip);
    auth.audit(r.blocked ? "auth_blocked" : "pass_fail", { ip, deviceId: p.deviceId, detail: r.blocked ? "senha — bloqueado" : "senha incorreta" });
    send(ws, { t: "need_pass", error: r.blocked ? "muitas tentativas — tente mais tarde" : "senha incorreta" });
    return;
  }
  guard.recordSuccess(ip); clearUnauthTimer(ws);
  p.verified = true;
  send(ws, { t: "authed", user: { id: p.userId, role: p.role, name: p.name }, verified: true });
  await sendInitialState(ws);
}

wss.on("connection", (ws: WebSocket, req: any) => {
  const ip = guard.clientIp(req);
  // connection cap (per IP + global) — blunts connection-flood DoS.
  if (!guard.connOpen(ip)) { try { ws.close(1013, "too many connections"); } catch { /* ignore */ } return; }
  ws.once("close", () => guard.connClose(ip));
  // Remote runners dial the "/runner" path; everything else is a UI client.
  if (String(req?.url || "").startsWith("/runner")) { handleRunnerConnection(ws, ip); return; }
  // Optional Origin allowlist (public deployments); no-op unless JARVIS_ALLOWED_ORIGINS set.
  if (!guard.originAllowed(req)) { try { ws.close(1008, "origin not allowed"); } catch { /* ignore */ } return; }
  // Fail-closed on plaintext when JARVIS_REQUIRE_TLS=on (public deployments).
  if (guard.tlsRequiredButMissing(req)) { try { send(ws, { t: "unauth", reason: "conexão exige HTTPS/WSS" }); ws.close(1008, "tls required"); } catch { /* ignore */ } return; }
  maybeWarnInsecure(req);
  // Drop connections that never authenticate (idle unauth hoarding). Cleared on auth.
  if (auth.AUTH_ENABLED) {
    unauthTimers.set(ws, setTimeout(() => {
      if (!fullyAuthed(ws)) { try { send(ws, { t: "unauth", reason: "tempo de autenticação esgotado", claimed: auth.isClaimed() }); ws.close(); } catch { /* ignore */ } }
    }, 20000));
  }
  // Attach listeners SYNCHRONOUSLY (before any await) so a client message sent
  // right after connect is never dropped. The initial state below is async
  // (agent caps + speaker list, which spawns Python), so pushing it before the
  // message listener was attached created a window where "open" etc. were lost.
  // A per-connection socket error (e.g. oversized frame rejected by maxPayload) must
  // NEVER crash the hub — an unhandled 'error' event would take the whole process down.
  ws.on("error", () => { try { ws.close(); } catch { /* ignore */ } });
  ws.on("close", () => {
    subs.delete(ws);
    wakeClients.delete(ws);
    clearUnauthTimer(ws);
    syncTails();
  });

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // --- auth gate: until this connection is authenticated, ONLY the auth
    //     handshake is processed; every other message is dropped. ---
    if (auth.AUTH_ENABLED && !principals.has(ws)) {
      await handleAuth(ws, msg, req);
      return;
    }
    // --- 2nd factor gate: token accepted but owner passphrase not yet verified. ---
    if (auth.AUTH_ENABLED && !fullyAuthed(ws)) {
      if (msg.t === "verify") await handleVerify(ws, msg, req);
      else send(ws, { t: "need_pass" });
      return;
    }

    // --- machine selection + routing to remote runners -----------------------
    if (msg.t === "machines") { send(ws, { t: "machines", machines: machineList() }); return; }
    if (msg.t === "runner" && typeof msg.runnerId === "string") {
      const target = runners.has(msg.runnerId) ? msg.runnerId : LOCAL_ID;
      clientRunner.set(ws, target); subs.delete(ws);
      send(ws, { t: "machines", machines: machineList() });
      if (target === LOCAL_ID) sendSessions(ws);
      else { const rc = runners.get(target); if (!rc || !sendToRunner(rc, { t: "list" })) send(ws, { t: "sessions", sessions: [], recentDirs: [] }); }
      return;
    }
    if (msg.t === "rename_runner" && typeof msg.runnerId === "string" && typeof msg.label === "string") {
      if (!requireOwner(ws)) return;
      runnerLabels[msg.runnerId] = msg.label.slice(0, 40); saveRunnerLabels(); broadcastMachines(); secState(ws); return;
    }
    // when viewing a REMOTE machine, session ops are forwarded to that runner
    {
      const ar = activeRunner(ws);
      if (ar !== LOCAL_ID && (msg.t === "list" || msg.t === "open" || msg.t === "send" || msg.t === "new" || msg.t === "listdir" || msg.t === "configure" || msg.t === "readfile" || msg.t === "readdiff" || msg.t === "delete")) {
        const rc = runners.get(ar);
        if (!rc || !rc.ws || rc.ws.readyState !== 1) { send(ws, { t: "error", message: "máquina offline" }); return; }
        if (msg.t === "list") { sendToRunner(rc, { t: "list" }); return; }
        if (msg.t === "delete" && (typeof msg.sessionId === "string" || Array.isArray(msg.sessionIds))) { sendToRunner(rc, { t: "delete", sessionId: msg.sessionId, sessionIds: msg.sessionIds, alsoNative: !!msg.alsoNative }); send(ws, { t: "deleted", sessionId: msg.sessionId, ids: msg.sessionIds, ok: true }); return; }
        if (msg.t === "readdiff" && typeof msg.path === "string" && typeof msg.sessionId === "string") { const reqId = "r" + (++reqSeq); pendingReq.set(reqId, ws); sendToRunner(rc, { t: "readdiff", reqId, sessionId: msg.sessionId, path: msg.path }); return; }
        if (msg.t === "new") { const reqId = "r" + (++reqSeq); pendingReq.set(reqId, ws); sendToRunner(rc, { t: "new", reqId, agent: msg.agent, cwd: msg.cwd }); return; }
        if (msg.t === "readfile" && typeof msg.path === "string") { const reqId = "r" + (++reqSeq); pendingReq.set(reqId, ws); sendToRunner(rc, { t: "readfile", reqId, path: msg.path, cwd: msg.cwd }); return; }
        if (msg.t === "listdir") { const reqId = "r" + (++reqSeq); pendingReq.set(reqId, ws); sendToRunner(rc, { t: "listdir", reqId, path: msg.path }); return; }
        if (msg.t === "configure" && typeof msg.sessionId === "string") { const reqId = "r" + (++reqSeq); pendingReq.set(reqId, ws); sendToRunner(rc, { t: "configure", reqId, sessionId: msg.sessionId, agent: msg.agent, cwd: msg.cwd }); return; }
        if (msg.t === "open" && typeof msg.sessionId === "string") { const reqId = "r" + (++reqSeq); pendingReq.set(reqId, ws); subs.set(ws, msg.sessionId); sendToRunner(rc, { t: "open", reqId, sessionId: msg.sessionId }); return; }
        if (msg.t === "send" && typeof msg.text === "string") {
          const sid = (typeof msg.sessionId === "string" && msg.sessionId) ? msg.sessionId : (subs.get(ws) || "default");
          auth.audit("send", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: ar, detail: `${sid}: ${String(msg.text).slice(0, 80)}` });
          sendToRunner(rc, { t: "send", sessionId: sid, text: msg.text, opts: { model: msg.model, effort: msg.effort } });
          return;
        }
      }
    }

    // --- session management (shared across every client) ---
    if (msg.t === "list") {
      sendSessions(ws);
      return;
    }
    // Delete one or MANY conversations on THIS (local) machine — and, if asked, the
    // underlying native claude/codex session each maps to. Irreversible.
    if (msg.t === "delete" && (typeof msg.sessionId === "string" || Array.isArray(msg.sessionIds))) {
      const ids: string[] = Array.isArray(msg.sessionIds) ? msg.sessionIds.filter((x: any) => typeof x === "string") : [msg.sessionId];
      const deleteOne = (sid: string): boolean => {
        if (isNativeId(sid)) { stopTail(sid); return deleteNative(sid); }
        const s = store.get(sid);
        if (s) {
          const ag = agents.get(s.agent);
          if (msg.alsoNative && ag.nativeSessionId) { const nid = ag.nativeSessionId(sid); if (nid) deleteNative("claude:" + nid); }
          ag.forgetSession?.(sid);
        }
        return store.delete(sid);
      };
      let okCount = 0;
      for (const sid of ids) { if (deleteOne(sid)) okCount++; if (subs.get(ws) === sid) subs.delete(ws); }
      auth.audit("delete", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${okCount}/${ids.length} conversa(s)` });
      send(ws, { t: "deleted", sessionId: msg.sessionId, ids, ok: okCount === ids.length, okCount });
      pushSessions();
      return;
    }
    // plan usage (5h / weekly windows) — account-level, from the local agent's usage endpoint
    if (msg.t === "get_usage") {
      const name = typeof msg.agent === "string" && agents.names().includes(msg.agent) ? msg.agent : "claude-code";
      let plan = null;
      try { const a = agents.get(name); plan = a.usage ? await a.usage() : null; } catch { plan = null; }
      send(ws, { t: "usage_info", agent: name, plan });
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
    // read a file to view it ("ver antes de executar") — local machine
    if (msg.t === "readfile" && typeof msg.path === "string") {
      send(ws, { t: "filecontent", ...readProjectFile(msg.path, typeof msg.cwd === "string" ? msg.cwd : undefined) });
      return;
    }
    // read the diff of an edited file, reconstructed from the session's claude jsonl — local machine
    if (msg.t === "readdiff" && typeof msg.path === "string" && typeof msg.sessionId === "string") {
      const diffId = isNativeId(msg.sessionId) ? msg.sessionId : (() => { const s = store.get(msg.sessionId); const nid = s && agents.get(s.agent).nativeSessionId?.(s.id); return nid ? "claude:" + nid : ""; })();
      send(ws, { t: "filediff", ...(diffId ? sessionFileDiff(diffId, msg.path) : { path: msg.path, name: msg.path.split(/[\\/]/).pop() || msg.path, error: "sem sessão nativa vinculada" }) });
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
      syncTails();
      const h = nativeHistory(msg.sessionId);
      if (!h) { send(ws, { t: "error", message: "sessão nativa não encontrada" }); return; }
      send(ws, {
        t: "history",
        sessionId: msg.sessionId,
        session: { agent: h.agent, cwd: h.cwd, title: h.title, native: true, writable: h.agent === "claude-code" },
        total: h.messages.length,
        messages: h.messages.slice(-HISTORY_CAP).map((m) => ({ sessionId: msg.sessionId, role: m.role, text: m.text, ts: m.ts, agent: h.agent, name: m.name, path: m.path, adds: m.adds, dels: m.dels, rows: m.rows })),
        files: sessionFiles(msg.sessionId),
      });
      return;
    }
    if (msg.t === "open" && typeof msg.sessionId === "string") {
      subs.set(ws, msg.sessionId);
      syncTails();
      const s = store.ensure(msg.sessionId);
      const all = store.history(s.id);
      const nid = agents.get(s.agent).nativeSessionId?.(s.id);
      send(ws, { t: "history", sessionId: s.id, session: { agent: s.agent, cwd: s.cwd, title: s.title, nativeId: nid }, total: all.length, messages: all.slice(-HISTORY_CAP), files: nid ? sessionFiles("claude:" + nid) : [] });
      return;
    }
    if (msg.t === "new") {
      const id = randomUUID();
      const agentName = agents.names().includes(msg.agent) ? msg.agent : agents.default;
      const cwd = typeof msg.cwd === "string" && existsSync(msg.cwd) ? msg.cwd : CWD;
      const s = store.ensure(id, { agent: agentName, cwd });
      subs.set(ws, id);
      syncTails();
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
      await runAndSendSearch(ws, msg.query, false); // busca digitada não fala; áudio só quando pedido por voz
      return;
    }
    // per-session "resumir e falar" — cheap one-shot, spoken, not stored in history
    if (msg.t === "summarize" && typeof msg.sessionId === "string") {
      if (voiceOpBusy) { send(ws, { t: "busy", message: "Já estou gerando um áudio — aguarde terminar." }); return; }
      voiceOpBusy = true;
      try { await summarizeAndSpeak(ws, msg.sessionId, msg.speak !== false); } finally { voiceOpBusy = false; }
      return;
    }
    // cross-agent digest ("o que está rolando entre as sessões")
    if (msg.t === "digest") {
      if (voiceOpBusy) { send(ws, { t: "busy", message: "Já estou gerando um áudio — aguarde terminar." }); return; }
      voiceOpBusy = true;
      try { await digestAndSpeak(ws, msg.speak !== false); } finally { voiceOpBusy = false; }
      return;
    }
    // summary/digest one-shot config (which agent/model/effort — cheap by default)
    if (msg.t === "summary_cfg") { send(ws, { t: "summary_cfg", cfg: summaryCfg, agents: await agents.describe() }); return; }
    if (msg.t === "set_summary_cfg") {
      if (typeof msg.agent === "string" && agents.names().includes(msg.agent)) summaryCfg.agent = msg.agent;
      if (typeof msg.model === "string" && msg.model) summaryCfg.model = msg.model;
      if (typeof msg.effort === "string" && msg.effort) summaryCfg.effort = msg.effort;
      saveSummaryCfg();
      send(ws, { t: "summary_cfg", cfg: summaryCfg, agents: await agents.describe() });
      return;
    }
    // --- self-update (git) ---
    if (msg.t === "update_check") { await refreshUpdate(false); send(ws, { t: "update_status", status: updateStatus }); return; }
    if (msg.t === "update_apply") {
      if (!requireOwner(ws)) return;
      const all = !!msg.allMachines;
      let sent = 0;
      if (all) for (const rc of runners.values()) if (!rc.local && rc.ws && rc.ws.readyState === WebSocket.OPEN) { if (sendToRunner(rc, { t: "update" })) sent++; }
      auth.audit("update_apply", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, detail: all ? `hub + ${sent} máquina(s)` : "hub" });
      send(ws, { t: "update_progress", message: all ? `Atualizando o Hub e ${sent} máquina(s)…` : "Atualizando o Hub…" });
      const r = await updateApply(UPDATE_ROOT);
      send(ws, { t: "update_result", ok: r.ok, log: r.log });
      if (r.ok && (r.behind ?? 0) > 0) scheduleRestart();
      else await refreshUpdate(true);
      return;
    }
    if (msg.t === "update_rollback") {
      if (!requireOwner(ws)) return;
      const r = await updateRollback(UPDATE_ROOT);
      send(ws, { t: "update_result", ok: r.ok, log: r.log });
      if (r.ok) scheduleRestart();
      return;
    }
    // --- security admin (owner-only): connected devices + invites + revoke ---
    if (msg.t === "sec_state") { if (!requireOwner(ws)) return; secState(ws); return; }
    if (msg.t === "sec_invite") {
      const p = requireOwner(ws); if (!p) return;
      const role = msg.role === "owner" ? "owner" : "member";
      // ttlSec 0 = sem expiração (permanente); senão entre 1min e 1 ano
      const raw = Number(msg.ttlSec);
      const ttlSec = raw === 0 ? 0 : Math.min(Math.max(raw || 86400, 60), 365 * 86400);
      const runners = Array.isArray(msg.runners) ? msg.runners.filter((x: any) => typeof x === "string") : [];
      const { code, invite } = auth.mintInvite(p.userId, { role, runners, ttlSec });
      send(ws, { t: "sec_invite_created", code, invite });
      secState(ws);
      return;
    }
    if (msg.t === "sec_revoke_device" && typeof msg.deviceId === "string") {
      if (!requireOwner(ws)) return;
      auth.revokeDevice(msg.deviceId);
      dropRevoked();
      secState(ws);
      return;
    }
    if (msg.t === "sec_set_role" && typeof msg.deviceId === "string" && (msg.role === "owner" || msg.role === "member")) {
      if (!requireOwner(ws)) return;
      if (auth.setDeviceRole(msg.deviceId, msg.role)) refreshPrincipalRole(msg.deviceId, msg.role);
      else send(ws, { t: "error", message: "não é possível (precisa de ao menos 1 dono)" });
      secState(ws);
      return;
    }
    if (msg.t === "sec_revoke_all") {
      const p = requireOwner(ws); if (!p) return;
      if (p.deviceId) auth.revokeAllExcept(p.deviceId);
      dropRevoked();
      secState(ws);
      return;
    }
    if (msg.t === "sec_revoke_invite" && typeof msg.inviteId === "string") {
      if (!requireOwner(ws)) return;
      auth.revokeInvite(msg.inviteId);
      secState(ws);
      return;
    }
    // --- machines (runners): mint a per-machine token / revoke one (owner) ---
    if (msg.t === "mint_runner") {
      const p = requireOwner(ws); if (!p) return;
      const label = (typeof msg.label === "string" && msg.label.trim()) ? msg.label.trim().slice(0, 40) : "Nova máquina";
      const rid = "m-" + randomUUID().slice(0, 8);
      const token = auth.mintRunnerToken(rid, label);
      auth.audit("mint_runner", { userId: p.userId, detail: label });
      send(ws, { t: "runner_token", runnerId: rid, label, token });
      secState(ws);
      return;
    }
    if (msg.t === "sec_revoke_runner" && typeof msg.runnerId === "string") {
      if (!requireOwner(ws)) return;
      auth.revokeRunnerToken(msg.runnerId);
      const rc = runners.get(msg.runnerId); if (rc && rc.ws) { try { rc.ws.close(); } catch { /* ignore */ } }
      runners.delete(msg.runnerId); if (runnerLabels[msg.runnerId]) { delete runnerLabels[msg.runnerId]; saveRunnerLabels(); }
      broadcastMachines(); secState(ws);
      return;
    }
    // owner passphrase (2nd factor): set/change/clear
    if (msg.t === "set_pass" && typeof msg.new === "string") {
      if (!requireOwner(ws)) return;
      try { auth.setPassphrase(msg.new); } catch (e: any) { send(ws, { t: "error", message: String(e?.message ?? e) }); return; }
      // don't kick sessions that are already in — only future/reconnecting ones need the passphrase
      for (const c of wss.clients) { const pr = principals.get(c as WebSocket); if (pr) pr.verified = true; }
      send(ws, { t: "pass_set", enabled: true });
      secState(ws);
      return;
    }
    if (msg.t === "clear_pass") {
      if (!requireOwner(ws)) return;
      auth.clearPassphrase();
      send(ws, { t: "pass_set", enabled: false });
      secState(ws);
      return;
    }
    // QR code of the URL to open on the phone
    if (msg.t === "qr" && typeof msg.url === "string") {
      try { send(ws, { t: "qr", url: msg.url, dataUri: await QRCode.toDataURL(msg.url, { width: 300, margin: 1 }) }); }
      catch (e: any) { send(ws, { t: "error", message: "qr: " + String(e?.message ?? e) }); }
      return;
    }
    // Web Push subscribe/unsubscribe + VAPID public key
    if (msg.t === "pushkey") { send(ws, { t: "pushkey", key: vapid.publicKey }); return; }
    if (msg.t === "subscribe" && msg.sub) { addSub(msg.sub); send(ws, { t: "pushok" }); return; }
    if (msg.t === "unsubscribe" && typeof msg.endpoint === "string") { removeSub(msg.endpoint); return; }
    if (msg.t === "sendTo" && typeof msg.sessionId === "string" && typeof msg.text === "string") {
      const s = store.get(msg.sessionId);
      if (!s) { send(ws, { t: "error", message: "sessão não encontrada" }); return; }
      const ag = agents.get(s.agent);
      const now = Date.now();
      store.add(s.id, { role: "user", text: msg.text, ts: now, agent: s.agent });
      broadcast(s.id, { t: "message", message: { sessionId: s.id, role: "user", text: msg.text, ts: now, agent: s.agent } });
      pushSessions();
      try {
        const reply = await agentTurn(s.id, ag, msg.text, s.cwd, { model: msg.model, effort: msg.effort });
        store.add(s.id, { role: "assistant", text: reply.text, ts: Date.now(), agent: s.agent });
        pushSessions();
      } catch (e: any) {
        send(ws, { t: "error", message: String(e?.message ?? e) });
      }
      return;
    }

    // --- conversation (text or voice) ---
    const sid = subs.get(ws) || (typeof msg.sessionId === "string" ? msg.sessionId : "default");
    subs.set(ws, sid);

    // Resolve the utterance first — routing (search / voice / native / normal) depends on it,
    // and native ids aren't in the store so we must NOT store.ensure() them here.
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
    { const _p = principalOf(ws); auth.audit("send", { userId: _p?.userId, deviceId: _p?.deviceId, detail: `${sid}: ${String(text).slice(0, 80)}` }); }

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
    // Continue an imported native CLI session (resumes the real claude session; persists in its jsonl).
    if (isNativeId(sid)) {
      await deliverNativeTurn(ws, sid, text, { model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, speak: !!msg.speak, speaker, attachments: Array.isArray(msg.attachments) ? msg.attachments : [] });
      return;
    }

    // --- normal Jarvis session (agent + cwd locked at creation) ---
    const session = store.ensure(sid);
    const agent = agents.get(session.agent);

    // Attachments: agent sees file contents / image paths; chat shows text + 📎 chip / image preview.
    const { agentText, showText, images } = buildAttachments(Array.isArray(msg.attachments) ? msg.attachments : [], text);
    text = showText;

    const now = Date.now();
    // User message -> store + broadcast to everyone on this session (so all UIs show it).
    store.add(sid, { role: "user", text, ts: now, agent: agent.name, speaker, images });
    broadcast(sid, { t: "message", message: { sessionId: sid, role: "user", text, ts: now, agent: agent.name, speaker, images } });
    pushSessions();

    try {
      const opts = { model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined };
      const reply = await agentTurn(sid, agent, agentText, session.cwd, opts);
      store.add(sid, { role: "assistant", text: reply.text, ts: Date.now(), agent: agent.name });
      pushSessions();

      if (msg.speak) {
        const spoken = await speechForReply(reply.text); // clean text, not raw markdown
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

  // Initial state — pushed AFTER the message listener is attached. With auth ON,
  // it is deferred until the client completes the handshake (see handleAuth ->
  // sendInitialState); the client drives with authinfo/auth on connect. With auth
  // OFF (JARVIS_AUTH=off), push immediately as before.
  if (!auth.AUTH_ENABLED) void sendInitialState(ws);
});

// --- loopback-only admin API (host recovery) --------------------------------
// Mint pairing codes / manage devices WITHOUT a logged-in device. Bound to
// 127.0.0.1 so only host-local processes reach it (a reverse proxy forwards to
// PORT, never here). This is the answer to "no devices left — how do I get a
// code?": run scripts/jarvis.ps1 on the host. See docs/multi-runner.md (4a).
const ADMIN_PORT = Number(process.env.JARVIS_ADMIN_PORT || 4578);
const PUBLIC_URL = (process.env.JARVIS_PUBLIC_URL || "").replace(/\/+$/, "");
function inviteLink(code: string): string | undefined { return PUBLIC_URL ? `${PUBLIC_URL}/#invite=${encodeURIComponent(code)}` : undefined; }
const adminServer = createServer((req, res) => {
  const ra = String(req.socket.remoteAddress || "");
  if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra)) { res.writeHead(403, { "content-type": "application/json" }).end('{"error":"loopback only"}'); return; }
  // anti-CSRF + anti-DNS-rebinding: the recovery CLI never sets Origin/Referer, and always
  // uses a localhost Host. A browser page (even via DNS rebinding) sets Origin and/or a
  // rebound Host — reject those so a visited web page can't drive the admin API.
  if (req.headers.origin || req.headers.referer) { res.writeHead(403, { "content-type": "application/json" }).end('{"error":"browser requests not allowed"}'); return; }
  const host = String(req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (host && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) { res.writeHead(403, { "content-type": "application/json" }).end('{"error":"bad host"}'); return; }
  const url = (req.url || "/").split("?")[0];
  const json = (code: number, obj: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const body = () => new Promise<any>((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
  (async () => {
    try {
      if (req.method === "GET" && url === "/admin/status") return json(200, { claimed: auth.isClaimed(), authEnabled: auth.AUTH_ENABLED, devices: auth.listDevices(), invites: auth.listInvites(), guard: guard.stats() });
      if (req.method === "GET" && url === "/admin/claimcode") return json(200, { claimed: auth.isClaimed(), code: auth.isClaimed() ? null : auth.ensureClaimCode() });
      if (req.method === "GET" && url === "/admin/audit") { const n = Number((req.url || "").split("n=")[1]) || 100; return json(200, { audit: auth.readAudit(n) }); }
      if (req.method === "GET" && url === "/admin/update") { return json(200, await updateCheck(UPDATE_ROOT, true)); }
      if (req.method === "POST" && url === "/admin/update") { const r = await updateApply(UPDATE_ROOT); if (r.ok && (r.behind ?? 0) > 0) scheduleRestart(); return json(200, r); }
      if (req.method === "POST" && url === "/admin/update/rollback") { const r = await updateRollback(UPDATE_ROOT); if (r.ok) scheduleRestart(); return json(200, r); }
      if (req.method === "POST" && url === "/admin/update-runners") { let sent = 0; for (const rc of runners.values()) if (!rc.local && rc.ws && rc.ws.readyState === WebSocket.OPEN) { if (sendToRunner(rc, { t: "update" })) sent++; } return json(200, { ok: true, sent }); }
      // purge the "ok" probe litter on connected runners via their existing delete handler
      // (no git-pull/restart needed): query the session list, delete the "ok" natives, repeat.
      if (req.method === "POST" && url === "/admin/purge-runner-ok") {
        const results: any[] = [];
        for (const rc of runners.values()) {
          if (rc.local || !rc.ws || rc.ws.readyState !== WebSocket.OPEN) continue;
          let purged = 0;
          for (let round = 0; round < 60; round++) {
            const sessions: any[] = await new Promise((resolve) => { pendingRunnerList.set(rc.id, resolve); sendToRunner(rc, { t: "list" }); setTimeout(() => { if (pendingRunnerList.delete(rc.id)) resolve([]); }, 6000); });
            const okIds = sessions.filter((s) => typeof s?.id === "string" && s.source === "native" && String(s.title || "").trim().toLowerCase() === "ok").map((s) => s.id);
            if (!okIds.length) break;
            sendToRunner(rc, { t: "delete", sessionIds: okIds, alsoNative: true });
            purged += okIds.length;
            await new Promise((r) => setTimeout(r, 900));
          }
          results.push({ runner: runnerLabels[rc.id] || rc.id, purged });
        }
        return json(200, { ok: true, results });
      }
      if (req.method === "POST" && url === "/admin/invite") {
        const b = await body();
        const role = b.role === "owner" ? "owner" : "member";
        const ttlSec = Math.min(Math.max(Number(b.ttlSec) || 86400, 60), 30 * 86400);
        const { code, invite } = auth.mintInvite("cli", { role, runners: [], ttlSec });
        return json(200, { code, link: inviteLink(code), invite });
      }
      if (req.method === "POST" && url === "/admin/runner-token") {
        const b = await body();
        const label = (typeof b.label === "string" && b.label) ? b.label : "runner";
        const rid = (typeof b.runnerId === "string" && b.runnerId) ? b.runnerId : ("m-" + randomUUID().slice(0, 8));
        const token = auth.mintRunnerToken(rid, label);
        const hubWs = PUBLIC_URL ? PUBLIC_URL.replace(/^http/, "ws") : `ws://<este-host>:${PORT}`;
        return json(200, { runnerId: rid, label, token, hub: hubWs });
      }
      if (req.method === "POST" && url === "/admin/passphrase") {
        const b = await body();
        if (b.clear) { auth.clearPassphrase(); return json(200, { ok: true, enabled: false }); }
        if (typeof b.new === "string") { try { auth.setPassphrase(b.new); return json(200, { ok: true, enabled: true }); } catch (e: any) { return json(400, { error: String(e?.message ?? e) }); } }
        return json(200, { enabled: auth.hasPassphrase() });
      }
      if (req.method === "POST" && url === "/admin/revoke") { const b = await body(); const ok = typeof b.deviceId === "string" && auth.revokeDevice(b.deviceId); dropRevoked(); return json(200, { ok: !!ok }); }
      if (req.method === "POST" && url === "/admin/device-role") { const b = await body(); const role = b.role === "owner" ? "owner" : "member"; const ok = typeof b.deviceId === "string" && auth.setDeviceRole(b.deviceId, role); if (ok) refreshPrincipalRole(b.deviceId, role); return json(200, { ok: !!ok, role }); }
      if (req.method === "POST" && url === "/admin/revoke-all") { const n = auth.listDevices().length; for (const d of auth.listDevices()) auth.revokeDevice(d.id); dropRevoked(); return json(200, { revoked: n }); }
      json(404, { error: "not found" });
    } catch (e: any) { json(500, { error: String(e?.message ?? e) }); }
  })();
});
adminServer.listen(ADMIN_PORT, "127.0.0.1", () => console.log(`[hub] admin (loopback) http://127.0.0.1:${ADMIN_PORT}  — recovery: scripts/jarvis.ps1`));

void refreshLocalAgents();
setInterval(() => void refreshLocalAgents(), 300_000); // every 5 min — availability rarely changes; each probe spawns a real `claude -p`
setTimeout(() => void refreshUpdate(true), 8_000); // first update check shortly after boot
setInterval(() => void refreshUpdate(true), 6 * 3600_000); // then every 6h
try { const purged = purgeProbeJunk(); if (purged) console.log(`[hub] limpei ${purged} sessão(ões) de sondagem "ok"`); } catch { /* ignore */ }
server.listen(PORT, () => {
  console.log(`[hub] http+ws  http://127.0.0.1:${PORT}`);
  console.log(`[hub] agents=[${agents.names().join(", ")}]  default=${agents.default}  cwd=${CWD}  voice=${VOICE}`);
  console.log(`[hub] guard: rate-limit + conn caps + ${Math.round(guard.MAX_PAYLOAD / 1024 / 1024)}MB payload cap active${/^(on|1|true)$/i.test(process.env.JARVIS_TRUST_PROXY || "") ? " (trust-proxy on)" : ""}`);
  if (!auth.AUTH_ENABLED) {
    console.log(`[hub] AUTH DISABLED (JARVIS_AUTH=off) — every connection is trusted. Use ONLY on a private network (never a public server).`);
  } else if (!auth.isClaimed()) {
    const code = auth.ensureClaimCode();
    console.log(`[hub] UNCLAIMED. Claim ownership on your first device with this code:\n\n      ${code}\n\n      (also saved to ~/.jarvis/claim-code.txt)`);
  } else {
    console.log(`[hub] auth on — ${auth.listDevices().length} device(s) paired.`);
  }
});
