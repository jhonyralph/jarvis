import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskConnectionStore, resolveTaskConnection, remoteMismatchWarning } from "./task-connections.js";
import { fetchProviderIdentity, searchProviderTasks, getProviderTask, createProviderTask, sanitizeSecrets, adfToText, TASK_PROVIDERS, type FetchLike } from "./task-providers.js";

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
