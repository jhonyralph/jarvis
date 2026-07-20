/**
 * Jarvis MCP server (stdio) — exposes the fleet as tools so any MCP client (Claude Desktop, Claude
 * Code, …) can list machines/sessions, read fleet status, and kick off a task on a machine.
 *
 * It's a thin bridge: MCP JSON-RPC on stdin/stdout (protocol handled by @jarvis/core's handleMcp),
 * backed by a WebSocket client to the Hub that speaks the same protocol the web UI uses.
 *
 * Env:
 *   JARVIS_HUB        ws(s) URL of the Hub (default ws://127.0.0.1:4577)
 *   JARVIS_MCP_TOKEN  a device token (mint one in the UI / `jarvis invite`); omit only if JARVIS_AUTH=off
 *
 * IMPORTANT: only JSON-RPC goes to stdout; all logs go to stderr (an MCP client parses stdout).
 * Register with an MCP client, e.g. Claude Desktop config:
 *   { "mcpServers": { "jarvis": { "command": "npx", "args": ["tsx", "<repo>/apps/mcp/src/index.ts"],
 *     "env": { "JARVIS_HUB": "ws://127.0.0.1:4577", "JARVIS_MCP_TOKEN": "<token>" } } } }
 */
import { createInterface } from "node:readline";
import { WebSocket } from "ws";
import { handleMcp, VERSION, type McpTool, type JsonRpcMessage } from "@jarvis/core";

const HUB = (process.env.JARVIS_HUB || "ws://127.0.0.1:4577").replace(/\/$/, "");
const TOKEN = process.env.JARVIS_MCP_TOKEN || "";
const log = (...a: unknown[]) => console.error("[jarvis-mcp]", ...a);

// --- Hub WebSocket client: connect, auth, and a reply-by-type request helper -------------------
let ws: WebSocket | null = null;
let readyResolve: (() => void) | null = null;
let ready: Promise<void> = new Promise((r) => (readyResolve = r));
const waiters: Array<{ type: string; resolve: (m: any) => void }> = [];

function connect(): void {
  ws = new WebSocket(HUB + "/");
  ws.on("open", () => { ws!.send(JSON.stringify(TOKEN ? { t: "auth", token: TOKEN } : { t: "authinfo" })); });
  ws.on("message", (d) => {
    let m: any; try { m = JSON.parse(d.toString()); } catch { return; }
    if (m.t === "authed" || m.t === "machines" || m.t === "sessions") { if (readyResolve) { readyResolve(); readyResolve = null; } }
    if (m.t === "unauth" || (m.t === "need_pass")) log("auth falhou:", m.reason || m.t, "— confira JARVIS_MCP_TOKEN / passphrase");
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].type === m.t) { waiters[i].resolve(m); waiters.splice(i, 1); }
  });
  ws.on("close", () => { ready = new Promise((r) => (readyResolve = r)); setTimeout(connect, 1500); });
  ws.on("error", (e) => log("ws erro:", (e as any)?.message || e));
}

/** Send `msg` and resolve with the next Hub message of type `replyType`. Times out. */
function request(msg: unknown, replyType: string, ms = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error("Hub desconectado")); return; }
    const w = { type: replyType, resolve };
    waiters.push(w);
    ws.send(JSON.stringify(msg));
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error(`timeout esperando "${replyType}" do Hub`)); } }, ms);
  });
}
const send = (msg: unknown) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

