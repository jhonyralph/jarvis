/**
 * Fatia G — gerenciar a fonte/pasta de tarefas por uma frase do chat.
 *
 * O teste que mais importa aqui é o de NÃO disparar: um classificador de intenção pessoal já leu
 * "consulta" como compromisso de calendário com 0,99 e prendeu a sessão. Uma frase que menciona
 * "pasta", "jira" ou "fonte" no meio de uma conversa não pode reconfigurar projeto nenhum, então a
 * lista de negativos abaixo é o contrato — não decoração.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseTaskSourceCommand, planTaskSourceCommand, formatTaskSourceConfirmation } from "./task-source-command.js";
import { ProjectTaskBindingStore, resolveTaskSource, projectKeyFor } from "./task-link.js";

const PROJ = process.platform === "win32" ? "C:\\proj" : "/home/u/proj";

/* ── 1. reconhecimento ────────────────────────────────────────────────────────────────────────── */

test("G: a frase declara a pasta local, em várias formas naturais", () => {
  for (const frase of [
    "a fonte de tarefas deste projeto é a pasta docs/features",
    "fonte de tarefas: docs/features",
    "pasta de tarefas deste projeto = docs/features",
    "troca a fonte de tarefas deste projeto para a pasta docs/features",
    "usa a pasta de tarefas docs/features",
    "as tarefas deste projeto vêm da pasta docs/features",
    "Jarvis, define a pasta de tarefas deste projeto como docs/features",
  ]) {
    assert.deepEqual(parseTaskSourceCommand(frase), { intent: "set", tracker: "local", featuresDir: "docs/features" }, frase);
  }
});

test("G: 'pasta' na frente libera um segmento só; sem ela, o alvo precisa ter forma de caminho", () => {
  assert.deepEqual(parseTaskSourceCommand("fonte de tarefas: pasta features"), { intent: "set", tracker: "local", featuresDir: "features" });
  // "backlog" solto podia ser pasta, provedor ou só uma palavra — sem forma de caminho, não age.
  assert.equal(parseTaskSourceCommand("fonte de tarefas: backlog"), null);
  // "pasta local" sem caminho é fonte local no padrão, e o padrão aparece na confirmação.
  assert.deepEqual(parseTaskSourceCommand("a fonte de tarefas deste projeto é a pasta local"), { intent: "set", tracker: "local" });
});

test("G: provedor, servidor MCP e desligar também entram pela frase", () => {
  assert.deepEqual(parseTaskSourceCommand("a fonte de tarefas deste projeto é o jira"), { intent: "set", tracker: "jira" });
  assert.deepEqual(parseTaskSourceCommand("as tarefas deste projeto vêm do linear"), { intent: "set", tracker: "linear" });
  assert.deepEqual(parseTaskSourceCommand("fonte de tarefas: jira da conta trabalho"), { intent: "set", tracker: "jira", connectionHint: "trabalho" });
  assert.deepEqual(parseTaskSourceCommand("fonte de tarefas: linear (Linear ACME)"), { intent: "set", tracker: "linear", connectionHint: "Linear ACME" });
  assert.deepEqual(parseTaskSourceCommand("fonte de tarefas: mcp linear-local"), { intent: "set", tracker: "mcp", mcpServer: "linear-local" });
  assert.deepEqual(parseTaskSourceCommand("fonte de tarefas deste projeto: servidor mcp"), { intent: "set", tracker: "mcp" });
  assert.deepEqual(parseTaskSourceCommand("fonte de tarefas deste projeto: nenhuma"), { intent: "clear", tracker: "" });
});

test("G: 'azure' vira o id do catálogo, senão o vínculo nasceria sem conexão capaz de servi-lo", () => {
  assert.deepEqual(parseTaskSourceCommand("fonte de tarefas: azure"), { intent: "set", tracker: "azure-devops" });
  assert.deepEqual(parseTaskSourceCommand("fonte de tarefas: azure devops"), { intent: "set", tracker: "azure-devops" });
});

/* ── 2. o que NÃO pode disparar ───────────────────────────────────────────────────────────────── */

test("G: conversa normal que menciona pasta/jira/fonte NÃO configura nada", () => {
  const naoPodeDisparar = [
    // menção casual — a cabeça da frase não nomeia a configuração
    "essa pasta de tarefas tá uma bagunça, dá uma olhada",
    "o jira caiu de novo hoje de manhã",
    "qual é a fonte desse número no relatório",
    "abre a pasta docs/features e me diz o que tem lá",
    "cria uma tarefa no jira para esse bug",
    "move os arquivos da pasta de tarefas para outro lugar",
    "acho que a fonte de tarefas deste projeto está errada",
    "não usa a pasta de tarefas antiga",
    "preciso entender de onde vem a fonte de tarefas do outro repo",
    // pergunta: responder não pode mudar o mundo
    "a fonte de tarefas deste projeto é o jira?",
    "fonte de tarefas: qual é?",
    "qual a pasta de tarefas deste projeto?",
    // sem alvo, ou alvo que não é reconhecido por inteiro
    "a fonte de tarefas deste projeto é",
    "a fonte de tarefas deste projeto é o que a Ana definir",
    "as tarefas deste projeto vêm do jira, mas o time usa notion",
    "as tarefas deste projeto estão atrasadas",
    "a fonte de tarefas e a fonte de contexto são coisas diferentes",
    "troca a fonte de tarefas",
    "usa a pasta de tarefas que a gente combinou",
    "configura a pasta de tarefas direito",
    "define a fonte de tarefas do projeto legado",
    // outros canais
    "!ls docs/features",
    "/tarefas",
  ];
  for (const frase of naoPodeDisparar) assert.equal(parseTaskSourceCommand(frase), null, frase);
});

