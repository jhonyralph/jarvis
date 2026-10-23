/**
 * E2E do VS Code por máquina (BRW-IDE-00 F4) no Hub DE VERDADE, com auth ligada.
 *
 * Prova o que só o Hub inteiro prova, sem baixar o code-server de 218 MB (o code-server real é coberto
 * por apps/runner/src/ide.integration.test.ts, opt-in):
 *   - owner-only: membro com grant recusado e auditado; capacidade só aparece para o dono;
 *   - bilhete de uso único → cookie HttpOnly/SameSite=Strict com Path por máquina; sem cookie = 401
 *     (HTTP e WebSocket); cookie de uma máquina não abre outra; Origin de fora = 403;
 *   - máquina REMOTA pelo túnel na conexão do runner (a ponta do runner é o módulo real
 *     `apps/runner/src/ide.ts` + `IdeManager` real com um code-server falso): HTTP, corpos grandes nos
 *     dois sentidos, Set-Cookie duplicado, Location com prefixo, Service-Worker-Allowed, Host original,
 *     WebSocket com mensagens grandes;
 *   - máquina do Hub (LOCAL) pelo proxy direto;
 *   - revogar o aparelho corta a IDE aberta nele; runner caindo derruba os streams; parar a IDE mata
 *     a árvore; e no fim nenhum processo do code-server falso sobra.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { RUNNER_PROTOCOL_VERSION } from "@jarvis/protocol";
import { IdeManager, listProcesses } from "@jarvis/core";
import { writeFakeCodeServer } from "../../../packages/core/src/fixtures/fake-code-server.js";
import { createRunnerIde } from "../../runner/src/ide.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; } };

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
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
}

class Inbox {
  readonly json: any[] = [];
  private wake: (() => void) | undefined;
  constructor(readonly ws: WebSocket) {
    ws.on("message", (raw, isBinary) => { if (isBinary) return; try { this.json.push(JSON.parse(raw.toString())); } catch { /* ignore */ } this.wake?.(); });
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
/** WebSocket da IDE (como o workbench abre); resolve com o socket ou com o status HTTP da recusa. */
function ideSocket(url: string, headers: Record<string, string>): Promise<WebSocket | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers, perMessageDeflate: false });
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => { resolve(res.statusCode || 0); ws.terminate(); });
    ws.once("error", () => resolve(-1));
  });
}
function echoOnce(ws: WebSocket, data: string | Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => { ws.once("message", (d) => resolve(Buffer.isBuffer(d) ? d : Buffer.from(d as ArrayBuffer))); ws.once("error", reject); ws.send(data); });
}
const pattern = (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = i % 251; return b; };

