/**
 * Catálogo de provedores de tarefas (C1/C4 do plano de conexões) — ORIENTADO A DADOS.
 *
 * Cada provedor declara: campos de configuração, forma de autenticação (bearer/basic/chave+token) e
 * como perguntar "quem sou eu". Adicionar provedor é acrescentar uma entrada + teste — não é
 * arquitetura nova. Operações de TAREFA (buscar/carregar/criar) existem no tier 1 (GitHub, GitLab,
 * Jira, Linear — os com conta real para validar); os demais nascem "identidade só" e são promovidos
 * quando um token real os exercitar.
 *
 * Regras duras deste módulo:
 *  - o SEGREDO nunca entra em objeto persistido; chega como valor já resolvido do env e sai de
 *    qualquer mensagem de erro (sanitize) — token vazado em log foi projetado para ser impossível;
 *  - todo HTTP é injetável (`FetchLike`) — os testes exercitam URL/headers/corpo sem rede.
 */

export interface TaskProviderField { key: string; label: string; required?: boolean; hint?: string }

export interface TaskProviderSpec {
  id: string;
  label: string;
  /** campos de config além dos segredos (baseUrl do Jira, e-mail, org…). */
  fields: TaskProviderField[];
  /** segredos exigidos (Trello usa dois: chave + token). Sempre por secretRef (nome de env var). */
  secrets: Array<{ key: "secretRef" | "secretRef2"; label: string }>;
  /** 1 = operações de tarefa implementadas; 2 = por enquanto só identidade verificada. */
  tier: 1 | 2;
  /** o que o vínculo do projeto precisa apontar para ESCRITA (ex.: owner/repo, chave do projeto). */
  targetHint?: string;
}

export const TASK_PROVIDERS: readonly TaskProviderSpec[] = Object.freeze([
  { id: "github", label: "GitHub", tier: 1, fields: [{ key: "org", label: "Organização (opcional, restringe busca e valida remote)" }], secrets: [{ key: "secretRef", label: "Token (PAT)" }], targetHint: "owner/repo" },
  { id: "gitlab", label: "GitLab", tier: 1, fields: [{ key: "baseUrl", label: "Base URL (vazio = gitlab.com)" }], secrets: [{ key: "secretRef", label: "Token" }], targetHint: "grupo/projeto" },
  { id: "jira", label: "Jira", tier: 1, fields: [{ key: "baseUrl", label: "Base URL (https://sua-org.atlassian.net)", required: true }, { key: "email", label: "E-mail da conta", required: true }], secrets: [{ key: "secretRef", label: "API token" }], targetHint: "chave do projeto (ex.: ABC)" },
  { id: "linear", label: "Linear", tier: 1, fields: [], secrets: [{ key: "secretRef", label: "API key" }], targetHint: "chave do time (ex.: PRI)" },
  { id: "azure-devops", label: "Azure DevOps", tier: 2, fields: [{ key: "org", label: "Organização", required: true }], secrets: [{ key: "secretRef", label: "PAT" }] },
  { id: "asana", label: "Asana", tier: 2, fields: [], secrets: [{ key: "secretRef", label: "Personal access token" }] },
  { id: "trello", label: "Trello", tier: 2, fields: [], secrets: [{ key: "secretRef", label: "API key" }, { key: "secretRef2", label: "Token" }] },
  { id: "notion", label: "Notion", tier: 2, fields: [], secrets: [{ key: "secretRef", label: "Integration token" }] },
  { id: "clickup", label: "ClickUp", tier: 2, fields: [], secrets: [{ key: "secretRef", label: "API token" }] },
  { id: "monday", label: "Monday", tier: 2, fields: [], secrets: [{ key: "secretRef", label: "API token" }] },
]);

export const taskProviderSpec = (id: string): TaskProviderSpec | undefined => TASK_PROVIDERS.find((p) => p.id === id);

/* ── HTTP injetável ───────────────────────────────────────────────────────────────────────────── */

export interface FetchLikeResponse { ok: boolean; status: number; text(): Promise<string> }
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<FetchLikeResponse>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as Promise<FetchLikeResponse>;

