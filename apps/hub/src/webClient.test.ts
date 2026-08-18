/**
 * Regression tests for the WEB CLIENT (apps/hub/web/app.js).
 *
 * That file carries the whole machine/session routing model and had zero coverage — the Desktop⇄Notebook
 * session mixing came from there, not from the Hub. app.js is a classic <script> (no modules, no
 * exports), so we load its SOURCE into a function scope with a minimal DOM/WebSocket stub and append
 * an epilogue that hands back the internals we assert on. No jsdom, no new dependency.
 *
 * The invariant under test: the client's idea of which machine it is on must never silently disagree
 * with the Hub's. `clientRunner` on the Hub is per-socket and resets to LOCAL on every reconnect, so
 * the client has to re-assert routing after each one — and 'all' is a synthetic VIEW, never a runner.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_JS = fileURLToPath(new URL("../web/app.js", import.meta.url));

interface FakeSocket { sent: any[]; deliver(frame: unknown): void; }
interface ClientHandle {
  readonly currentMachine: string;
  readonly routedMachine: string;
  readonly restoringMachine: boolean;
  readonly currentSession: string | null;
  readonly currentSessionRunner: string;
  readonly sessions: any[];
  readonly recentsRows: string[];
  socket(): FakeSocket;
  store: Record<string, string>;
  openSession(id: string, runnerId?: string): void;
  organizeSessions(list: any[], opts: any): { groups: any[]; total: number; shownCount: number; groupBy: string; sortBy: string; status: string };
  // Espaço de Soluções + fluxo de subagente (test-only handles).
  el(k: string): any;
  makeEl(tag: string): any;
  setSession(id: string | null, runner: string): void;
  solutionArm(): any;
  setSolutionArm(patch: any): void;
  solutionArmed(): boolean;
  startSolutionRound(topic: string): void;
  updateSolutionCount(): void;
  appendFlowText(container: any, st: any, text: string): void;
  closeFlowText(st: any): void;
  // Interjeição no debate: para onde o composer manda o texto enquanto um debate roda.
  submitComposer(text: string): void;
  debateLive(sid: string, runner?: string): boolean;
  // Acompanhamento de fluxo: a faixa e a porta de saída.
  wfCollapse(v: boolean): void;
  wfRunActive(): boolean;
  wfSetDefs(defs: any[]): void;
}

/** One permissive fake element: every property access the client makes resolves to something inert. */
function fakeEl(tag = "div"): any {
  const el: any = {
    tagName: tag.toUpperCase(), nodeType: 1, isConnected: true, children: [] as any[], dataset: {},
    style: new Proxy({}, { get: () => "", set: () => true }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: "", value: "", title: "", checked: false, disabled: false,
    scrollHeight: 0, clientHeight: 0, scrollTop: 0, offsetHeight: 0, parentNode: null,
    appendChild(c: any) { el.children.push(c); if (c) c.parentNode = el; return c; },
    removeChild(c: any) { el.children = el.children.filter((x: any) => x !== c); return c; },
    insertBefore(c: any) { el.children.push(c); return c; },
    append() {}, remove() {}, focus() {}, blur() {}, click() {}, scrollIntoView() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {}, requestSubmit() {}, closest: () => null,
    querySelector: () => fakeEl(), querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, width: 0 }),
  };
  // Real accessor: `el.innerHTML = ''` is how the client clears a list before re-rendering, so the
  // stub must actually drop the children — otherwise rows pile up across renders and a stale row
  // from an earlier render would satisfy an assertion about the current one.
  let html = "";
  Object.defineProperty(el, "innerHTML", {
    get: () => html,
    set: (v: string) => { html = String(v ?? ""); if (!html) el.children = []; },
    enumerable: true, configurable: true,
  });
  return el;
}