// --- tools ------------------------------------------------------------------------------------
const tools: McpTool[] = [
  {
    name: "jarvis_list_machines",
    description: "Lista as máquinas (runners) do Jarvis: online/offline, IA autenticada e versão.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      await ready;
      const m = await request({ t: "machines" }, "machines");
      const rows = (m.machines || []).map((x: any) => `- ${x.label}${x.local ? " (servidor)" : ""} · ${x.online ? "online" : "offline"}${x.agents?.length ? " · " + x.agents.join("/") : " · ⚠ sem IA"}${x.commit ? " · " + x.commit : ""} [id: ${x.id}]`);
      return rows.length ? rows.join("\n") : "Nenhuma máquina.";
    },
  },
  {
    name: "jarvis_fleet_status",
    description: "Uso & custo: máquinas online, turnos rodando, sessões, custo estimado por IA e uso do plano.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      await ready;
      const m = await request({ t: "fleet" }, "fleet");
      const T = m.totals || {}, mm = m.machines || [];
      let out = `Uso & custo: ${mm.filter((x: any) => x.online).length}/${mm.length} máquinas online · ${T.active || 0} rodando · ${T.sessions || 0} sessões · $${(T.billableTotal || 0).toFixed(2)} cobrado reportado · ≈$${(T.estimatedTotal || 0).toFixed(2)} equivalente estimado\n`;
      const agName: Record<string, string> = { "claude-code": "Claude", codex: "Codex", gemini: "Gemini", cursor: "Cursor", copilot: "Copilot", opencode: "OpenCode", cline: "Cline", qwen: "Qwen", continue: "Continue", kiro: "Kiro", antigravity: "Antigravity", aider: "Aider", outro: "Outros" };
      const usageFmt = (u: any) => u?.billableUsd > 0 && u?.estimatedUsd <= 0 ? `$${u.costUsd.toFixed(2)}` : u?.estimatedUsd > 0 && u?.billableUsd <= 0 ? `≈$${u.costUsd.toFixed(2)}` : `Σ$${Number(u?.costUsd || 0).toFixed(2)}`;
      const agLine = Object.entries(T.byAgentUsage || {}).sort((a, b) => Number((b[1] as any)?.costUsd || 0) - Number((a[1] as any)?.costUsd || 0)).map(([a, u]) => `${agName[a] || a} ${usageFmt(u)}`).join(" · ");
      if (agLine) out += `Custo por IA: ${agLine}\n`;
      out += mm.map((x: any) => `- ${x.label}: ${x.online ? "online" : "offline"}${x.active ? ` · ${x.active} rodando` : ""}${x.stale ? " · desatualizada" : ""}`).join("\n");
      if (m.plan?.fiveHour) out += `\nPlano 5h: ${Math.round(m.plan.fiveHour.pct)}%` + (m.plan.sevenDay ? ` · semanal: ${Math.round(m.plan.sevenDay.pct)}%` : "");
      return out;
    },
  },
  {
    name: "jarvis_list_sessions",
    description: "Lista as sessões de todas as máquinas (título, agente, pasta, máquina).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      await ready;
      const m = await request({ t: "listAll" }, "sessions");
      const rows = (m.sessions || []).slice(0, 40).map((s: any) => `- ${s.title || s.id}${s.machine ? ` [${s.machine}]` : ""}${s.agent ? " · " + s.agent : ""}${s.cwd ? " · " + s.cwd : ""} (id: ${s.id})`);
      return rows.length ? rows.join("\n") : "Nenhuma sessão.";
    },
  },
  {
    name: "jarvis_run_task",
    description: "Inicia uma tarefa numa máquina: cria uma sessão nova e envia o prompt. O resultado aparece no Jarvis. Args: prompt (obrigatório), machine (id da máquina, padrão 'local'), agent, cwd.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "a instrução para o agente" },
        machine: { type: "string", description: "id da máquina (veja jarvis_list_machines); padrão 'local'" },
        agent: { type: "string", description: "id do adapter (claude-code, codex, gemini, cursor, copilot, opencode, cline, qwen, continue, kiro, antigravity ou aider)" },
        cwd: { type: "string", description: "pasta de trabalho" },
      },
      required: ["prompt"],
    },
    handler: async (args) => {
      await ready;
      const prompt = String(args.prompt || "").trim();
      if (!prompt) return "erro: 'prompt' vazio.";
      const machine = args.machine ? String(args.machine) : "local";
      send({ t: "runner", runnerId: machine });                    // switch active runner (ordered before 'new')
      const h = await request({ t: "new", agent: args.agent, cwd: args.cwd }, "history");
      send({ t: "send", sessionId: h.sessionId, text: prompt });   // routes to the active machine
      return `Tarefa iniciada na máquina "${machine}", sessão ${h.sessionId}. Acompanhe no Jarvis (o resultado chega por lá / push).`;
    },
  },
];

// --- stdio JSON-RPC loop ----------------------------------------------------------------------
connect();
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const s = line.trim();
  if (!s) return;
  let msg: JsonRpcMessage;
  try { msg = JSON.parse(s); } catch { return; }
  const resp = await handleMcp(msg, tools, { name: "jarvis", version: VERSION });
  if (resp) process.stdout.write(JSON.stringify(resp) + "\n");
});
log(`pronto (Hub ${HUB}${TOKEN ? "" : ", sem token"})`);