/** Erros saem SEM os segredos, aconteça o que acontecer. */
export function sanitizeSecrets(text: string, secrets: string[]): string {
  let out = String(text ?? "");
  for (const s of secrets.filter((v) => v && v.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(s).join("[REDACTED]");
  return out;
}

async function call(fetchFn: FetchLike, secrets: string[], url: string, init: Parameters<FetchLike>[1]): Promise<any> {
  let res: FetchLikeResponse;
  try { res = await fetchFn(url, init); }
  catch (e: any) { throw new Error(sanitizeSecrets(`falha de rede: ${String(e?.message ?? e)}`, secrets)); }
  const body = await res.text().catch(() => "");
  if (!res.ok) throw new Error(sanitizeSecrets(`HTTP ${res.status}: ${body.slice(0, 300)}`, secrets));
  try { return body ? JSON.parse(body) : {}; }
  catch { throw new Error(sanitizeSecrets(`resposta não-JSON: ${body.slice(0, 120)}`, secrets)); }
}

const b64 = (v: string): string => Buffer.from(v, "utf8").toString("base64");
const gitlabBase = (cfg: Record<string, string>): string => (cfg.baseUrl || "https://gitlab.com").replace(/\/+$/, "");
const jiraBase = (cfg: Record<string, string>): string => String(cfg.baseUrl || "").replace(/\/+$/, "");

interface ProviderCallInput { config: Record<string, string>; secret: string; secret2?: string; fetchFn?: FetchLike; signal?: AbortSignal }

/* ── identidade: "quem sou eu" por provedor ───────────────────────────────────────────────────── */

export interface TaskIdentity { id: string; login: string; name?: string }

/**
 * Chama o endpoint de identidade do provedor e devolve QUEM é esta credencial de verdade. O rótulo
 * da conexão nunca é a fonte da verdade — isto aqui é.
 */
export async function fetchProviderIdentity(providerId: string, input: ProviderCallInput): Promise<TaskIdentity> {
  const f = input.fetchFn || defaultFetch;
  const secrets = [input.secret, input.secret2 || ""].filter(Boolean);
  const cfg = input.config || {};
  const j = (url: string, init?: Parameters<FetchLike>[1]) => call(f, secrets, url, { ...init, signal: input.signal });
  switch (providerId) {
    case "github": {
      const u = await j("https://api.github.com/user", { headers: { authorization: `Bearer ${input.secret}`, "user-agent": "jarvis", accept: "application/vnd.github+json" } });
      return { id: String(u.id ?? u.login), login: String(u.login || ""), name: u.name || undefined };
    }
    case "gitlab": {
      const u = await j(`${gitlabBase(cfg)}/api/v4/user`, { headers: { authorization: `Bearer ${input.secret}` } });
      return { id: String(u.id ?? u.username), login: String(u.username || ""), name: u.name || undefined };
    }
    case "jira": {
      if (!jiraBase(cfg) || !cfg.email) throw new Error("Jira exige baseUrl e e-mail");
      const u = await j(`${jiraBase(cfg)}/rest/api/3/myself`, { headers: { authorization: `Basic ${b64(`${cfg.email}:${input.secret}`)}`, accept: "application/json" } });
      return { id: String(u.accountId || ""), login: String(u.emailAddress || cfg.email), name: u.displayName || undefined };
    }
    case "linear": {
      const r = await j("https://api.linear.app/graphql", { method: "POST", headers: { authorization: input.secret, "content-type": "application/json" }, body: JSON.stringify({ query: "{ viewer { id name email } }" }) });
      const v = r?.data?.viewer || {};
      if (!v.id) throw new Error("Linear não devolveu viewer (token inválido?)");
      return { id: String(v.id), login: String(v.email || v.name || ""), name: v.name || undefined };
    }
    case "azure-devops": {
      if (!cfg.org) throw new Error("Azure DevOps exige a organização");
      const u = await j(`https://dev.azure.com/${encodeURIComponent(cfg.org)}/_apis/connectionData?api-version=7.0`, { headers: { authorization: `Basic ${b64(`:${input.secret}`)}` } });
      const au = u?.authenticatedUser || {};
      return { id: String(au.id || ""), login: String(au.providerDisplayName || au.customDisplayName || ""), name: au.customDisplayName || undefined };
    }
    case "asana": {
      const u = await j("https://app.asana.com/api/1.0/users/me", { headers: { authorization: `Bearer ${input.secret}` } });
      return { id: String(u?.data?.gid || ""), login: String(u?.data?.email || u?.data?.name || ""), name: u?.data?.name || undefined };
    }
    case "trello": {
      if (!input.secret2) throw new Error("Trello exige chave + token");
      const u = await j(`https://api.trello.com/1/members/me?key=${encodeURIComponent(input.secret)}&token=${encodeURIComponent(input.secret2)}`);
      return { id: String(u.id || ""), login: String(u.username || ""), name: u.fullName || undefined };
    }
    case "notion": {
      const u = await j("https://api.notion.com/v1/users/me", { headers: { authorization: `Bearer ${input.secret}`, "notion-version": "2022-06-28" } });
      return { id: String(u.id || ""), login: String(u?.bot?.owner?.user?.person?.email || u.name || ""), name: u.name || undefined };
    }
    case "clickup": {
      const u = await j("https://api.clickup.com/api/v2/user", { headers: { authorization: input.secret } });
      return { id: String(u?.user?.id || ""), login: String(u?.user?.email || u?.user?.username || ""), name: u?.user?.username || undefined };
    }
    case "monday": {
      const r = await j("https://api.monday.com/v2", { method: "POST", headers: { authorization: input.secret, "content-type": "application/json" }, body: JSON.stringify({ query: "{ me { id name email } }" }) });
      const me = r?.data?.me || {};
      if (!me.id) throw new Error("Monday não devolveu identidade (token inválido?)");
      return { id: String(me.id), login: String(me.email || me.name || ""), name: me.name || undefined };
    }
    default: throw new Error(`provedor desconhecido: ${providerId}`);
  }
}

/* ── operações de tarefa (tier 1) ─────────────────────────────────────────────────────────────── */

export interface TaskItem { tracker: string; key: string; title: string; description?: string; url?: string; state?: string }

/** Texto plano de um documento ADF do Jira (best-effort: só nós de texto, na ordem). */
export function adfToText(node: unknown, cap = 4000): string {
  const parts: string[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) { n.content.forEach(walk); if (n.type === "paragraph") parts.push("\n"); }
  };
  walk(node);
  return parts.join("").replace(/\n{2,}/g, "\n").trim().slice(0, cap);
}

const ghHeaders = (secret: string): Record<string, string> => ({ authorization: `Bearer ${secret}`, "user-agent": "jarvis", accept: "application/vnd.github+json" });
/** `owner/repo` de uma issue do GitHub. A busca devolve `repository_url`; a lista de atribuídas
 *  devolve `repository` inteiro — a chave do Jarvis tem de sair igual pelos dois caminhos, senão a
 *  MESMA tarefa vira duas identidades diferentes conforme a tela por onde ela entrou. */
const ghRepoOf = (it: any): string => {
  const m = /repos\/([^/]+\/[^/]+)\/issues/.exec(String(it?.repository_url || "")) || /github\.com\/([^/]+\/[^/]+)\//.exec(String(it?.html_url || ""));
  return String(it?.repository?.full_name || (m ? m[1] : "?"));
};

/**
 * Busca por texto no provedor da conexao, uma pagina por vez.
 *
 * Board tem milhares de itens e a busca voltava 10, sem jeito de ver o resto: um termo generico
 * ("insight", "login") devolvia uma amostra que parecia a resposta inteira. O `cursor` e o mesmo
 * contrato opaco da listagem — quem chama devolve a string que recebeu, sem saber de qual provedor
 * ela veio. Tier 2 -> erro claro, nunca resultado vazio mentiroso.
 */
export async function searchProviderTasks(providerId: string, query: string, input: ProviderCallInput & { limit?: number; cursor?: string }): Promise<TaskPage> {
  const f = input.fetchFn || defaultFetch;
  const secrets = [input.secret, input.secret2 || ""].filter(Boolean);
  const cfg = input.config || {};
  const q = String(query || "").trim().slice(0, 200);
  if (!q) return { tasks: [] };
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(input.limit)) || 10));
  const cursor = String(input.cursor || "").trim().slice(0, 400);
  const pagina = Math.max(1, Math.trunc(Number(cursor)) || 1);
  const j = (url: string, init?: Parameters<FetchLike>[1]) => call(f, secrets, url, { ...init, signal: input.signal });
  switch (providerId) {
    case "github": {
      const scope = cfg.org ? ` org:${cfg.org}` : "";
      const r = await j(`https://api.github.com/search/issues?q=${encodeURIComponent(`${q} is:issue${scope}`)}&per_page=${limit}&page=${pagina}`, { headers: ghHeaders(input.secret) });
      const items = r.items || [];
      const total = Number(r.total_count);
      return {
        tasks: items.map((it: any) => ({ tracker: "github", key: `${ghRepoOf(it)}#${it.number}`, title: String(it.title || ""), description: (it.body || undefined) as string | undefined, url: it.html_url, state: it.state })),
        cursor: items.length && (Number.isFinite(total) ? pagina * limit < total : items.length >= limit) ? String(pagina + 1) : undefined,
      };
    }
    case "gitlab": {
      const r = await j(`${gitlabBase(cfg)}/api/v4/issues?search=${encodeURIComponent(q)}&per_page=${limit}&page=${pagina}&scope=all`, { headers: { authorization: `Bearer ${input.secret}` } });
      const cru = Array.isArray(r) ? r : [];
      return {
        tasks: cru.map((it: any) => ({ tracker: "gitlab", key: `${String(it?.references?.full || "").replace(/#\d+$/, "") || it.project_id}#${it.iid}`, title: String(it.title || ""), description: it.description || undefined, url: it.web_url, state: it.state })),
        cursor: cru.length >= limit ? String(pagina + 1) : undefined,
      };
    }
    case "jira": {
      const startAt = Math.max(0, Math.trunc(Number(cursor)) || 0);
      const r = await j(`${jiraBase(cfg)}/rest/api/3/search`, { method: "POST", headers: { authorization: `Basic ${b64(`${cfg.email}:${input.secret}`)}`, "content-type": "application/json" }, body: JSON.stringify({ jql: `text ~ ${JSON.stringify(q)} ORDER BY updated DESC`, maxResults: limit, startAt, fields: ["summary", "description", "status"] }) });
      const issues = r.issues || [];
      const total = Number(r?.total);
      const proximo = startAt + issues.length;
      return {
        tasks: issues.map((it: any) => ({ tracker: "jira", key: String(it.key || ""), title: String(it?.fields?.summary || ""), description: adfToText(it?.fields?.description) || undefined, url: `${jiraBase(cfg)}/browse/${it.key}`, state: it?.fields?.status?.name })),
        cursor: issues.length && (Number.isFinite(total) ? proximo < total : issues.length >= limit) ? String(proximo) : undefined,
      };
    }
    case "linear": {
      const r = await j("https://api.linear.app/graphql", { method: "POST", headers: { authorization: input.secret, "content-type": "application/json" }, body: JSON.stringify({ query: "query($q:String!,$n:Int!,$c:String){ searchIssues(term:$q, first:$n, after:$c){ pageInfo { hasNextPage endCursor } nodes { identifier title description url state { name } } } }", variables: { q, n: limit, c: cursor || null } }) });
      const conexao = r?.data?.searchIssues;
      const nodes = conexao?.nodes || [];
      return {
        tasks: nodes.map((it: any) => ({ tracker: "linear", key: String(it.identifier || ""), title: String(it.title || ""), description: it.description || undefined, url: it.url, state: it?.state?.name })),
        cursor: conexao?.pageInfo?.hasNextPage ? String(conexao.pageInfo.endCursor || "") || undefined : undefined,
      };
    }
    default: throw new Error(`busca ainda nao implementada para ${providerId} (tier 2 — identidade so)`);
  }
}