/** Load app.js into an isolated scope. `machine` seeds localStorage['jarvis_machine']. */
function loadClient(opts: { machine?: string } = {}): ClientHandle {
  const store: Record<string, string> = {};
  if (opts.machine) store["jarvis_machine"] = opts.machine;

  const sockets: FakeSocket[] = [];
  class FakeWebSocket {
    static readonly OPEN = 1;
    readyState = 1;
    onopen: null | (() => void) = null;
    onmessage: null | ((e: { data: string }) => void) = null;
    onclose: null | (() => void) = null;
    onerror: null | (() => void) = null;
    sent: any[] = [];
    constructor() {
      sockets.push({
        sent: this.sent,
        deliver: (frame: unknown) => this.onmessage?.({ data: JSON.stringify(frame) }),
      });
      // openSession() and friends run synchronously off onopen; fire it on the next tick like a real WS.
      queueMicrotask(() => this.onopen?.());
    }
    send(raw: string) { try { this.sent.push(JSON.parse(raw)); } catch { this.sent.push(raw); } }
    close() { this.readyState = 3; }
  }

  const document: any = {
    getElementById: () => fakeEl(), createElement: (t: string) => fakeEl(t),
    createTextNode: () => fakeEl("#text"), querySelector: () => fakeEl(), querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, execCommand() {},
    body: fakeEl("body"), documentElement: fakeEl("html"), head: fakeEl("head"),
    visibilityState: "visible", hidden: false, activeElement: null, cookie: "",
  };
  const window: any = {
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    location: { protocol: "http:", host: "127.0.0.1:4577", hash: "", href: "http://127.0.0.1:4577/", origin: "http://127.0.0.1:4577" },
    // No serviceWorker/mediaDevices KEYS at all: app.js feature-detects with `'x' in navigator`, which
    // is true even for a key set to undefined — the stub has to be absent, not empty.
    navigator: { userAgent: "node", language: "pt-BR" },
    history: { replaceState() {}, pushState() {} },
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    scrollTo() {}, alert() {}, confirm: () => true, atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
  };
  window.window = window;

  // The epilogue is what makes the internals observable — app.js exports nothing by design.
  const src = readFileSync(APP_JS, "utf8") + `
;return {
  get currentMachine(){ return currentMachine; },
  get routedMachine(){ return routedMachine; },
  get restoringMachine(){ return restoringMachine; },
  get currentSession(){ return currentSession; },
  get currentSessionRunner(){ return currentSessionRunner; },
  get sessions(){ return sessions; },
  get recentsRows(){ return E.recents.children.map(c=>String(c.textContent||'')); },
  openSession: (id,rid)=>openSession(id,rid),
  organizeSessions: (list,opts)=>organizeSessions(list,opts),
  el: (k)=>E[k],
  makeEl: (t)=>document.createElement(t),
  setSession: (id,r)=>{ currentSession=id; currentSessionRunner=r; },
  solutionArm: ()=>solutionArm(),
  setSolutionArm: (patch)=>setSolutionArm(patch),
  solutionArmed: ()=>solutionArmed(),
  startSolutionRound: (topic)=>startSolutionRound(topic),
  updateSolutionCount: ()=>updateSolutionCount(),
  appendFlowText: (c,s,t)=>appendFlowText(c,s,t),
  closeFlowText: (s)=>closeFlowText(s),
  submitComposer: (text)=>{ E.input.value=text; E.composer.onsubmit({preventDefault(){}}); },
  debateLive: (sid,r)=>!!debateLive(sid,r),
  wfCollapse: (v)=>{ wfHideSuggest=v; renderWfRun(); },
  wfRunActive: ()=>!!wfRun,
  wfSetDefs: (defs)=>{ wfDefs=defs; renderWfRun(); },
};`;

  const factory = new Function(
    "window", "document", "localStorage", "navigator", "location", "WebSocket", "history",
    "matchMedia", "fetch", "Notification", "requestAnimationFrame", "cancelAnimationFrame", "alert", "self",
    "addEventListener", "removeEventListener", "setInterval", "setTimeout",
    src,
  );
  // app.js installs pollers/pagers that would hold the event loop open forever and hang the runner.
  // Unref'd timers still fire while the test is running, they just don't keep the process alive.
  const unrefTimer = (fn: any, ms?: number, ...rest: any[]) => { const t: any = setTimeout(fn, ms, ...rest); t.unref?.(); return t; };
  const unrefInterval = (fn: any, ms?: number, ...rest: any[]) => { const t: any = setInterval(fn, ms, ...rest); t.unref?.(); return t; };
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  const api = factory(
    window, document, localStorage, window.navigator, window.location, FakeWebSocket, window.history,
    window.matchMedia, async () => ({ ok: false, json: async () => ({}) }), undefined,
    (cb: any) => unrefTimer(cb, 0), () => {}, () => {}, window,
    () => {}, () => {}, unrefInterval, unrefTimer,
  );
  return Object.assign(api, { store, socket: () => sockets[sockets.length - 1] }) as ClientHandle;
}