test("G: parágrafo, multilinha e texto vazio nunca são comando", () => {
  assert.equal(parseTaskSourceCommand("fonte de tarefas: docs/features\ne também revisa o README"), null, "multilinha é conversa, não comando");
  assert.equal(parseTaskSourceCommand("a fonte de tarefas deste projeto é a pasta docs/features " + "e ".repeat(120)), null, "texto longo é conversa");
  assert.equal(parseTaskSourceCommand(""), null);
  assert.equal(parseTaskSourceCommand("   "), null);
  assert.equal(parseTaskSourceCommand(undefined as unknown as string), null);
});

/* ── 3. plano: resolve, contém e recusa com motivo ────────────────────────────────────────────── */

test("G: o caminho gravado é o RESOLVIDO, não o que foi digitado", () => {
  const cmd = parseTaskSourceCommand("fonte de tarefas: docs/../docs/features")!;
  const r = planTaskSourceCommand({ command: cmd, projectDir: PROJ });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.plan.binding?.featuresDir, "docs/features");
});

test("G: caminho absoluto DENTRO do projeto vira o relativo correspondente", () => {
  const dentro = resolve(PROJ, "docs", "features");
  const r = planTaskSourceCommand({ command: { intent: "set", tracker: "local", featuresDir: dentro }, projectDir: PROJ });
  assert.equal(r.ok && r.plan.binding?.featuresDir, "docs/features");
});

test("G: recusa caminho que escapa do projeto, com motivo acionável", () => {
  for (const fuga of ["../fora", "docs/../../fora", process.platform === "win32" ? "C:\\Windows\\Temp" : "/etc"]) {
    const cmd = parseTaskSourceCommand(`fonte de tarefas: ${fuga}`);
    assert.ok(cmd, `"${fuga}" precisa virar comando — só assim a recusa é falada em vez de o turno ir para a IA`);
    const r = planTaskSourceCommand({ command: cmd!, projectDir: PROJ });
    assert.equal(r.ok, false, fuga);
    assert.match(!r.ok ? r.error : "", /fora do projeto/);
    assert.match(!r.ok ? r.error : "", /docs\/features/, "a recusa precisa dizer o que fazer, não só o que deu errado");
  }
});

test("G: sem saber a pasta do projeto, recusa em vez de resolver pelo diretório errado", () => {
  const r = planTaskSourceCommand({ command: { intent: "set", tracker: "local" }, projectDir: "" });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /pasta esta sessão está na máquina/);
});

test("G: a conta nomeada é resolvida contra o cofre — sem match, recusa listando o que existe", () => {
  const conns = [{ id: "jira:acme", provider: "jira", label: "Jira ACME" }, { id: "jira:pessoal", provider: "jira", label: "Jira Pessoal" }];
  const ok = planTaskSourceCommand({ command: { intent: "set", tracker: "jira", connectionHint: "acme" }, projectDir: PROJ, connections: conns });
  assert.equal(ok.ok && ok.plan.binding?.connectionId, "jira:acme");

  const nada = planTaskSourceCommand({ command: { intent: "set", tracker: "jira", connectionHint: "trabalho" }, projectDir: PROJ, connections: conns });
  assert.equal(nada.ok, false);
  assert.match(!nada.ok ? nada.error : "", /Jira ACME/, "recusar sem dizer o que existe obriga o usuário a adivinhar");

  const ambiguo = planTaskSourceCommand({ command: { intent: "set", tracker: "jira", connectionHint: "jira" }, projectDir: PROJ, connections: conns });
  assert.equal(ambiguo.ok, false);
  assert.match(!ambiguo.ok ? ambiguo.error : "", /combina com 2/);
});

test("G: trocar de fonte não carrega política de escrita da fonte antiga", () => {
  const atual = { tracker: "jira", connectionId: "jira:acme", target: "ABC", autoApprove: ["create"], updatedAt: 1 };
  const trocou = planTaskSourceCommand({ command: { intent: "set", tracker: "linear" }, projectDir: PROJ, current: atual });
  assert.equal(trocou.ok && trocou.plan.binding?.autoApprove, undefined, "autoApprove do Jira num projeto Linear liberaria escrita num board nunca aprovado");
  assert.equal(trocou.ok && trocou.plan.binding?.target, undefined);
  assert.equal(trocou.ok && trocou.plan.binding?.connectionId, undefined, "conexão do Jira não serve um projeto que agora declara Linear");

  const mesmo = planTaskSourceCommand({ command: { intent: "set", tracker: "jira" }, projectDir: PROJ, current: atual, connections: [{ id: "jira:acme", provider: "jira" }] });
  assert.deepEqual(mesmo.ok && mesmo.plan.binding?.autoApprove, ["create"], "sem trocar de fonte, a política do projeto continua valendo");
  assert.equal(mesmo.ok && mesmo.plan.binding?.connectionId, "jira:acme");
});

