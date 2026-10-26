/**
 * E2E da F2 (a IA no browser) no Hub DE VERDADE, com auth ligada e runner falso no protocolo 19.
 *
 * Prova o que só o Hub inteiro prova: (1) o turno do DONO chega à máquina com `browser:true` (o runner
 * entrega a ponte `jarvisbrowser` à IA) e o de um MEMBRO com grant na máquina chega SEM; (2) a
 * capacidade (`browserAgent`, `browserGrab`) só aparece para o dono; (3) "Deixar a IA dirigir" e
 * "Assumir" do dono chegam à máquina, e o estado que ela devolve vai a TODO socket de dono (o selo no
 * 🌐) com auditoria; membro tentando liberar é recusado e auditado; (4) cada ação da IA vai ao
 * audit.log sem conteúdo; (5) a seleção de pontos atravessa com o reqId do HUB (o do cliente nunca vira
 * chave) e volta ao cliente certo; (6) máquina com `JARVIS_BROWSER_AGENT=0` não ganha o perfil IA
 * (runner de protocolo antigo nem chega a tanto: o Hub o põe em quarentena de atualização).
 * Não sobe Chrome (JARVIS_BROWSER=0 no Hub; o runner é falso).
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

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PAGE = "6F1C0FFEE0000000000000000000ABCD";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server));
  })));
  const ports = servers.map((server) => { const address = server.address(); return typeof address === "object" && address ? address.port : 0; });
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  return ports;
}
class Inbox {
  readonly json: any[] = [];
  private wake: (() => void) | undefined;
  constructor(readonly ws: WebSocket) {
    ws.on("message", (raw, isBinary) => { if (!isBinary) { try { this.json.push(JSON.parse(raw.toString())); } catch { /* ignore */ } } this.wake?.(); });
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
}
async function client(port: number): Promise<Inbox> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  return new Inbox(ws);
}
async function fakeRunner(port: number, token: string, runnerId: string, protocolVersion: number, extra: Record<string, unknown>): Promise<Inbox> {
  const rws = new WebSocket(`ws://127.0.0.1:${port}/runner`);
  await new Promise<void>((resolve, reject) => { rws.once("open", () => resolve()); rws.once("error", reject); });
  const runner = new Inbox(rws);
  runner.send({ t: "register", token, info: { runnerId, host: "nb", os: "linux", agents: ["mock"], agentDescriptors: [], agentUsage: {}, protocolVersion, version: "test", label: "Notebook", browser: true, ...extra } });
  await runner.take((m) => m.t === "welcome");
  rws.on("message", (raw) => { try { const m = JSON.parse(raw.toString()); if (m.t === "ping") rws.send(JSON.stringify({ t: "pong" })); } catch { /* ignore */ } });
  return runner;
}

