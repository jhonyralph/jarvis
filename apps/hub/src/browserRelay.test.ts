import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeBrowserFrame, decodeBrowserFrame } from "@jarvis/core";
import { RUNNER_CAPABILITY_SINCE } from "@jarvis/protocol";
import { BROWSER_CREDIT_TIMEOUT_MS, BROWSER_MAX_INFLIGHT, BrowserProfilePages, BrowserRelay, browserAccess, browserToolsForTurn, parseBrowserClientMessage, runnerHasBrowser, runnerHasBrowserAgent, runnerHasBrowserGrab, sanitizeBrowserInput } from "./browserRelay.js";

const P1 = "AAAA1111", P2 = "BBBB2222";
const frame = (pageId: string, seq: number) => encodeBrowserFrame({ pageId, seq, t0: 0, width: 1280, height: 800, quality: 60 }, Buffer.from([0xff, 0xd8, seq & 0xff]));
const seqOf = (b: Buffer) => decodeBrowserFrame(b)!.header.seq;

function setup(opts: { canView?: (v: string) => boolean } = {}) {
  let now = 1000;
  const sent: Array<{ viewer: string; frame: Buffer }> = [];
  const producer: Array<{ runnerId: string; pageId: string; on: boolean; maxWidth: number }> = [];
  const feedback: Array<{ pageId: string; delivered: number; dropped: number }> = [];
  const idle: any[] = [];
  const relay = new BrowserRelay<string>({
    sendFrame: (viewer, f) => sent.push({ viewer, frame: f }),
    setProducer: (runnerId, pageId, on, dims) => producer.push({ runnerId, pageId, on, maxWidth: dims.maxWidth }),
    feedback: (_r, pageId, delivered, dropped) => feedback.push({ pageId, delivered, dropped }),
    canView: opts.canView,
    onPageIdle: (s) => idle.push(s),
    now: () => now,
  });
  return { relay, sent, producer, feedback, idle, advance: (ms: number) => { now += ms; } };
}

test("relay: repassa o MESMO Buffer (opaco) e conta espectadores por aba", () => {
  const s = setup();
  s.relay.view("a", "r1", P1, { maxWidth: 800, maxHeight: 600 });
  assert.deepEqual(s.producer, [{ runnerId: "r1", pageId: P1, on: true, maxWidth: 800 }], "primeiro espectador liga o produtor");
  const f = frame(P1, 1);
  assert.equal(s.relay.onFrame("r1", f), "relayed");
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].frame, f, "mesma referência: nada de copiar nem re-encodar");
  s.relay.view("b", "r1", P1, { maxWidth: 1600, maxHeight: 900 });
  assert.equal(s.producer.at(-1)!.maxWidth, 1600, "a maior tela manda");
  assert.equal(s.sent.at(-1)!.viewer, "b", "quem chega recebe o último frame na hora");
  s.relay.unview("b");
  assert.equal(s.producer.at(-1)!.maxWidth, 800, "saiu a tela grande → produtor reduz");
  assert.equal(s.relay.viewerCount("r1", P1), 1);
  s.relay.unview("a");
  assert.deepEqual(s.producer.at(-1), { runnerId: "r1", pageId: P1, on: false, maxWidth: 800 }, "último espectador saiu → produtor para");
  assert.equal(s.relay.activePages, 0);
  assert.equal(s.idle.length, 1);
  assert.equal(s.idle[0].delivered, 2);
});

test("relay: crédito — no máximo 2 sem fack; acima disso só o MAIS RECENTE fica guardado", () => {
  const s = setup();
  s.relay.view("slow", "r1", P1, { maxWidth: 800, maxHeight: 600 });
  for (let i = 1; i <= 10; i++) s.relay.onFrame("r1", frame(P1, i));
  assert.equal(s.sent.length, BROWSER_MAX_INFLIGHT, "só 2 em voo");
  assert.deepEqual(s.sent.map((x) => seqOf(x.frame)), [1, 2]);
  s.relay.ack("slow", P1);
  assert.equal(s.sent.length, 3);
  assert.equal(seqOf(s.sent[2].frame), 10, "o guardado é o mais recente — 3..9 foram descartados");
  s.relay.ack("slow", P1);
  assert.equal(s.sent.length, 3, "nada guardado → nada a mandar");
  s.relay.tick();
  assert.deepEqual(s.feedback, [{ pageId: P1, delivered: 3, dropped: 7 }], "retorno de qualidade para o produtor");
  s.relay.tick();
  assert.equal(s.feedback.length, 1, "janela sem tráfego não gera retorno");
});

