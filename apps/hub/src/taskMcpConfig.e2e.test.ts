/**
 * E2E da TSK-12 — configurar o `task-mcp.json` de uma máquina PELA TELA.
 *
 * O que só um Hub de verdade prova: que o pedido do cliente chega à máquina CERTA, e que as guardas
 * (protocolo antigo, edição desligada, máquina offline) recusam com motivo — em vez de encaminhar um
 * frame que morreria em silêncio do outro lado.
 *
 * A máquina é FALSA de propósito: um WebSocket que fala o protocolo. O que está sob teste é o
 * roteamento e as guardas do Hub; validar e gravar é da máquina, e isso tem teste de unidade em
 * `packages/core/src/task-mcp.test.ts`.
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
// A versão vem da CONSTANTE: fixar o número aqui faz o teste quebrar a cada fatia que sobe o
// protocolo — e quebrar por motivo errado, porque o que ele testa não é a versão.
import { RUNNER_PROTOCOL_VERSION } from "@jarvis/protocol";



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

async function fakeRunner(port: number, opts: { runnerId: string; protocolVersion?: number; remoteEdit?: boolean; configFile?: string }): Promise<{ inbox: Inbox; close: () => void }> {

  // A máquina disca `/runner`; qualquer outro caminho o Hub trata como cliente de UI.

  const ws = new WebSocket(`ws://127.0.0.1:${port}/runner`);

  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });

  const inbox = new Inbox(ws);

  inbox.send({

    t: "register", token: "",

    info: {

      runnerId: opts.runnerId, host: "maquina-de-teste", os: "linux", agents: ["mock"], agentDescriptors: [], agentUsage: {},

      protocolVersion: opts.protocolVersion ?? RUNNER_PROTOCOL_VERSION, version: "test", label: "Máquina de teste", taskBridge: true,
      taskMcpServers: [], taskMcpConfigFile: opts.configFile ?? "/home/luby/.jarvis/task-mcp.json",
      taskMcpRemoteEdit: opts.remoteEdit !== false,

    },

  });

  // Máquina em protocolo antigo NÃO recebe `welcome`: o Hub a põe em quarentena de atualização e
  // manda `update`. Esperar só por `welcome` prenderia o teste no caso que ele quer cobrir.
  await inbox.take((m) => m.t === "welcome" || m.t === "update");
  // Ecoa como a máquina de verdade faria: a decisão de validar e gravar é dela, não do Hub.
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m?.t === "task_mcp_config" && typeof m.reqId === "string") {
      inbox.send({ t: "task_mcp_config", reqId: m.reqId, configFile: opts.configFile ?? "/home/luby/.jarvis/task-mcp.json", schemaVersion: 1, servers: [] });
      return;
    }
    if (m?.t === "task_mcp_config_set" && typeof m.reqId === "string") inbox.send({ t: "task_mcp_config_set", reqId: m.reqId, ok: true });
  });
  return { inbox, close: () => ws.close() };

}



test("configurar MCP pela tela: o pedido vai para a máquina certa, e as guardas recusam com motivo", { timeout: 70_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-mcpcfg-e2e-"));
  mkdirSync(join(home, ".jarvis"), { recursive: true });
  const [hubPort, adminPort] = await freePorts(2);
  const env = {
    JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock",
    JARVIS_CWD: home, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test",
    JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort),
  };
  const hub = child("apps/hub/src/index.ts", env);
  let ws: WebSocket | undefined;
  const maquinas: Array<{ close: () => void }> = [];
  try {
    await waitHealth(hubPort, hub.logs);
    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const cliente = new Inbox(ws);
    await cliente.take((m) => m.t === "version");

    const nova = await fakeRunner(hubPort, { runnerId: "luby", configFile: "/home/luby/.jarvis/task-mcp.json" });
    const velha = await fakeRunner(hubPort, { runnerId: "antiga", protocolVersion: RUNNER_PROTOCOL_VERSION - 1 });
    const trancada = await fakeRunner(hubPort, { runnerId: "trancada", remoteEdit: false });
    maquinas.push(nova, velha, trancada);
    await cliente.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === "trancada"));

    // 1) A tela mostra o caminho REAL de cada máquina - antes exibia o do Hub para todas.
    cliente.send({ t: "task_connections" });
    const conexoes = await cliente.take((m) => m.t === "task_connections" && m.mcpMachines?.some((x: any) => x.runnerId === "luby"));
    const luby = conexoes.mcpMachines.find((x: any) => x.runnerId === "luby");
    assert.equal(luby.configFile, "/home/luby/.jarvis/task-mcp.json", "caminho da máquina, não o do Hub");
    assert.equal(luby.editable, true);
    assert.equal(conexoes.mcpMachines.find((x: any) => x.runnerId === "antiga").editable, false, "protocolo 12 não ganha formulário");
    assert.equal(conexoes.mcpMachines.find((x: any) => x.runnerId === "trancada").editable, false, "chave desligada lá não ganha formulário");

    // 2) Salvar numa máquina apta chega até ela e volta ok.
    cliente.send({ t: "task_mcp_config_set", runnerId: "luby", name: "linear", server: { transport: { kind: "stdio", command: "npx" }, listTool: "list_issues" } });
    const salvo = await cliente.take((m) => m.t === "task_mcp_config_set" && m.runnerId === "luby");
    assert.equal(salvo.ok, true, JSON.stringify(salvo));

    // 3) Protocolo antigo: recusa com motivo, sem encaminhar frame que morreria lá.
    cliente.send({ t: "task_mcp_config_set", runnerId: "antiga", name: "x", server: { transport: { kind: "stdio", command: "npx" }, listTool: "l" } });
    const antiga = await cliente.take((m) => m.t === "task_mcp_config_set" && m.runnerId === "antiga");
    assert.equal(antiga.ok, false);
    assert.match(String(antiga.error), /atualize|configurada daqui/i);

    // 4) Edição desligada NAQUELA máquina: a recusa nomeia a chave, para o conserto ser óbvio.
    cliente.send({ t: "task_mcp_config_set", runnerId: "trancada", name: "x", server: { transport: { kind: "stdio", command: "npx" }, listTool: "l" } });
    const off = await cliente.take((m) => m.t === "task_mcp_config_set" && m.runnerId === "trancada");
    assert.equal(off.ok, false);
    assert.match(String(off.error), /JARVIS_TASK_MCP_REMOTE_EDIT/);

    // 5) Máquina que não existe: recusa em vez de silêncio — e o motivo distingue "não conheço" de
    // "conheço, mas está fora do ar". São conserto diferentes: parear vs. ligar a máquina.
    cliente.send({ t: "task_mcp_config_set", runnerId: "fantasma", name: "x", server: {} });
    const fantasma = await cliente.take((m) => m.t === "task_mcp_config_set" && m.runnerId === "fantasma");
    assert.equal(fantasma.ok, false);
    assert.match(String(fantasma.error), /não conheço/i);

    // 6) A máquina do Hub responde em processo, com validação de verdade: segredo em env é recusado.
    cliente.send({ t: "task_mcp_config_set", runnerId: "local", name: "ruim", server: { transport: { kind: "stdio", command: "npx", env: { GITHUB_TOKEN: "ghp_x" } }, listTool: "l" } });
    const ruim = await cliente.take((m) => m.t === "task_mcp_config_set" && m.runnerId === "local");
    assert.equal(ruim.ok, false);
    assert.match(String(ruim.error), /secretEnv/);
  } finally {
    for (const m of maquinas) m.close();
    ws?.close();
    await stopChild(hub.process);
    rmSync(home, { recursive: true, force: true });
  }
});
