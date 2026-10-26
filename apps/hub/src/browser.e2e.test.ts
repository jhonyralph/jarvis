/**
 * E2E do browser remoto (BRW-IDE-00 F1) no Hub DE VERDADE, com auth ligada.
 *
 * Prova o que só o Hub inteiro prova: (1) owner-only — um MEMBRO com grant na máquina é recusado e a
 * tentativa vai para o audit.log; (2) a capacidade só aparece para o dono; (3) o roteamento até o
 * runner; (4) frames BINÁRIOS atravessam a conexão do runner e chegam ao cliente byte a byte, com o
 * crédito de 2 frames sem `fack`; (5) sem espectador o Hub não repassa e manda o produtor parar;
 * (6) o socket do espectador caindo desliga o screencast.
 *
 * O runner é falso (fala o protocolo) e o browser LOCAL do Hub fica desligado (`JARVIS_BROWSER=0`):
 * este teste não sobe Chrome nenhum — o Chrome de verdade é coberto em apps/runner/src/browser.integration.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { stopChild } from "../../../packages/core/src/fixtures/stop-child.js";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { RUNNER_PROTOCOL_VERSION } from "@jarvis/protocol";
import { decodeBrowserFrame, encodeBrowserFrame } from "@jarvis/core";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PAGE = "6F1C0FFEE0000000000000000000ABCD";

async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server));
  })));
  const ports = servers.map((server) => { const address = server.address(); return typeof address === "object" && address ? address.port : 0; });
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  return ports;
}

/** Caixa de entrada que separa JSON de binário (frames). */
class Inbox {
  readonly json: any[] = [];
  readonly binary: Buffer[] = [];
  private wake: (() => void) | undefined;
  constructor(readonly ws: WebSocket) {
    ws.on("message", (raw, isBinary) => {
      if (isBinary) this.binary.push(Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]));
      else { try { this.json.push(JSON.parse(raw.toString())); } catch { /* ignore */ } }
      this.wake?.();
    });
  }
  send(message: unknown): void { this.ws.send(JSON.stringify(message)); }
  async take(predicate: (message: any) => boolean, timeout = 15_000): Promise<any> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const index = this.json.findIndex(predicate); if (index >= 0) return this.json.splice(index, 1)[0];
      await new Promise<void>((resolve) => { const timer = setTimeout(resolve, Math.min(100, end - Date.now())); this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); }; });
    }
    throw new Error("timeout esperando frame; buffer=" + JSON.stringify(this.json.slice(-8)).slice(0, 2000));
  }
  async waitBinary(n: number, timeout = 10_000): Promise<void> {
    const end = Date.now() + timeout;
    while (this.binary.length < n) { if (Date.now() > end) throw new Error(`esperava ${n} frame(s) binário(s), chegaram ${this.binary.length}`); await new Promise((r) => setTimeout(r, 30)); }
  }
}

async function client(port: number): Promise<Inbox> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  return new Inbox(ws);
}

