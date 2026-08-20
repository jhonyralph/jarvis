import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskConnectionStore, resolveTaskConnection, remoteMismatchWarning, remoteCheckApplies, publicTaskConnections } from "./task-connections.js";
import { fetchProviderIdentity, searchProviderTasks, listProviderTasks, getProviderTask, createProviderTask, sanitizeSecrets, adfToText, TASK_PROVIDERS, type FetchLike } from "./task-providers.js";

const fake = (routes: Record<string, unknown | ((init?: any) => unknown)>): { fetchFn: FetchLike; calls: Array<{ url: string; init?: any }> } => {
  const calls: Array<{ url: string; init?: any }> = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) return { ok: false, status: 404, text: async () => `sem rota para ${url}` };
    const value = typeof hit[1] === "function" ? (hit[1] as any)(init) : hit[1];
    return { ok: true, status: 200, text: async () => JSON.stringify(value) };
  };
  return { fetchFn, calls };
};

test("identidade verificada: cada provedor do catálogo tem 'quem sou eu' funcional", async () => {
  const routes = fake({
    "https://api.github.com/user": { id: 7, login: "jon-acme", name: "Jon" },
    "https://gitlab.com/api/v4/user": { id: 9, username: "jon-gl" },
    "https://acme.atlassian.net/rest/api/3/myself": { accountId: "a1", emailAddress: "jon@acme.com", displayName: "Jon" },
    "https://api.linear.app/graphql": { data: { viewer: { id: "v1", name: "Jon", email: "jon@acme.com" } } },
    "https://dev.azure.com/acme/_apis/connectionData": { authenticatedUser: { id: "az1", providerDisplayName: "jon@acme.com" } },
    "https://app.asana.com/api/1.0/users/me": { data: { gid: "as1", email: "jon@acme.com", name: "Jon" } },
    "https://api.trello.com/1/members/me": { id: "t1", username: "jontrello", fullName: "Jon" },
    "https://api.notion.com/v1/users/me": { id: "n1", name: "Jarvis Bot", bot: { owner: { user: { person: { email: "jon@acme.com" } } } } },
    "https://api.clickup.com/api/v2/user": { user: { id: 11, email: "jon@acme.com", username: "jon" } },
    "https://api.monday.com/v2": { data: { me: { id: "m1", name: "Jon", email: "jon@acme.com" } } },
  });
  const cfg: Record<string, Record<string, string>> = {
    jira: { baseUrl: "https://acme.atlassian.net", email: "jon@acme.com" },
    "azure-devops": { org: "acme" },
  };
  for (const p of TASK_PROVIDERS) {
    const id = await fetchProviderIdentity(p.id, { config: cfg[p.id] || {}, secret: "sec-1234", secret2: "sec2-9999", fetchFn: routes.fetchFn });
    assert.ok(id.id && id.login, `${p.id} devolveu identidade real (${JSON.stringify(id)})`);
  }
  // Autenticação certa por forma: bearer no GitHub, Basic no Jira, token cru no Linear.
  const gh = routes.calls.find((c) => c.url.startsWith("https://api.github.com/user"))!;
  assert.equal(gh.init.headers.authorization, "Bearer sec-1234");
  const jira = routes.calls.find((c) => c.url.includes("atlassian.net"))!;
  assert.match(jira.init.headers.authorization, /^Basic /);
  const linear = routes.calls.find((c) => c.url.includes("linear.app"))!;
  assert.equal(linear.init.headers.authorization, "sec-1234");
});

test("erros de provedor saem SANITIZADOS — o segredo nunca aparece", async () => {
  const fetchFn: FetchLike = async () => ({ ok: false, status: 401, text: async () => "bad credentials: sec-1234 rejeitado" });
  await assert.rejects(
    () => fetchProviderIdentity("github", { config: {}, secret: "sec-1234", fetchFn }),
    (e: Error) => e.message.includes("[REDACTED]") && !e.message.includes("sec-1234"),
  );
  assert.equal(sanitizeSecrets("x sec-1234 y", ["sec-1234"]), "x [REDACTED] y");
});

