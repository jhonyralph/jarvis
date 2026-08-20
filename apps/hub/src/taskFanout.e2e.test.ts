/**
 * E2E da fatia I — 1..N tarefas viram 1..N SUBSESSÕES de verdade.
 *
 * Os testes de unidade provam a decisão (`packages/core/src/task-fanout.test.ts`) e o vínculo durável
 * (`store.test.ts`). O que só um Hub de verdade prova é o resto: que o pedido do cliente cria sessões
 * reais, que elas aparecem na lista carregando a MÃE, e que os dois caminhos (seleção × interpretação)
 * de fato se excluem no servidor — com seleção, a resposta do modelo mock nem chega a ser lida.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server));
  })));
  const ports = servers.map((server) => { const address = server.address(); return typeof address === "object" && address ? address.port : 0; });
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  return ports;
}

function child(entry: string, env: NodeJS.ProcessEnv): { process: ChildProcess; logs: () => string } {
  const p = spawn(process.execPath, ["--import", "tsx", entry], { cwd: ROOT, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; const add = (b: Buffer) => { log = (log + b.toString()).slice(-12000); };
  p.stdout?.on("data", add); p.stderr?.on("data", add);
  return { process: p, logs: () => log };
}

async function stopChild(p: ChildProcess | undefined): Promise<void> {
  if (!p || p.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => p.once("exit", () => resolve()));
  if (process.platform === "win32" && p.pid) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else p.kill();
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
}

async function waitHealth(port: number, logs: () => string): Promise<void> {
  const end = Date.now() + 15_000;
  while (Date.now() < end) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch { /* subindo */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Hub não ficou saudável:\n" + logs());
}

class Inbox {
  private messages: any[] = [];
  private wake: (() => void) | undefined;
  constructor(readonly ws: WebSocket) { ws.on("message", (raw) => { try { this.messages.push(JSON.parse(raw.toString())); } catch { /* ignore */ } this.wake?.(); }); }
  send(message: unknown): void { this.ws.send(JSON.stringify(message)); }
  async take(predicate: (message: any) => boolean, timeout = 20_000): Promise<any> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const index = this.messages.findIndex(predicate); if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise<void>((resolve) => { const timer = setTimeout(resolve, Math.min(100, end - Date.now())); this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); }; });
    }
    throw new Error("timeout esperando frame; buffer=" + JSON.stringify(this.messages.slice(-8)));
  }
}

import { RUNNER_PROTOCOL_VERSION } from "@jarvis/protocol";

const SELECIONADAS = [
  { tracker: "local", key: "docs/features/a.md", title: "Tarefa A", description: "primeira" },
  { tracker: "local", key: "docs/features/b.md", title: "Tarefa B" },
  { tracker: "local", key: "docs/features/c.md", title: "Tarefa C" },
];