const frame = (seq: number) => encodeBrowserFrame({ pageId: PAGE, seq, t0: Date.now(), width: 1280, height: 800, quality: 60 }, Buffer.from([0xff, 0xd8, seq, 0xff, 0xd9]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("browser remoto no Hub: só o dono, roteamento, frames binários com crédito e fim do screencast", { timeout: 90_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-brw-e2e-"));
  mkdirSync(join(home, ".jarvis"), { recursive: true });
  const [hubPort, adminPort] = await freePorts(2);
  const hub = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], {
    cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, JARVIS_AUTH: "on", JARVIS_BROWSER: "0", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock",
      JARVIS_CWD: home, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test", JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort) },
  });
  let logs = ""; const add = (b: Buffer) => { logs = (logs + b.toString()).slice(-12000); };
  hub.stdout?.on("data", add); hub.stderr?.on("data", add);
  const sockets: WebSocket[] = [];
  try {
    const end = Date.now() + 20_000;
    for (;;) { try { if ((await fetch(`http://127.0.0.1:${hubPort}/health`)).ok) break; } catch { /* subindo */ } if (Date.now() > end) throw new Error("Hub não subiu:\n" + logs); await sleep(100); }

    // Dono: reivindica o Hub com o claim code do primeiro boot.
    const owner = await client(hubPort); sockets.push(owner.ws);
    const claimCode = readFileSync(join(home, ".jarvis", "claim-code.txt"), "utf8").trim();
    owner.send({ t: "claim", code: claimCode, label: "dono-teste" });
    await owner.take((m) => m.t === "authed" && m.user?.role === "owner");

    // Token da máquina + convite de MEMBRO com grant nessa máquina.
    owner.send({ t: "mint_runner", label: "Notebook" });
    const { runnerId, token } = await owner.take((m) => m.t === "runner_token");
    owner.send({ t: "sec_invite", role: "member", runners: [runnerId], ttlSec: 3600, label: "membro" });
    const { code: inviteCode } = await owner.take((m) => m.t === "sec_invite_created");

    // Runner falso com o protocolo atual e a capacidade.
    const rws = new WebSocket(`ws://127.0.0.1:${hubPort}/runner`); sockets.push(rws);
    await new Promise<void>((resolve, reject) => { rws.once("open", () => resolve()); rws.once("error", reject); });
    const runner = new Inbox(rws);
    runner.send({ t: "register", token, info: { runnerId, host: "nb", os: "linux", agents: ["mock"], agentDescriptors: [], agentUsage: {}, protocolVersion: RUNNER_PROTOCOL_VERSION, ide: true, version: "test", label: "Notebook", browser: true } });
    await runner.take((m) => m.t === "welcome");
    rws.on("message", (raw, isBinary) => { if (isBinary) return; try { const m = JSON.parse(raw.toString()); if (m.t === "ping") rws.send(JSON.stringify({ t: "pong" })); } catch { /* ignore */ } });

    const member = await client(hubPort); sockets.push(member.ws);
    member.send({ t: "redeem", code: inviteCode, label: "membro-teste" });
    await member.take((m) => m.t === "authed" && m.user?.role === "member");

    // Capacidade: o dono vê `browser:true` na máquina; o membro (mesmo com grant) não.
    owner.send({ t: "machines" });
    const om = await owner.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === runnerId && x.online));
    assert.equal(om.machines.find((x: any) => x.id === runnerId).browser, true);
    assert.equal(om.machines.find((x: any) => x.id === "local").browser, false, "JARVIS_BROWSER=0 no Hub: local sem browser");
    member.send({ t: "machines" });
    const mm = await member.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === runnerId));
    assert.equal(mm.machines.find((x: any) => x.id === runnerId).browser, false, "membro nem fica sabendo da capacidade");

    // Runner e app ANTIGOS ainda falam do VS Code (F4, removido em 2026-10-26) — Luby/Mac passam por isso
    // quando o Hub atualiza antes deles. O Hub novo descarta em silêncio e segue: o resto deste teste roda
    // depois disto, então um Hub que caísse ou travasse aqui o faria falhar.
    assert.equal(om.machines.find((x: any) => x.id === runnerId).ide, undefined, "o Hub não anuncia mais VS Code, mesmo com o runner dizendo ide:true");
    runner.send({ t: "ide_state", state: { status: "running", version: "4.141.0", installed: true } });
    rws.send(Buffer.from([0x54, 1, 0, 0, 0, 1]), { binary: true }); // frame do antigo túnel da IDE
    owner.send({ t: "ide_open", runnerId, reqId: "app-antigo" });

    // Membro com grant: recusado, nada chega à máquina, e fica no audit.log.
    member.send({ t: "browser_open", runnerId, reqId: "m1" });
    const denied = await member.take((m) => m.t === "browser_error");
    assert.match(denied.message, /dono/);
    member.send({ t: "browser_view", runnerId, pageId: PAGE, on: true, maxWidth: 800 });
    await member.take((m) => m.t === "browser_error");
    await sleep(300);
    assert.equal(runner.json.filter((m) => String(m.t).startsWith("browser_")).length, 0, "nenhuma operação do membro chegou ao runner");

    // Dono abre: o pedido chega ao runner, e o estado volta para o dono.
    owner.send({ t: "browser_open", runnerId, reqId: "o1" });
    const open = await runner.take((m) => m.t === "browser_open");
    assert.equal(open.reqId, "o1"); assert.equal(open.profile, "owner");
    runner.send({ t: "browser_state", reqId: "o1", state: { profile: "owner", running: true, pages: [{ pageId: PAGE, url: "https://example.com/", title: "Example" }], activePageId: PAGE } });
    const st = await owner.take((m) => m.t === "browser_state");
    assert.equal(st.runnerId, runnerId); assert.equal(st.pages[0].pageId, PAGE); assert.equal(st.reqId, "o1");
    assert.ok(!member.json.some((m) => m.t === "browser_state"), "membro não recebe estado");

    // Sem espectador: frame NÃO é repassado e o Hub manda o produtor parar.
    rws.send(frame(1), { binary: true });
    const stop = await runner.take((m) => m.t === "browser_view" && m.on === false);
    assert.equal(stop.pageId, PAGE);
    await sleep(200);
    assert.equal(owner.binary.length, 0);

    // Espectador liga: o runner é avisado com a largura da tela do espectador.
    owner.send({ t: "browser_view", runnerId, pageId: PAGE, on: true, maxWidth: 800, maxHeight: 600 });
    const on = await runner.take((m) => m.t === "browser_view" && m.on === true);
    assert.equal(on.maxWidth, 800); assert.equal(on.maxHeight, 600);

    // 5 frames sem fack → só 2 chegam (crédito); idênticos byte a byte.
    const sent = [2, 3, 4, 5, 6].map(frame);
    for (const f of sent) rws.send(f, { binary: true });
    await owner.waitBinary(2);
    await sleep(300);
    assert.equal(owner.binary.length, 2, "no máximo 2 sem confirmação");
    assert.deepEqual(owner.binary[0], sent[0], "repasse opaco: bytes idênticos");
    owner.send({ t: "browser_fack", runnerId, pageId: PAGE });
    await owner.waitBinary(3);
    assert.equal(decodeBrowserFrame(owner.binary[2])!.header.seq, 6, "depois do fack chega o MAIS RECENTE (3..5 descartados)");

    // Input chega ao runner já saneado (campo extra não atravessa).
    owner.send({ t: "browser_input", runnerId, pageId: PAGE, input: { kind: "mouse", type: "down", x: 10, y: 20, button: "left", evil: "x" } });
    const inp = await runner.take((m) => m.t === "browser_input");
    assert.deepEqual(inp.input, { kind: "mouse", type: "down", x: 10, y: 20, button: "left", modifiers: 0 });
    owner.send({ t: "browser_nav", runnerId, pageId: PAGE, url: "example.org" });
    assert.equal((await runner.take((m) => m.t === "browser_nav")).url, "example.org");

    // Erro do runner chega ao dono.
    runner.send({ t: "browser_error", pageId: PAGE, message: "aba ainda conectando" });
    assert.equal((await owner.take((m) => m.t === "browser_error")).message, "aba ainda conectando");

    // O espectador cai: o último saiu → screencast desligado.
    owner.ws.close();
    const off = await runner.take((m) => m.t === "browser_view" && m.on === false);
    assert.equal(off.pageId, PAGE);

    const audit = readFileSync(join(home, ".jarvis", "audit.log"), "utf8");
    assert.match(audit, /"event":"browser_denied"/, "recusa do membro auditada");
    assert.match(audit, /"event":"browser_open"/, "abertura auditada");
    assert.match(audit, /"event":"browser_nav"/, "navegação auditada");
  } finally {
    for (const s of sockets) { try { s.close(); } catch { /* ignore */ } }
    await stopChild(hub);
    for (let i = 0; i < 10; i++) { try { rmSync(home, { recursive: true, force: true }); break; } catch { await sleep(200); } }
  }
});
