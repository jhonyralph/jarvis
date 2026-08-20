/**
 * Fonte de tarefas por MCP, executada NA MÁQUINA DO PROJETO (fatia E).
 *
 * Por que aqui e não no Hub: um servidor MCP de tarefas depende do que existe naquela máquina —
 * binário, credencial, VPN, acesso ao repositório. O Hub perguntar isso pelo disco dele devolveria a
 * resposta de outro lugar, que é o mesmo engano que a fatia C matou na varredura local.
 *
 * Três decisões que sustentam o resto:
 *
 *  1. **A allowlist é o arquivo da própria máquina** (`~/.jarvis/task-mcp.json`). O Hub manda só o
 *     NOME do servidor; se o nome não existir ali, a resposta é recusa com motivo. Nada vindo da
 *     rede vira linha de comando: quem decide o que roda é quem tem acesso ao disco da máquina —
 *     mesmo nível de confiança do `runner.env`, que já guarda o token do Hub.
 *  2. **Segredo não sai da máquina**: o arquivo guarda `secretEnv` (NOME da env var), nunca o valor,
 *     e o valor é resolvido no processo local. O cliente recebe apenas `{key, title, description}`.
 *  3. **Zero LLM** (anti-escopo do épico): a leitura do resultado é determinística. Se o servidor
 *     devolver texto livre em vez de dados, isso é ERRO com motivo — não um palpite de modelo.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ManagedPersonalMcpClient,
  createMcpStdioStartActionExecutor,
  type PersonalEndpointPolicy,
  type PersonalMcpClientDependencies,
  type PersonalMcpTransport,
} from "./personal-mcp-client.js";
import { isSensitiveEnvKey } from "./personal-mcp-client.js";
import { writeJsonAtomic } from "./persist.js";
import type { LocalTaskFile } from "./task-local-cache.js";

/** Teto de itens numa listagem — a lista é para escolher uma tarefa, não para paginar um board. */
export const TASK_MCP_MAX_ITEMS = 200;
const MAX_TEXT_BYTES = 512 * 1024;

export interface TaskMcpServer {
  /** rótulo humano ("Linear do trabalho"); cai no nome da chave quando ausente. */
  label?: string;
  transport: PersonalMcpTransport;
  /** ferramenta que LISTA tarefas (só leitura — esta fonte nunca escreve). */
  listTool: string;
  /** argumentos fixos da listagem (ex.: `{ "limit": 50 }`). */
  listArguments?: Record<string, unknown>;
  /** de onde tirar chave/título/descrição, quando o servidor usa outros nomes de campo. */
  fields?: { key?: string; title?: string; description?: string };
}

export interface TaskMcpConfig {
  /** Servidores EFETIVOS: transporte + o uso de listagem já combinado, que é o que o resto do código
   *  consome desde sempre. A separação servidor × uso é forma de ARQUIVO (v2), não de runtime. */
  servers: Record<string, TaskMcpServer>;
  /** Uso de CRIAÇÃO por servidor (v2). Ausente = aquele servidor não sabe criar, e criar por ele é
   *  recusado com motivo: o que o servidor anuncia não amplia nada. */
  creates: Record<string, { tool: string; arguments?: Record<string, unknown> }>;
  /** Versão lida do arquivo (1 = forma antiga, sem `uses`). */
  schemaVersion: number;
  /** motivo legível quando o arquivo existe mas não pôde ser usado (nunca silencioso). */
  error?: string;
}

export function taskMcpConfigFile(home = process.env.JARVIS_HOME || homedir()): string {
  return join(home, ".jarvis", "task-mcp.json");
}

const str = (v: unknown, cap = 200): string => (typeof v === "string" ? v.trim().slice(0, cap) : "");

/**
 * Lê a allowlist da máquina. Arquivo ausente NÃO é erro (a máquina só não tem fonte MCP); arquivo
 * torto é erro com o caminho, porque um JSON quebrado silenciosamente vira "nenhuma tarefa" — e essa
 * é justamente a resposta que engana.
 */
