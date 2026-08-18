import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTaskInput, parseFeatureTask, projectKeyFor, ProjectTaskBindingStore, TaskMetaStore, formatParallelRunsLine, resolveTaskSource } from "./task-link.js";
import { DEFAULT_FEATURES_DIR } from "./task-local-cache.js";

test("parseTaskInput reconhece URLs de GitHub, Linear, Jira e GitLab sem rede", () => {
  assert.deepEqual(parseTaskInput("https://github.com/acme/api/issues/123"), { tracker: "github", key: "acme/api#123", url: "https://github.com/acme/api/issues/123", title: undefined });
  assert.equal(parseTaskInput("https://github.com/acme/api/pull/9")!.key, "acme/api#9");
  const linear = parseTaskInput("https://linear.app/acme/issue/PRI-824/titulo-da-tarefa")!;
  assert.equal(linear.tracker, "linear");
  assert.equal(linear.key, "PRI-824");
  const jira = parseTaskInput("https://acme.atlassian.net/browse/ABC-42")!;
  assert.equal(jira.tracker, "jira");
  assert.equal(jira.key, "ABC-42");
  const gitlab = parseTaskInput("https://gitlab.com/grupo/sub/projeto/-/issues/7")!;
  assert.equal(gitlab.tracker, "gitlab");
  assert.equal(gitlab.key, "grupo/sub/projeto#7");
});

test("parseTaskInput: chave nua herda o rastreador do vínculo da pasta; convenções continuam valendo", () => {
  assert.deepEqual(parseTaskInput("PRI-824", { defaultTracker: "linear" }), { tracker: "linear", key: "PRI-824", url: undefined, title: undefined });
  assert.equal(parseTaskInput("PRI-824")!.tracker, "");
  assert.deepEqual(parseTaskInput("linear PRI-824"), { tracker: "linear", key: "PRI-824", url: undefined, title: undefined });
  assert.deepEqual(parseTaskInput("acme/api#77"), { tracker: "github", key: "acme/api#77", url: undefined, title: undefined });
  // URL desconhecida não vira lixo: preserva o link e usa o último pedaço como chave.
  const other = parseTaskInput("https://tasks.example.com/board/T-9", { defaultTracker: "jira" })!;
  assert.equal(other.tracker, "jira");
  assert.equal(other.key, "T-9");
  assert.equal(other.url, "https://tasks.example.com/board/T-9");
  assert.equal(parseTaskInput("   "), null);
});

test("parseFeatureTask: frontmatter manda; sem ele, h1 e primeiro parágrafo; sem nada, o nome do arquivo", () => {
  const fm = parseFeatureTask("---\ntitle: Busca global\ndescription: Buscar em todas as sessões.\n---\n# Outro título\ncorpo", "docs\\features\\busca.md");
  assert.equal(fm.title, "Busca global");
  assert.equal(fm.description, "Buscar em todas as sessões.");
  assert.equal(fm.task.tracker, "local");
  assert.equal(fm.task.key, "docs/features/busca.md");
  assert.equal(fm.task.title, "Busca global");

  const h1 = parseFeatureTask("# Exportar CSV\n\nPermitir exportar o histórico.\nEm duas linhas.\n\n## Detalhes", "docs/features/csv.md");
  assert.equal(h1.title, "Exportar CSV");
  assert.equal(h1.description, "Permitir exportar o histórico. Em duas linhas.");

  const bare = parseFeatureTask("sem estrutura nenhuma", "docs/features/rascunho-x.md");
  assert.equal(bare.title, "rascunho-x");
});