/** Drive the client to the authenticated state, then hand it a machine list. */
async function authenticate(client: ClientHandle, machines: any[]): Promise<FakeSocket> {
  await new Promise((r) => setTimeout(r, 0)); // let onopen fire
  const sock = client.socket();
  sock.deliver({ t: "authinfo", claimed: true, authEnabled: false });
  sock.deliver({ t: "hello", agents: [{ name: "claude-code", models: [], defaultModel: null }], default: "claude-code" });
  sock.deliver({ t: "machines", machines });
  await new Promise((r) => setTimeout(r, 0));
  return sock;
}

const MACHINES = [
  { id: "local", label: "Desktop", local: true, online: true, agents: ["claude-code"] },
  { id: "notebook-1", label: "Notebook", local: false, online: true, agents: ["claude-code"] },
];

test("client boots into the unified view and STAYS there across a reconnect", async () => {
  const client = loadClient({ machine: "all" });
  await authenticate(client, MACHINES);

  // Regression: postAuth() flagged 'all' as a machine to restore; the 'machines' handler then found no
  // machines[].id === 'all', fell into the else, and dropped the view to 'local' while the aggregated
  // (two-machine) list stayed on screen — with the per-row machine chips gone, since those only render
  // when currentMachine === 'all'. That is exactly the "Desktop stuff on Notebook" report.
  assert.equal(client.currentMachine, "all", "a visão unificada não pode virar 'local' sozinha");
  assert.equal(client.store["jarvis_machine"], "all", "a preferência salva não pode ser apagada");
  assert.equal(client.restoringMachine, false, "'all' não é uma máquina a restaurar");
});

test("a reconnect resets routedMachine so the client re-asserts routing to the Hub", async () => {
  const client = loadClient({ machine: "all" });
  const sock = await authenticate(client, MACHINES);

  // The Hub's clientRunner is per-socket and starts at LOCAL. If the client kept believing it was
  // still routed to Notebook, openSession() would skip {t:'runner'} and every open/send would execute on
  // the Desktop against a session id that only exists on Notebook.
  assert.equal(client.routedMachine, "local", "socket novo => o espelho do roteamento volta a 'local'");

  sock.sent.length = 0;
  client.openSession("sessao-da-notebook", "notebook-1");
  const runnerFrames = sock.sent.filter((f) => f && f.t === "runner");
  assert.deepEqual(runnerFrames.map((f) => f.runnerId), ["notebook-1"], "abrir sessão remota tem de reafirmar a máquina");
  const openFrame = sock.sent.find((f) => f && f.t === "open");
  assert.ok(openFrame, "o open precisa ser enviado");
  assert.ok(sock.sent.indexOf(runnerFrames[0]) < sock.sent.indexOf(openFrame), "{t:'runner'} tem de vir ANTES do open");
});

test("a real remote machine IS restored after a reconnect", async () => {
  const client = loadClient({ machine: "notebook-1" });
  const sock = await authenticate(client, MACHINES);

  // The counterpart of the fix: a genuine runner id must still be re-selected on the Hub, otherwise
  // the machine bar shows Notebook while the Hub serves the Desktop.
  assert.equal(client.currentMachine, "notebook-1");
  assert.ok(sock.sent.some((f) => f && f.t === "runner" && f.runnerId === "notebook-1"), "deve reenviar {t:'runner'} para a máquina salva");
});

test("a saved machine that no longer exists falls back to local and clears the preference", async () => {
  const client = loadClient({ machine: "maquina-que-sumiu" });
  await authenticate(client, MACHINES);

  assert.equal(client.currentMachine, "local");
  assert.equal(client.store["jarvis_machine"], undefined, "preferência morta tem de ser apagada");
});