export function loadTaskMcpConfig(file = taskMcpConfigFile()): TaskMcpConfig {
  const vazio = { servers: {}, creates: {}, schemaVersion: TASK_MCP_SCHEMA_VERSION };
  if (!existsSync(file)) return vazio;
  let raw: any;
  try { raw = JSON.parse(readFileSync(file, "utf8")); }
  catch (e: any) { return { ...vazio, error: `${file} não é um JSON válido (${String(e?.message ?? e).slice(0, 120)})` }; }
  const source = raw && typeof raw === "object" && raw.servers && typeof raw.servers === "object" ? raw.servers : undefined;
  if (!source) return { ...vazio, error: `${file} precisa de um objeto "servers" com os servidores MCP de tarefa` };
  // v2 separa COMO subir o servidor (transport) de PARA QUE usá-lo (uses.tasks[nome]). O runtime
  // continua consumindo um servidor "efetivo": a separação existe para o mesmo processo servir mais de
  // um uso — listar e criar —, não para espalhar a decisão por duas estruturas em memória.
  const versao = Number(raw?.schemaVersion) >= 2 ? 2 : 1;
  const usos = (versao === 2 && raw?.uses && typeof raw.uses === "object" && raw.uses.tasks && typeof raw.uses.tasks === "object")
    ? raw.uses.tasks as Record<string, any> : {};
  const servers: Record<string, TaskMcpServer> = {};
  const creates: TaskMcpConfig["creates"] = {};
  const rejected: string[] = [];
  for (const [rawName, value] of Object.entries(source as Record<string, any>)) {
    const name = str(rawName, 60);
    const uso = usos[rawName] && typeof usos[rawName] === "object" ? usos[rawName] : undefined;
    // O uso de listagem é dobrado de volta no servidor: é o que `pickTaskMcpServer` e
    // `listTasksFromMcp` sempre consumiram, e nenhum deles precisa saber em que forma o arquivo está.
    const efetivo = versao === 2 && uso?.list
      ? { ...value, listTool: uso.list.tool, listArguments: uso.list.arguments, fields: uso.list.fields }
      : value;
    const parsed = parseServer(efetivo);
    if (!parsed) { rejected.push(name); continue; }
    servers[name] = parsed;
    const criar = uso?.create;
    if (criar && str(criar.tool, 80)) creates[name] = { tool: str(criar.tool, 80), arguments: criar.arguments && typeof criar.arguments === "object" ? criar.arguments : undefined };
  }
  const error = rejected.length ? `servidor(es) ignorado(s) por configuração incompleta em ${file}: ${rejected.join(", ")}` : undefined;
  return { servers, creates, schemaVersion: versao, error };
}

function parseServer(value: any): TaskMcpServer | null {
  if (!value || typeof value !== "object") return null;
  const listTool = str(value.listTool, 80);
  if (!listTool) return null;
  const t = value.transport && typeof value.transport === "object" ? value.transport : {};
  let transport: PersonalMcpTransport;
  if (str(t.kind, 20) === "streamable-http" || str(t.endpoint, 500)) {
    const endpoint = str(t.endpoint, 500);
    if (!endpoint) return null;
    // Servidor "da máquina do projeto": por padrão só loopback/LAN. Alcance maior é declarado no
    // arquivo, explicitamente, por quem administra a máquina.
    const policy: PersonalEndpointPolicy = t.endpointPolicy && typeof t.endpointPolicy === "object"
      ? t.endpointPolicy
      : { allowLoopback: true, allowLan: true };
    transport = {
      kind: "streamable-http", endpoint, profile: "read-only",
      certification: (["first_party", "audited", "uncertified"].includes(str(t.certification, 20)) ? str(t.certification, 20) : "uncertified") as any,
      endpointPolicy: policy,
      ...(str(t.authorizationSecretRef, 120) ? { authorizationSecretRef: str(t.authorizationSecretRef, 120) } : {}),
    };
  } else {
    const command = str(t.command, 300);
    if (!command) return null;
    transport = {
      kind: "stdio", command,
      args: Array.isArray(t.args) ? t.args.map((a: unknown) => String(a).slice(0, 300)).slice(0, 40) : undefined,
      cwd: str(t.cwd, 400) || undefined,
      env: t.env && typeof t.env === "object" ? Object.fromEntries(Object.entries(t.env).map(([k, v]) => [k, String(v).slice(0, 400)])) : undefined,
      secretEnv: t.secretEnv && typeof t.secretEnv === "object" ? Object.fromEntries(Object.entries(t.secretEnv).map(([k, v]) => [k, String(v).slice(0, 120)])) : undefined,
    };
  }
  const fields = value.fields && typeof value.fields === "object"
    ? { key: str(value.fields.key, 60) || undefined, title: str(value.fields.title, 60) || undefined, description: str(value.fields.description, 60) || undefined }
    : undefined;
  return {
    label: str(value.label, 80) || undefined,
    transport, listTool,
    listArguments: value.listArguments && typeof value.listArguments === "object" ? value.listArguments : undefined,
    fields,
  };
}