test("fan-out: 3 tarefas marcadas abrem 3 subsessões ligadas à mãe, e a seleção desliga o interpretador", { timeout: 70_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-fanout-e2e-"));
  mkdirSync(join(home, ".jarvis"), { recursive: true });
  const [hubPort, adminPort] = await freePorts(2);
  const env = {
    JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock",
    JARVIS_CWD: home, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test",
    JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort),
  };
  const hub = child("apps/hub/src/index.ts", env);
  let ws: WebSocket | undefined;
  try {
    await waitHealth(hubPort, hub.logs);
    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const inbox = new Inbox(ws);
    await inbox.take((m) => m.t === "version");

    inbox.send({ t: "new", agent: "mock", cwd: home });
    const mae = (await inbox.take((m) => m.t === "history" && m.session?.agent === "mock")).sessionId;

    // 1) PLANEJAR com 3 marcadas. A frase vai junto de propósito: o servidor tem de ignorá-la.
    inbox.send({ t: "task_fanout_plan", sessionId: mae, selected: SELECIONADAS, phrase: "e de quebra sobe a versão" });
    const plano = await inbox.take((m) => m.t === "task_fanout_plan");
    assert.equal(plano.ok, true, "seleção explícita não depende de modelo nenhum: " + JSON.stringify(plano));
    assert.equal(plano.origin, "selection");
    assert.equal(plano.tasks.length, 3);
    // O mock devolve `{"answer":...,"matches":[]}` — se o interpretador tivesse rodado, o plano teria
    // voltado como recusa ("não identifiquei nenhuma tarefa"). ok:true com 3 tarefas SÓ acontece se
    // o caminho do modelo nem foi cogitado.
    assert.match(plano.confirm, /Vou abrir 3 subsessões/);

    // 2) Planejar NÃO abre nada: a lista de sessões ainda tem só a mãe.
    inbox.send({ t: "list" });
    const antes = await inbox.take((m) => m.t === "sessions" && Array.isArray(m.sessions));
    assert.equal(antes.sessions.filter((s: any) => s.parentSessionId === mae).length, 0, "o plano não pode criar sessão");

    // 3) ABRIR o plano confirmado.
    inbox.send({ t: "task_fanout_open", planId: plano.planId });
    const aberto = await inbox.take((m) => m.t === "task_fanout_opened");
    assert.equal(aberto.ok, true, JSON.stringify(aberto));
    assert.equal(aberto.sessions.length, 3);
    assert.equal(aberto.origin, "selection");
    assert.deepEqual(aberto.sessions.map((s: any) => s.title), ["Tarefa A", "Tarefa B", "Tarefa C"]);

    // 4) O vínculo mãe→filha existe na LISTA, não só na resposta que abriu.
    inbox.send({ t: "list" });
    const depois = await inbox.take((m) => m.t === "sessions" && m.sessions?.some((s: any) => s.parentSessionId === mae));
    const filhas = depois.sessions.filter((s: any) => s.parentSessionId === mae);
    assert.equal(filhas.length, 3, "três subsessões, cada uma apontando para a mãe");
    assert.equal(new Set(filhas.map((s: any) => s.id)).size, 3, "ids distintos: são três conversas, não três apelidos");
    assert.equal(filhas.every((s: any) => s.id !== mae), true);

    // 5) Cada filha já nasce sabendo QUAL tarefa é, e a mãe registra o que abriu.
    inbox.send({ t: "open", sessionId: filhas.find((s: any) => s.title === "Tarefa A").id });
    const filhaA = await inbox.take((m) => m.t === "history" && m.sessionId === filhas.find((s: any) => s.title === "Tarefa A").id);
    assert.match(filhaA.messages[0].text, /Tarefa A/);
    assert.match(filhaA.messages[0].text, /docs\/features\/a\.md/);
    inbox.send({ t: "open", sessionId: mae });
    const historicoMae = await inbox.take((m) => m.t === "history" && m.sessionId === mae);
    assert.match(historicoMae.messages.map((x: any) => x.text).join("\n"), /Abri 3 subsessões/, "abrir em silêncio some do histórico de quem pediu");

    // 6) O MESMO plano não abre duas vezes (duplo clique não vira seis conversas).
    inbox.send({ t: "task_fanout_open", planId: plano.planId });
    const repetido = await inbox.take((m) => m.t === "task_fanout_opened" && m.ok === false);
    assert.match(repetido.error, /expirou/);

    // 7) SEM seleção, aí sim o interpretador roda — e a recusa do mock prova que ele foi consultado.
    inbox.send({ t: "task_fanout_plan", sessionId: mae, phrase: "corrige o login e atualiza o README" });
    const interpretado = await inbox.take((m) => m.t === "task_fanout_plan");
    assert.equal(interpretado.ok, false, "o mock não devolve tarefas — e um palpite não pode ser inventado no lugar");
    assert.match(String(interpretado.question || interpretado.error), /não identifiquei nenhuma tarefa/);
    assert.equal(interpretado.interpretedFrom, "corrige o login e atualiza o README");
  } finally {
    ws?.close();
    await stopChild(hub.process);
    // No Windows o `taskkill` volta ANTES de o SO soltar os handles do processo morto, e a faxina
    // estoura com EBUSY — falhando um teste cujo assunto é o comportamento do Hub, não o momento em
    // que o sistema libera arquivo. Tenta de novo e, se ainda assim não der, ignora: pasta temporária
    // que sobrou é lixo, não resultado.
    try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp é descartável */ }
  }
});