/** Uma pagina de tarefas. `cursor` ausente = acabou; presente = mande de volta para pegar a proxima. */
export interface TaskPage { tasks: TaskItem[]; cursor?: string }

/**
 * "As MINHAS tarefas abertas" no provedor da conexao, uma pagina por vez.
 *
 * Buscar exige saber o que procurar. Uma fonte `provider` abria com uma caixa de busca vazia — e nada
 * mais — enquanto `local` e `mcp` abrem listando; quem tinha a conta certa, verificada e vinculada
 * mesmo assim nao via tarefa nenhuma, e concluia que a integracao nao funcionava.
 *
 * Listar nao e busca com termo vazio: o criterio e "atribuida a MIM e ainda nao fechada", que nenhum
 * termo expressa. Com `state`, o criterio passa a ser aquele estado — inclusive um FECHADO: quem pede
 * "Done" quer os Done, e manter o recorte de abertas por cima devolveria lista vazia sem explicacao.
 *
 * O `cursor` e OPACO. Os quatro provedores paginam de formas incompativeis (cursor no Linear, numero
 * de pagina em GitHub/GitLab, deslocamento no Jira); traduzir isso na tela faria o cliente saber de
 * qual provedor veio a lista, e trocar de provedor mudaria a tela. Aqui ele e so uma string que volta.
 *
 * A lista NAO traz descricao, de proposito. Uma linha de lista mostra chave, titulo e estado; a
 * descricao so serve quando a tarefa e ESCOLHIDA — e ai `getProviderTask` traz a integra. Medicao
 * real neste board: 83 KB para 5 itens, uma unica descricao com 38 KB. E o cache de tarefas corta
 * em 4000 caracteres na gravacao, entao o excedente nem sobrevivia a viagem.
 */