/* ── Configuração PELA TELA (TSK-12) ───────────────────────────────────────────────────────────
   Quem valida e grava é a máquina dona do arquivo. O Hub só encaminha a intenção: a decisão fica
   onde está o disco, que é a mesma postura da ponte de tarefas. O que sai daqui para a tela é
   REDIGIDO — nomes de env, nunca valores. */

/** Limites: uma allowlist, não um catálogo. Números grandes aqui só escondem engano de configuração. */
export const TASK_MCP_MAX_SERVERS = 20;
const NOME_OK = /^[a-z0-9][a-z0-9._-]{0,59}$/i;
const ENV_NAME_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type TaskMcpValidation = { ok: true; name: string; server: TaskMcpServer } | { ok: false; error: string };

/**
 * Valida o que veio da tela ANTES de virar arquivo. O erro precisa dizer o conserto: "faltou X" é
 * inútil se a pessoa não sabe onde X mora. Recusa em vez de sanear — corrigir em silêncio o que
 * alguém digitou esconde engano de configuração, que é o defeito que esta fatia existe para matar.
 */
export function validateTaskMcpServerInput(name: unknown, input: unknown): TaskMcpValidation {
  const nome = str(name, 60);
  if (!NOME_OK.test(nome)) return { ok: false, error: "nome do servidor: use letras, números, ponto, hífen ou _ (até 60)" };
  if (!input || typeof input !== "object") return { ok: false, error: "servidor vazio" };
  const raw = input as Record<string, any>;
  if (!str(raw.listTool, 80)) return { ok: false, error: "falta `listTool`: o nome da ferramenta MCP que LISTA tarefas" };
  const t = raw.transport && typeof raw.transport === "object" ? raw.transport as Record<string, any> : {};
  const kind = str(t.kind, 20) || (str(t.endpoint, 500) ? "streamable-http" : "stdio");
  if (kind === "streamable-http") {
    if (!str(t.endpoint, 500)) return { ok: false, error: "transporte HTTP precisa de `endpoint`" };
  } else {
    if (!str(t.command, 300)) return { ok: false, error: "transporte stdio precisa de `command` (o executável que sobe o servidor)" };
    if (t.args !== undefined && !Array.isArray(t.args)) return { ok: false, error: "`args` precisa ser uma lista de textos" };
    if ((t.args?.length ?? 0) > 40) return { ok: false, error: "no máximo 40 argumentos" };
    for (const [key, value] of Object.entries((t.env && typeof t.env === "object" ? t.env : {}) as Record<string, unknown>)) {
      if (!ENV_NAME_OK.test(key)) return { ok: false, error: `nome de variável inválido: ${key}` };
      // A MESMA regra do cliente MCP pessoal. Valor que parece segredo não vira arquivo de
      // configuração: ele entra por `secretEnv` (NOME), e é resolvido no processo local.
      if (isSensitiveEnvKey(key)) return { ok: false, error: `${key} parece segredo — declare em "secretEnv" o NOME do segredo, não o valor` };
      if (typeof value !== "string") return { ok: false, error: `${key}: valor precisa ser texto` };
    }
    for (const [key, ref] of Object.entries((t.secretEnv && typeof t.secretEnv === "object" ? t.secretEnv : {}) as Record<string, unknown>)) {
      if (!ENV_NAME_OK.test(key)) return { ok: false, error: `nome de variável inválido: ${key}` };
      if (!str(ref, 120)) return { ok: false, error: `${key}: falta o NOME do segredo` };
    }
  }
  const server = parseServer({ ...raw, transport: { ...t, kind } });
  if (!server) return { ok: false, error: "configuração incompleta para este transporte" };
  return { ok: true, name: nome, server };
}

