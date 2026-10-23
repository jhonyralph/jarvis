import test from "node:test";
import assert from "node:assert/strict";
import { RUNNER_CAPABILITY_SINCE } from "@jarvis/protocol";
import {
  IdeAuth, buildSessionCookie, cleanIdeState, createIdeService, downstreamResponseHeaders, isIdeRunnerId, parseCookies, parseIdePath,
  runnerOffersIde, stripCookie, upstreamRequestHeaders, type IdeRunnerView,
} from "./ideGateway.js";

test("caminho /ide/<máquina>/…: prefixo, redirecionamento sem barra, ids recusados", () => {
  assert.deepEqual(parseIdePath("/ide/m-1a2b3c4d/static/x.js?v=1"), { runnerId: "m-1a2b3c4d", prefix: "/ide/m-1a2b3c4d", rest: "/static/x.js?v=1" });
  assert.deepEqual(parseIdePath("/ide/local/"), { runnerId: "local", prefix: "/ide/local", rest: "/" });
  assert.deepEqual(parseIdePath("/ide/local"), { runnerId: "local", prefix: "/ide/local", redirect: "/ide/local/" });
  assert.deepEqual(parseIdePath("/ide/local?folder=%2Fc%3A%2F"), { runnerId: "local", prefix: "/ide/local", redirect: "/ide/local/?folder=%2Fc%3A%2F" });
  assert.equal(parseIdePath("/idex/local/"), null);
  assert.equal(parseIdePath("/"), null);
  for (const bad of ["/ide/../x/", "/ide/%2e%2e/", "/ide//", "/ide/a%2Fb/", "/ide/" + "a".repeat(65) + "/", "/ide/.hidden/"]) assert.equal(parseIdePath(bad), null, bad);
  assert.equal(isIdeRunnerId("m-1234abcd"), true);
  assert.equal(isIdeRunnerId("Notebook do João"), false);
});

test("cabeçalhos para o code-server: Host ORIGINAL preservado, nosso cookie fora, hop-by-hop só no http", () => {
  const raw = ["Host", "meu-hub.ts.net", "Connection", "Upgrade", "Upgrade", "websocket", "Cookie", "jarvis_ide=SEGREDO; vscode-tkn=abc", "Sec-WebSocket-Key", "k==", "Origin", "https://meu-hub.ts.net", "Keep-Alive", "timeout=5"];
  assert.deepEqual(upstreamRequestHeaders(raw, "upgrade"), ["Host", "meu-hub.ts.net", "Connection", "Upgrade", "Upgrade", "websocket", "Cookie", "vscode-tkn=abc", "Sec-WebSocket-Key", "k==", "Origin", "https://meu-hub.ts.net", "Keep-Alive", "timeout=5"]);
  assert.deepEqual(upstreamRequestHeaders(raw, "http"), ["Host", "meu-hub.ts.net", "Cookie", "vscode-tkn=abc", "Sec-WebSocket-Key", "k==", "Origin", "https://meu-hub.ts.net"]);
  assert.deepEqual(upstreamRequestHeaders(["Host", "h", "Cookie", "jarvis_ide=x"], "http"), ["Host", "h"], "Cookie só com o nosso some inteiro");
  assert.equal(stripCookie("a=1; jarvis_ide=s; b=2"), "a=1; b=2");
  assert.equal(stripCookie("jarvis_ide_x=1"), "jarvis_ide_x=1", "só o nome exato");
  assert.equal(parseCookies("a=1; jarvis_ide=abc=; b").get("jarvis_ide"), "abc=");
});

