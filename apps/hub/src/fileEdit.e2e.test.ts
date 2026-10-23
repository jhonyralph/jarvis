/**
 * E2E do BRW-IDE-00 F3 — o editor leve atravessando um Hub de verdade (porta livre, HOME temporária).
 *
 * O que só um Hub de pé prova: que `writefile`/`searchfiles` chegam à máquina CERTA (a do Hub, em
 * processo; a remota, por pendência com reqId do Hub), que a resposta volta com o reqId do CLIENTE,
 * que `readfile` aceita `runnerId` explícito, e que máquina em protocolo antigo é recusada com motivo.
 * As regras de dono/auditoria têm teste de unidade em `fileEdit.test.ts` (aqui a auth está desligada,
 * e o cliente local é dono por definição).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { RUNNER_PROTOCOL_VERSION, RUNNER_CAPABILITY_SINCE } from "@jarvis/protocol";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server));
  })));
  const ports = servers.map((server) => { const address = server.address(); return typeof address === "object" && address ? address.port : 0; });
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  return ports;
}

async function stopChild(p: ChildProcess | undefined): Promise<void> {
  if (!p || p.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => p.once("exit", () => resolve()));
  if (process.platform === "win32" && p.pid) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else p.kill();
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
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

async function fakeRunner(port: number, runnerId: string, protocolVersion: number): Promise<{ inbox: Inbox; seen: any[]; close: () => void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/runner`);
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  const inbox = new Inbox(ws);
  const seen: any[] = [];
  inbox.send({ t: "register", token: "", info: { runnerId, host: "maquina-" + runnerId, os: "linux", agents: ["mock"], agentDescriptors: [], agentUsage: {}, protocolVersion, version: "test", label: runnerId } });
  await inbox.take((m) => m.t === "welcome" || m.t === "update");
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m?.t === "writefile") { seen.push(m); inbox.send({ t: "filesaved", reqId: m.reqId, path: m.path, name: "remoto.ts", ok: true, mtimeMs: 4242, size: Buffer.byteLength(m.content) }); }
    if (m?.t === "searchfiles") { seen.push(m); inbox.send({ t: "searchresults", reqId: m.reqId, cwd: m.cwd, query: m.query, results: [{ path: "/srv/p/x.ts", rel: "x.ts", line: 9, col: 2, preview: "a " + m.query, hl: [2, 2 + m.query.length] }], truncated: false, engine: "rg" }); }
    if (m?.t === "readfile") { seen.push(m); inbox.send({ t: "filecontent", reqId: m.reqId, path: m.path, name: "remoto.ts", content: "remoto\n", size: 7, mtimeMs: 1, readOnlyReason: "teste" }); }
  });
  return { inbox, seen, close: () => ws.close() };
}

test("F3 e2e: gravar e buscar pelo Hub — máquina do Hub e máquina remota", { timeout: 90_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-f3-e2e-"));
  mkdirSync(join(home, ".jarvis"), { recursive: true });
  const proj = join(home, "proj"); mkdirSync(join(proj, "src"), { recursive: true });
  const file = join(proj, "src", "a.ts");
  writeFileSync(file, "export const v = 1;\r\n");
  const [hubPort, adminPort] = await freePorts(2);
  const env = {
    JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock",
    JARVIS_CWD: home, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test",
    JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort),
  };
  const hub = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], { cwd: ROOT, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; const add = (b: Buffer) => { logs = (logs + b.toString()).slice(-12000); };
  hub.stdout?.on("data", add); hub.stderr?.on("data", add);
  let ws: WebSocket | undefined;
  const maquinas: Array<{ close: () => void }> = [];
  try {
    const end = Date.now() + 20_000;
    for (;;) { try { if ((await fetch(`http://127.0.0.1:${hubPort}/health`)).ok) break; } catch { /* subindo */ } if (Date.now() > end) throw new Error("Hub não subiu:\n" + logs); await new Promise((r) => setTimeout(r, 100)); }
    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`);
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const c = new Inbox(ws);
    await c.take((m) => m.t === "version");

    // 1) Máquina do Hub: lê, grava com a versão lida, CRLF preservado, auditoria no audit.log.
    c.send({ t: "readfile", path: file, runnerId: "local" });
    const lido = await c.take((m) => m.t === "filecontent" && m.path === file);
    assert.equal(lido.readOnlyReason, undefined);
    c.send({ t: "writefile", reqId: "cli-1", runnerId: "local", path: file, content: "export const v = 2;\r\n", expectedMtimeMs: lido.mtimeMs, expectedSize: lido.size });
    const salvo = await c.take((m) => m.t === "filesaved" && m.reqId === "cli-1");
    assert.equal(salvo.ok, true, JSON.stringify(salvo));
    assert.equal(readFileSync(file, "utf8"), "export const v = 2;\r\n");
    assert.equal(salvo.mtimeMs, statSync(file).mtimeMs);

    // 2) A IA edita depois: salvar com a versão velha vira conflito e não grava.
    writeFileSync(file, "export const v = 3; // IA\r\n");
    const t = new Date(statSync(file).mtimeMs + 5000); utimesSync(file, t, t);
    c.send({ t: "writefile", reqId: "cli-2", runnerId: "local", path: file, content: "minha\r\n", expectedMtimeMs: salvo.mtimeMs, expectedSize: salvo.size });
    const conflito = await c.take((m) => m.t === "filesaved" && m.reqId === "cli-2");
    assert.equal(conflito.ok, false);
    assert.equal(conflito.conflict.mtimeMs, statSync(file).mtimeMs);
    assert.equal(readFileSync(file, "utf8"), "export const v = 3; // IA\r\n");

    // 3) Busca na máquina do Hub (worker ou rg, conforme a máquina).
    c.send({ t: "searchfiles", reqId: "cli-3", runnerId: "local", cwd: proj, query: "// ia" });
    const achou = await c.take((m) => m.t === "searchresults" && m.reqId === "cli-3");
    assert.equal(achou.error, undefined, JSON.stringify(achou));
    assert.deepEqual(achou.results.map((h: any) => `${h.rel}:${h.line}`), ["src/a.ts:1"]);

    // 4) Máquina remota em protocolo atual: encaminha com reqId do Hub e devolve o do cliente.
    const nova = await fakeRunner(hubPort, "notebook", RUNNER_PROTOCOL_VERSION); maquinas.push(nova);
    await c.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === "notebook" && x.online));
    c.send({ t: "writefile", reqId: "cli-4", runnerId: "notebook", path: "/srv/p/x.ts", cwd: "/srv/p", content: "abc", expectedMtimeMs: 1, expectedSize: 3 });
    const remoto = await c.take((m) => m.t === "filesaved" && m.reqId === "cli-4");
    assert.equal(remoto.ok, true); assert.equal(remoto.runnerId, "notebook"); assert.equal(remoto.mtimeMs, 4242);
    const visto = nova.seen.find((m) => m.t === "writefile");
    assert.ok(visto.reqId && visto.reqId !== "cli-4", "o runner recebe o reqId do Hub, não o do cliente");
    assert.equal(visto.expectedMtimeMs, 1); assert.equal(visto.content, "abc");
    c.send({ t: "searchfiles", reqId: "cli-5", runnerId: "notebook", cwd: "/srv/p", query: "foo" });
    const rbusca = await c.take((m) => m.t === "searchresults" && m.reqId === "cli-5");
    assert.equal(rbusca.results[0].line, 9); assert.equal(rbusca.engine, "rg");
    // readfile com runnerId explícito vai para a máquina pedida mesmo com o cliente roteado no Hub.
    c.send({ t: "readfile", path: "/srv/p/x.ts", runnerId: "notebook" });
    const rlido = await c.take((m) => m.t === "filecontent" && m.path === "/srv/p/x.ts");
    assert.equal(rlido.content, "remoto\n"); assert.equal(rlido.readOnlyReason, "teste");

    // 5) Máquina antes da capacidade: recusa com motivo, nenhum frame chega a ela.
    const velha = await fakeRunner(hubPort, "antiga", RUNNER_CAPABILITY_SINCE.fileWrite - 1); maquinas.push(velha);
    await c.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === "antiga"));
    c.send({ t: "writefile", reqId: "cli-6", runnerId: "antiga", path: "/x", content: "x", expectedMtimeMs: 1 });
    const recusa = await c.take((m) => m.t === "filesaved" && m.reqId === "cli-6");
    assert.equal(recusa.ok, false);
    assert.match(String(recusa.error), /protocolo|offline/);
    assert.equal(velha.seen.length, 0);

    // 6) Auditoria da máquina do Hub: caminho + bytes, nunca o conteúdo.
    const audit = readFileSync(join(home, ".jarvis", "audit.log"), "utf8");
    assert.match(audit, /"event":"file_write"/);
    assert.match(audit, /"event":"file_search"/);
    assert.doesNotMatch(audit, /export const v = 2/);
  } finally {
    for (const m of maquinas) m.close();
    ws?.close();
    await stopChild(hub);
    try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp é descartável */ }
  }
});