/**
 * Grava a allowlist da máquina. Carimba `schemaVersion` porque a 4b vai migrar a forma do arquivo, e
 * migrar adivinhando a versão de arquivos escritos à mão é como o formato se perde.
 */
export function writeTaskMcpConfig(servers: Record<string, TaskMcpServer>, file = taskMcpConfigFile(), creates: TaskMcpConfig["creates"] = {}): void {
  const names = Object.keys(servers);
  if (names.length > TASK_MCP_MAX_SERVERS) throw new Error(`no máximo ${TASK_MCP_MAX_SERVERS} servidores nesta máquina`);
  // Grava SEMPRE em v2: transporte de um lado, usos do outro. A migração acontece aqui — ler continua
  // aceitando v1, então nenhuma máquina precisa ser tocada para seguir funcionando.
  const puros: Record<string, unknown> = {};
  const uses: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(servers)) {
    puros[name] = { ...(s.label ? { label: s.label } : {}), transport: s.transport };
    uses[name] = {
      list: { tool: s.listTool, ...(s.listArguments ? { arguments: s.listArguments } : {}), ...(s.fields ? { fields: s.fields } : {}) },
      ...(creates[name] ? { create: { tool: creates[name].tool, ...(creates[name].arguments ? { arguments: creates[name].arguments } : {}) } } : {}),
    };
  }
  writeJsonAtomic(file, { schemaVersion: TASK_MCP_SCHEMA_VERSION, servers: puros, uses: { tasks: uses } }, { pretty: true });
}

/** A versão que a gravação carimba. Arquivo sem carimbo é lido como 1 — é o que todo mundo tem hoje. */
export const TASK_MCP_SCHEMA_VERSION = 2;

/** O que a TELA pode ver: nomes de env, nunca valores. O que não trafega não vaza. */
export function describeTaskMcpServers(config: TaskMcpConfig): Array<Record<string, unknown>> {
  return Object.entries(config.servers).map(([name, s]) => {
    const t = s.transport as Record<string, any>;
    return {
      name, label: s.label, listTool: s.listTool, listArguments: s.listArguments, fields: s.fields,
      transportKind: t.kind,
      ...(t.kind === "stdio"
        ? { command: t.command, args: t.args, cwd: t.cwd, envNames: Object.keys(t.env ?? {}), secretEnvNames: Object.keys(t.secretEnv ?? {}) }
        : { endpoint: t.endpoint }),
      testedAt: (s as unknown as Record<string, unknown>).testedAt,
    };
  });
}

/**
 * Qual servidor responde por um projeto. `wanted` vem do vínculo (o Hub sabe só o NOME). Sem nome e
 * com exatamente um servidor, ele é o escolhido — mais de um exige dizer qual, porque adivinhar aqui
 * é escolher a fonte por conta própria, o oposto da fatia D.
 */
export function pickTaskMcpServer(config: TaskMcpConfig, wanted?: string): { name: string; server: TaskMcpServer } | { error: string } {
  const names = Object.keys(config.servers);
  const want = str(wanted, 60);
  if (want) {
    const server = config.servers[want];
    if (server) return { name: want, server };
    return { error: names.length
      ? `esta máquina não tem servidor MCP de tarefas chamado "${want}" (tem: ${names.join(", ")}) — confira ${taskMcpConfigFile()}`
      : `esta máquina não tem nenhum servidor MCP de tarefas configurado — declare "${want}" em ${taskMcpConfigFile()}` };
  }
  if (names.length === 1) return { name: names[0], server: config.servers[names[0]] };
  if (!names.length) return { error: `esta máquina não tem nenhum servidor MCP de tarefas configurado — crie ${taskMcpConfigFile()}` };
  return { error: `esta máquina tem ${names.length} servidores MCP de tarefas (${names.join(", ")}) — diga qual este projeto usa` };
}

/* ── leitura determinística do resultado ──────────────────────────────────────────────────────── */

