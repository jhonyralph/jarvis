/**
 * Ponte MCP de TAREFAS (C3): a porta única pela qual qualquer IA fala com os provedores.
 *
 * Mesmo desenho da permission-bridge (provado ponta a ponta): um servidor MCP stdio minúsculo,
 * embutido como STRING e escrito de forma idempotente em ~/.jarvis, injetado por sessão no
 * lançamento do agente via mcp-config temporário. A IA ganha `jarvis_task_search/get/create` sem
 * NENHUMA configuração própria — e sem nunca ver credencial: cada chamada vai ao Hub, que resolve
 * sessão → projeto → conexão do cofre e executa com a conta certa.
 *
 * `create` pode BLOQUEAR aguardando a aprovação do dono (o Hub segura a resposta) — é o preview
 * nominal do C4 valendo também para a IA, não só para a UI.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const TASK_BRIDGE_SCRIPT = `import { createInterface } from "node:readline";
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const URL_ = process.env.JARVIS_TASK_URL;
const TOKEN = process.env.JARVIS_TASK_TOKEN;
const SESSION = process.env.JARVIS_TASK_SESSION || "";
// create espera decisão humana; o Hub é dono do timeout real. Isto é só a rede de segurança final.
const HARD_TIMEOUT_MS = 15 * 60 * 1000;
async function callHub(op, args) {
  if (!URL_ || !TOKEN) return { ok: false, error: "ponte de tarefas do Jarvis não configurada" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HARD_TIMEOUT_MS);
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + TOKEN },
      body: JSON.stringify({ sessionId: SESSION, op, args: args ?? {} }),
      signal: ctrl.signal,
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: "Jarvis respondeu HTTP " + res.status + ": " + body.slice(0, 200) };
    try { return JSON.parse(body); } catch { return { ok: false, error: "resposta ilegível do Hub" }; }
  } catch (e) {
    return { ok: false, error: "ponte de tarefas: " + String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}
const TOOLS = [
  { name: "search", description: "Busca tarefas na fonte vinculada ao PROJETO desta sessão (Jira/GitHub/Linear/...). O Jarvis escolhe a conta certa; nunca há conta padrão.", inputSchema: { type: "object", properties: { query: { type: "string", description: "texto da busca" } }, required: ["query"] } },
  { name: "get", description: "Carrega uma tarefa pela chave (ex.: ABC-123, owner/repo#42) na fonte vinculada ao projeto.", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "create", description: "Cria uma tarefa no destino vinculado ao projeto. BLOQUEIA aguardando aprovação do dono no Jarvis; pode ser recusada.", inputSchema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title"] } },
];
createInterface({ input: process.stdin }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (method === "initialize") send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jarvistask", version: "0.0.1" } } });
  else if (method === "notifications/initialized") { /* sem resposta */ }
  else if (method === "tools/list") send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  else if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    callHub(String(name || ""), args).then((r) => {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(r) }], isError: r && r.ok === false } });
    });
  }
  else if (method === "ping") send({ jsonrpc: "2.0", id, result: {} });
  else if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
});
`;

export function taskBridgePath(dir = join(homedir(), ".jarvis")): string {
  return join(dir, "task-bridge.mjs");
}

/** Escreve a ponte (idempotente — upgrade regrava) e devolve o caminho. Best-effort como a de permissão. */
export function ensureTaskBridge(dir = join(homedir(), ".jarvis")): string {
  const path = taskBridgePath(dir);
  try {
    mkdirSync(dir, { recursive: true });
    let current = "";
    try { current = readFileSync(path, "utf8"); } catch { /* ainda não escrita */ }
    if (current !== TASK_BRIDGE_SCRIPT) writeFileSync(path, TASK_BRIDGE_SCRIPT);
  } catch { /* caller falha fechado na camada MCP */ }
  return path;
}