test("the unified list only accepts the aggregate, never a single machine's list", async () => {
  const client = loadClient({ machine: "all" });
  const sock = await authenticate(client, MACHINES);

  sock.deliver({ t: "sessions", runnerId: "all", sessions: [
    { id: "s-desktop", title: "Desktop 1", runnerId: "local", machine: "Desktop", updatedAt: 200 },
    { id: "s-notebook", title: "Notebook 1", runnerId: "notebook-1", machine: "Notebook", updatedAt: 100 },
  ], machines: [
    { runnerId: "local", label: "Desktop", online: true, contributed: true },
    { runnerId: "notebook-1", label: "Notebook", online: true, contributed: true },
  ] });
  assert.deepEqual(client.sessions.map((s: any) => s.id), ["s-desktop", "s-notebook"]);

  // A stray single-machine list must NOT replace the aggregate — that would drop the other machine's
  // sessions and leave the rows unlabelled.
  sock.deliver({ t: "sessions", runnerId: "notebook-1", sessions: [{ id: "s-notebook", title: "Notebook 1", updatedAt: 100 }], recentDirs: [] });
  assert.deepEqual(client.sessions.map((s: any) => s.id), ["s-desktop", "s-notebook"], "lista de máquina única não pode sobrescrever o agregado");
});

test("a machine missing from the unified view is named, not silently dropped", async () => {
  const client = loadClient({ machine: "all" });
  const sock = await authenticate(client, MACHINES);

  // Offline and online-but-silent are different failures and the user needs to tell them apart —
  // before this, both just produced a shorter list with no explanation.
  sock.deliver({ t: "sessions", runnerId: "all", sessions: [{ id: "s-desktop", runnerId: "local", machine: "Desktop", updatedAt: 1 }], machines: [
    { runnerId: "local", label: "Desktop", online: true, contributed: true },
    { runnerId: "notebook-1", label: "Notebook", online: false, contributed: false },
  ] });
  const warning = client.recentsRows.find((r) => r.includes("⚠"));
  assert.ok(warning, "a visão parcial precisa avisar quais máquinas ficaram de fora");
  assert.match(warning!, /Notebook \(offline\)/);

  sock.deliver({ t: "sessions", runnerId: "all", sessions: [{ id: "s-desktop", runnerId: "local", machine: "Desktop", updatedAt: 1 }], machines: [
    { runnerId: "local", label: "Desktop", online: true, contributed: true },
    { runnerId: "notebook-1", label: "Notebook", online: true, contributed: false },
  ] });
  assert.match(client.recentsRows.find((r) => r.includes("⚠"))!, /Notebook \(não respondeu\)/);

  // Complete aggregation => no warning at all.
  sock.deliver({ t: "sessions", runnerId: "all", sessions: [{ id: "s-desktop", runnerId: "local", machine: "Desktop", updatedAt: 1 }], machines: [
    { runnerId: "local", label: "Desktop", online: true, contributed: true },
    { runnerId: "notebook-1", label: "Notebook", online: true, contributed: true },
  ] });
  assert.equal(client.recentsRows.find((r) => r.includes("⚠")), undefined, "visão completa não mostra aviso");
});

// ---- Fase 1: organização da lista (agrupar / ordenar / filtrar / arquivar) ----
const ORG = [
  { id: "a", title: "Zebra", agent: "claude-code", cwd: "/work/api", runnerId: "local", machine: "Desktop", updatedAt: 300, cost: 0.10 },
  { id: "b", title: "Alpha", agent: "codex", cwd: "/work/api", runnerId: "local", machine: "Desktop", updatedAt: 100, cost: 0.50 },
  { id: "c", title: "Meio", agent: "claude-code", cwd: "/work/web", runnerId: "notebook-1", machine: "Notebook", updatedAt: 200, cost: 0.01, archived: true },
];

test("organizeSessions groups by project and keeps the recency order inside a group", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  const org = client.organizeSessions(ORG, { groupBy: "project", sortBy: "recency", status: "all" });
  // two projects (api, web); the last path segment is the label
  assert.deepEqual(org.groups.map((g) => g.label), ["api", "web"]);
  const api = org.groups.find((g) => g.label === "api");
  assert.deepEqual(api.sessions.map((s: any) => s.id), ["a", "b"], "recency: 300 antes de 100 dentro do grupo");
  assert.equal(api.cwd, "/work/api"); assert.equal(api.runnerId, "local");
});