test("relay: espectador rápido não é freado pelo lento", () => {
  const s = setup();
  s.relay.view("fast", "r1", P1, { maxWidth: 800, maxHeight: 600 });
  s.relay.view("slow", "r1", P1, { maxWidth: 800, maxHeight: 600 });
  for (let i = 1; i <= 6; i++) { s.relay.onFrame("r1", frame(P1, i)); s.relay.ack("fast", P1); }
  assert.equal(s.sent.filter((x) => x.viewer === "fast").length, 6);
  assert.equal(s.sent.filter((x) => x.viewer === "slow").length, 2);
});

test("relay: fack de outra aba não dá crédito; trocar de aba move o espectador", () => {
  const s = setup();
  s.relay.view("a", "r1", P1, { maxWidth: 800, maxHeight: 600 });
  s.relay.onFrame("r1", frame(P1, 1)); s.relay.onFrame("r1", frame(P1, 2));
  s.relay.view("a", "r1", P2, { maxWidth: 800, maxHeight: 600 });
  assert.ok(s.producer.some((p) => p.pageId === P1 && !p.on), "a aba antiga parou (ninguém mais nela)");
  assert.ok(s.producer.some((p) => p.pageId === P2 && p.on));
  s.relay.onFrame("r1", frame(P2, 1)); s.relay.onFrame("r1", frame(P2, 2)); s.relay.onFrame("r1", frame(P2, 3));
  const before = s.sent.length;
  s.relay.ack("a", P1); // atrasado, da aba velha
  assert.equal(s.sent.length, before, "fack da aba antiga ignorado");
  s.relay.ack("a", P2);
  assert.equal(s.sent.length, before + 1);
});

test("relay: sem espectador, frame NÃO é repassado e o produtor é lembrado de parar (com folga)", () => {
  const s = setup();
  assert.equal(s.relay.onFrame("r1", frame(P1, 1)), "unwatched");
  assert.equal(s.relay.onFrame("r1", frame(P1, 2)), "unwatched");
  assert.equal(s.sent.length, 0);
  assert.equal(s.producer.filter((p) => !p.on).length, 1, "um lembrete, não um por frame");
  s.advance(2500);
  s.relay.onFrame("r1", frame(P1, 3));
  assert.equal(s.producer.filter((p) => !p.on).length, 2);
  assert.equal(s.relay.onFrame("r1", Buffer.from("lixo")), "invalid");
});

test("relay: crédito preso (fack perdido) destrava depois do timeout", () => {
  const s = setup();
  s.relay.view("a", "r1", P1, { maxWidth: 800, maxHeight: 600 });
  for (let i = 1; i <= 4; i++) s.relay.onFrame("r1", frame(P1, i));
  assert.equal(s.sent.length, 2);
  s.advance(BROWSER_CREDIT_TIMEOUT_MS - 1); s.relay.tick();
  assert.equal(s.sent.length, 2, "ainda dentro do prazo");
  s.advance(2); s.relay.tick();
  assert.equal(s.sent.length, 3);
  assert.equal(seqOf(s.sent[2].frame), 4);
});

test("relay: socket que perdeu o direito (deixou de ser dono) não recebe; máquina offline limpa tudo", () => {
  let allowed = true;
  const s = setup({ canView: () => allowed });
  s.relay.view("a", "r1", P1, { maxWidth: 800, maxHeight: 600 });
  s.relay.view("b", "r2", P2, { maxWidth: 800, maxHeight: 600 });
  allowed = false;
  s.relay.onFrame("r1", frame(P1, 1));
  assert.equal(s.sent.length, 0);
  allowed = true;
  const affected = s.relay.dropRunner("r1");
  assert.deepEqual(affected, ["a"]);
  assert.equal(s.relay.viewing("a"), undefined);
  assert.deepEqual(s.relay.viewing("b"), { runnerId: "r2", pageId: P2 });
  assert.equal(s.relay.onFrame("r1", frame(P1, 2)), "unwatched");
  const st = s.relay.stats();
  assert.equal(st.pages, 1); assert.equal(st.viewers, 1);
});

test("gate: browser é só do dono — membro recusado mesmo com grant; auth desligada = local confiável", () => {
  assert.deepEqual(browserAccess({ authEnabled: true, role: "owner" }), { ok: true });
  assert.equal(browserAccess({ authEnabled: true, role: "member" }).ok, false);
  assert.equal(browserAccess({ authEnabled: true, role: undefined }).ok, false);
  assert.deepEqual(browserAccess({ authEnabled: false, role: "member" }), { ok: true });
});