test("resposta: Service-Worker-Allowed injetado (bug do code-server no Windows), Location com prefixo, hop-by-hop fora", () => {
  const ctx = { prefix: "/ide/local", path: "/stable-abc/static/out/vs/workbench/contrib/webview/browser/pre/serviceWorker.js?v=4" };
  const sw = downstreamResponseHeaders(["Content-Type", "text/javascript", "Transfer-Encoding", "chunked", "Connection", "keep-alive"], ctx);
  assert.deepEqual(sw, ["Content-Type", "text/javascript", "Service-Worker-Allowed", "/ide/local/"]);
  const sw2 = downstreamResponseHeaders(["Service-Worker-Allowed", "/"], ctx);
  assert.deepEqual(sw2, ["Service-Worker-Allowed", "/ide/local/"], "o do upstream (escopo errado) é trocado");
  const other = downstreamResponseHeaders(["Set-Cookie", "a=1", "Set-Cookie", "b=2"], { prefix: "/ide/local", path: "/x.js" });
  assert.deepEqual(other, ["Set-Cookie", "a=1", "Set-Cookie", "b=2"], "duplicatas preservadas; sem SW fora do serviceWorker.js");
  const loc = (v: string) => downstreamResponseHeaders(["Location", v], { prefix: "/ide/m-1", path: "/" })[1];
  assert.equal(loc("./?folder=x"), "./?folder=x");
  assert.equal(loc("/login?to=/"), "/ide/m-1/login?to=/");
  assert.equal(loc("/ide/m-1/ok"), "/ide/m-1/ok");
  assert.equal(loc("//evil.example/"), "//evil.example/");
  assert.equal(loc("https://x/"), "https://x/");
});

test("cookie de sessão: HttpOnly, SameSite=Strict, Path por máquina, Secure só com TLS", () => {
  const c = buildSessionCookie("V", "/ide/m-1", { secure: false, maxAgeSec: 86400 });
  assert.equal(c, "jarvis_ide=V; Path=/ide/m-1/; HttpOnly; SameSite=Strict; Max-Age=86400");
  assert.match(buildSessionCookie("V", "/ide/m-1", { secure: true, maxAgeSec: 1 }), /; Secure$/);
});

test("bilhete: uso único, expira em 60 s, preso à máquina; sessão expira e é revogável", () => {
  let now = 1_000_000;
  const auth = new IdeAuth({ now: () => now, sessionTtlMs: 3600_000 });
  const t = auth.mintTicket({ runnerId: "m-1", deviceId: "d1", userId: "u1", folder: "/c:/p" });
  assert.ok(t.length >= 40);
  const ok = auth.redeem(t, "m-1");
  assert.ok(!("error" in ok));
  if ("error" in ok) return;
  assert.equal(ok.folder, "/c:/p");
  assert.deepEqual(auth.redeem(t, "m-1"), { error: "bilhete inválido ou já usado" }, "uso único");
  const t2 = auth.mintTicket({ runnerId: "m-1", deviceId: "d1", userId: "u1", folder: "" });
  assert.deepEqual(auth.redeem(t2, "m-2"), { error: "bilhete de outra máquina" });
  assert.deepEqual(auth.redeem(t2, "m-1"), { error: "bilhete inválido ou já usado" }, "tentativa em outra máquina queima o bilhete");
  const t3 = auth.mintTicket({ runnerId: "m-1", deviceId: "d1", userId: "u1", folder: "" });
  now += 61_000;
  assert.deepEqual(auth.redeem(t3, "m-1"), { error: "bilhete expirado" });
  assert.deepEqual(auth.redeem(t3, "m-1"), { error: "bilhete inválido ou já usado" }, "e some");
  assert.deepEqual(auth.redeem("x".repeat(43), "m-1"), { error: "bilhete inválido ou já usado" });
  assert.equal(auth.check(ok.cookie, "m-1")?.deviceId, "d1");
  assert.equal(auth.check(ok.cookie, "m-2"), null, "cookie de uma máquina não vale em outra");
  assert.equal(auth.check("nada", "m-1"), null);
  let closed = 0;
  auth.check(ok.cookie, "m-1")!.closers.add(() => closed++);
  assert.equal(auth.revalidate((s) => s.deviceId !== "d1"), 1);
  assert.equal(closed, 1, "conexões abertas da sessão revogada fecham");
  assert.equal(auth.check(ok.cookie, "m-1"), null);
  const t4 = auth.mintTicket({ runnerId: "m-1", deviceId: "d1", userId: "u1", folder: "" });
  const s4 = auth.redeem(t4, "m-1");
  if ("error" in s4) throw new Error(s4.error);
  now += 3600_001;
  assert.equal(auth.check(s4.cookie, "m-1"), null, "sessão expira");
});