const pick = (row: Record<string, unknown>, names: string[]): string => {
  for (const name of names) {
    const v = row[name];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
};

/** Onde estão as linhas dentro do que o servidor devolveu (aceita as formas usuais, sem adivinhar). */
function rowsOf(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  for (const key of ["tasks", "issues", "items", "results", "records", "data"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v;
  }
  return null;
}

/**
 * Resultado MCP → itens de tarefa. Determinístico e explícito: usa `structuredContent` quando existe,
 * senão tenta o conteúdo textual COMO JSON. Texto livre é recusado com motivo — inventar tarefa a
 * partir de prosa exigiria um modelo, e o épico proíbe LLM neste caminho.
 */
export function mapMcpTasks(result: unknown, opts: { fields?: TaskMcpServer["fields"]; max?: number } = {}): LocalTaskFile[] {
  const max = Math.max(1, Math.min(opts.max ?? TASK_MCP_MAX_ITEMS, TASK_MCP_MAX_ITEMS));
  const root = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  // `structuredContent` presente mas sem linhas reconhecíveis é um caso diferente de "não veio
  // nada": culpar a ausência de texto esconderia que os dados vieram e não foram entendidos.
  const structured = root.structuredContent !== undefined && root.structuredContent !== null;
  let rows = rowsOf(root.structuredContent);
  if (!rows) {
    const content = Array.isArray(root.content) ? root.content : [];
    const text = content
      .filter((c: any) => c && typeof c === "object" && c.type === "text" && typeof c.text === "string")
      .map((c: any) => String(c.text))
      .join("\n")
      .trim();
    if (!text && structured) throw new Error("não encontrei a lista de tarefas no structuredContent do servidor MCP (esperado um array, ou um objeto com tasks/issues/items/results)");
    if (!text) throw new Error("o servidor MCP não devolveu dados de tarefa (nem structuredContent, nem texto)");
    if (text.length > MAX_TEXT_BYTES) throw new Error("a resposta do servidor MCP é grande demais para ser lida como lista de tarefas");
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new Error("o servidor MCP devolveu texto livre; esta fonte precisa de JSON (structuredContent ou texto JSON) com id e título — nenhum modelo interpreta isso aqui"); }
    rows = rowsOf(parsed);
  }
  if (!rows) throw new Error("não encontrei a lista de tarefas na resposta do servidor MCP (esperado um array, ou um objeto com tasks/issues/items/results)");
  const out: LocalTaskFile[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (out.length >= max) break;
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const key = opts.fields?.key ? pick(r, [opts.fields.key]) : pick(r, ["key", "id", "identifier", "number", "slug"]);
    const title = opts.fields?.title ? pick(r, [opts.fields.title]) : pick(r, ["title", "name", "summary", "subject"]);
    if (!key && !title) continue; // linha sem nada que identifique não vira tarefa fantasma
    const description = opts.fields?.description ? pick(r, [opts.fields.description]) : pick(r, ["description", "body", "summary", "detail"]);
    const id = (key || title).slice(0, 200);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ key: id, title: (title || key).slice(0, 300), ...(description && description !== title ? { description: description.slice(0, 500) } : {}) });
  }
  if (!out.length) throw new Error("o servidor MCP respondeu, mas nenhuma linha tinha id/título reconhecível — ajuste `fields` na configuração desta máquina");
  return out;
}

/* ── execução ─────────────────────────────────────────────────────────────────────────────────── */

/** Grant mínimo: UMA ferramenta, só leitura, argumentos fixos declarados na máquina. */
function listGrant(server: TaskMcpServer) {
  const properties: Record<string, unknown> = {};
  for (const key of Object.keys(server.listArguments || {})) properties[key] = {};
  return {
    name: server.listTool,
    risk: "read" as const,
    allowedArguments: Object.keys(server.listArguments || {}),
    inputSchema: { type: "object", additionalProperties: false, properties },
  };
}

/** As mesmas costuras injetáveis do cliente gerenciado (`clientFactory`/`transportFactory`) — é
 *  assim que o teste exercita o caminho real sem subir processo nenhum. */
export type ListMcpTasksDeps = PersonalMcpClientDependencies;

export interface McpTaskListing { label: string; files: LocalTaskFile[]; scannedAt: number; cached: boolean }
export interface McpListingCache { get(name: string): { at: number; listing: McpTaskListing } | undefined; set(name: string, value: { at: number; listing: McpTaskListing }): void }

/** TTL curto do resultado: cada listagem sobe um processo (ou fala com a rede) da máquina. Sem isso,
 *  abrir o painel duas vezes paga duas vezes; com TTL longo, a lista mente. `refresh` sempre ignora. */