test("capacidade: só máquina com protocolo ≥ 18 E navegador declarado", () => {
  assert.equal(RUNNER_CAPABILITY_SINCE.remoteBrowser, 18);
  assert.equal(runnerHasBrowser({ protocolVersion: 18, browser: true }), true);
  assert.equal(runnerHasBrowser({ protocolVersion: 17, browser: true }), false, "runner antigo não oferece");
  assert.equal(runnerHasBrowser({ protocolVersion: 18, browser: false }), false, "kill switch / sem Chrome");
  assert.equal(runnerHasBrowser({ protocolVersion: 18 }), false);
  assert.equal(runnerHasBrowser(undefined), false);
});

test("mensagens do cliente: validação e forma canônica", () => {
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_view", runnerId: "r1", pageId: P1, maxWidth: 99999, maxHeight: 5 }, "local"), { op: "view", runnerId: "r1", pageId: P1, on: true, dims: { maxWidth: 3840, maxHeight: 120 } });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_view", pageId: P1, on: false }, "local"), { op: "view", runnerId: "local", pageId: P1, on: false, dims: { maxWidth: 1280, maxHeight: 1280 } });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_nav", pageId: P1, action: "back" }, "local"), { op: "nav", runnerId: "local", pageId: P1, action: "back" });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_nav", pageId: P1, url: "example.com" }, "local"), { op: "nav", runnerId: "local", pageId: P1, url: "example.com" });
  assert.ok("error" in parseBrowserClientMessage({ t: "browser_nav", pageId: P1, action: "rm -rf" }, "local"));
  assert.ok("error" in parseBrowserClientMessage({ t: "browser_nav", pageId: "../../x", url: "a.b" }, "local"), "pageId fora do formato");
  assert.ok("error" in parseBrowserClientMessage({ t: "browser_tab", op: "close" }, "local"), "fechar exige aba");
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_tab", op: "new", url: "a.b" }, "local"), { op: "tab", runnerId: "local", tab: "new", profile: "owner", url: "a.b" });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_viewport", pageId: P1, width: 0 }, "local"), { op: "viewport", runnerId: "local", pageId: P1 });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_viewport", pageId: P1, width: 390, height: 700, mobile: true, scale: 9 }, "local"), { op: "viewport", runnerId: "local", pageId: P1, width: 390, height: 700, mobile: true, scale: 3 });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_dialog", pageId: P1, accept: true, promptText: "x" }, "local"), { op: "dialog", runnerId: "local", pageId: P1, accept: true, promptText: "x" });
  assert.ok("error" in parseBrowserClientMessage({ t: "browser_wat" }, "local"));
  const open = parseBrowserClientMessage({ t: "browser_open", runnerId: "r2" }, "local") as any;
  assert.equal(open.op, "open"); assert.equal(open.runnerId, "r2"); assert.ok(open.reqId);
});

test("input do cliente: só campos conhecidos, números grampeados, lixo recusado", () => {
  assert.deepEqual(sanitizeBrowserInput({ kind: "mouse", type: "down", x: 1, y: 2, button: "left", clickCount: 9, evil: "x" }), { kind: "mouse", type: "down", x: 1, y: 2, button: "left", clickCount: 3, modifiers: 0 });
  assert.equal(sanitizeBrowserInput({ kind: "mouse", type: "down", x: "a", y: 2 }), null);
  assert.deepEqual(sanitizeBrowserInput({ kind: "wheel", x: 1, y: 2, dy: 30 }), { kind: "wheel", x: 1, y: 2, dx: 0, dy: 30, modifiers: 0 });
  assert.deepEqual(sanitizeBrowserInput({ kind: "key", type: "down", key: "Enter", code: "Enter", modifiers: 99 }), { kind: "key", type: "down", key: "Enter", code: "Enter", modifiers: 15 });
  assert.equal(sanitizeBrowserInput({ kind: "key", type: "down", key: "x".repeat(40) }), null);
  assert.deepEqual(sanitizeBrowserInput({ kind: "text", text: "olá" }), { kind: "text", text: "olá" });
  assert.equal(sanitizeBrowserInput({ kind: "text", text: "" }), null);
  assert.equal(sanitizeBrowserInput(null), null);
  assert.equal(sanitizeBrowserInput({ kind: "exec" }), null);
});

// ---------------------------------------------------------------------------- F2: a IA no browser