export async function listProviderTasks(providerId: string, input: ProviderCallInput & { limit?: number; state?: string; cursor?: string }): Promise<TaskPage> {
  const f = input.fetchFn || defaultFetch;
  const secrets = [input.secret, input.secret2 || ""].filter(Boolean);
  const cfg = input.config || {};
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(input.limit)) || 25));
  const estado = String(input.state || "").trim().slice(0, 120);
  const cursor = String(input.cursor || "").trim().slice(0, 400);
  const pagina = Math.max(1, Math.trunc(Number(cursor)) || 1);   // GitHub/GitLab/Jira: cursor e numero
  const j = (url: string, init?: Parameters<FetchLike>[1]) => call(f, secrets, url, { ...init, signal: input.signal });
  switch (providerId) {
    case "github": {
      // `/issues` (ou `/orgs/{org}/issues`) e o endpoint de "atribuidas ao usuario autenticado". Ele
      // devolve PULL REQUEST junto — e PR nao e tarefa, entao sai daqui como a busca faz com `is:issue`.
      const base = cfg.org ? `https://api.github.com/orgs/${encodeURIComponent(cfg.org)}/issues` : "https://api.github.com/issues";
      const r = await j(`${base}?filter=assigned&state=${estado === "closed" ? "closed" : "open"}&per_page=${limit}&page=${pagina}`, { headers: ghHeaders(input.secret) });
      const cru = Array.isArray(r) ? r : [];
      const tasks = cru.filter((it: any) => !it?.pull_request)
        .map((it: any) => ({ tracker: "github", key: `${ghRepoOf(it)}#${it.number}`, title: String(it.title || ""), url: it.html_url, state: it.state }));
      // Pagina cheia = pode haver mais. PR filtrado encurta a lista SEM significar fim: por isso o
      // teste e no que o provedor devolveu, nao no que sobrou.
      return { tasks, cursor: cru.length >= limit ? String(pagina + 1) : undefined };
    }
    case "gitlab": {
      const r = await j(`${gitlabBase(cfg)}/api/v4/issues?scope=assigned_to_me&state=${estado === "closed" ? "closed" : "opened"}&per_page=${limit}&page=${pagina}`, { headers: { authorization: `Bearer ${input.secret}` } });
      const cru = Array.isArray(r) ? r : [];
      return {
        tasks: cru.map((it: any) => ({ tracker: "gitlab", key: `${String(it?.references?.full || "").replace(/#\d+$/, "") || it.project_id}#${it.iid}`, title: String(it.title || ""), url: it.web_url, state: it.state })),
        cursor: cru.length >= limit ? String(pagina + 1) : undefined,
      };
    }
    case "jira": {
      // Aqui o cursor e o DESLOCAMENTO, nao o numero da pagina — e o proprio Jira responde `total`.
      const startAt = Math.max(0, Math.trunc(Number(cursor)) || 0);
      const jql = estado
        ? `assignee = currentUser() AND status = ${JSON.stringify(estado)} ORDER BY updated DESC`
        : "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
      const r = await j(`${jiraBase(cfg)}/rest/api/3/search`, { method: "POST", headers: { authorization: `Basic ${b64(`${cfg.email}:${input.secret}`)}`, "content-type": "application/json" }, body: JSON.stringify({ jql, maxResults: limit, startAt, fields: ["summary", "status"] }) });
      const issues = r?.issues || [];
      const total = Number(r?.total);
      const proximo = startAt + issues.length;
      return {
        tasks: issues.map((it: any) => ({ tracker: "jira", key: String(it.key || ""), title: String(it?.fields?.summary || ""), url: `${jiraBase(cfg)}/browse/${it.key}`, state: it?.fields?.status?.name })),
        cursor: issues.length && (Number.isFinite(total) ? proximo < total : issues.length >= limit) ? String(proximo) : undefined,
      };
    }
    case "linear": {
      // O filtro vai no SERVIDOR: recortar depois gastaria o teto da pagina com tarefa que ja acabou.
      const filtro = estado ? { state: { id: { eq: estado } } } : { completedAt: { null: true }, canceledAt: { null: true } };
      const r = await j("https://api.linear.app/graphql", { method: "POST", headers: { authorization: input.secret, "content-type": "application/json" }, body: JSON.stringify({
        query: "query($n:Int!,$c:String,$f:IssueFilter){ viewer { assignedIssues(first:$n, after:$c, orderBy: updatedAt, filter:$f) { pageInfo { hasNextPage endCursor } nodes { identifier title url state { name } } } } }",
        variables: { n: limit, c: cursor || null, f: filtro },
      }) });
      const conexao = r?.data?.viewer?.assignedIssues;
      const nodes = conexao?.nodes || [];
      return {
        tasks: nodes.map((it: any) => ({ tracker: "linear", key: String(it.identifier || ""), title: String(it.title || ""), url: it.url, state: it?.state?.name })),
        cursor: conexao?.pageInfo?.hasNextPage ? String(conexao.pageInfo.endCursor || "") || undefined : undefined,
      };
    }
    default: throw new Error(`lista de tarefas ainda nao implementada para ${providerId} (tier 2 — identidade so)`);
  }
}