test("tier 1: busca/carrega/cria com URLs e corpos corretos; tier 2 recusa com erro claro", async () => {
  const routes = fake({
    "https://api.github.com/search/issues": { items: [{ number: 12, title: "Login social", body: "Google+GitHub", html_url: "https://github.com/acme/api/issues/12", state: "open", repository_url: "https://api.github.com/repos/acme/api" }] },
    "https://api.github.com/repos/acme/api/issues/12": { number: 12, title: "Login social", body: "Google+GitHub", html_url: "https://github.com/acme/api/issues/12", state: "open" },
    "https://api.github.com/repos/acme/api/issues": { number: 77, html_url: "https://github.com/acme/api/issues/77" },
    "https://acme.atlassian.net/rest/api/3/search": { issues: [{ key: "ABC-1", fields: { summary: "Tarefa", status: { name: "To Do" }, description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "descrição adf" }] }] } } }] },
    "https://api.linear.app/graphql": (init: any) => {
      const body = JSON.parse(init.body);
      if (String(body.query).includes("searchIssues")) return { data: { searchIssues: { nodes: [{ identifier: "PRI-824", title: "Voz", description: "d", url: "https://linear.app/acme/issue/PRI-824", state: { name: "In Progress" } }] } } };
      if (String(body.query).includes("teams(")) return { data: { teams: { nodes: [{ id: "team-uuid" }] } } };
      return { data: { issueCreate: { issue: { identifier: "PRI-900", url: "https://linear.app/acme/issue/PRI-900" } } } };
    },
  });
  const gh = await searchProviderTasks("github", "login", { config: { org: "acme" }, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(gh[0].key, "acme/api#12");
  assert.ok(routes.calls[0].url.includes("org%3Aacme"), "org da conexão restringe a busca");

  const got = await getProviderTask("github", "acme/api#12", { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(got!.title, "Login social");
  await assert.rejects(() => getProviderTask("github", "12", { config: {}, secret: "s", fetchFn: routes.fetchFn }), /owner\/repo#numero/);

  const jira = await searchProviderTasks("jira", "tarefa", { config: { baseUrl: "https://acme.atlassian.net", email: "e@x" }, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(jira[0].description, "descrição adf", "descrição ADF vira texto plano");

  const li = await getProviderTask("linear", "pri-824", { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(li!.key, "PRI-824", "match exato do identificador, sem depender de caixa");

  const created = await createProviderTask("github", "acme/api", { title: "Nova" }, { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(created.key, "acme/api#77");
  const linearCreated = await createProviderTask("linear", "PRI", { title: "Nova" }, { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(linearCreated.key, "PRI-900", "chave do time resolve para teamId antes da mutation");

  await assert.rejects(() => searchProviderTasks("trello", "x", { config: {}, secret: "a", secret2: "b", fetchFn: routes.fetchFn }), /tier 2/);
  assert.equal(adfToText(null), "");
});

test("cofre: CRUD, identidade presa à credencial e NENHUM segredo no arquivo", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-vault-"));
  try {
    const store = new TaskConnectionStore({ dir });
    const c = store.save({ provider: "github", label: "GitHub ACME", config: { org: "acme" }, secretRef: "GH_ACME_TOKEN" });
    assert.equal(c.id, "github:github-acme");
    assert.throws(() => store.save({ provider: "github", label: "X", secretRef: "TOKEN=abc123" }), /NOME da variável/);
    assert.throws(() => store.save({ provider: "trello", label: "T", secretRef: "K" }), /dois segredos/);
    assert.throws(() => store.save({ provider: "jira", label: "J", secretRef: "T" }), /obrigatório/);

    store.recordVerification(c.id, { identity: { id: "7", login: "jon-acme" } });
    assert.equal(store.get(c.id)!.identity!.login, "jon-acme");
    assert.ok(store.get(c.id)!.lastVerifiedAt);

    // Trocar o secretRef derruba a identidade: credencial nova = conta desconhecida até re-verificar.
    store.save({ id: c.id, provider: "github", label: "GitHub ACME", config: { org: "acme" }, secretRef: "OUTRA_VAR" });
    assert.equal(store.get(c.id)!.identity, undefined);

    store.recordVerification(c.id, { error: "HTTP 401: bad credentials" });
    assert.match(store.get(c.id)!.lastError!, /401/);

    const persisted = readFileSync(join(dir, "task-connections.json"), "utf8");
    assert.ok(!persisted.includes("abc123"), "nenhum valor de segredo no arquivo");
    assert.equal(new TaskConnectionStore({ dir }).list().length, 1, "sobrevive a restart");
    assert.equal(store.remove(c.id), true);
    assert.equal(store.list().length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("regra de ouro: cada caminho de recusa tem código próprio e nunca cai em conta padrão", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-vault-rule-"));
  try {
    const store = new TaskConnectionStore({ dir });
    const conn = store.save({ provider: "github", label: "ACME", config: {}, secretRef: "GH_TOKEN" });
    const env = { GH_TOKEN: "tok-123" };

    const r1 = resolveTaskConnection({ binding: null, store, env });
    assert.equal("refusal" in r1 && r1.refusal.code, "NO_BINDING");
    const r2 = resolveTaskConnection({ binding: { connectionId: "" }, store, env });
    assert.equal("refusal" in r2 && r2.refusal.code, "NO_CONNECTION");
    const r3 = resolveTaskConnection({ binding: { connectionId: "github:sumiu" }, store, env });
    assert.equal("refusal" in r3 && r3.refusal.code, "CONNECTION_MISSING");
    const r4 = resolveTaskConnection({ binding: { connectionId: conn.id, allowed: ["outra"] }, store, env });
    assert.equal("refusal" in r4 && r4.refusal.code, "NOT_ALLOWED");
    const r5 = resolveTaskConnection({ binding: { connectionId: conn.id }, store, env: {} });
    assert.equal("refusal" in r5 && r5.refusal.code, "SECRET_MISSING");
    const r6 = resolveTaskConnection({ binding: { connectionId: conn.id }, store, env, requireVerified: true });
    assert.equal("refusal" in r6 && r6.refusal.code, "NOT_VERIFIED", "escrita exige identidade verificada");

    store.recordVerification(conn.id, { identity: { id: "7", login: "jon" } });
    const ok = resolveTaskConnection({ binding: { connectionId: conn.id, allowed: [conn.id] }, store, env, requireVerified: true });
    assert.ok("connection" in ok && ok.secret === "tok-123");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("divergência remote×conexão avisa antes da escrita errada", () => {
  const conn = { provider: "github", label: "ACME", config: { org: "acme" } } as any;
  assert.match(remoteMismatchWarning("git@github.com:pessoal/repo.git", conn)!, /pessoal.*acme/i);
  assert.equal(remoteMismatchWarning("https://github.com/acme/api.git", conn), undefined);
  assert.equal(remoteMismatchWarning(undefined, conn), undefined, "sem remote, sem alarme falso");
  assert.equal(remoteMismatchWarning("git@github.com:x/y.git", { ...conn, config: {} }), undefined, "sem org declarada, sem palpite");
});

// TSK-11, borda 4: "sem aviso" tem DOIS sentidos — "conferi e está certo" e "não tinha como
// conferir". Auto-aprovação só pode confiar no primeiro; e exigir remote onde a checagem nada diz
// (Jira, Linear, GitHub sem org) quebraria auto-aprovação por um motivo inexistente.
test("a checagem de remote só se aplica onde ela pode afirmar alguma coisa", () => {
  const github = { provider: "github", label: "ACME", config: { org: "acme" } } as any;
  assert.equal(remoteCheckApplies(github), true);
  assert.equal(remoteCheckApplies({ ...github, config: {} }), false, "sem org não há o que comparar");
  assert.equal(remoteCheckApplies({ ...github, provider: "gitlab" }), true);
  assert.equal(remoteCheckApplies({ ...github, provider: "jira" }), false, "git remote não diz nada sobre a conta do Jira");
  assert.equal(remoteCheckApplies({ ...github, provider: "linear" }), false);
});

/* ── F: o que sai para o cliente ──────────────────────────────────────────────────────────────── */

test("payload público: nome de env var vai, VALOR de segredo nunca — nem escondido no config", () => {
  const env = { TOK: "sk-super-secreto-123", TOK2: "segundo-segredo-456" };
  const conexoes: any[] = [
    { id: "jira:acme", provider: "jira", label: "Jira ACME", secretRef: "TOK", secretRef2: "TOK2",
      config: { baseUrl: "https://acme.atlassian.net", email: "eu@acme.com" }, createdAt: 1, updatedAt: 2, identity: { login: "jon" } },
    // Token colado no campo errado do formulário: "config é não-sensível" é promessa, não garantia.
    { id: "gh:pessoal", provider: "github", label: "GitHub", secretRef: "TOK",
      config: { org: "acme", note: "usar sk-super-secreto-123 aqui" }, createdAt: 1, updatedAt: 2 },
    { id: "sem-env", provider: "linear", label: "Linear", secretRef: "AUSENTE", config: {}, createdAt: 1, updatedAt: 2 },
  ];

  const publico = publicTaskConnections(conexoes, env);
  const json = JSON.stringify(publico);

  for (const valor of Object.values(env)) assert.ok(!json.includes(valor), `o segredo ${valor.slice(0, 6)}… não pode aparecer no payload`);
  assert.equal(publico[0].secretRef, "TOK", "o NOME da variável continua indo — é ele que permite pedir 'cole o segredo de TOK'");
  assert.equal(publico[0].config.baseUrl, "https://acme.atlassian.net", "config legítimo passa intacto");
  assert.equal(publico[1].config.note, "[REDIGIDO]");
  assert.equal(publico[0].envOk, true);
  assert.equal(publico[2].envOk, false, "segredo ausente vira booleano, não silêncio");
});

/* ── "As MINHAS tarefas abertas" ──────────────────────────────────────────────────────────────────
   Um projeto com fonte `provider` abria so com uma caixa de busca vazia: quem tinha a conta certa,
   verificada e vinculada, mesmo assim nao via tarefa nenhuma e concluia que a integracao falhou.
   Listar nao e buscar com termo vazio — o criterio e "atribuida a MIM e ainda aberta", que nenhum
   termo expressa. */

test("listar tarefas do provedor pede as MINHAS abertas, em cada tier 1", async () => {
  const routes = fake({
    "https://api.github.com/issues": [
      { number: 12, title: "Login social", body: "corpo", html_url: "https://github.com/acme/api/issues/12", state: "open", repository: { full_name: "acme/api" } },
      { number: 13, title: "PR aberto", html_url: "https://github.com/acme/api/pull/13", state: "open", repository: { full_name: "acme/api" }, pull_request: { url: "x" } },
    ],
    "https://gitlab.com/api/v4/issues": [{ iid: 5, title: "Bug", web_url: "https://gitlab.com/acme/app/-/issues/5", state: "opened", references: { full: "acme/app#5" } }],
    "https://acme.atlassian.net/rest/api/3/search": { issues: [{ key: "ABC-1", fields: { summary: "Tarefa", status: { name: "In Progress" } } }] },
    "https://api.linear.app/graphql": { data: { viewer: { assignedIssues: { nodes: [{ identifier: "ENG-904", title: "Insight sumido", url: "https://linear.app/acme/issue/ENG-904", state: { name: "Triage" } }] } } } },
  });

  const gh = await listProviderTasks("github", { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(gh.length, 1, "pull request nao e tarefa: o endpoint devolve os dois juntos");
  assert.equal(gh[0].key, "acme/api#12", "a chave sai igual a da busca, que le repository_url");

  const gl = await listProviderTasks("gitlab", { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(gl[0].key, "acme/app#5");
  const ji = await listProviderTasks("jira", { config: { baseUrl: "https://acme.atlassian.net", email: "e@x" }, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(ji[0].key, "ABC-1");
  const li = await listProviderTasks("linear", { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(li[0].key, "ENG-904");

  // O criterio "minhas e abertas" tem de estar na PERGUNTA, nao num filtro depois: filtrar aqui
  // gastaria o teto de resultados com tarefa que ja acabou.
  const url = (prefixo: string) => routes.calls.find((c) => c.url.startsWith(prefixo))!;
  assert.match(url("https://api.github.com/issues").url, /filter=assigned&state=open/);
  assert.match(url("https://gitlab.com/api/v4/issues").url, /scope=assigned_to_me&state=opened/);
  assert.match(String(JSON.parse(url("https://acme.atlassian.net/rest/api/3/search").init.body).jql), /assignee = currentUser\(\) AND statusCategory != Done/);
  const linearBody = String(JSON.parse(url("https://api.linear.app/graphql").init.body).query);
  assert.match(linearBody, /viewer \{ assignedIssues/);
  assert.match(linearBody, /completedAt: \{ null: true \}/);
});

test("a lista nao carrega descricao — ela custa caro e nao cabe na linha", async () => {
  const enorme = "x".repeat(38_000);
  const routes = fake({
    "https://api.github.com/issues": [{ number: 12, title: "T", body: enorme, html_url: "https://github.com/acme/api/issues/12", state: "open", repository: { full_name: "acme/api" } }],
    "https://api.linear.app/graphql": { data: { viewer: { assignedIssues: { nodes: [{ identifier: "ENG-904", title: "T", url: "u", state: { name: "Triage" } }] } } } },
  });

  const gh = await listProviderTasks("github", { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.equal(gh[0].description, undefined, "38 KB por item viajariam a cada abertura do painel");
  // E o Linear nem PEDE o campo: economia na origem, nao no mapeamento.
  await listProviderTasks("linear", { config: {}, secret: "s", fetchFn: routes.fetchFn });
  assert.doesNotMatch(String(JSON.parse(routes.calls.at(-1)!.init.body).query), /description/);
});

test("org da conexao restringe a lista, e tier 2 recusa em vez de mentir lista vazia", async () => {
  const routes = fake({ "https://api.github.com/orgs/acme/issues": [] });
  await listProviderTasks("github", { config: { org: "acme" }, secret: "s", fetchFn: routes.fetchFn });
  assert.match(routes.calls[0].url, /^https:\/\/api\.github\.com\/orgs\/acme\/issues/);
  // Lista vazia de um provedor sem implementacao seria indistinguivel de "voce nao tem tarefas".
  await assert.rejects(() => listProviderTasks("trello", { config: {}, secret: "a", secret2: "b", fetchFn: routes.fetchFn }), /tier 2/);
});