/* ── Fan-out na MAQUINA da sessao (protocolo 16) ─────────────────────────────────────────────────
   As filhas saiam de `store.ensure` do Hub, entao uma sessao remota so podia receber a recusa "abrir
   subsessoes ainda so funciona em sessao desta maquina". Criar aqui poria a conversa da tarefa numa
   maquina que nao e a do projeto — o mesmo engano que a listagem por projeto tirou de cena. */

test("fan-out remoto: quem cria as subsessoes e a maquina da sessao, nao o Hub", { timeout: 70_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-fanout-remoto-"));
  mkdirSync(join(home, ".jarvis"), { recursive: true });
  const [hubPort, adminPort] = await freePorts(2);
  const env = {
    JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock",
    JARVIS_CWD: home, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test",
    JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort),
  };
  const hub = child("apps/hub/src/index.ts", env);
  let ws: WebSocket | undefined, rws: WebSocket | undefined;
  try {
    await waitHealth(hubPort, hub.logs);

    // A maquina: protocolo 16, com uma sessao-mae cujo projeto vive NELA.
    rws = new WebSocket(`ws://127.0.0.1:${hubPort}/runner`);
    await new Promise<void>((resolve, reject) => { rws!.once("open", resolve); rws!.once("error", reject); });
    const runner = new Inbox(rws);
    runner.send({ t: "register", token: "", info: { runnerId: "maq-1", host: "maquina", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: "abc1234" } });
    await runner.take((m) => m.t === "welcome");
    runner.send({ t: "sessions", sessions: [{ id: "sess-mae", title: "Mae remota", agent: "mock", cwd: "/proj/app", updatedAt: Date.now() }] });

    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const inbox = new Inbox(ws);
    await inbox.take((m) => m.t === "version");
    inbox.send({ t: "runner", runnerId: "maq-1" });
    await new Promise((r) => setTimeout(r, 300));

    inbox.send({ t: "task_fanout_plan", sessionId: "sess-mae", selected: SELECIONADAS });
    const plano = await inbox.take((m) => m.t === "task_fanout_plan");
    assert.equal(plano.ok, true, "maquina no protocolo 16 nao recebe mais a recusa: " + JSON.stringify(plano));

    // A maquina responde a cada `new` como o runner de verdade faz: `history` com o reqId.
    const criadas: any[] = [];
    rws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === "new") { criadas.push(m); rws!.send(JSON.stringify({ t: "history", reqId: m.reqId, sessionId: "filha-" + criadas.length, title: m.title, agent: m.agent, cwd: m.cwd, writable: true, total: 0, messages: [] })); }
    });

    inbox.send({ t: "task_fanout_open", planId: plano.planId });
    const aberto = await inbox.take((m) => m.t === "task_fanout_opened");
    assert.equal(aberto.ok, true, JSON.stringify(aberto));
    assert.equal(aberto.runnerId, "maq-1", "a resposta diz em QUAL maquina elas nasceram");
    assert.equal(aberto.sessions.length, 3);
    assert.deepEqual(aberto.sessions.map((x: any) => x.sessionId), ["filha-1", "filha-2", "filha-3"],
      "os ids sao os que a MAQUINA gerou — o Hub nao inventa id de sessao que vive noutro disco");

    assert.equal(criadas.length, 3, "uma criacao por tarefa, na maquina");
    assert.equal(criadas[0].cwd, "/proj/app", "cwd herdado da mae: a subsessao e do MESMO projeto");
    assert.equal(criadas[0].agent, "mock", "e a mesma IA — cair no default abriria a conversa com outra");
    assert.equal(criadas[0].parentSessionId, "sess-mae", "a mae fica registrada la, nao aqui");
    assert.equal(criadas[0].title, "Tarefa A");
    assert.match(String(criadas[0].seed || ""), /Tarefa A/, "a filha nasce sabendo de que tarefa veio");

    // E o recado da mae vai para o disco DELA: sem isto, 3 conversas apareceriam na lista e a que as
    // pediu nao teria linha nenhuma sobre elas.
    const nota = await runner.take((m) => m.t === "session_note");
    assert.equal(nota.sessionId, "sess-mae");
    assert.match(String(nota.text || ""), /Tarefa A/);
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    try { rws?.close(); } catch { /* ignore */ }
    await stopChild(hub.process);
    try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows solta os handles com atraso */ }
  }
});