/** Um estado do board, como o PROVEDOR o chama. `type` e a familia dele quando existe. */
export interface TaskState { id: string; name: string; type?: string }

/**
 * Os estados REAIS do board da conexao — para o filtro falar a lingua do board, e nao um vocabulario
 * normalizado que inventa "em andamento" onde o tracker so tem aberta/fechada.
 *
 * O escopo e DESCOBERTO, nao configurado. A primeira versao usava o `destino` do vinculo do projeto,
 * e estava errada: destino e o campo de ESCRITA (owner/repo, chave de projeto Jira, chave de time
 * Linear) — formato diferente por provedor e sem relacao necessaria com o board de onde se le. Pior,
 * exigia configuracao para o filtro nascer decente.
 *
 * Quando o provedor sabe responder "quais boards sao meus", perguntamos a ele: no Linear, uma conta
 * real devolveu 49 estados no total e 13 depois de recortar pelos times do proprio usuario, sem
 * ninguem preencher nada. Onde o provedor nao sabe (Jira), a lista e da instancia, deduplicada. E
 * onde o conceito nao existe (GitHub, GitLab), sao dois estados fixos e nenhuma chamada de rede.
 */
export async function listProviderStates(providerId: string, input: ProviderCallInput): Promise<TaskState[]> {
  const f = input.fetchFn || defaultFetch;
  const secrets = [input.secret, input.secret2 || ""].filter(Boolean);
  const cfg = input.config || {};
  const j = (url: string, init?: Parameters<FetchLike>[1]) => call(f, secrets, url, { ...init, signal: input.signal });
  switch (providerId) {
    case "github": return [{ id: "open", name: "Open", type: "unstarted" }, { id: "closed", name: "Closed", type: "completed" }];
    case "gitlab": return [{ id: "opened", name: "Opened", type: "unstarted" }, { id: "closed", name: "Closed", type: "completed" }];
    case "jira": {
      const r = await j(`${jiraBase(cfg)}/rest/api/3/status`, { headers: { authorization: `Basic ${b64(`${cfg.email}:${input.secret}`)}`, accept: "application/json" } });
      // O retorno varia entre instalacoes (lista plana, ou agrupada por tipo de issue com `statuses`
      // dentro): ler as duas formas custa uma linha e evita lista vazia num Jira que responde certo.
      const cru: any[] = Array.isArray(r) ? r.flatMap((it: any) => (Array.isArray(it?.statuses) ? it.statuses : [it])) : [];
      return dedupeStates(cru.map((it: any) => ({ id: String(it?.id ?? it?.name ?? ""), name: String(it?.name || ""), type: it?.statusCategory?.key || undefined })));
    }
    case "linear": {
      // UMA requisicao para as duas perguntas: de quais times sou, e quais sao os estados. Duas idas
      // deixariam uma janela em que o time some entre elas — e custariam o dobro de latencia.
      const r = await j("https://api.linear.app/graphql", { method: "POST", headers: { authorization: input.secret, "content-type": "application/json" }, body: JSON.stringify({ query: "{ viewer { teams(first: 50) { nodes { key } } } workflowStates(first: 250) { nodes { id name type position team { key } } } }" }) });
      const meus = new Set<string>(((r?.data?.viewer?.teams?.nodes || []) as any[]).map((t) => String(t?.key || "").toUpperCase()).filter(Boolean));
      const nodes: any[] = r?.data?.workflowStates?.nodes || [];
      // Sem time nenhum (conta de servico, por exemplo) o recorte vazio esconderia o board inteiro:
      // ali a lista completa deduplicada e menos errada que uma tela vazia.
      const doTime = meus.size ? nodes.filter((n) => meus.has(String(n?.team?.key || "").toUpperCase())) : nodes;
      // Ordenar SO por `position` embaralha o board: medido numa conta real, saía "Triage > Backlog >
      // In Progress > Done > Canceled > Duplicate > In Review > ...". O `position` do Linear vale
      // DENTRO do tipo, nao entre tipos — entao o tipo manda primeiro, e a posicao desempata.
      const ordenados = [...doTime].sort((a, b) => rankLinearState(a?.type) - rankLinearState(b?.type) || (Number(a?.position) || 0) - (Number(b?.position) || 0));
      return dedupeStates(ordenados.map((n) => ({ id: String(n?.id || ""), name: String(n?.name || ""), type: n?.type || undefined })));
    }
    default: throw new Error(`estados do board ainda nao implementados para ${providerId} (tier 2 — identidade so)`);
  }
}