test("F2 no Hub: ponte só em turno do dono, nível 3 + Assumir, auditoria e seleção de pontos", { timeout: 120_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-brwagent-e2e-"));
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

    const owner = await client(hubPort); sockets.push(owner.ws);
    owner.send({ t: "claim", code: readFileSync(join(home, ".jarvis", "claim-code.txt"), "utf8").trim(), label: "dono-teste" });
    const authed = await owner.take((m) => m.t === "authed" && m.user?.role === "owner");
    owner.send({ t: "mint_runner", label: "Notebook" });
    const { runnerId, token } = await owner.take((m) => m.t === "runner_token");
    owner.send({ t: "mint_runner", label: "Antigo" });
    const old = await owner.take((m) => m.t === "runner_token");
    owner.send({ t: "sec_invite", role: "member", runners: [runnerId], ttlSec: 3600, label: "membro" });
    const { code: inviteCode } = await owner.take((m) => m.t === "sec_invite_created");

    const runner = await fakeRunner(hubPort, token, runnerId, RUNNER_PROTOCOL_VERSION, { browserAgent: true }); sockets.push(runner.ws);
    // máquina no protocolo atual com a IA DESLIGADA (JARVIS_BROWSER_AGENT=0): browser do dono sim, IA não.
    // (Runner de protocolo antigo nem chega aqui: o Hub o põe em quarentena de atualização.)
    const offRunner = await fakeRunner(hubPort, old.token, old.runnerId, RUNNER_PROTOCOL_VERSION, { browserAgent: false }); sockets.push(offRunner.ws);
    // um segundo socket do dono (outra aba, painel FECHADO) — também precisa ver o "IA no controle"
    const owner2 = await client(hubPort); sockets.push(owner2.ws);
    owner2.send({ t: "auth", token: authed.token });
    await owner2.take((m) => m.t === "authed" && m.user?.role === "owner");
    const member = await client(hubPort); sockets.push(member.ws);
    member.send({ t: "redeem", code: inviteCode, label: "membro-teste" });
    await member.take((m) => m.t === "authed" && m.user?.role === "member");

    // (2) capacidade só para o dono; máquina com a IA desligada não oferece o perfil IA
    owner.send({ t: "machines" });
    const om = await owner.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === runnerId && x.online) && m.machines?.some((x: any) => x.id === old.runnerId && x.online));
    const mine = om.machines.find((x: any) => x.id === runnerId), antigo = om.machines.find((x: any) => x.id === old.runnerId);
    assert.equal(mine.browserAgent, true); assert.equal(mine.browserGrab, true); assert.equal(mine.agentControl, 0);
    assert.equal(antigo.browser, true); assert.equal(antigo.browserAgent, false, "JARVIS_BROWSER_AGENT=0: sem IA no browser"); assert.equal(antigo.browserGrab, true, "a seleção de pontos é do dono: continua");
    member.send({ t: "machines" });
    const mm = await member.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === runnerId));
    const seen = mm.machines.find((x: any) => x.id === runnerId);
    assert.equal(seen.browserAgent, undefined, "membro nem fica sabendo"); assert.equal(seen.browserGrab, undefined);

    // (1) turno do dono → `browser:true`; do membro (com grant na máquina) → sem
    owner.send({ t: "runner", runnerId });
    await owner.take((m) => m.t === "sessions" && m.runnerId === runnerId, 5000).catch(() => null);
    owner.send({ t: "send", sessionId: "sess-dono", text: "abra o site e clique", msgId: "turn-owner-1" });
    const ownerTurn = await runner.take((m) => m.t === "send" && m.sessionId === "sess-dono");
    assert.equal(ownerTurn.browser, true, "turno do dono leva a ponte de browser");
    member.send({ t: "runner", runnerId });
    await member.take((m) => m.t === "sessions" && m.runnerId === runnerId, 5000).catch(() => null);
    member.send({ t: "send", sessionId: "sess-membro", text: "veja o browser do dono", msgId: "turn-member-1" });
    const memberTurn = await runner.take((m) => m.t === "send" && m.sessionId === "sess-membro", 8000).catch(() => null);
    assert.ok(memberTurn, "o turno do membro (com grant na máquina) chegou à máquina");
    assert.equal(memberTurn.browser, undefined, "turno de membro NUNCA leva a ponte");
    // (3) membro tentando liberar o nível 3: recusado, nada chega à máquina
    member.send({ t: "browser_agent_grant", runnerId, sessionId: "sess-membro", on: true });
    assert.match((await member.take((m) => m.t === "browser_error")).message, /dono/);
    // dono libera para a sessão: chega à máquina; o estado que ela devolve vai aos donos
    owner.send({ t: "browser_open", runnerId, profile: "owner", reqId: "o1" });
    await runner.take((m) => m.t === "browser_open" && m.profile === "owner");
    await owner.take((m) => m.t === "browser_agent_state" && m.runnerId === runnerId);
    owner.send({ t: "browser_agent_grant", runnerId, sessionId: "sess-dono", on: true });
    const grantMsg = await runner.take((m) => m.t === "browser_agent_grant");
    assert.deepEqual({ sessionId: grantMsg.sessionId, on: grantMsg.on }, { sessionId: "sess-dono", on: true });
    assert.equal(runner.json.filter((m) => m.t === "browser_agent_grant" && m.sessionId === "sess-membro").length, 0, "o pedido do membro não chegou");
    const grants = [{ sessionId: "sess-dono", profile: "owner", since: Date.now(), expiresAt: Date.now() + 1800000, turnActive: true }];
    runner.send({ t: "browser_agent_state", grants });
    const st = await owner.take((m) => m.t === "browser_agent_state" && m.runnerId === runnerId && m.grants?.length === 1);
    assert.equal(st.grants[0].sessionId, "sess-dono");
    await owner2.take((m) => m.t === "browser_agent_state" && m.runnerId === runnerId && m.grants?.length === 1);
    owner.send({ t: "machines" });
    const om2 = await owner.take((m) => m.t === "machines" && m.machines?.some((x: any) => x.id === runnerId && x.agentControl === 1));
    assert.ok(om2);
    await sleep(200);
    assert.equal(member.json.filter((m) => m.t === "browser_agent_state").length, 0, "membro não vê o estado");
    // perfil "IA" pedido pelo dono chega à máquina
    owner.send({ t: "browser_open", runnerId, profile: "agent", reqId: "o2" });
    await runner.take((m) => m.t === "browser_open" && m.profile === "agent");
    // perfil "IA" numa máquina com a IA desligada: recusado no Hub, nada chega a ela
    owner.send({ t: "browser_open", runnerId: old.runnerId, profile: "agent", reqId: "o3" });
    assert.match((await owner.take((m) => m.t === "browser_error" && m.reqId === "o3")).message, /IA não tem browser/);
    assert.equal(offRunner.json.filter((m) => m.t === "browser_open").length, 0);
    // (4) ação da IA → audit.log, sem conteúdo
    runner.send({ t: "browser_agent_action", action: { sessionId: "sess-dono", tool: "browser_type", profile: "owner", pageId: PAGE, ok: true, detail: "ref e5, 12 caractere(s)", at: Date.now() } });
    const shown = await owner.take((m) => m.t === "browser_agent_action" && m.tool === "browser_type");
    assert.equal(shown.detail, "ref e5, 12 caractere(s)");
    // Assumir: revoga tudo na máquina
    owner.send({ t: "browser_agent_revoke", runnerId });
    const take = await runner.take((m) => m.t === "browser_agent_grant" && m.all === true);
    assert.equal(take.on, false);
    runner.send({ t: "browser_agent_state", grants: [] });
    await owner.take((m) => m.t === "browser_agent_state" && m.runnerId === runnerId && m.grants?.length === 0);

    // (5) seleção de pontos: reqId do Hub até a máquina, o do cliente na volta
    owner.send({ t: "browser_grab", runnerId, pageId: PAGE, x: 10, y: 20, reqId: "client-grab-1" });
    const gr = await runner.take((m) => m.t === "browser_grab");
    assert.notEqual(gr.reqId, "client-grab-1", "o reqId do cliente não vira chave na máquina");
    assert.deepEqual({ pageId: gr.pageId, x: gr.x, y: gr.y }, { pageId: PAGE, x: 10, y: 20 });
    runner.send({ t: "browser_grab_result", reqId: gr.reqId, ok: true, grab: { url: "https://x/", tag: "button", selector: "#go", rect: { x: 1, y: 2, width: 3, height: 4 } } });
    const res = await owner.take((m) => m.t === "browser_grab_result");
    assert.equal(res.reqId, "client-grab-1"); assert.equal(res.ok, true); assert.equal(res.grab.selector, "#go");
    // resposta forjada com reqId desconhecido não vai a ninguém
    runner.send({ t: "browser_grab_result", reqId: "inventado", ok: true, grab: { url: "x" } });
    member.send({ t: "browser_grab", runnerId, pageId: PAGE, x: 1, y: 1, reqId: "m-grab" });
    assert.match((await member.take((m) => m.t === "browser_error")).message, /dono/);
    await sleep(300);
    assert.equal(owner.json.filter((m) => m.t === "browser_grab_result").length, 0);

    // auditoria: liberação, Assumir, ação da IA e a recusa do membro
    const audit = readFileSync(join(home, ".jarvis", "audit.log"), "utf8");
    assert.match(audit, /browser_agent_grant_request/);
    assert.match(audit, /browser_agent_grant_on/);
    assert.match(audit, /browser_agent_takeover/);
    assert.match(audit, /browser_agent_action[^\n]*browser_type[^\n]*sess-dono/);
    assert.match(audit, /browser_grab/);
    assert.match(audit, /browser_denied/);
  } finally {
    for (const s of sockets) { try { s.close(); } catch { /* ignore */ } }
    await stopChild(hub);
    rmSync(home, { recursive: true, force: true });
  }
});