test("F2 — capacidades: ferramentas da IA e seleção de pontos só em runner 19 com browser", () => {
  assert.equal(RUNNER_CAPABILITY_SINCE.browserAgentTools, 19);
  assert.equal(RUNNER_CAPABILITY_SINCE.browserGrab, 19);
  assert.equal(runnerHasBrowserAgent({ protocolVersion: 19, browser: true, browserAgent: true }), true);
  assert.equal(runnerHasBrowserAgent({ protocolVersion: 18, browser: true, browserAgent: true }), false, "runner da F1 não oferece");
  assert.equal(runnerHasBrowserAgent({ protocolVersion: 19, browser: true, browserAgent: false }), false, "JARVIS_BROWSER_AGENT=0");
  assert.equal(runnerHasBrowserAgent({ protocolVersion: 19, browser: false, browserAgent: true }), false, "sem navegador");
  assert.equal(runnerHasBrowserGrab({ protocolVersion: 19, browser: true }), true);
  assert.equal(runnerHasBrowserGrab({ protocolVersion: 18, browser: true }), false);
});

test("F2 — só turno do DONO leva a ponte de browser (membro nunca, mesmo com grant na máquina)", () => {
  assert.equal(browserToolsForTurn({ ownerTurn: true, machineOffers: true }), true);
  assert.equal(browserToolsForTurn({ ownerTurn: false, machineOffers: true }), false, "membro");
  assert.equal(browserToolsForTurn({ ownerTurn: true, machineOffers: false }), false, "máquina sem a capacidade");
  assert.equal(browserToolsForTurn({ ownerTurn: false, machineOffers: false }), false);
});

test("F2 — mensagens do cliente: perfil, liberação do nível 3, Assumir e seleção de pontos", () => {
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_open", runnerId: "r1", profile: "agent", reqId: "q" }, "local"), { op: "open", runnerId: "r1", profile: "agent", reqId: "q" });
  assert.equal((parseBrowserClientMessage({ t: "browser_open", profile: "root" }, "local") as any).profile, "owner", "perfil desconhecido cai no do dono, nunca em outro");
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_shutdown", runnerId: "r1", profile: "agent" }, "local"), { op: "shutdown", runnerId: "r1", profile: "agent" });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_tab", op: "new", profile: "agent" }, "local"), { op: "tab", runnerId: "local", tab: "new", profile: "agent" });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_agent_grant", runnerId: "r1", sessionId: " s1 ", on: true }, "local"), { op: "agent_grant", runnerId: "r1", sessionId: "s1", on: true });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_agent_grant", sessionId: "s1", on: "yes" }, "local"), { op: "agent_grant", runnerId: "local", sessionId: "s1", on: false }, "só true liga");
  assert.ok("error" in parseBrowserClientMessage({ t: "browser_agent_grant", on: true }, "local"), "liberação exige a sessão");
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_agent_revoke", runnerId: "r1" }, "local"), { op: "agent_revoke", runnerId: "r1" });
  assert.deepEqual(parseBrowserClientMessage({ t: "browser_grab", runnerId: "r1", pageId: P1, x: 10.5, y: 20, reqId: "g1" }, "local"), { op: "grab", runnerId: "r1", pageId: P1, x: 10.5, y: 20, reqId: "g1" });
  assert.ok("error" in parseBrowserClientMessage({ t: "browser_grab", pageId: P1, x: -1, y: 2 }, "local"));
  assert.ok("error" in parseBrowserClientMessage({ t: "browser_grab", pageId: P1, x: "a", y: 2 }, "local"));
  assert.ok("error" in parseBrowserClientMessage({ t: "browser_grab", x: 1, y: 2 }, "local"), "seleção exige a aba");
});

test("F2 — abas por (máquina, perfil): o estado do perfil IA não derruba quem assiste o do dono", () => {
  const pp = new BrowserProfilePages();
  assert.deepEqual(pp.update("r1", { profile: "owner", running: true, pages: [{ pageId: P1, url: "", title: "" }] }), []);
  assert.deepEqual(pp.update("r1", { profile: "agent", running: true, pages: [{ pageId: P2, url: "", title: "" }] }), [], "estado do agente sem a aba do dono: nada a soltar");
  assert.equal(pp.profileOf("r1", P1), "owner");
  assert.equal(pp.profileOf("r1", P2), "agent");
  assert.deepEqual(pp.update("r1", { profile: "agent", running: false, pages: [] }), [P2], "Chrome do agente parou: só as abas DELE saem");
  assert.equal(pp.profileOf("r1", P1), "owner");
  assert.deepEqual(pp.update("r1", { profile: "owner", running: true, pages: [] }), [P1]);
  pp.drop("r1");
  assert.equal(pp.profileOf("r1", P1), undefined);
});