/** Como o Linear empilha os tipos no board. Tipo desconhecido (o catalogo dele cresce) vai para o
 *  fim em vez de se misturar com "a fazer" — errar para o lado de nao mentir sobre a ordem. */
const ORDEM_ESTADO_LINEAR = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
const rankLinearState = (tipo: unknown): number => {
  const i = ORDEM_ESTADO_LINEAR.indexOf(String(tipo || "").toLowerCase());
  return i < 0 ? ORDEM_ESTADO_LINEAR.length : i;
};

/** Mesmo nome em times/tipos diferentes e UM estado para quem filtra: o primeiro vence e mantem a ordem. */
function dedupeStates(states: TaskState[]): TaskState[] {
  const vistos = new Set<string>();
  const out: TaskState[] = [];
  for (const st of states) {
    const chave = st.name.trim().toLowerCase();
    if (!st.id || !chave || vistos.has(chave)) continue;
    vistos.add(chave); out.push({ ...st, name: st.name.trim() });
  }
  return out;
}

/** Carrega UMA tarefa pela chave normalizada do Jarvis ("owner/repo#12", "ABC-1", "PRI-824"). */
export async function getProviderTask(providerId: string, key: string, input: ProviderCallInput): Promise<TaskItem | null> {
  const f = input.fetchFn || defaultFetch;
  const secrets = [input.secret, input.secret2 || ""].filter(Boolean);
  const cfg = input.config || {};
  const k = String(key || "").trim();
  if (!k) return null;
  const j = (url: string, init?: Parameters<FetchLike>[1]) => call(f, secrets, url, { ...init, signal: input.signal });
  switch (providerId) {
    case "github": {
      const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(k);
      if (!m) throw new Error(`chave GitHub deve ser owner/repo#numero (veio: ${k})`);
      const it = await j(`https://api.github.com/repos/${m[1]}/issues/${m[2]}`, { headers: ghHeaders(input.secret) });
      return { tracker: "github", key: k, title: String(it.title || ""), description: it.body || undefined, url: it.html_url, state: it.state };
    }
    case "gitlab": {
      const m = /^(.+)#(\d+)$/.exec(k);
      if (!m) throw new Error(`chave GitLab deve ser grupo/projeto#iid (veio: ${k})`);
      const it = await j(`${gitlabBase(cfg)}/api/v4/projects/${encodeURIComponent(m[1])}/issues/${m[2]}`, { headers: { authorization: `Bearer ${input.secret}` } });
      return { tracker: "gitlab", key: k, title: String(it.title || ""), description: it.description || undefined, url: it.web_url, state: it.state };
    }
    case "jira": {
      const it = await j(`${jiraBase(cfg)}/rest/api/3/issue/${encodeURIComponent(k)}?fields=summary,description,status`, { headers: { authorization: `Basic ${b64(`${cfg.email}:${input.secret}`)}`, accept: "application/json" } });
      return { tracker: "jira", key: String(it.key || k), title: String(it?.fields?.summary || ""), description: adfToText(it?.fields?.description) || undefined, url: `${jiraBase(cfg)}/browse/${it.key || k}`, state: it?.fields?.status?.name };
    }
    case "linear": {
      const r = await j("https://api.linear.app/graphql", { method: "POST", headers: { authorization: input.secret, "content-type": "application/json" }, body: JSON.stringify({ query: "query($q:String!){ searchIssues(term:$q, first:5){ nodes { identifier title description url state { name } } } }", variables: { q: k } }) });
      const hit = (r?.data?.searchIssues?.nodes || []).find((n: any) => String(n.identifier).toUpperCase() === k.toUpperCase());
      return hit ? { tracker: "linear", key: String(hit.identifier), title: String(hit.title || ""), description: hit.description || undefined, url: hit.url, state: hit?.state?.name } : null;
    }
    default: throw new Error(`carregar tarefa ainda não implementado para ${providerId} (tier 2)`);
  }
}