export const MCP_LISTING_TTL_MS = 60_000;
const defaultCache: McpListingCache = new Map<string, { at: number; listing: McpTaskListing }>();

/**
 * Caminho completo da fonte MCP para UMA máquina: allowlist do disco → escolha do servidor →
 * listagem (com TTL). Vive no core porque os dois lados chamam o MESMO código: o runner, quando a
 * sessão é remota, e o Hub, quando a máquina do projeto é ele próprio — foi a divergência entre
 * lados que criou o bug da fatia C.
 *
 * Erro nunca vira lista vazia: volta `{error}` com o que fazer (qual arquivo, quais servidores).
 */
export async function listTasksFromMcp(input: {
  wanted?: string;
  refresh?: boolean;
  file?: string;
  deps?: ListMcpTasksDeps;
  signal?: AbortSignal;
  cache?: McpListingCache;
  now?: () => number;
} = {}): Promise<McpTaskListing | { error: string }> {
  const now = input.now || (() => Date.now());
  const config = loadTaskMcpConfig(input.file);
  const picked = pickTaskMcpServer(config, input.wanted);
  // Config quebrada só é fatal quando impede a escolha — servidor bom continua servindo, e o aviso
  // do arquivo torto aparece no lugar do erro quando nada pôde ser escolhido.
  if ("error" in picked) return { error: config.error ? `${picked.error}. Além disso: ${config.error}` : picked.error };
  const cache = input.cache || defaultCache;
  const hit = cache.get(picked.name);
  if (!input.refresh && hit && now() - hit.at < MCP_LISTING_TTL_MS) return { ...hit.listing, cached: true };
  const files = await listMcpTasks({ name: picked.name, server: picked.server, signal: input.signal, deps: input.deps });
  const listing: McpTaskListing = { label: picked.server.label || picked.name, files, scannedAt: now(), cached: false };
  cache.set(picked.name, { at: now(), listing });
  return listing;
}

/**
 * CRIAR uma tarefa pelo servidor MCP desta máquina (TSK-13).
 *
 * A ferramenta de criação é a declarada em `uses.tasks[<servidor>].create` — e SÓ ela. Servidor sem
 * `create` declarado é recusado com motivo, mesmo que anuncie uma ferramenta de criar: o que o
 * servidor oferece nunca amplia o que a máquina autorizou. É a mesma regra do `listTool`, aplicada
 * ao lado que escreve, onde ela importa mais.
 */
export async function createTaskViaMcp(input: {
  wanted?: string;
  title: string;
  description?: string;
  file?: string;
  deps?: ListMcpTasksDeps;
  signal?: AbortSignal;
}): Promise<{ key: string; url?: string } | { error: string }> {
  const config = loadTaskMcpConfig(input.file);
  const picked = pickTaskMcpServer(config, input.wanted);
  if ("error" in picked) return { error: config.error ? `${picked.error}. Além disso: ${config.error}` : picked.error };
  const criar = config.creates[picked.name];
  if (!criar) {
    return { error: `o servidor MCP "${picked.name}" não declara ferramenta de criar tarefa — adicione "create" em uses.tasks.${picked.name} no ${input.file || taskMcpConfigFile()}` };
  }
  const titulo = str(input.title, 300);
  if (!titulo) return { error: "a tarefa precisa de título" };
  const deps = input.deps || {};
  const fixos = criar.arguments || {};
  const argumentos = { ...fixos, title: titulo, ...(input.description ? { description: str(input.description, 4000) } : {}) };
  const grant = {
    name: criar.tool,
    // `write` é o que este grant é. Declarar "read" aqui para simplificar seria mentir para a única
    // camada que decide o que pode acontecer.
    risk: "write" as const,
    allowedArguments: Object.keys(argumentos),
    inputSchema: { type: "object", additionalProperties: false, properties: Object.fromEntries(Object.keys(argumentos).map((k) => [k, {}])) },
  };
  const client = new ManagedPersonalMcpClient({ id: `task-${picked.name}`.slice(0, 60), transport: picked.server.transport, tools: [grant], resources: [] } as any,
    { ...deps, resolveSecret: deps.resolveSecret ?? ((secretRef: string): string => {
      const value = process.env[secretRef];
      if (!value) throw new Error("segredo ausente no ambiente desta máquina");
      return value;
    }) });
  try {
    if (picked.server.transport.kind === "stdio") {
      const starter = createMcpStdioStartActionExecutor({ client, kind: "task_mcp_start", impact: `subir o servidor MCP de tarefas "${picked.name}" nesta máquina` });
      await starter.execute({}, { principalId: "jarvis-task-source", signal: input.signal ?? new AbortController().signal });
    } else {
      await client.connect(input.signal);
    }
    const result = await client.callTool(criar.tool, argumentos, { signal: input.signal });
    // Mesma leitura determinística da listagem: o que voltou tem de ser DADO. Servidor que responde
    // em prosa é erro com motivo — interpretar isso exigiria um modelo, e criar tarefa não adivinha.
    const criada = mapMcpTasks(result, { fields: picked.server.fields, max: 1 })[0];
    if (!criada) return { error: `o servidor "${picked.name}" criou a tarefa mas não devolveu a chave dela — não dá para confirmar o que foi criado` };
    return { key: criada.key, url: (criada as { url?: string }).url };
  } catch (e: any) {
    return { error: String(e?.message ?? e).slice(0, 400) };
  } finally {
    try { await client.close(); } catch { /* fechar é best-effort */ }
  }
}