test("estado do runner é dado não confiável; capacidade exige protocolo ≥ 19 + ide:true", () => {
  assert.equal(cleanIdeState({ status: "hack" }), null);
  assert.equal(cleanIdeState(null), null);
  assert.deepEqual(cleanIdeState({ status: "installing", version: "4.141.0", installed: false, sizeBytes: 10, progress: { phase: "download", received: 5, total: 10 }, extra: "x", reason: "r".repeat(1000) }),
    { status: "installing", version: "4.141.0", installed: false, sizeBytes: 10, progress: { phase: "download", received: 5, total: 10 }, reason: "r".repeat(400) });
  assert.equal(RUNNER_CAPABILITY_SINCE.ideServer, 19);
  assert.equal(runnerOffersIde({ protocolVersion: 19, ide: true }), true);
  assert.equal(runnerOffersIde({ protocolVersion: 18, ide: true }), false);
  assert.equal(runnerOffersIde({ protocolVersion: 19 }), false);
});

test("serviço: membro recusado e auditado; dono abre → runner recebe ide_open → bilhete com a pasta em URI", () => {
  type Sock = { id: string; owner: boolean; out: any[] };
  const audits: Array<{ event: string; detail?: string }> = [];
  const toRunner: any[] = [];
  const view: IdeRunnerView = { online: true, os: "win32", protocolVersion: 19, ide: true, link: {}, sendJson: (o) => { toRunner.push(o); return true; }, sendBinary: () => {}, backlog: () => 0 };
  const svc = createIdeService<Sock>({
    authEnabled: true, localId: "local", localIde: null, localOs: "linux",
    isOwner: (ws) => ws.owner, actor: (ws) => ({ userId: "u-" + ws.id, deviceId: "d-" + ws.id }), canUseRunner: () => true, defaultRunner: () => "m-1",
    runner: (rid) => (rid === "m-1" ? view : null), send: (ws, f) => ws.out.push(f), isOpen: () => true, ownerDevice: () => true,
    audit: (event, info) => audits.push({ event, detail: info.detail }), clientIp: () => "1.2.3.4", originAllowed: () => true,
    guard: { blockedFor: () => 0, recordFail: () => ({ blocked: false }), recordSuccess: () => {}, connOpen: () => true, connClose: () => {} }, log: () => {},
  });
  const member: Sock = { id: "m", owner: false, out: [] };
  svc.handleClient(member, { t: "ide_open", runnerId: "m-1", reqId: "c1", cwd: "C:\\p" });
  svc.handleClient(member, { t: "ide_open", runnerId: "m-1", reqId: "c2" });
  assert.equal(member.out.length, 2);
  assert.equal(member.out[0].t, "ide_error");
  assert.match(member.out[0].message, /só do dono/);
  assert.equal(audits.filter((a) => a.event === "ide_denied").length, 1, "auditado, mas sem inundar o audit.log");
  assert.equal(toRunner.length, 0);
  assert.equal(svc.capable("m-1"), true);
  assert.equal(svc.capable("local"), false, "sem code-server local");

  const owner: Sock = { id: "o", owner: true, out: [] };
  svc.handleClient(owner, { t: "ide_open", runnerId: "m-1", reqId: "c3", cwd: "C:\\Users\\J\\proj" });
  assert.equal(toRunner.length, 1);
  assert.equal(toRunner[0].t, "ide_open");
  assert.notEqual(toRunner[0].reqId, "c3", "o reqId do cliente nunca vira chave no Hub");
  assert.ok(audits.some((a) => a.event === "ide_open" && a.detail === "C:\\Users\\J\\proj"));
  // runner responde que está de pé → o dono (e só ele) recebe o link com o bilhete
  svc.onRunnerState("m-1", { t: "ide_state", reqId: toRunner[0].reqId, state: { status: "running", version: "4.141.0", installed: true } });
  const ready = owner.out.find((f) => f.t === "ide_ready");
  assert.ok(ready, JSON.stringify(owner.out));
  assert.equal(ready.reqId, "c3");
  const m = /^\/ide\/m-1\/__jarvis_auth\?t=([A-Za-z0-9_-]+)$/.exec(ready.url);
  assert.ok(m, ready.url);
  const r = svc.auth.redeem(m![1], "m-1");
  assert.ok(!("error" in r) && r.folder === "/c:/Users/J/proj", JSON.stringify(r));
  // máquina que não responde: o pedido expira com erro (sem ficar pendurado)
  svc.handleClient(owner, { t: "ide_status", runnerId: "m-1", reqId: "c4" });
  svc.runnerOffline("m-1");
  assert.ok(owner.out.some((f) => f.t === "ide_error" && f.reqId === "c4" && /offline/.test(f.message)));
  svc.shutdown();
});
