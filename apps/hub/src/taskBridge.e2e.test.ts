/**
 * E2E da TSK-11 — a ponte de tarefas servida para uma máquina REMOTA.
 *
 * O que só um Hub de verdade prova: que o pedido chega amarrado à MÁQUINA que o fez (`rc.id`), e que
 * é o projeto DAQUELA máquina — não o `cwd` do Hub — que decide qual conta responde. Enquanto a ponte
 * só existia localmente, esse amarre era um default implícito (`LOCAL_ID`), correto por acidente.
 *
 * O runner aqui é FALSO de propósito: um WebSocket que se registra e fala o protocolo. Subir o runner
 * de verdade traria a ponte HTTP com porta efêmera e token que o teste não tem como ler — e o que
 * está sob teste é a decisão do Hub, não o transporte local da outra ponta.
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

/** Um runner de mentira que fala o protocolo: registra-se, responde `git_remote` e usa a ponte. */
async function fakeRunner(port: number, opts: { runnerId: string; cwdBySession: Record<string, string>; remoteUrl?: string }): Promise<{ inbox: Inbox; close: () => void }> {
  // A máquina disca `/runner`; qualquer outro caminho o Hub trata como cliente de UI.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/runner`);
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  const inbox = new Inbox(ws);
  inbox.send({
    t: "register", token: "",
    info: {
      runnerId: opts.runnerId, host: "maquina-de-teste", os: "linux", agents: ["mock"], agentDescriptors: [], agentUsage: {},
      protocolVersion: 12, version: "test", label: "Máquina de teste", taskBridge: true,
    },
  });
  await inbox.take((m) => m.t === "welcome");
  // A máquina publica suas sessões — é daqui que o Hub aprende a PASTA de cada sessão dela.
  inbox.send({ t: "sessions", sessions: Object.entries(opts.cwdBySession).map(([id, cwd]) => ({ id, agent: "mock", cwd, title: id, updatedAt: Date.now() })) });   // publicação espontânea
  const sessions = (): unknown => ({ t: "sessions", sessions: Object.entries(opts.cwdBySession).map(([id, cwd]) => ({ id, agent: "mock", cwd, title: id, updatedAt: Date.now() })) });
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    // Trocar de máquina no cliente faz o Hub PERGUNTAR a lista para ela; é dessa resposta que ele
    // aprende a pasta de cada sessão — e é a pasta que decide o vínculo do projeto.
    if (m?.t === "list") { inbox.send(sessions()); return; }
    // O remote vive no disco DESTA máquina; o Hub pergunta em vez de calcular no disco dele.
    if (m?.t === "git_remote" && typeof m.reqId === "string") inbox.send({ t: "git_remote", reqId: m.reqId, cwd: m.cwd, url: opts.remoteUrl });
  });
  return { inbox, close: () => ws.close() };
}