test("vínculo por pasta: normalização de caminho, persistência e recusa de featuresDir com ..", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-task-bind-"));
  try {
    const store = new ProjectTaskBindingStore({ dir, platform: "win32" });
    store.set("C:\\Users\\Dev\\Projeto-X\\", { tracker: "jira" });
    assert.equal(store.get("c:/users/dev/projeto-x")!.tracker, "jira", "no Windows o caminho é case-insensitive e barras não importam");
    store.set("C:/Users/Dev/ProjY", { tracker: "local", featuresDir: "docs\\features" });
    assert.equal(store.get("C:/Users/Dev/ProjY")!.featuresDir, "docs/features");
    assert.throws(() => store.set("C:/p", { tracker: "local", featuresDir: "../fora" }), /não pode sair do projeto/);

    const reread = new ProjectTaskBindingStore({ dir, platform: "win32" });
    assert.equal(reread.get("C:/Users/Dev/Projeto-X")!.tracker, "jira", "o vínculo sobrevive a restart");
    assert.equal(reread.list().length, 2);
    // Em FS sensível a caso, projetos que diferem por caixa são projetos diferentes.
    assert.notEqual(projectKeyFor("/home/dev/Api", "linux"), projectKeyFor("/home/dev/api", "linux"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cache de meta: merge não apaga campo ausente, persiste e respeita o teto", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-task-meta-"));
  try {
    let clock = 1000;
    const store = new TaskMetaStore({ dir, now: () => ++clock });
    store.merge("jira", "ABC-1", { title: "Título", description: "Descrição longa", url: "https://x/browse/ABC-1" });
    store.merge("jira", "ABC-1", { summary: "Resumo curto" });
    const m = store.get("jira", "ABC-1")!;
    assert.equal(m.title, "Título", "merge parcial preserva o que já se sabia");
    assert.equal(m.summary, "Resumo curto");
    assert.equal(new TaskMetaStore({ dir }).get("jira", "ABC-1")!.title, "Título", "cache sobrevive a restart");

    for (let i = 0; i < 320; i++) store.merge("github", `acme/api#${i}`, { title: `t${i}` });
    assert.equal(store.get("jira", "ABC-1"), undefined, "o teto derruba os mais antigos primeiro");
    assert.ok(store.get("github", "acme/api#319"), "os recentes ficam");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("formatParallelRunsLine resume as outras tarefas em uma linha e some quando não há outras", () => {
  assert.equal(formatParallelRunsLine([]), "");
  const line = formatParallelRunsLine([
    { workflowName: "entrega", task: { tracker: "github", key: "acme/api#12" }, currentStepId: "tdd", steps: [
      { id: "spec", title: "Spec", kind: "step", state: "done" },
      { id: "tdd", title: "TDD", kind: "step", state: "pending" },
    ] as any },
  ] as any);
  assert.match(line, /acme\/api#12 \(TDD, 1\/2\)/);
  assert.match(line, /não são o assunto deste turno/);
});

/* ── D: fonte única declarada por projeto ─────────────────────────────────────────────────────── */

const conns = [{ id: "jira:acme", provider: "jira", label: "Jira ACME" }, { id: "github:pessoal", provider: "github" }];

test("fonte única: projeto sem declaração NÃO cai em pasta local por padrão — pede para declarar", () => {
  for (const binding of [undefined, null, { tracker: "" }]) {
    const d = resolveTaskSource({ binding: binding as any, connections: conns });
    assert.equal(d.kind, "none");
    assert.equal(d.ready, false);
    assert.equal(d.code, "NO_SOURCE");
    assert.match(d.reason!, /escolha a fonte/);
    // Um default silencioso aqui é o bug: a lista viria da pasta sem ninguém ter dito que é dela.
    assert.equal(d.featuresDir, undefined);
  }
});

test("fonte única: `local` está pronta e aplica a pasta padrão; pasta declarada é normalizada", () => {
  assert.deepEqual(resolveTaskSource({ binding: { tracker: "local" } }),
    { kind: "local", tracker: "local", ready: true, featuresDir: DEFAULT_FEATURES_DIR });
  assert.equal(resolveTaskSource({ binding: { tracker: "local", featuresDir: "/specs\\tarefas/" } }).featuresDir, "specs/tarefas");
});

test("fonte única: provedor sem conta vinculada dá erro acionável, não lista vazia", () => {
  const d = resolveTaskSource({ binding: { tracker: "jira" }, connections: conns });
  assert.equal(d.kind, "provider");
  assert.equal(d.ready, false);
  assert.equal(d.code, "NO_CONNECTION");
  assert.match(d.reason!, /declara jira.*vincule a conexão/);
});

test("fonte única: conexão que sumiu do cofre e conexão de OUTRO provedor são recusadas com o motivo certo", () => {
  const gone = resolveTaskSource({ binding: { tracker: "jira", connectionId: "jira:antiga" }, connections: conns });
  assert.equal(gone.code, "CONNECTION_MISSING");
  assert.match(gone.reason!, /não existe mais no cofre/);

  // Vínculo apontando para conta de outro provedor: listar por ela contradiz o que o projeto declara.
  const mismatch = resolveTaskSource({ binding: { tracker: "jira", connectionId: "github:pessoal" }, connections: conns });
  assert.equal(mismatch.code, "PROVIDER_MISMATCH");
  assert.match(mismatch.reason!, /é de github.*declara jira/);
  assert.equal(mismatch.ready, false);
});

test("fonte única: provedor com conta vinculada e presente está pronto — e nunca traz pasta local junto", () => {
  const d = resolveTaskSource({ binding: { tracker: "jira", connectionId: "jira:acme", featuresDir: "docs/features" }, connections: conns });
  assert.deepEqual(d, { kind: "provider", tracker: "jira", connectionId: "jira:acme", ready: true });
  assert.equal(d.featuresDir, undefined, "featuresDir num projeto de provedor seria a segunda fonte entrando pela porta de trás");
});

test("fonte única: tracker é normalizado (maiúsculas/espaço não criam fonte diferente)", () => {
  assert.equal(resolveTaskSource({ binding: { tracker: " LOCAL " } }).kind, "local");
  assert.equal(resolveTaskSource({ binding: { tracker: "Jira", connectionId: "jira:acme" }, connections: conns }).ready, true);
});

test("fonte única: projeto desconhecido é recusado — nunca resolvido pela pasta de outra máquina", () => {
  const d = resolveTaskSource({ projectDir: "", binding: { tracker: "local" }, connections: conns });
  assert.equal(d.code, "UNKNOWN_PROJECT");
  assert.equal(d.ready, false);
  assert.match(d.reason!, /em que pasta esta sessão está/);
  // Com a pasta conhecida, a mesma entrada resolve normalmente.
  assert.equal(resolveTaskSource({ projectDir: "C:/proj", binding: { tracker: "local" } }).ready, true);
  // Campo ausente = "não me pergunte isso" (avaliar só o vínculo), e não "pasta vazia".
  assert.equal(resolveTaskSource({ binding: { tracker: "local" } }).ready, true);
});

test("fonte única: `mcp` sai pronta para perguntar à máquina — quem valida o servidor é ela", () => {
  const semNome = resolveTaskSource({ binding: { tracker: "mcp" } });
  assert.equal(semNome.kind, "mcp");
  assert.equal(semNome.ready, true, "o Hub não sabe o que existe na máquina; recusar aqui inventaria um erro");
  assert.equal(semNome.mcpServer, undefined, "sem nome, a máquina decide (se tiver um só)");

  const comNome = resolveTaskSource({ binding: { tracker: "mcp", mcpServer: "linear-local" } });
  assert.equal(comNome.mcpServer, "linear-local");
  assert.equal(comNome.featuresDir, undefined, "fonte mcp não carrega pasta junto — seriam duas fontes");
});