/** Cria uma tarefa. `target` vem do VÍNCULO do projeto (owner/repo, chave Jira, chave do time Linear). */
export async function createProviderTask(providerId: string, target: string, task: { title: string; description?: string }, input: ProviderCallInput): Promise<{ key: string; url?: string }> {
  const f = input.fetchFn || defaultFetch;
  const secrets = [input.secret, input.secret2 || ""].filter(Boolean);
  const cfg = input.config || {};
  const title = String(task.title || "").trim().slice(0, 300);
  if (!title) throw new Error("a tarefa precisa de título");
  if (!String(target || "").trim()) throw new Error("o vínculo do projeto não define o destino (repo/projeto/time)");
  const j = (url: string, init?: Parameters<FetchLike>[1]) => call(f, secrets, url, { ...init, signal: input.signal });
  switch (providerId) {
    case "github": {
      const it = await j(`https://api.github.com/repos/${target}/issues`, { method: "POST", headers: { ...ghHeaders(input.secret), "content-type": "application/json" }, body: JSON.stringify({ title, body: task.description || "" }) });
      return { key: `${target}#${it.number}`, url: it.html_url };
    }
    case "gitlab": {
      const it = await j(`${gitlabBase(cfg)}/api/v4/projects/${encodeURIComponent(target)}/issues`, { method: "POST", headers: { authorization: `Bearer ${input.secret}`, "content-type": "application/json" }, body: JSON.stringify({ title, description: task.description || "" }) });
      return { key: `${target}#${it.iid}`, url: it.web_url };
    }
    case "jira": {
      const description = task.description ? { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: task.description.slice(0, 4000) }] }] } : undefined;
      const it = await j(`${jiraBase(cfg)}/rest/api/3/issue`, { method: "POST", headers: { authorization: `Basic ${b64(`${cfg.email}:${input.secret}`)}`, "content-type": "application/json" }, body: JSON.stringify({ fields: { project: { key: target }, issuetype: { name: "Task" }, summary: title, ...(description ? { description } : {}) } }) });
      return { key: String(it.key || ""), url: `${jiraBase(cfg)}/browse/${it.key}` };
    }
    case "linear": {
      const teams = await j("https://api.linear.app/graphql", { method: "POST", headers: { authorization: input.secret, "content-type": "application/json" }, body: JSON.stringify({ query: "query($k:String!){ teams(filter:{ key:{ eq:$k } }){ nodes { id } } }", variables: { k: target.toUpperCase() } }) });
      const teamId = teams?.data?.teams?.nodes?.[0]?.id;
      if (!teamId) throw new Error(`time Linear não encontrado pela chave ${target}`);
      const r = await j("https://api.linear.app/graphql", { method: "POST", headers: { authorization: input.secret, "content-type": "application/json" }, body: JSON.stringify({ query: "mutation($input:IssueCreateInput!){ issueCreate(input:$input){ issue { identifier url } } }", variables: { input: { teamId, title, description: task.description || undefined } } }) });
      const issue = r?.data?.issueCreate?.issue;
      if (!issue?.identifier) throw new Error("Linear não confirmou a criação");
      return { key: String(issue.identifier), url: issue.url };
    }
    default: throw new Error(`criar tarefa ainda não implementado para ${providerId} (tier 2)`);
  }
}