test("G: voltar para a pasta sem dizer caminho reaproveita o que o projeto já usava", () => {
  const atual = { tracker: "local", featuresDir: "docs/roadmap", updatedAt: 1 };
  const r = planTaskSourceCommand({ command: { intent: "set", tracker: "local" }, projectDir: PROJ, current: atual });
  assert.equal(r.ok && r.plan.binding?.featuresDir, "docs/roadmap");
});

/* ── 4. a confirmação mostra o que ficou valendo ──────────────────────────────────────────────── */

test("G: a confirmação nasce da decisão gravada e mostra o caminho resolvido", () => {
  const decision = resolveTaskSource({ projectDir: PROJ, binding: { tracker: "local", featuresDir: "docs/features" } });
  const frase = formatTaskSourceConfirmation({ projectDir: PROJ, decision });
  assert.match(frase, /docs\/features/);
  assert.match(frase, new RegExp(PROJ.replace(/\\/g, "\\\\")));
});

test("G: fonte que não pode servir é confirmada COM o motivo, nunca como sucesso", () => {
  const decision = resolveTaskSource({ projectDir: PROJ, binding: { tracker: "jira" }, connections: [] });
  const frase = formatTaskSourceConfirmation({ projectDir: PROJ, decision });
  assert.match(frase, /Ainda não dá para listar/);
  assert.match(frase, /vincule a conexão/i, "o motivo vem de resolveTaskSource e já é imperativo");
});

test("G: MCP sem nome de servidor diz que a máquina decide — e quando ela não consegue", () => {
  const frase = formatTaskSourceConfirmation({ projectDir: PROJ, decision: resolveTaskSource({ projectDir: PROJ, binding: { tracker: "mcp" } }) });
  assert.match(frase, /servidor MCP/);
  assert.match(frase, /dois ou mais/);
});

/* ── 5. mesma STORE que a tela de Configurações lê ────────────────────────────────────────────── */

test("G: o que a frase grava é o que Configurações → 🎯 Tarefas lista (mesma store)", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-tsk-g-"));
  try {
    // Esta é a MESMA classe que o Hub instancia para `projectTasks` e a MESMA leitura (`list()`) que
    // alimenta o campo `bindings` do frame difundido — se divergisse, a tela mostraria outro estado.
    const store = new ProjectTaskBindingStore({ dir, platform: process.platform, now: () => 1 });
    const cmd = parseTaskSourceCommand("fonte de tarefas deste projeto: docs/roadmap")!;
    const planned = planTaskSourceCommand({ command: cmd, projectDir: PROJ });
    assert.equal(planned.ok, true);
    const gravado = store.set(PROJ, (planned as { ok: true; plan: { binding: any } }).plan.binding);

    const naLista = store.list().find((row) => row.project === projectKeyFor(PROJ, process.platform));
    assert.ok(naLista, "o projeto configurado pelo chat precisa aparecer na listagem que a tela usa");
    assert.equal(naLista!.binding.tracker, "local");
    assert.equal(naLista!.binding.featuresDir, "docs/roadmap");

    // E a decisão que a confirmação mostra é a mesma que a tela e a listagem resolvem do vínculo.
    const decision = resolveTaskSource({ projectDir: PROJ, binding: naLista!.binding });
    assert.equal(decision.featuresDir, "docs/roadmap");
    assert.match(formatTaskSourceConfirmation({ projectDir: PROJ, decision }), /docs\/roadmap/);
    assert.equal(gravado.featuresDir, "docs/roadmap");

    // Desligar pela frase some da lista — "sem fonte declarada" é estado honesto, não projeto órfão.
    const off = parseTaskSourceCommand("fonte de tarefas deste projeto: nenhuma")!;
    const planOff = planTaskSourceCommand({ command: off, projectDir: PROJ });
    assert.equal(planOff.ok && planOff.plan.remove, true);
    store.remove(PROJ);
    assert.equal(store.list().length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("G: uma pasta que escapa NUNCA chega a ser gravada", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-tsk-g-"));
  try {
    const store = new ProjectTaskBindingStore({ dir, platform: process.platform, now: () => 1 });
    const cmd = parseTaskSourceCommand("fonte de tarefas: ../fora")!;
    const planned = planTaskSourceCommand({ command: cmd, projectDir: PROJ });
    assert.equal(planned.ok, false);
    // O plano recusa ANTES do store: gravar e falhar depois deixaria o projeto apontando para o nada.
    assert.equal(store.list().length, 0);
    assert.ok(!resolve(PROJ, "..", "fora").startsWith(resolve(PROJ) + sep));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