test("ponte de tarefas: a máquina que pede é a máquina que decide qual projeto responde", { timeout: 70_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-bridge-e2e-"));
  mkdirSync(join(home, ".jarvis"), { recursive: true });
  const projetoRemoto = join(home, "projeto-da-maquina");
  mkdirSync(projetoRemoto, { recursive: true });
  const [hubPort, adminPort] = await freePorts(2);
  const env = {
    JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock",
    JARVIS_CWD: home, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test",
    JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort),
  };
  const hub = child("apps/hub/src/index.ts", env);
  let ws: WebSocket | undefined;
  let runner: Awaited<ReturnType<typeof fakeRunner>> | undefined;
  try {
    await waitHealth(hubPort, hub.logs);
    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const cliente = new Inbox(ws);
    await cliente.take((m) => m.t === "version");

    // O projeto que vive NO HUB declara GitHub como fonte. É o vínculo que a máquina remota não pode
    // alcançar — se ela alcançar, escreve no board de um projeto que não é dela.
    cliente.send({ t: "new", agent: "mock", cwd: home });
    const sessaoLocal = (await cliente.take((m) => m.t === "history" && m.session?.agent === "mock")).sessionId;
    cliente.send({ t: "task_binding_set", sessionId: sessaoLocal, tracker: "github" });
    const vinculoLocal = await cliente.take((m) => m.t === "task_binding" && m.sessionId === sessaoLocal);
    assert.equal(vinculoLocal.binding.tracker, "github");

    runner = await fakeRunner(hubPort, { runnerId: "maquina-remota", cwdBySession: { "s-remota": projetoRemoto }, remoteUrl: undefined });
    await cliente.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === "maquina-remota"));

    // 1) CONTENÇÃO: a máquina remota pede tarefa para uma sessão CUJO PROJETO não declarou fonte.
    // O vínculo de github existe — mas é do projeto do Hub. A resposta tem de falar do projeto DELA.
    runner.inbox.send({ t: "task_bridge", reqId: "r1", sessionId: "s-remota", op: "search", args: { query: "login" } });
    const recusa = await runner.inbox.take((m) => m.t === "task_bridge_result" && m.reqId === "r1");
    assert.equal(recusa.ok, false, "sem fonte declarada no projeto DELA, não há conta a usar");
    assert.match(String(recusa.error), /fonte|declar/i, "e a recusa diz o motivo: " + JSON.stringify(recusa));
    assert.equal(recusa.connection, undefined, "nenhuma conexão do projeto do Hub vaza para a máquina");

    // 2) O mesmo pedido, agora com o projeto DA MÁQUINA declarando sua própria fonte: a recusa muda de
    // motivo (falta conta vinculada), provando que o Hub passou a olhar para o vínculo certo.
    cliente.send({ t: "runner", runnerId: "maquina-remota" });
    await cliente.take((m) => m.t === "sessions" && m.runnerId === "maquina-remota");
    cliente.send({ t: "task_binding_set", sessionId: "s-remota", tracker: "jira" });
    const vinculoRemoto = await cliente.take((m) => m.t === "task_binding" && m.sessionId === "s-remota");
    assert.equal(vinculoRemoto.cwd, projetoRemoto, "o vínculo foi gravado pela pasta da MÁQUINA, não pela do Hub");

    runner.inbox.send({ t: "task_bridge", reqId: "r2", sessionId: "s-remota", op: "search", args: { query: "login" } });
    const semConta = await runner.inbox.take((m) => m.t === "task_bridge_result" && m.reqId === "r2");
    assert.equal(semConta.ok, false);
    assert.match(String(semConta.error), /conta|conex/i, "agora o motivo é a conta que falta, não a fonte: " + JSON.stringify(semConta));

    // 3) Entrega duplicada do MESMO reqId não vira duas respostas.
    runner.inbox.send({ t: "task_bridge", reqId: "r3", sessionId: "s-remota", op: "search", args: { query: "x" } });
    await runner.inbox.take((m) => m.t === "task_bridge_result" && m.reqId === "r3");
    runner.inbox.send({ t: "task_bridge", reqId: "r3", sessionId: "s-remota", op: "search", args: { query: "x" } });
    const segunda = await runner.inbox.take((m) => m.t === "task_bridge_result" && m.reqId === "r3", 3_000).catch(() => null);
    assert.ok(segunda !== null, "o Hub responde de novo (o dono da resposta é o runner, por reqId)");

    // 4) Criar falha FECHADO e com código: sem conta verificada não existe escrita, e o motivo é
    // sempre o primeiro que impede — nunca um sucesso silencioso nem uma recusa sem nome.
    runner.inbox.send({ t: "task_bridge", reqId: "r4", sessionId: "s-remota", op: "create", args: { title: "Nova" } });
    const semEscrita = await runner.inbox.take((m) => m.t === "task_bridge_result" && m.reqId === "r4");
    assert.equal(semEscrita.ok, false);
    assert.equal(semEscrita.code, "NO_CONNECTION", "a conta vem antes do destino: " + JSON.stringify(semEscrita));
    assert.ok(String(semEscrita.error || "").length > 10, "recusa com motivo legível, não só código");
  } finally {
    runner?.close();
    ws?.close();
    await stopChild(hub.process);
    rmSync(home, { recursive: true, force: true });
  }
});