test("organizeSessions: status filter hides archived by default and can show only archived", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  assert.deepEqual(client.organizeSessions(ORG, { status: "active" }).groups.flatMap((g: any) => g.sessions.map((s: any) => s.id)).sort(), ["a", "b"], "active esconde arquivada 'c'");
  assert.deepEqual(client.organizeSessions(ORG, { status: "archived" }).groups.flatMap((g: any) => g.sessions.map((s: any) => s.id)), ["c"], "archived mostra só 'c'");
  assert.equal(client.organizeSessions(ORG, { status: "all" }).total, 3);
});

test("organizeSessions: alpha and cost sorts reorder the flat set", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  const alpha = client.organizeSessions(ORG, { groupBy: "none", sortBy: "alpha", status: "all" });
  assert.deepEqual(alpha.groups[0].sessions.map((s: any) => s.id), ["b", "c", "a"], "Alpha < Meio < Zebra");
  const cost = client.organizeSessions(ORG, { groupBy: "none", sortBy: "cost", status: "all" });
  assert.deepEqual(cost.groups[0].sessions.map((s: any) => s.id), ["b", "a", "c"], "0.50 > 0.10 > 0.01");
});

test("organizeSessions: groupBy 'none' respects the global limit (flat pagination)", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  // sem agrupamento, o teto GLOBAL (`limit`) ainda recorta a lista achatada — path do "Mostrar mais".
  const org = client.organizeSessions(ORG, { groupBy: "none", sortBy: "recency", status: "all", limit: 1 });
  assert.equal(org.shownCount, 1); assert.equal(org.total, 3);
  assert.deepEqual(org.groups.flatMap((g: any) => g.sessions.map((s: any) => s.id)), ["a"], "só a mais recente entra no recorte flat");
});

test("organizeSessions: grouped caps EACH group at perGroupLimit and 'expanded' reveals the rest", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  // Agrupado IGNORA o teto global (limit) e aplica o teto POR grupo. Aqui perGroupLimit=1: o grupo
  // 'api' (2 sessões) mostra só a mais recente e reporta o resto como escondido.
  const capped = client.organizeSessions(ORG, { groupBy: "project", sortBy: "recency", status: "all", limit: 1, perGroupLimit: 1 });
  assert.equal(capped.total, 3, "total continua cheio");
  const api = capped.groups.find((g: any) => g.label === "api");
  assert.deepEqual(api.sessions.map((s: any) => s.id), ["a"], "só a mais recente do grupo entra sob o teto");
  assert.equal(api.total, 2); assert.equal(api.hidden, 1); assert.equal(api.expanded, false);
  const web = capped.groups.find((g: any) => g.label === "web");
  assert.equal(web.hidden, 0, "grupo com 1 item não esconde nada");
  // Expandir o grupo 'api' (via chave do grupo em `expanded`) revela todas as suas sessões.
  const expanded = client.organizeSessions(ORG, { groupBy: "project", sortBy: "recency", status: "all", perGroupLimit: 1, expanded: new Set([`project ${api.key}`]) });
  const apiX = expanded.groups.find((g: any) => g.label === "api");
  assert.deepEqual(apiX.sessions.map((s: any) => s.id), ["a", "b"], "expandido mostra todas do grupo");
  assert.equal(apiX.hidden, 0); assert.equal(apiX.expanded, true);
});

// ---- Espaço de Soluções: contador visível do limite do envio (não truncar em silêncio) ----
test("contador avisa o corte do servidor (20k) em vez de truncar em silêncio", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-count", "local");
  const input = client.el("input"), count = client.el("solutionChars");

  // Desarmado o teto não existe: um turno normal de chat não passa pelo corte de 20k do servidor.
  input.value = "x".repeat(19000);
  client.updateSolutionCount();
  assert.equal(count.textContent, "", "sem rodada armada não mostra contador");

  client.setSolutionArm({ mode: "benchmark" });
  assert.match(count.textContent, /19000 \/ 20000/, "armado, mostra quanto foi usado do teto");
  assert.doesNotMatch(count.textContent, /será cortado/, "abaixo do teto não avisa corte");
  input.value = "y".repeat(20001);
  client.updateSolutionCount();
  assert.match(count.textContent, /20001 \/ 20000/);
  assert.match(count.textContent, /será cortado em 20000/, "acima do teto avisa que o servidor vai cortar");
});