test("VS Code por máquina pelo Hub: só o dono, cookie por máquina, túnel HTTP+WS até o runner, LOCAL direto, revogação e limpeza", { timeout: 180_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-ide-e2e-"));
  mkdirSync(join(home, ".jarvis"), { recursive: true });
  const fakeCs = join(home, "fake-code-server");
  writeFakeCodeServer(fakeCs);
  const [hubPort, adminPort] = await freePorts(2);
  const base = `http://127.0.0.1:${hubPort}`;
  const hub = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], {
    cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, JARVIS_AUTH: "on", JARVIS_BROWSER: "0", JARVIS_IDE_CODE_SERVER: fakeCs, JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock",
      JARVIS_CWD: home, JARVIS_HOME: home, USERPROFILE: home, HOME: home, NODE_ENV: "test", JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort), JARVIS_VOICE_WARMUP: "0" },
  });
  let logs = ""; const add = (b: Buffer) => { logs = (logs + b.toString()).slice(-16000); };
  hub.stdout?.on("data", add); hub.stderr?.on("data", add);
  const sockets: WebSocket[] = [];
  const runnerMgr = new IdeManager({ rootDir: join(home, "runner-ide"), binDir: fakeCs, idleMs: 0, startTimeoutMs: 30_000 });
  const pidsSeen: number[] = [];
  try {
    const end = Date.now() + 25_000;
    for (;;) { try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* subindo */ } if (Date.now() > end) throw new Error("Hub não subiu:\n" + logs); await sleep(100); }

    const owner = await client(hubPort); sockets.push(owner.ws);
    owner.send({ t: "claim", code: readFileSync(join(home, ".jarvis", "claim-code.txt"), "utf8").trim(), label: "dono-1" });
    await owner.take((m) => m.t === "authed" && m.user?.role === "owner");
    owner.send({ t: "mint_runner", label: "Notebook" });
    const { runnerId, token } = await owner.take((m) => m.t === "runner_token");
    owner.send({ t: "sec_invite", role: "member", runners: [runnerId], ttlSec: 3600, label: "membro" });
    const { code: memberCode } = await owner.take((m) => m.t === "sec_invite_created");
    owner.send({ t: "sec_invite", role: "owner", ttlSec: 3600, label: "dono-2" });
    const { code: owner2Code } = await owner.take((m) => m.t === "sec_invite_created");

    // ---- runner "remoto": o módulo REAL do runner + IdeManager real com o code-server falso
    let rws: WebSocket;
    const runnerIde = createRunnerIde({
      manager: runnerMgr,
      sendJson: (m) => { if (rws.readyState === WebSocket.OPEN) rws.send(JSON.stringify(m)); },
      sendBinary: (f, compress) => { if (rws.readyState === WebSocket.OPEN) rws.send(f, { binary: true, compress }); },
      backlog: () => rws.bufferedAmount,
    });
    const connectRunner = async () => {
      rws = new WebSocket(`ws://127.0.0.1:${hubPort}/runner`); sockets.push(rws);
      await new Promise<void>((resolve, reject) => { rws.once("open", () => resolve()); rws.once("error", reject); });
      runnerIde.onConnect();
      const welcome = new Promise<void>((resolve) => {
        rws.on("message", (raw, isBinary) => {
          if (isBinary) { runnerIde.onFrame(Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[])); return; }
          let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
          if (m.t === "welcome") resolve();
          else if (m.t === "ping") rws.send(JSON.stringify({ t: "pong" }));
          else if (typeof m.t === "string" && m.t.startsWith("ide_")) void runnerIde.handleMessage(m);
        });
      });
      rws.on("close", () => runnerIde.onDisconnect());
      rws.send(JSON.stringify({ t: "register", token, info: { runnerId, host: "nb", os: "win32", agents: ["mock"], agentDescriptors: [], agentUsage: {}, protocolVersion: RUNNER_PROTOCOL_VERSION, version: "test", label: "Notebook", ide: true } }));
      await welcome;
    };
    await connectRunner();

    // ---- capacidade só para o dono; membro recusado e auditado
    owner.send({ t: "machines" });
    const machines = (await owner.take((m) => m.t === "machines" && m.machines.some((x: any) => x.id === runnerId))).machines;
    assert.equal(machines.find((x: any) => x.id === runnerId).ide, true);
    assert.equal(machines.find((x: any) => x.id === "local").ide, true, "LOCAL com JARVIS_IDE_CODE_SERVER");
    const member = await client(hubPort); sockets.push(member.ws);
    member.send({ t: "redeem", code: memberCode, label: "membro-teste" });
    await member.take((m) => m.t === "authed" && m.user?.role === "member");
    member.send({ t: "machines" });
    const mm = (await member.take((m) => m.t === "machines" && m.machines.some((x: any) => x.id === runnerId))).machines;
    assert.equal(mm.find((x: any) => x.id === runnerId).ide, false, "membro nem fica sabendo");
    member.send({ t: "ide_open", runnerId, reqId: "m1", cwd: "C:\\x" });
    assert.match((await member.take((m) => m.t === "ide_error" && m.reqId === "m1")).message, /só do dono/);

    // ---- sem cookie: nada passa
    const prefix = `/ide/${runnerId}`;
    assert.equal((await fetch(`${base}${prefix}/echo-headers`)).status, 401);
    const html = await fetch(`${base}${prefix}/`, { headers: { accept: "text/html" } });
    assert.equal(html.status, 401);
    assert.match(await html.text(), /Abra o VS Code desta máquina de novo pelo Jarvis/);
    assert.equal(await ideSocket(`ws://127.0.0.1:${hubPort}${prefix}/ws`, { origin: base }), 401);
    const noSlash = await fetch(`${base}${prefix}`, { redirect: "manual" });
    assert.equal(noSlash.status, 301);
    assert.equal(noSlash.headers.get("location"), `${prefix}/`);

    // ---- estado e abertura (dono)
    owner.send({ t: "ide_status", runnerId, reqId: "s1" });
    const st = await owner.take((m) => m.t === "ide_state" && m.reqId === "s1");
    assert.equal(st.state.status, "stopped");
    assert.equal(st.state.external, true);
    owner.send({ t: "ide_open", runnerId, reqId: "o1", cwd: "C:\\Users\\Dono\\proj" });
    const ready = await owner.take((m) => m.t === "ide_ready" && m.reqId === "o1", 40_000);
    assert.match(ready.url, new RegExp(`^${prefix}/__jarvis_auth\\?t=`));
    const redeem = await fetch(base + ready.url, { redirect: "manual" });
    assert.equal(redeem.status, 302);
    assert.equal(redeem.headers.get("location"), `${prefix}/?folder=${encodeURIComponent("/c:/Users/Dono/proj")}`, "pasta do Windows vira URI /c:/…");
    const setCookie = redeem.headers.get("set-cookie") || "";
    assert.match(setCookie, new RegExp(`^jarvis_ide=[A-Za-z0-9_-]{40,}; Path=${prefix}/; HttpOnly; SameSite=Strict; Max-Age=86400$`));
    const cookie = setCookie.split(";")[0];
    assert.equal((await fetch(base + ready.url, { redirect: "manual" })).status, 401, "bilhete é de uso único");

    // ---- HTTP pelo túnel
    const echo = await fetch(`${base}${prefix}/echo-headers?q=1`, { headers: { cookie: `${cookie}; outro=1` } });
    assert.equal(echo.status, 200);
    assert.deepEqual(echo.headers.getSetCookie(), ["a=1; Path=/", "b=2; Path=/"], "Set-Cookie duplicado atravessa");
    const eb = await echo.json();
    pidsSeen.push(eb.childPid);
    assert.equal(eb.url, "/echo-headers?q=1", "prefixo removido");
    const hv = (k: string) => eb.rawHeaders[eb.rawHeaders.findIndex((x: string, i: number) => i % 2 === 0 && x.toLowerCase() === k) + 1];
    assert.equal(hv("host"), `127.0.0.1:${hubPort}`, "Host ORIGINAL chega ao code-server");
    assert.equal(hv("cookie"), "outro=1", "o cookie do Jarvis não vai ao code-server");
    const big = await fetch(`${base}${prefix}/big?n=5000000`, { headers: { cookie } });
    const bigBody = Buffer.from(await big.arrayBuffer());
    assert.equal(bigBody.length, 5_000_000);
    assert.equal(sha(bigBody), sha(pattern(5_000_000)));
    const up = randomBytes(3 * 1024 * 1024);
    const posted = Buffer.from(await (await fetch(`${base}${prefix}/echo`, { method: "POST", body: up, headers: { cookie, "content-type": "application/octet-stream" } })).arrayBuffer());
    assert.equal(sha(posted), sha(up), "corpo de 3 MB para cima e de volta");
    const sw = await fetch(`${base}${prefix}/stable-x/static/serviceWorker.js?v=1`, { headers: { cookie } });
    assert.equal(sw.headers.get("service-worker-allowed"), `${prefix}/`);
    const loc = await fetch(`${base}${prefix}/go-root`, { headers: { cookie }, redirect: "manual" });
    assert.equal(loc.headers.get("location"), `${prefix}/login?x=1`);

    // ---- WebSocket pelo túnel
    const wsRemote = await ideSocket(`ws://127.0.0.1:${hubPort}${prefix}/stable-x?reconnectionToken=abc&skipWebSocketFrames=false`, { cookie, origin: base });
    assert.ok(wsRemote instanceof WebSocket, `upgrade recusado: ${wsRemote}`);
    sockets.push(wsRemote as WebSocket);
    assert.equal((await echoOnce(wsRemote as WebSocket, "olá túnel")).toString(), "olá túnel");
    const blob = randomBytes(300_000);
    assert.equal(sha(await echoOnce(wsRemote as WebSocket, blob)), sha(blob));
    assert.equal(await ideSocket(`ws://127.0.0.1:${hubPort}${prefix}/x`, { cookie, origin: "https://evil.example" }), 403, "Origin de fora");
    assert.equal(await ideSocket(`ws://127.0.0.1:${hubPort}/ide/local/x`, { cookie, origin: base }), 401, "cookie de uma máquina não abre outra");
    assert.equal((await fetch(`${base}/ide/local/echo-headers`, { headers: { cookie } })).status, 401);

    // ---- LOCAL (proxy direto)
    owner.send({ t: "ide_open", runnerId: "local", reqId: "o2", cwd: home });
    const readyLocal = await owner.take((m) => m.t === "ide_ready" && m.reqId === "o2", 40_000);
    const rl = await fetch(base + readyLocal.url, { redirect: "manual" });
    assert.equal(rl.status, 302);
    const cookieLocal = (rl.headers.get("set-cookie") || "").split(";")[0];
    const le = await (await fetch(`${base}/ide/local/echo-headers`, { headers: { cookie: cookieLocal } })).json();
    assert.equal(le.url, "/echo-headers");
    pidsSeen.push(le.childPid);
    const wsLocal = await ideSocket(`ws://127.0.0.1:${hubPort}/ide/local/ws`, { cookie: cookieLocal, origin: base });
    assert.ok(wsLocal instanceof WebSocket, `upgrade local recusado: ${wsLocal}`);
    sockets.push(wsLocal as WebSocket);
    const blob2 = randomBytes(200_000);
    assert.equal(sha(await echoOnce(wsLocal as WebSocket, blob2)), sha(blob2));
    const lbig = Buffer.from(await (await fetch(`${base}/ide/local/big?n=3000000`, { headers: { cookie: cookieLocal } })).arrayBuffer());
    assert.equal(sha(lbig), sha(pattern(3_000_000)));

    // ---- revogar o aparelho corta a IDE aberta nele
    const owner2 = await client(hubPort); sockets.push(owner2.ws);
    owner2.send({ t: "redeem", code: owner2Code, label: "dono-2" });
    await owner2.take((m) => m.t === "authed" && m.user?.role === "owner");
    owner2.send({ t: "ide_open", runnerId, reqId: "o3" });
    const ready2 = await owner2.take((m) => m.t === "ide_ready" && m.reqId === "o3", 40_000);
    const r2 = await fetch(base + ready2.url, { redirect: "manual" });
    assert.equal(r2.headers.get("location"), `${prefix}/`, "sem pasta: abre a última do code-server");
    const cookie2 = (r2.headers.get("set-cookie") || "").split(";")[0];
    const ws2 = await ideSocket(`ws://127.0.0.1:${hubPort}${prefix}/ws2`, { cookie: cookie2, origin: base });
    assert.ok(ws2 instanceof WebSocket);
    const ws2Closed = new Promise<void>((resolve) => (ws2 as WebSocket).once("close", () => resolve()));
    for (let i = owner.json.length - 1; i >= 0; i--) if (owner.json[i].t === "sec_state") owner.json.splice(i, 1); // estados velhos (antes do dono-2)
    owner.send({ t: "sec_state" });
    const sec = await owner.take((m) => m.t === "sec_state");
    const dev2 = sec.devices.find((d: any) => d.label === "dono-2");
    owner.send({ t: "sec_revoke_device", deviceId: dev2.id });
    await Promise.race([ws2Closed, sleep(5000).then(() => { throw new Error("WebSocket da IDE do aparelho revogado não fechou"); })]);
    assert.equal((await fetch(`${base}${prefix}/echo-headers`, { headers: { cookie: cookie2 } })).status, 401);
    assert.equal((await fetch(`${base}${prefix}/echo-headers`, { headers: { cookie } })).status, 200, "o outro aparelho segue");

    // ---- runner caindo derruba os streams; HTTP vira 502
    const remoteClosed = new Promise<void>((resolve) => (wsRemote as WebSocket).once("close", () => resolve()));
    rws!.terminate();
    await Promise.race([remoteClosed, sleep(5000).then(() => { throw new Error("WebSocket pelo túnel não caiu com o runner"); })]);
    const off = await fetch(`${base}${prefix}/echo-headers`, { headers: { cookie } });
    assert.equal(off.status, 502);
    assert.match(await off.text(), /offline/);
    // volta: o mesmo cookie vale (sessão é do Hub), túnel novo
    await connectRunner();
    assert.equal((await fetch(`${base}${prefix}/echo-headers`, { headers: { cookie } })).status, 200, "reconectou: túnel novo, mesma sessão");

    // ---- parar a IDE mata a árvore
    owner.send({ t: "ide_stop", runnerId: "local", reqId: "x1" });
    assert.equal((await owner.take((m) => m.t === "ide_state" && m.reqId === "x1")).state.status, "stopped");
    owner.send({ t: "ide_stop", runnerId, reqId: "x2" });
    assert.equal((await owner.take((m) => m.t === "ide_state" && m.reqId === "x2")).state.status, "stopped");
    await sleep(500);
    for (const pid of pidsSeen) assert.equal(pidAlive(pid), false, `processo ${pid} do code-server falso sobrou`);

    const audit = readFileSync(join(home, ".jarvis", "audit.log"), "utf8");
    for (const ev of ["ide_denied", "ide_open", "ide_session", "ide_auth_fail", "ide_origin_reject", "ide_stop"]) assert.match(audit, new RegExp(`"event":"${ev}"`), ev);
    assert.doesNotMatch(audit, /jarvis_ide=|__jarvis_auth\?t=/, "nenhum bilhete/cookie no audit.log");
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ignore */ } }
    runnerMgr.stopSync();
    await stopChild(hub);
    // nenhum processo do code-server falso pode sobrar (o watchdog/taskkill é o caminho real de saída)
    const rows = (await listProcesses(process.platform === "win32" ? "node.exe" : undefined)) || [];
    const left = rows.filter((r) => r.cmdline.includes(fakeCs));
    for (const r of left) { try { process.kill(r.pid); } catch { /* ignore */ } }
    for (let i = 0; i < 20; i++) { try { rmSync(home, { recursive: true, force: true }); break; } catch { await sleep(250); } }
    assert.deepEqual(left.map((r) => r.cmdline.slice(0, 160)), [], "processos órfãos do code-server falso");
  }
});