/**
 * Lista as tarefas de um servidor MCP configurado NESTA máquina.
 *
 * O start do transporte stdio passa pelo executor de ação do próprio cliente gerenciado (é o único
 * caminho que autoriza subir processo). Não há aprovação interativa aqui de propósito: a aprovação
 * é o arquivo — só quem tem acesso ao disco desta máquina põe um servidor na allowlist, e o Hub
 * jamais manda linha de comando, só o nome.
 */
export async function listMcpTasks(input: {
  name: string;
  server: TaskMcpServer;
  signal?: AbortSignal;
  deps?: ListMcpTasksDeps;
}): Promise<LocalTaskFile[]> {
  const { name, server, signal } = input;
  const deps = input.deps || {};
  const config = {
    id: `task-${name}`.slice(0, 60),
    transport: server.transport,
    tools: [listGrant(server)],
    resources: [],
  };
  // `secretRef` é o NOME de uma variável de ambiente DESTA máquina (mesmo contrato do cofre de
  // conexões). Sem resolvedor, um servidor com `secretEnv` morre em "MCP secret resolver is not
  // configured" — mensagem que não diz ao dono o que fazer.
  //
  // A checagem de ausência acontece AQUI FORA, antes de conectar: dentro do cliente gerenciado, a
  // mensagem passa pela redação de segredos e o nome da variável vira "[REDACTED]" — perde-se
  // exatamente a única informação acionável. Fora dele, o nome sobrevive.
  // Só quando o transporte REAL vai ser criado por nós: com transporte/resolvedor injetado (teste,
  // ou um chamador que resolve segredo de outro jeito), a checagem seria um palpite sobre o ambiente
  // de outra pessoa.
  if (!deps.resolveSecret && !deps.transportFactory && server.transport.kind === "stdio") {
    const faltando = Object.values(server.transport.secretEnv || {}).filter((ref) => !process.env[String(ref)]);
    if (faltando.length) throw new Error(`variável(is) de ambiente ausente(s) nesta máquina para o servidor MCP "${name}": ${faltando.join(", ")}`);
  }
  const resolveSecret = deps.resolveSecret ?? ((secretRef: string): string => {
    const value = process.env[secretRef];
    if (!value) throw new Error("segredo ausente no ambiente desta máquina");
    return value;
  });
  const client = new ManagedPersonalMcpClient(config as any, { ...deps, resolveSecret });
  try {
    if (server.transport.kind === "stdio") {
      const starter = createMcpStdioStartActionExecutor({
        client,
        kind: "task_mcp_start",
        impact: `subir o servidor MCP de tarefas "${name}" nesta máquina`,
      });
      await starter.execute({}, { principalId: "jarvis-task-source", signal: signal ?? new AbortController().signal });
    } else {
      await client.connect(signal);
    }
    const result = await client.callTool(server.listTool, { ...(server.listArguments || {}) }, { signal });
    return mapMcpTasks(result, { fields: server.fields });
  } finally {
    try { await client.close(); } catch { /* fechar é best-effort: a lista já foi obtida ou já falhou */ }
  }
}