// ---- Subagente inline no chat: texto do agente como markdown intercalado (paridade com o chat) ----
test("appendFlowText acumula texto contíguo e closeFlowText abre bloco novo após uma ferramenta", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  const container = client.makeEl("div"); const st: any = {};
  client.appendFlowText(container, st, "Analisando ");
  client.appendFlowText(container, st, "o diff.");
  assert.equal(container.children.length, 1, "texto contíguo fica num único bloco de markdown");
  assert.equal(st.curTextRaw, "Analisando o diff.");
  client.closeFlowText(st);
  assert.equal(st.curTextEl, null, "fechar solta o estado do bloco");
  client.appendFlowText(container, st, "Depois da ferramenta.");
  assert.equal(container.children.length, 2, "texto após uma ferramenta abre um bloco NOVO (interleaving)");
});

// ---- Espaço de Soluções: a config armada é por sessão e sobrevive a reload ----
test("a rodada armada persiste por sessão e não vaza para outra sessão", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-debate", "local");
  client.setSolutionArm({ mode: "debate", rounds: 5, effort: "max", persist: "always" });

  const saved = Object.values(JSON.parse(client.store["jarvis_solution_arm"] || "{}"))[0] as any;
  assert.ok(saved, "a config armada foi persistida em localStorage");
  assert.equal(saved.mode, "debate");
  assert.equal(saved.rounds, 5);
  assert.equal(saved.effort, "max");
  assert.equal(saved.persist, "always");

  // Armar é por sessão, igual às pills de modelo/esforço: outra sessão nasce desarmada.
  client.setSession("s-outra", "local");
  assert.equal(client.solutionArmed(), false, "sessão diferente não herda a rodada armada");
  client.setSession("s-debate", "local");
  assert.equal(client.solutionArm().mode, "debate", "voltar para a sessão restaura o que estava armado");
  assert.equal(client.solutionArm().rounds, 5);
});

// A decisão de projeto: 'once' protege contra disparar 2-6 execuções paralelas sem querer na
// mensagem seguinte; 'always' é para quem quer a sessão inteira rodando em modo Soluções.
test("persist 'once' desarma ao enviar e 'always' continua armado", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-once", "local");

  client.setSolutionArm({ mode: "benchmark", persist: "once" });
  assert.equal(client.solutionArmed(), true);
  client.startSolutionRound("comparar duas abordagens de cache");
  assert.equal(client.solutionArmed(), false, "execução única desarma sozinha depois de disparar");
  const sent = client.socket().sent.filter((f: any) => f.t === "tournament_start");
  assert.equal(sent.length, 1, "a rodada foi disparada");
  assert.equal(sent[0].mode, "benchmark");

  client.setSolutionArm({ mode: "council", persist: "always" });
  client.startSolutionRound("como estruturar o rollout");
  assert.equal(client.solutionArmed(), true, "sempre ativa continua armada após enviar");
  assert.equal(client.solutionArm().mode, "council");
});

// O Conselho ficou autossuficiente: com a rodada armada, as pills de IA/modelo/esforço somem do
// composer, então o frame não pode continuar obedecendo a elas. `model` saiu de vez (era preferência
// que só casava com uma das IAs; as outras caíam no próprio padrão) e o esforço vem da config.
test("council_start não carrega model e tira o esforço da config da rodada", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-council", "local");

  client.setSolutionArm({ mode: "council", persist: "always" });
  client.startSolutionRound("como estruturar o rollout");
  let frame = client.socket().sent.filter((f: any) => f.t === "council_start").pop() as any;
  assert.ok(frame, "a rodada foi disparada");
  assert.equal(frame.model, undefined, "modelo não vem mais do composer");
  assert.equal(frame.effort, undefined, "padrão automático: cada IA usa o esforço do próprio modelo");

  client.setSolutionArm({ councilEffort: "max" });
  client.startSolutionRound("segunda rodada");
  frame = client.socket().sent.filter((f: any) => f.t === "council_start").pop() as any;
  assert.equal(frame.effort, "max", "o esforço escolhido na config da rodada viaja no frame");
  assert.equal(frame.model, undefined, "e o modelo segue fora");
});

// Regressão: o postfix de "gerar plano/encaminhamento" era concatenado no tema E num campo `criteria`,
// então o juiz recebia a mesma instrução duas vezes — e, com Critérios vazio, recebia SÓ o postfix
// como se fosse critério de julgamento. O campo saiu; o postfix agora entra uma vez só, na tarefa.
test("o postfix do pós-resultado entra uma única vez, sem campo de critérios", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-postfix", "local");
  client.setSolutionArm({ mode: "review", postAction: "plan" });
  client.startSolutionRound("revisar o diff do PR 42");

  const frame = client.socket().sent.filter((f: any) => f.t === "tournament_start").pop() as any;
  assert.ok(frame, "a rodada foi disparada");
  assert.equal(frame.criteria, undefined, "não existe mais campo de critérios no protocolo do cliente");
  const hits = frame.task.match(/plano de execucao/g) || [];
  assert.equal(hits.length, 1, "a instrução de plano aparece uma vez só, na tarefa");
});

// ---- Acompanhamento de fluxo: entrar não pode ser caminho só de ida ----
// A dor original: "depois que eu escolho um fluxo não tem opção de ignorar e cancelar depois". O
// servidor já sabia encerrar (`finish`/`abandon`); a UI não expunha nem um nem outro.
const wfRunFrame = (over: any = {}) => ({
  t: "workflow_run", sessionId: "s-wf",
  run: {
    runId: "r1", workflowId: "pipeline-sdlc", workflowName: "Pipeline de engenharia (F1–F14)",
    task: { tracker: "", key: "" }, status: "active", currentStepId: "f1",
    steps: [
      { id: "f1", title: "F1 — Discovery", kind: "step", state: "pending" },
      { id: "f2", title: "F2 — Spec", kind: "step", state: "pending" },
    ],
    summary: { done: 0, total: 2, missingEvidence: [] },
    ...over,
  },
});

// Sem fluxo, a faixa ocupava uma linha inteira acima do composer para anunciar que não havia nada, e
// o botão que oferecia abria um diálogo pedindo o NÚMERO do fluxo. Sumiu: quem inicia é o chip 🧭.
test("sem fluxo não existe faixa — e o chip diz o que faz, em vez de '—'", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  client.wfSetDefs([{ id: "pipeline-sdlc", name: "Pipeline", steps: [{ id: "f1", title: "F1", kind: "step" }] }]);

  assert.equal(client.wfRunActive(), false);
  assert.equal(String(client.el("wfRun").innerHTML), "", "a faixa não renderiza nada sem fluxo");
  assert.equal(String(client.el("wfStepName").textContent), "Fluxo", "o chip é a porta de entrada e precisa se nomear");
});

test("a faixa do fluxo ativo oferece saída: concluir, parar e encolher", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  client.socket().deliver(wfRunFrame());

  assert.equal(client.wfRunActive(), true, "o run chegou e está acompanhando");
  const html = String(client.el("wfRun").innerHTML);
  assert.match(html, /wf-stop/, "existe 'parar de acompanhar'");
  assert.match(html, /wf-finish/, "existe 'concluir'");
  assert.match(html, /wf-dismiss/, "existe 'encolher'");
  // Encolher e encerrar são coisas diferentes, e a faixa precisa dizer isso — senão some da tela um
  // fluxo que continua entrando em todo turno da IA.
  assert.match(html, /CONTINUA acompanhando/, "encolher avisa que o fluxo segue no turno");
});

test("encolhido, o rótulo mostra o passo — esconder não é esconder que existe fluxo", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  client.socket().deliver(wfRunFrame());

  client.wfCollapse(true);
  const html = String(client.el("wfRun").innerHTML);
  assert.match(html, /F1 — Discovery/, "a alça diz em que passo o fluxo está");
  assert.match(html, /wf-restore/, "e dá para reabrir");
  assert.ok(!/wf-adv/.test(html), "encolhido não mostra os controles da faixa inteira");
});

test("run encerrado sai da faixa no primeiro frame, sem depender do workflow_runs seguinte", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  const sock = client.socket();
  sock.deliver(wfRunFrame());
  assert.equal(client.wfRunActive(), true);

  // É o mesmo frame que o Hub devolve ao abandonar: o run atualizado, agora sem status ativo.
  sock.deliver(wfRunFrame({ status: "abandoned" }));
  assert.equal(client.wfRunActive(), false, "fluxo abandonado não continua acompanhando a sessão");
});

// ---- Interjeição: com um debate rodando, o chat fala com o DEBATE ----
// A dor original: começar um debate e não conseguir mais falar com ele. O envio virava um turno
// paralelo, que o debate ignorava — e a IA da sessão respondia sem nunca ter visto o debate.
const debateFrame = (over: any = {}) => ({
  t: "debate_progress", runnerId: "local", sessionId: "s-deb", debateId: "d1",
  round: 1, maxRounds: 3, phase: "debating", canSay: true, debaters: [], ...over,
});

test("com debate vivo o envio vira recado (debate_say), não um turno", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-deb", "local");

  const sock = client.socket();
  sock.deliver(debateFrame());
  assert.equal(client.debateLive("s-deb", "local"), true, "o frame de progresso marca a sessão como em debate");

  sock.sent.length = 0;
  client.submitComposer("foca no custo de operação");
  const say = sock.sent.filter((f: any) => f.t === "debate_say");
  assert.equal(say.length, 1, "o texto foi para o debate");
  assert.equal(say[0].text, "foca no custo de operação");
  assert.equal(say[0].sessionId, "s-deb");
  assert.equal(sock.sent.filter((f: any) => f.t === "send").length, 0, "e NÃO abriu um turno paralelo");
});

test("a janela de recado fecha na síntese e some quando o debate termina", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-deb", "local");
  const sock = client.socket();

  // Síntese: não existe mais rodada para receber o recado, então o chat volta a ser turno normal —
  // melhor um turno do que um "anotado" que não vai a lugar nenhum.
  sock.deliver(debateFrame({ phase: "synthesizing", canSay: false }));
  assert.equal(client.debateLive("s-deb", "local"), false);
  sock.sent.length = 0;
  client.submitComposer("e o custo?");
  assert.equal(sock.sent.filter((f: any) => f.t === "debate_say").length, 0);
  assert.equal(sock.sent.filter((f: any) => f.t === "send").length, 1, "sem janela de recado, é turno normal");

  sock.deliver(debateFrame({ phase: "debating", canSay: true }));
  assert.equal(client.debateLive("s-deb", "local"), true);
  sock.deliver(debateFrame({ phase: "done" }));
  assert.equal(client.debateLive("s-deb", "local"), false, "debate encerrado devolve o chat à IA da sessão");
});

// "!" executa shell no Hub (expandBang). Engolir isso como recado perderia o comando em silêncio —
// que é a classe de bug que a interjeição existe para MATAR, não para criar em outro lugar.
test("'!comando' não vira recado nem com debate vivo", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-deb", "local");
  const sock = client.socket();
  sock.deliver(debateFrame());

  sock.sent.length = 0;
  client.submitComposer("!git status");
  assert.equal(sock.sent.filter((f: any) => f.t === "debate_say").length, 0, "shell não é recado");
  const turno = sock.sent.filter((f: any) => f.t === "send");
  assert.equal(turno.length, 1, "continua sendo o turno que sempre foi");
  assert.equal(turno[0].text, "!git status");
});

test("recado recusado vira turno normal em vez de sumir", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-deb", "local");
  const sock = client.socket();
  sock.deliver(debateFrame());

  sock.sent.length = 0;
  client.submitComposer("considere o plano B");
  assert.equal(sock.sent.filter((f: any) => f.t === "debate_say").length, 1);

  // O debate fechou entre o envio e a chegada. O composer já foi limpo, então engolir a recusa
  // perderia a mensagem: o servidor devolve o texto e o cliente a manda como o turno que ela seria.
  sock.deliver({ t: "debate_said", ok: false, runnerId: "local", sessionId: "s-deb", text: "considere o plano B", message: "Nenhum debate aceitando recado nesta sessão." });
  const turno = sock.sent.filter((f: any) => f.t === "send");
  assert.equal(turno.length, 1, "a mensagem recusada foi reenviada como turno");
  assert.equal(turno[0].text, "considere o plano B");
  assert.equal(client.debateLive("s-deb", "local"), false, "a recusa também corrige o estado local");
});
