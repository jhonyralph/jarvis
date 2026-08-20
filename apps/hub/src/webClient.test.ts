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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// TSK-07: o teste da fatia G monta os frames com o MESMO código do Hub, para não haver a chance de
// a asserção passar sobre um payload inventado que o servidor nunca produziria.
import { ProjectTaskBindingStore, resolveTaskSource, parseTaskSourceCommand, planTaskSourceCommand, formatTaskSourceConfirmation } from "@jarvis/core";

const APP_JS = fileURLToPath(new URL("../web/app.js", import.meta.url));

interface FakeSocket { sent: any[]; deliver(frame: unknown): void; drop(): void; }
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
  // TSK-01: o chip 🧭 abre a faixa em vez do seletor quando há fluxo ativo.
  wfSetRun(run: any): void;
  wfClickChip(): void;
  wfBody(): any;
  wfModalCard(): any;
  wfRerender(): void;
  wfExpanded(): boolean;
  askPendingCount(sessionId: string, runnerId?: string): number;
  localTaskError(): string;
  taskSource(): any;
  taskBindings(): any;
  taskMcpMachines(): any;
  renderTaskSettings(): void;
  localTaskFiles(): any;
  searchResults(): any;
  readonly recentsHtml: string[];
  popAnchor(): any;
  // TSK-I (fatia I): marcar N tarefas → abrir N subsessões.
  fanoutMarks(): any[];
  fanoutToggle(task: any): void;
  fanoutAsk(phrase?: string): void;
  fanoutPlan(): any;
  dlgConfirm(): void;
  dlgCancel(): void;
  taskArmFor(runnerId: string, sessionId: string): any;
  buildTaskDrawer(): any;
  buildPanelBody(): any;
  // TSK-08 (fatia H): a fila de itens DENTRO de uma execução.
  openWork(id: string): void;
  workQueueHtml(): string;
  workQueue(): Array<{ id: string; title: string; bucket: string; label: string; why: string }>;
}

/** One permissive fake element: every property access the client makes resolves to something inert. */
function fakeEl(tag = "div"): any {
  const el: any = {
    tagName: tag.toUpperCase(), nodeType: 1, isConnected: true, children: [] as any[], dataset: {},
    style: new Proxy({}, { get: () => "", set: () => true }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: "", value: "", title: "", checked: false, disabled: false,
    scrollHeight: 0, clientHeight: 0, scrollTop: 0, offsetHeight: 0, parentNode: null,
    // O log do framework poda a lista por `childNodes`/`lastChild`: sem estes espelhos, QUALQUER
    // frame que passe por fwLog (workflow_list, inventário) estoura antes da asserção.
    get childNodes() { return el.children; },
    get firstChild() { return el.children[0] || null; },
    get lastChild() { return el.children[el.children.length - 1] || null; },
    appendChild(c: any) { el.children.push(c); if (c) c.parentNode = el; return c; },
    removeChild(c: any) { el.children = el.children.filter((x: any) => x !== c); return c; },
    insertBefore(c: any) { el.children.push(c); return c; },
    // O detalhe do trabalho monta a tela em duas etapas: `innerHTML=` e depois `insertAdjacentHTML`.
    // Sem isso o stub perde a segunda metade do que a tela mostra.
    insertAdjacentHTML(position: string, markup: string) {
      const value = String(markup ?? "");
      el.innerHTML = position === "afterbegin" ? value + el.innerHTML : el.innerHTML + value;
    },
    append() {}, remove() {}, focus() {}, blur() {}, click() {}, scrollIntoView() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    // Listeners DELEGADOS ficam guardados: a faixa do fluxo trata quase tudo por delegação
    // (`E.wfRun.addEventListener('click', …)`), e um stub que engole o registro deixa metade dos
    // gestos da faixa — iniciar, alternar o auto-início, encolher — sem como ser exercitada.
    _on: {} as Record<string, any[]>,
    addEventListener(type: string, fn: any) { (el._on[type] = el._on[type] || []).push(fn); },
    removeEventListener() {}, requestSubmit() {}, closest: () => null,
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
        // Queda do socket: é o que separa "o painel está ao vivo" de "isto é a última visão".
        drop: () => { this.readyState = 3; this.onclose?.(); },
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
  wfSetRun: (run)=>{ wfRun=run; wfOpen=false; renderWfRun(); },
  wfClickChip: ()=>E.wfStepBtn.onclick({preventDefault(){},stopPropagation(){}}),
  wfBody: ()=>wfStepsEl,
  wfModalCard: ()=>wfModal&&wfModal.card,
  wfRerender: ()=>wfRerender(),
  wfExpanded: ()=>wfOpen,
  askPendingCount: (sid,rid)=>(askPending.get(sessionStateKey(sid,rid||"local"))||{count:0}).count,
  get recentsHtml(){ return E.recents.children.map(c=>String(c.innerHTML||'')); },
  localTaskError: ()=>wfLocalErr,
  taskSource: ()=>wfTaskSource,
  taskBindings: ()=>tskBindings,
  taskMcpMachines: ()=>tskMcpMachines,
  renderTaskSettings: ()=>renderTaskSettings(),
  localTaskFiles: ()=>wfLocalFiles,
  searchResults: ()=>wfSearchResults,
  popAnchor: ()=>E.pop._anchor||null,
  fanoutMarks: ()=>wfFanoutList(),
  fanoutToggle: (t)=>wfFanoutToggle(t),
  fanoutAsk: (phrase)=>wfFanoutAsk(phrase),
  fanoutPlan: ()=>wfFanoutPlan,
  dlgConfirm: ()=>dlgClose(true),
  dlgCancel: ()=>dlgClose(null),
  taskArmFor: (rid,sid)=>{ try{ return JSON.parse(localStorage.getItem('jarvis_task_arm')||'{}')[rid+' '+sid]||null; }catch(e){ return null; } },
  buildTaskDrawer: ()=>{ const p=document.createElement('div'); buildWfTaskSection(p); return p; },
  buildPanelBody: ()=>{ const p=document.createElement('div'); wfPanelBody(p); return p; },
  openWork: (id)=>{ openWorkPanel(); openWorkNode(id); },
  workQueueHtml: ()=>String(E.workQueue.innerHTML||''),
  workQueue: ()=>workQueueItems(workSelected).map(it=>({id:it.node.executionId,title:String(it.node.title||''),bucket:it.bucket,label:it.label,why:it.why})),
};`;

  const factory = new Function(
    "window", "document", "localStorage", "navigator", "location", "WebSocket", "history",
    "matchMedia", "fetch", "Notification", "requestAnimationFrame", "cancelAnimationFrame", "alert", "self",
    "addEventListener", "removeEventListener", "setInterval", "setTimeout",
    // Posicionamento do popover: `placePop` lê variáveis CSS e o tamanho da viewport como globais
    // nuas. Sem elas, abrir QUALQUER popup estoura ReferenceError dentro do teste.
    "getComputedStyle", "innerWidth", "innerHeight",
    // O painel de trabalhos monta seletores com `CSS.escape` para achar o cartão inline do subagente.
    // Sem este global, QUALQUER snapshot de execução estoura ReferenceError dentro do teste.
    "CSS",
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
    () => ({ getPropertyValue: () => "0" }), window.innerWidth, window.innerHeight,
    { escape: (value: string) => String(value).replace(/["\\]/g, "\\$&") },
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

// ── TSK-01: com fluxo ativo, o chip 🧭 abre a FAIXA (onde já estão trilha, passos e tarefa) em vez
// de empilhar um seletor por cima. Sem fluxo ele continua sendo a única porta de entrada.
const WF_DEFS = [{ id: "pipeline-sdlc", name: "Pipeline", steps: [{ id: "f1", title: "F1 — Discovery", kind: "step" }, { id: "f2", title: "F2 — Spec", kind: "step" }] }];
function wfRunFixture(over: any = {}): any {
  return {
    runId: "run-1", workflowId: "pipeline-sdlc", workflowName: "Pipeline", status: "active",
    sessions: ["s-wf"], currentStepId: "f1",
    steps: [{ id: "f1", title: "F1 — Discovery", state: "pending", kind: "step" }, { id: "f2", title: "F2 — Spec", state: "pending", kind: "step" }],
    summary: { done: 0, total: 2 },
    ...over,
  };
}
function bandHtml(client: any): string { return String(client.el("wfRun").innerHTML || ""); }
/** Todo elemento montado dentro da faixa. O corpo do painel é construído com createElement/appendChild
 *  (não com innerHTML), então `bandHtml` sozinho enxerga só o cabeçalho. */
function barNodes(client: any): any[] {
  const out: any[] = [];
  const walk = (el: any): void => { for (const c of el.children || []) { out.push(c); walk(c); } };
  walk(client.el("wfRun"));
  return out;
}
/** Texto de tudo que a faixa mostra — cabeçalho (innerHTML) + corpo (nós construídos). */
function barText(client: any): string {
  return [bandHtml(client), ...barNodes(client).map((n) => `${n.innerHTML || ""} ${n.textContent || ""} ${n.title || ""}`)].join(" ");
}
/** O primeiro botão do corpo cujo rótulo casa — é assim que o teste "clica" no que foi construído. */
function barButton(client: any, re: RegExp): any {
  return barNodes(client).find((n) => n.tagName === "BUTTON" && re.test(`${n.textContent || ""} ${n.innerHTML || ""}`)) || null;
}
/** Dispara um clique DELEGADO na faixa, como se o alvo tivesse a classe pedida. */
function clickBar(client: any, cls: string): void {
  const target = { closest: (sel: string) => (sel === `.${cls}` ? { dataset: {} } : null), dataset: {} };
  for (const fn of client.el("wfRun")._on?.click || []) fn({ target, preventDefault() {}, stopPropagation() {} });
}
/** A lista de fluxos como o Hub a manda — inclusive quem é o padrão e se ele inicia sozinho. */
function deliverFlows(sock: any, opts: { autoStart?: boolean; autoStartId?: string | null; defs?: any[] } = {}): void {
  sock.deliver({ t: "workflow_list", ok: true, workflows: opts.defs || WF_DEFS, candidates: [],
    autoStartFlows: opts.autoStart !== false, autoStartId: opts.autoStartId === undefined ? "pipeline-sdlc" : opts.autoStartId });
}

test("TSK-01: com fluxo ativo o chip expande a faixa, sem abrir seletor", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  client.wfSetDefs(WF_DEFS);
  client.wfSetRun(wfRunFixture());

  assert.equal(client.wfExpanded(), false, "a faixa começa recolhida");
  client.wfClickChip();

  assert.equal(client.wfExpanded(), true, "o clique expandiu a faixa");
  assert.match(bandHtml(client), />ocultar</, "a faixa expandida oferece 'ocultar'");
  assert.equal(client.popAnchor(), null, "nenhum popup foi aberto por cima");
});

test("TSK-01: o chip é alternância — o segundo clique recolhe", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  client.wfSetDefs(WF_DEFS);
  client.wfSetRun(wfRunFixture());

  client.wfClickChip();
  client.wfClickChip();

  assert.equal(client.wfExpanded(), false, "voltou a recolher");
  assert.match(bandHtml(client), />passos</, "e volta a oferecer 'passos'");
  assert.equal(client.popAnchor(), null);
});

// ── Faixa única: o chip abre a MESMA faixa com ou sem fluxo. Sem fluxo ele abria um popover — que
// fechava ao primeiro clique fora, empilhava sobre a faixa e escondia lá dentro a escolha de fonte,
// pasta e arquivo. O popover do fluxo deixou de existir; quem não tem fluxo vê o modo início.
test("sem fluxo ativo o chip abre a faixa no modo início — sem popover e sem criar acompanhamento", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock);

  client.wfClickChip();

  assert.equal(client.popAnchor(), null, "nenhum popover foi aberto");
  assert.equal(client.wfRunActive(), false, "abrir a faixa NÃO cria acompanhamento");
  assert.match(barText(client), /Iniciar um fluxo/, "a faixa oferece começar um fluxo");
  assert.match(barText(client), /F1 — Discovery/, "e os passos, para entrar direto no certo");
});

test("o segundo clique fecha a faixa do modo início e ela some do DOM", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock);

  client.wfClickChip();
  client.wfClickChip();

  assert.equal(bandHtml(client), "", "sem fluxo e fechada, a faixa não ocupa linha nenhuma");
  assert.equal(barNodes(client).length, 0, "e não deixa nós pendurados de um render anterior");
});

// O ponto do dono: o início automático estava LIGADO e não aparecia em lugar nenhum fora de
// Configurações → Framework. Uma sessão que nasce dentro de um fluxo paga steering em todo turno.
test("a faixa diz qual fluxo é o padrão e que ele inicia sozinho", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock, { autoStart: true });

  client.wfClickChip();

  const txt = barText(client);
  assert.match(txt, /padrão/, "o fluxo padrão é identificado como tal");
  assert.match(txt, /inicia sozinho em sessão nova/, "e o efeito dele é dito por extenso");
  assert.match(bandHtml(client), /auto: ON/, "com a chave de desligar à vista");
});

test("auto-início desligado aparece como desligado — e não como ausência de padrão", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock, { autoStart: false });

  client.wfClickChip();

  assert.match(barText(client), /auto-início desligado/);
  assert.match(bandHtml(client), /auto: off/);
});

test("a chave do auto-início é operável da faixa, sem rebaixar a preferência do framework", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock, { autoStart: true });
  client.wfClickChip();

  clickBar(client, "wf-auto");

  const set = sock.sent.filter((m: any) => m.t === "set_framework_cfg");
  assert.equal(set.length, 1);
  assert.equal(set[0].autoStartFlows, false, "desliga o que estava ligado");
  assert.equal("preference" in set[0], false, "e não manda preferência — quem não manda, não muda");
});

test("Iniciar começa o fluxo padrão no primeiro passo", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock);
  client.wfClickChip();

  clickBar(client, "wf-begin");

  const start = sock.sent.find((m: any) => m.t === "workflow_run_start");
  assert.ok(start, "pediu para iniciar");
  assert.equal(start.workflowId, "pipeline-sdlc");
  assert.equal(start.stepId, "f1", "no primeiro passo, não no meio");
});

// Ponto 3 do dono: escolher a PASTA das features só existia em Configurações → Tarefas. Quem estava
// no fluxo tinha de sair, achar o projeto na lista e voltar.
test("a gaveta de Tarefa da faixa escolhe a pasta e lista os arquivos de feature", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock);
  sock.deliver({ t: "task_binding", sessionId: "s-wf", cwd: "/p", binding: { tracker: "local", featuresDir: "docs/features" },
    source: { kind: "local", ready: true, featuresDir: "docs/features" } });
  client.wfClickChip();

  const drawer = barButton(client, /🎯 Tarefa/);
  assert.ok(drawer, "a gaveta de Tarefa existe dentro da faixa");
  drawer.onclick();

  assert.match(barText(client), /pasta: docs\/features/, "a pasta é escolhível aqui");
  assert.ok(barButton(client, /Arquivos de feature/), "e os arquivos da pasta também");
});

// Com fluxo ativo os passos DELE já estão na faixa; o corpo do painel não pode repetir a lista.
test("com fluxo ativo o corpo da faixa oferece trocar de fluxo, não repetir o atual", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock, { defs: [...WF_DEFS, { id: "hotfix", name: "Hotfix", steps: [{ id: "h1", title: "H1 — Corrigir", kind: "step" }] }] });
  client.wfSetRun(wfRunFixture());

  client.wfClickChip();

  const corpo = barNodes(client).map((nd) => `${nd.innerHTML || ""} ${nd.textContent || ""}`).join(" ");
  assert.match(corpo, /Trocar de fluxo/, "o outro fluxo é alcançável");
  assert.match(corpo, /Hotfix/);
  assert.doesNotMatch(corpo, /Pipeline<\/b>/, "e o fluxo atual não vira uma segunda lista");
});

test("TSK-01: faixa encolhida em alça volta inteira num clique", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  client.wfSetDefs(WF_DEFS);
  client.wfSetRun(wfRunFixture());
  client.wfCollapse(true);
  assert.match(bandHtml(client), /wf-restore/, "está na alça mínima");

  client.wfClickChip();

  assert.equal(client.wfExpanded(), true, "um clique só: restaurou E expandiu");
  assert.doesNotMatch(bandHtml(client), /wf-restore/, "não é mais alça");
  assert.match(bandHtml(client), />ocultar</);
});

// A gaveta de Tarefa (armar tarefa / cofre de conexões) só existia dentro do seletor. Se o chip para
// de abri-lo com fluxo ativo, ela precisa de porta na faixa — senão a fatia troca um clique por uma
// função perdida.
test("TSK-01: a faixa oferece porta para a gaveta de Tarefa", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  client.wfSetDefs(WF_DEFS);
  client.wfSetRun(wfRunFixture());
  client.wfClickChip();

  assert.match(bandHtml(client), /wf-task/, "a faixa expandida tem o acesso à tarefa");
});

// ── Ponto 2: o campo de colar seguia existindo em qualquer projeto, e "Armar" guardava a escolha
// para o PRÓXIMO fluxo mesmo com um fluxo rodando — a faixa dizia "trocar" e nada trocava.
async function drawerWith(source: any, run?: any): Promise<{ client: any; sock: any; nodes: (drawer?: any) => any[]; drawer: () => any }> {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock);
  sock.deliver({ t: "task_connections", connections: [], providers: [{ id: "jira", label: "Jira", targetHint: "chave do projeto (ex.: ABC)" }], bindings: [], mcpMachines: [] });
  sock.deliver({ t: "task_binding", sessionId: "s-wf", cwd: "/p", binding: { tracker: source.kind === "provider" ? source.tracker : source.kind }, source });
  if (run) client.wfSetRun(run);
  // UMA árvore por chamada: reconstruir a gaveta entre o "digitar" e o "clicar" faria o teste
  // preencher um input descartado e clicar num botão que lê outro, vazio — passando por engano.
  const nodes = (drawer?: any): any[] => {
    const out: any[] = [];
    const walk = (el: any): void => { for (const c of el.children || []) { out.push(c); walk(c); } };
    walk(drawer || client.buildTaskDrawer());
    return out;
  };
  return { client, sock, nodes, drawer: () => client.buildTaskDrawer() };
}

test("ponto 2: em projeto de PASTA não existe campo para colar URL de tracker", async () => {
  const { nodes } = await drawerWith({ kind: "local", ready: true, featuresDir: "docs/features" });
  const inputs = nodes().filter((el) => el.tagName === "INPUT");
  assert.equal(inputs.length, 0, "a fonte declarada é a pasta: colar chave de Jira aqui contradiz a própria fonte");
  assert.ok(nodes().some((el) => /Arquivos de feature/.test(String(el.innerHTML || ""))), "a lista da fonte é o caminho");
});

test("ponto 2: em projeto de provedor o campo existe e diz QUANDO tem efeito", async () => {
  const semRun = await drawerWith({ kind: "provider", tracker: "jira", ready: false, reason: "vincule a conexão" });
  const inp = semRun.nodes().find((el) => el.tagName === "INPUT");
  assert.ok(inp, "num board com milhares de itens, colar a chave é o caminho rápido");
  assert.match(String(inp.placeholder || ""), /chave ou URL/);
  assert.ok(semRun.nodes().some((el) => String(el.textContent || "") === "Usar no próximo fluxo"), "sem fluxo, o rótulo diz que fica para depois");

  const comRun = await drawerWith({ kind: "provider", tracker: "jira", ready: false, reason: "vincule a conexão" }, wfRunFixture());
  assert.ok(comRun.nodes().some((el) => String(el.textContent || "") === "Usar neste fluxo"), "com fluxo, o rótulo promete efeito AGORA");
});

test("ponto 2: com fluxo ativo, escolher a tarefa troca a do fluxo — não guarda para o próximo", async () => {
  const { client, sock, nodes, drawer } = await drawerWith({ kind: "provider", tracker: "jira", ready: false, reason: "vincule a conexão" }, wfRunFixture());
  const arvore = drawer();
  const inp = nodes(arvore).find((el) => el.tagName === "INPUT");
  inp.value = "ABC-42";
  nodes(arvore).find((el) => String(el.textContent || "") === "Usar neste fluxo").onclick();

  const upd = sock.sent.find((m: any) => m.t === "workflow_run_update" && m.op === "task");
  assert.ok(upd, "a troca vai para o Hub, que interpreta a chave pelo vínculo da pasta");
  assert.equal(upd.runId, "run-1");
  assert.equal(upd.taskInput, "ABC-42");
  assert.equal(client.taskArmFor("local", "s-wf"), null, "e NADA fica armado escondido para o próximo fluxo");
});

test("ponto 2: sem fluxo, escolher um arquivo de feature guarda para o fluxo que vier", async () => {
  const client = loadClient();
  await withTaskList(client, FEATURES);
  const find = (node: any, needle: string): any => {
    for (const child of node.children || []) {
      if (String(child.innerHTML || child.textContent || "").includes(needle)) return child;
      const deep = find(child, needle); if (deep) return deep;
    }
    return null;
  };
  find(client.buildTaskDrawer(), "Arquivos de feature").onclick();
  find(client.buildTaskDrawer(), "Tarefa A").onclick();

  const armada = client.taskArmFor("local", "s-mae");
  assert.ok(armada, "sem fluxo não há o que trocar: a escolha espera o início");
  assert.equal(armada.task.key, FEATURES[0].key);
});

// A faixa mostrava a lista inteira embaixo da trilha: num fluxo de 11 fases, onze linhas repetindo
// o mapa que já estava desenhado acima. A lista existe para AGIR (marcar, anexar, pular).
const WF_LONG = wfRunFixture({
  currentStepId: "f2",
  steps: [
    { id: "f1", title: "F1 — Discovery", state: "done", kind: "step", requiresEvidence: true, evidence: [] },
    { id: "f2", title: "F2 — Spec", state: "pending", kind: "step" },
    { id: "f3", title: "F3 — Testes", state: "pending", kind: "step" },
    { id: "f4", title: "F4 — Deploy", state: "pending", kind: "step", requiresEvidence: true, evidence: [] },
  ],
  summary: { done: 1, total: 4 },
});

test("a faixa lista o passo em foco e a dívida de evidência — o resto fica atrás de um clique", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock);
  client.wfSetRun(WF_LONG);
  client.wfClickChip();

  const html = bandHtml(client);
  // `>N. Título` casa a LINHA da lista; a trilha repete os mesmos nomes dentro de `title="…"`, e uma
  // asserção frouxa passaria vendo o tooltip do ponto em vez da linha.
  assert.match(html, />2\. F2 — Spec/, "o passo em foco aparece");
  assert.match(html, />1\. F1 — Discovery/, "e o passo dado que ficou devendo evidência também");
  assert.doesNotMatch(html, />3\. F3 — Testes/, "o passo futuro sem dívida não ocupa linha");
  assert.doesNotMatch(html, />4\. F4 — Deploy/, "nem o futuro que ainda VAI pedir evidência");
  assert.match(html, /ver todos os 4 passos \(2 ocultos\)/, "e o que foi escondido é dito, não sumido");
  assert.match(html, /wftrack/, "a trilha continua sendo o mapa das fases");
});

test("ver todos os passos abre a lista inteira e o segundo clique recolhe", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock);
  client.wfSetRun(WF_LONG);
  client.wfClickChip();

  clickBar(client, "wf-allsteps");
  const aberta = bandHtml(client);
  assert.match(aberta, />3\. F3 — Testes/);
  assert.match(aberta, />4\. F4 — Deploy/);
  assert.match(aberta, /ocultar os outros passos/);

  clickBar(client, "wf-allsteps");
  assert.doesNotMatch(bandHtml(client), />3\. F3 — Testes/, "voltou ao essencial");
});

// Provedor declarado SEM conta vinculada: destino e política de criação valem para escritas que não
// podem acontecer. Deixar os botões clicáveis ensina a desconfiar da tela.
test("provedor sem conexão só oferece o que resolve a falta — o resto fica desabilitado", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  deliverFlows(sock);
  sock.deliver({ t: "task_connections", connections: [], providers: [{ id: "jira", label: "Jira" }], bindings: [], mcpMachines: [] });
  sock.deliver({ t: "task_binding", sessionId: "s-wf", cwd: "/p", binding: { tracker: "jira" },
    source: { kind: "provider", tracker: "jira", ready: false, reason: "nenhuma conta está vinculada — vincule a conexão" } });

  const drawer = client.buildTaskDrawer();
  const botoes = (function walk(el: any): any[] {
    return (el.children || []).flatMap((c: any) => [c, ...walk(c)]);
  })(drawer).filter((b: any) => b.tagName === "BUTTON");
  const acha = (re: RegExp): any => botoes.find((b: any) => re.test(String(b.textContent || "")));

  assert.equal(acha(/destino:/).disabled, true, "destino de escrita exige conta");
  assert.equal(acha(/criar sem aprovar/).disabled, true, "política de criação também");
  const vincular = acha(/adicionar conexão de jira/);
  assert.ok(vincular, "cofre vazio: o botão leva a ADICIONAR, em vez de abrir um seletor sem opções");
  assert.equal(vincular.disabled, false, "e o caminho que resolve a falta continua clicável");
});

// ── Visibilidade do update: o relatório do updater existia em disco e NÃO chegava na tela. Com o
// estado em `sent`, o painel dizia "solicitação entregue" enquanto o registro ao lado guardava
// "git saiu com código 1" — e foi preciso ler o JSON à mão para descobrir por que uma máquina
// passou semanas sem atualizar.
test("máquina que falhou no update mostra a falha, mesmo com a entrega bem-sucedida", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  sock.deliver({ t: "machines", machines: [
    { id: "local", label: "Servidor", local: true, online: true },
    { id: "luby", label: "Luby", local: false, online: false, updatePending: {
      state: "sent", targetCommit: "81c78ea", fromCommit: "7bf2394", failures: 4,
      lastPhase: "restarting", lastError: "[restarting] git saiu com código 1",
      lastLogTail: "'git help -a' … ERRO na preparação: git saiu com código 1", lastReportAt: 1_787_190_207_016,
    } },
  ] });

  const html = String(client.el("updMachines").innerHTML || "")
    + client.el("updMachines").children.map((c: any) => `${c.innerHTML || ""} ${c.textContent || ""}`).join(" ");
  assert.match(html, /falhou em restarting/, "a fase e o erro aparecem: " + html.slice(0, 300));
  assert.match(html, /git saiu com código 1/);
  assert.doesNotMatch(html, /solicitação entregue/, "a frase otimista não pode cobrir a falha");
  assert.match(html, /4 tentativas/, "repetição vira 'está em loop', que é outra decisão");
  // O rastro do updater é o que identifica a CAUSA — fica atrás de um clique, mas existe.
  const nodes = (function walk(el: any): any[] { return (el.children || []).flatMap((c: any) => [c, ...walk(c)]); })(client.el("updMachines"));
  const verLog = nodes.find((b: any) => b.tagName === "BUTTON" && /ver log/.test(String(b.textContent || "")));
  assert.ok(verLog, "existe como abrir o log daquela máquina");
  verLog.onclick();
  const comLog = (function walk(el: any): any[] { return (el.children || []).flatMap((c: any) => [c, ...walk(c)]); })(client.el("updMachines"))
    .map((n: any) => String(n.textContent || "")).join(" ");
  assert.match(comLog, /ERRO na prepara/, "o rastro do updater aparece");
  assert.match(comLog, /7bf2394.*81c78ea/s, "com de-onde → para-onde, que é o que diz se ela está atrás");
});

// Reapontar o alvo NÃO é falhar. O Hub guardava esse recado no MESMO campo do erro, e a tela — que
// desde hoje mostra falha com destaque — passou a anunciar "falhou" para uma máquina que só estava
// seguindo um alvo novo depois de um rebase.
test("mudar o alvo do update é recado, não falha", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  sock.deliver({ t: "machines", machines: [
    { id: "local", label: "Servidor", local: true, online: true },
    { id: "luby", label: "Luby", local: false, online: false, protocolVersion: 11, hubProtocolVersion: 15, compatible: false,
      updatePending: { state: "queued", targetCommit: "16aca20", lastNote: "alvo anterior ec887ec substituído por 16aca20" } },
  ] });

  const html = String(client.el("updMachines").innerHTML || "")
    + client.el("updMachines").children.map((c: any) => `${c.innerHTML || ""} ${c.textContent || ""}`).join(" ");
  assert.doesNotMatch(html, /falhou/, "recado não pode virar falha: " + html.slice(0, 200));
  assert.match(html, /alvo anterior ec887ec/, "mas o recado aparece — ele explica por que o alvo mudou");
});

// O Hub agora PARA de reenviar quando o mesmo pedido é entregue vezes demais sem a máquina concluir.
// Parar em silêncio trocaria um problema invisível (o círculo) por outro (a máquina nunca atualiza e
// ninguém sabe): a tela tem de dizer que o reenvio foi pausado e oferecer como reabri-lo.
test("update em círculo: o painel diz que o reenvio parou e oferece a saída", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  sock.deliver({ t: "machines", machines: [
    { id: "local", label: "Servidor", local: true, online: true },
    { id: "luby", label: "Luby", local: false, online: true, updatePending: {
      state: "sent", targetCommit: "911b9e9", deliveries: 5, stalled: true,
      lastError: "entregue 5× sem concluir — parei de reenviar (círculo)",
    } },
  ] });

  const texto = String(client.el("updMachines").innerHTML || "")
    + client.el("updMachines").children.map((c: any) => `${c.innerHTML || ""} ${c.textContent || ""}`).join(" ");
  assert.match(texto, /reenvio pausado/, "o dono precisa ler que o Hub parou — não deduzir pelo silêncio: " + texto.slice(0, 300));
  assert.doesNotMatch(texto, /solicitação entregue/, "a frase de entrega descreveria o círculo como progresso");
  const nodes = (function walk(el: any): any[] { return (el.children || []).flatMap((c: any) => [c, ...walk(c)]); })(client.el("updMachines"));
  const reenviar = nodes.find((b: any) => b.tagName === "BUTTON" && /reenviar/.test(String(b.textContent || "")));
  assert.ok(reenviar, "sem esta saída, uma máquina que estourou o teto ficaria travada mesmo depois de consertada");
});

// `stalled` também é usado pelo watchdog do REINÍCIO (aplicou e não voltou). Ali reenviar não ajuda:
// derrubaria de novo uma máquina que já aplicou. O estado é o que separa os dois casos.
test("máquina que aplicou e não voltou não ganha botão de reenviar", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  sock.deliver({ t: "machines", machines: [
    { id: "local", label: "Servidor", local: true, online: true },
    { id: "luby", label: "Luby", local: false, online: false, updatePending: {
      state: "awaiting_restart", targetCommit: "911b9e9", stalled: true, awaitingSince: 1_787_190_207_016,
    } },
  ] });

  const nodes = (function walk(el: any): any[] { return (el.children || []).flatMap((c: any) => [c, ...walk(c)]); })(client.el("updMachines"));
  assert.equal(nodes.find((b: any) => b.tagName === "BUTTON" && /reenviar/.test(String(b.textContent || ""))), undefined);
});

// ── TSK-12: a seção de MCP por máquina em Configurações → 🎯 Tarefas.
test("MCP por máquina: caminho REAL de cada uma, e formulário só onde ele vai gravar", async () => {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  sock.deliver({ t: "task_connections", connections: [], providers: [], bindings: [], mcpMachines: [
    { runnerId: "luby", label: "Luby", servers: ["linear"], configFile: "/home/luby/.jarvis/task-mcp.json", known: true, editable: true, online: true },
    { runnerId: "antiga", label: "Antiga", servers: [], configFile: "", known: false, editable: false, online: true },
  ] });
  client.el("setSection").value = "tarefas";
  client.renderTaskSettings();

  const html = String(client.el("tskMcp").innerHTML || "") + client.el("tskMcp").children.map((c: any) => `${c.innerHTML || ""} ${c.textContent || ""}`).join(" ");
  assert.match(html, /\/home\/luby\/\.jarvis\/task-mcp\.json/, "o caminho é o DA MÁQUINA, não o do Hub");
  assert.match(html, /só leitura/, "máquina que não pode ser configurada daqui diz isso");
  const botoes = (function walk(el: any): any[] { return (el.children || []).flatMap((c: any) => [c, ...walk(c)]); })(client.el("tskMcp"))
    .filter((b: any) => b.tagName === "BUTTON").map((b: any) => String(b.textContent || ""));
  assert.ok(botoes.includes("+ servidor"), "a máquina apta ganha o formulário");
  assert.ok(botoes.includes("testar linear"), "e o teste, porque 'salvo' não é 'responde'");
  assert.equal(botoes.filter((t) => t === "+ servidor").length, 1, "a máquina inapta NÃO ganha formulário que não vai gravar");
});

// ── TSK-10: a decisão pendente precisa aparecer para quem NÃO está na sessão. Antes, o frame nem
// chegava (o servidor filtrava por inscrição) e, quando chegava, virava o mesmo pontinho de não-lida
// de qualquer resposta — indistinguível de "chegou mensagem".
function askPending(sessionId: string, count = 2, runnerId = "local"): any {
  return { t: "ask_pending", runnerId, sessionId, count, at: 1_700_000_000_000 };
}

test("TSK-10: decisão pendente em outra sessão marca a conversa na lista", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-atual", "local");
  client.socket().deliver({ t: "sessions", runnerId: "local", sessions: [{ id: "s-outra", title: "Refatorar cofre", agent: "claude-code", updatedAt: 2 }, { id: "s-atual", title: "Aqui", agent: "claude-code", updatedAt: 1 }] });

  client.socket().deliver(askPending("s-outra"));

  assert.equal(client.askPendingCount("s-outra", "local"), 2, "o cliente guardou a pendência da outra sessão");
  const linha = client.recentsHtml.find((r) => r.includes("Refatorar cofre")) || "";
  assert.match(linha, /⏳/, "a linha ganha marca própria de decisão esperando");
});

test("TSK-10: a marca é distinta de não-lida comum", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-atual", "local");
  client.socket().deliver({ t: "sessions", runnerId: "local", sessions: [{ id: "s-msg", title: "So mensagem", agent: "claude-code", updatedAt: 2 }] });

  // uma resposta comum chegando fora da sessão não pode pintar a marca de decisão
  client.socket().deliver({ t: "message", runnerId: "local", sessionId: "s-msg", message: { sessionId: "s-msg", role: "assistant", text: "oi", ts: 1 } });

  const linha = client.recentsHtml.find((r) => r.includes("So mensagem")) || "";
  assert.notEqual(linha, "", "a linha existe na lista (senão o teste passaria por vacuidade)");
  assert.doesNotMatch(linha, /⏳/, "mensagem comum não é decisão pendente");
});

test("TSK-10: responder em outro aparelho limpa a marca aqui", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-atual", "local");
  client.socket().deliver({ t: "sessions", runnerId: "local", sessions: [{ id: "s-outra", title: "Refatorar cofre", agent: "claude-code", updatedAt: 2 }] });
  client.socket().deliver(askPending("s-outra"));
  assert.equal(client.askPendingCount("s-outra", "local"), 2);

  client.socket().deliver({ t: "ask_cleared", runnerId: "local", sessionId: "s-outra" });

  assert.equal(client.askPendingCount("s-outra", "local"), 0, "a marca some sem eu tocar nela");
  const linha = client.recentsHtml.find((r) => r.includes("Refatorar cofre")) || "";
  assert.doesNotMatch(linha, /⏳/);
});

test("TSK-10: abrir a sessão pendente limpa a marca da lista", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-atual", "local");
  client.socket().deliver({ t: "sessions", runnerId: "local", sessions: [{ id: "s-outra", title: "Refatorar cofre", agent: "claude-code", updatedAt: 2 }] });
  client.socket().deliver(askPending("s-outra"));

  client.openSession("s-outra", "local");

  assert.equal(client.askPendingCount("s-outra", "local"), 0, "estou olhando a decisão: a marca cumpriu o papel");
});

// TSK-03 (fatia C): quem lista é a máquina do projeto. Se ela não pode responder, o motivo tem que
// chegar — lista vazia calada é indistinguível de "esse projeto não tem features".
test("TSK-03: recusa da máquina vira motivo visível, não lista vazia", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-remota", "local");

  client.socket().deliver({ t: "task_local_list", runnerId: "runner-b", sessionId: "s-remota", dir: "", files: [], cached: false, scannedAt: 1, error: "a máquina está offline — a lista de tarefas vive no disco dela" });

  assert.match(client.localTaskError(), /offline/, "o cliente guardou o motivo da recusa");
});

test("TSK-03: uma listagem boa limpa o motivo anterior", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-remota", "local");
  client.socket().deliver({ t: "task_local_list", runnerId: "runner-b", sessionId: "s-remota", dir: "", files: [], cached: false, scannedAt: 1, error: "desatualizada" });
  assert.notEqual(client.localTaskError(), "");

  client.socket().deliver({ t: "task_local_list", runnerId: "runner-b", sessionId: "s-remota", dir: "docs/features", files: [{ key: "docs/features/a.md", title: "A" }], cached: false, scannedAt: 2 });

  assert.equal(client.localTaskError(), "", "resposta boa não pode deixar aviso velho na tela");
});

// ── Rolagem preservada ao repintar a faixa ──────────────────────────────────────────────────────
// A faixa se reconstroi inteira a cada render, e o corpo que rola nasce novo — ou seja, no topo.
// Marcar uma tarefa no fim de uma lista de board devolvia a pessoa ao comeco a cada clique, o que
// torna selecao multipla em board grande praticamente inviavel.
test("marcar tarefa nao joga a lista de volta para o topo", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  client.wfClickChip();

  const corpo = client.wfBody();
  assert.ok(corpo, "a faixa aberta monta o corpo que rola");
  corpo.scrollTop = 120;

  client.wfRerender();   // e o que todo clique de marcar/desmarcar dispara

  const novo = client.wfBody();
  assert.notEqual(novo, corpo, "o corpo e mesmo outro objeto — o render nao reaproveita");
  assert.equal(novo.scrollTop, 120, "e a posicao veio junto");
});

test("trocar de sessao NAO herda a rolagem da conversa anterior", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-a", "local");
  client.wfClickChip();
  client.wfBody().scrollTop = 200;

  // A faixa CONTINUA aberta ao trocar de conversa (wfClickChip aqui a fecharia): o proximo render
  // monta um corpo novo, e e nele que a rolagem antiga nao pode reaparecer.
  client.setSession("s-b", "local");
  client.wfRerender();

  // Restaurar aqui poria a lista de OUTRA conversa numa posicao que ninguem escolheu.
  const outro = client.wfBody();
  assert.ok(outro, "a faixa segue aberta e monta o corpo da nova conversa");
  assert.notEqual(outro.scrollTop, 200);
});

// ── O modal de tarefas do provedor ──────────────────────────────────────────────────────────────
// Projeto com Linear vinculado e verificado abria so com uma caixa de busca vazia: nenhuma lista,
// nenhum estado vazio, e o botao Buscar sem texto nao fazia nada. O dono concluia, com razao, que a
// integracao nao funcionava — enquanto a conexao respondia perfeitamente. E uma gaveta de 300px nao
// comporta board: filtro, busca e paginacao precisam de superficie propria.
async function comConexao(): Promise<{ client: any; sock: any; nos: (raiz?: any) => any[] }> {
  const client = loadClient();
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-wf", "local");
  sock.deliver({ t: "task_connections", providers: [{ id: "linear", label: "Linear" }], bindings: [], mcpMachines: [],
    connections: [{ id: "linear:pallium", provider: "linear", label: "Pallium", identity: { id: "u1", login: "jonathan.campos@luby.com.br" } }] });
  sock.deliver({ t: "task_binding", sessionId: "s-wf", cwd: "/p", binding: { tracker: "linear", connectionId: "linear:pallium" },
    source: { kind: "provider", tracker: "linear", ready: true, connectionId: "linear:pallium" } });
  const nos = (raiz?: any): any[] => {
    const out: any[] = [];
    const walk = (el: any): void => { for (const c of el.children || []) { out.push(c); walk(c); } };
    walk(raiz || client.buildTaskDrawer());
    return out;
  };
  return { client, sock, nos };
}
const ache = (ns: any[], re: RegExp): any => ns.find((el) => re.test(String(el.innerHTML || el.textContent || "")));
const ENG904 = { tracker: "linear", key: "ENG-904", title: "AI-generated category insight missing", url: "https://linear.app/x/ENG-904", state: "Triage" };
const ESTADOS = [{ id: "st-triage", name: "Triage", type: "triage" }, { id: "st-rev", name: "In Review", type: "started" }];

test("a gaveta de provider tem UMA porta, e ela abre a lista", async () => {
  const { client, sock, nos } = await comConexao();
  const porta = ache(nos(), /Escolher tarefa/);
  assert.ok(porta, "sem isto, a unica porta era buscar — e buscar pressupoe ja saber o que procurar");
  porta.onclick();

  const pedido = sock.sent.find((m: any) => m.t === "task_provider_list");
  assert.ok(pedido, "abrir ja pergunta ao Hub");
  assert.equal(pedido.cursor, undefined, "a primeira pagina nao manda cursor — e o que traz os estados junto");

  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [ENG904], states: ESTADOS, cursor: "abc" });
  const texto = nos(client.wfModalCard()).map((n: any) => String(n.innerHTML || n.textContent || "")).join(" ");
  assert.match(texto, /ENG-904/, "a tarefa aparece: " + texto.slice(0, 200));
  assert.match(texto, /Triage/, "com o estado, que e o que diz se vale pegar");
});

test("o filtro fala a lingua do board, e trocar de estado descarta a lista antiga", async () => {
  const { client, sock, nos } = await comConexao();
  ache(nos(), /Escolher tarefa/).onclick();
  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [ENG904], states: ESTADOS });

  const sel = nos(client.wfModalCard()).find((n: any) => n.tagName === "SELECT");
  assert.ok(sel, "os estados vieram do provedor: o seletor existe");
  assert.deepEqual((sel.children || []).map((o: any) => o.textContent), ["Minhas abertas", "Triage", "In Review"],
    "na ordem do board, com o criterio padrao na frente");

  sel.value = "st-rev"; sel.onchange();
  const filtrado = sock.sent.filter((m: any) => m.t === "task_provider_list").at(-1);
  assert.equal(filtrado.state, "st-rev");
  // Misturar dois criterios na mesma lista seria pior que recarregar.
  assert.equal(nos(client.wfModalCard()).some((n: any) => /ENG-904/.test(String(n.innerHTML || ""))), false, "a lista do criterio anterior sai da tela");
});

test("carregar mais ACUMULA, e o cursor volta como veio", async () => {
  const { client, sock, nos } = await comConexao();
  ache(nos(), /Escolher tarefa/).onclick();
  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [ENG904], states: ESTADOS, cursor: "cursor-opaco" });

  const mais = nos(client.wfModalCard()).find((n: any) => /Carregar mais/.test(String(n.textContent || "")));
  assert.ok(mais, "o provedor disse que ha mais");
  mais.onclick();
  assert.equal(sock.sent.filter((m: any) => m.t === "task_provider_list").at(-1).cursor, "cursor-opaco",
    "o cliente nao interpreta o cursor — devolve a string que recebeu");

  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [{ ...ENG904, key: "ENG-903", title: "Outra" }], cursor: "" });
  const texto = nos(client.wfModalCard()).map((n: any) => String(n.innerHTML || "")).join(" ");
  assert.match(texto, /ENG-904/, "a pagina 1 continua na tela");
  assert.match(texto, /ENG-903/, "e a 2 entrou embaixo");
  assert.equal(nos(client.wfModalCard()).some((n: any) => /Carregar mais/.test(String(n.textContent || ""))), false, "sem cursor, sem promessa de mais");
});

test("escolher no modal arma a tarefa, busca a INTEGRA e fecha", async () => {
  const { client, sock, nos } = await comConexao();
  ache(nos(), /Escolher tarefa/).onclick();
  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [ENG904], states: ESTADOS });

  ache(nos(client.wfModalCard()), /ENG-904/).onclick();

  const armada = client.taskArmFor("local", "s-wf");
  assert.ok(armada, "sem fluxo rodando, a escolha fica guardada para o proximo");
  assert.equal(armada.task.key, "ENG-904");
  // A lista vem sem descricao de proposito; a integra da ESCOLHIDA chega pelo caminho que ja
  // alimenta a faixa e o Resumir. Sem este pedido, a tarefa entraria no fluxo so com o titulo.
  assert.equal(sock.sent.find((m: any) => m.t === "task_load")?.key, "ENG-904");
  assert.equal(client.wfModalCard(), null, "escolheu, fechou: o modal nao fica no caminho");
});

test("busca com campo vazio VOLTA para a lista, em vez de nao fazer nada", async () => {
  const { client, sock, nos } = await comConexao();
  ache(nos(), /Escolher tarefa/).onclick();
  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [ENG904], states: ESTADOS });

  const inp = nos(client.wfModalCard()).find((n: any) => n.tagName === "INPUT");
  const btn = nos(client.wfModalCard()).find((n: any) => String(n.textContent || "") === "Buscar");
  inp.value = "insight"; btn.onclick();
  assert.equal(sock.sent.filter((m: any) => m.t === "task_search").at(-1).query, "insight");

  const inp2 = nos(client.wfModalCard()).find((n: any) => n.tagName === "INPUT");
  const btn2 = nos(client.wfModalCard()).find((n: any) => String(n.textContent || "") === "Buscar");
  inp2.value = "  "; btn2.onclick();
  // Antes, campo vazio era `if(!q) return` — clique sem requisicao, sem toast, sem nada na tela.
  assert.ok(sock.sent.filter((m: any) => m.t === "task_provider_list").length >= 2, "limpar a busca traz a lista de volta");
});

test("a busca tambem carrega mais, e acumula", async () => {
  const { client, sock, nos } = await comConexao();
  ache(nos(), /Escolher tarefa/).onclick();
  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [ENG904], states: ESTADOS });

  const inp = nos(client.wfModalCard()).find((n: any) => n.tagName === "INPUT");
  inp.value = "insight";
  nos(client.wfModalCard()).find((n: any) => String(n.textContent || "") === "Buscar").onclick();
  sock.deliver({ t: "task_search_results", sessionId: "s-wf", query: "insight", results: [ENG904], cursor: "cur-2" });

  const mais = nos(client.wfModalCard()).find((n: any) => /Carregar mais/.test(String(n.textContent || "")));
  assert.ok(mais, "board tem milhares de itens: 10 resultados eram uma amostra que parecia a resposta");
  mais.onclick();
  const pedido = sock.sent.filter((m: any) => m.t === "task_search").at(-1);
  assert.equal(pedido.cursor, "cur-2");
  assert.equal(pedido.query, "insight", "a proxima pagina e do MESMO termo");

  sock.deliver({ t: "task_search_results", sessionId: "s-wf", query: "insight", results: [{ ...ENG904, key: "ENG-357", title: "Outra" }] });
  const texto = nos(client.wfModalCard()).map((n: any) => String(n.innerHTML || "")).join(" ");
  assert.match(texto, /ENG-904/, "a pagina 1 da busca continua na tela");
  assert.match(texto, /ENG-357/);
});

test("vazio e erro sao ditos, nao silenciados", async () => {
  const { client, sock, nos } = await comConexao();
  ache(nos(), /Escolher tarefa/).onclick();
  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [], states: ESTADOS });
  let texto = nos(client.wfModalCard()).map((n: any) => String(n.textContent || "")).join(" ");
  assert.match(texto, /Nenhuma tarefa aberta atribuida a @jonathan\.campos@luby\.com\.br/,
    "vazio calado e indistinguivel de falha — foi assim que o erro passou despercebido");

  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [], error: "HTTP 401: [REDACTED]" });
  texto = nos(client.wfModalCard()).map((n: any) => String(n.textContent || "")).join(" ");
  assert.match(texto, /HTTP 401/);
});

// ── A selecao visivel no painel do fluxo ────────────────────────────────────────────────────────
// As marcadas viviam so dentro da lista onde foram marcadas: fechado o modal, ou trocado o filtro, a
// selecao sumia da tela e continuava valendo. Marcar cinco e nao ver nenhuma e o caminho curto para
// abrir cinco conversas erradas.
test("tarefas marcadas para subsessao aparecem no painel do fluxo", async () => {
  const { client, sock, nos } = await comConexao();
  ache(nos(), /Escolher tarefa/).onclick();
  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [ENG904], states: ESTADOS });

  // A caixinha ao lado da tarefa e o que marca para subsessao.
  const marca = nos(client.wfModalCard()).find((n: any) => n.className === "wfact wf-fanmark");
  assert.ok(marca, "a lista do modal oferece marcar");
  marca.onclick({ stopPropagation() {} });

  const painel = nos(client.buildPanelBody()).map((n: any) => String(n.innerHTML || n.textContent || "")).join(" ");
  assert.match(painel, /1 marcada\(s\) para subsessao/, "o painel do fluxo mostra a selecao: " + painel.slice(0, 200));
  assert.match(painel, /ENG-904/);
});

test("desmarcar do painel e o par de marcar da lista", async () => {
  const { client, sock, nos } = await comConexao();
  ache(nos(), /Escolher tarefa/).onclick();
  sock.deliver({ t: "task_provider_results", sessionId: "s-wf", results: [ENG904], states: ESTADOS });
  nos(client.wfModalCard()).find((n: any) => n.className === "wfact wf-fanmark").onclick({ stopPropagation() {} });

  // Sem isto, tirar uma da selecao obrigaria a reabrir o modal e achar a tarefa de novo.
  const chip = nos(client.buildPanelBody()).find((n: any) => /ENG-904 ×/.test(String(n.textContent || "")));
  assert.ok(chip, "cada marcada tem como sair");
  chip.onclick();
  assert.equal(nos(client.buildPanelBody()).some((n: any) => /marcada\(s\) para subsessao/.test(String(n.textContent || ""))), false, "sem marcas, a faixa some");
});

// TSK-04 (fatia D): fonte ÚNICA declarada por projeto. O cliente não reimplementa a regra — ele
// desenha a fonte que o Hub resolveu, e trocar de fonte tem que trocar a LISTA na hora.
test("TSK-04: trocar a fonte do projeto descarta a lista da fonte antiga", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-1", "local");

  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "local", featuresDir: "docs/features" }, source: { kind: "local", tracker: "local", ready: true, featuresDir: "docs/features" } });
  client.socket().deliver({ t: "task_local_list", sessionId: "s-1", dir: "docs/features", files: [{ key: "docs/features/a.md", title: "A" }], cached: false, scannedAt: 1 });
  assert.equal(client.localTaskFiles().length, 1);

  // Projeto passa a declarar Jira: os .md que estavam na tela são de OUTRA fonte.
  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "jira", connectionId: "jira:acme" }, source: { kind: "provider", tracker: "jira", ready: true, connectionId: "jira:acme" } });

  assert.equal(client.localTaskFiles(), null, "lista da fonte antiga não sobrevive à troca — seriam duas fontes na mesma tela");
  assert.equal(client.taskSource().kind, "provider");
});

test("TSK-04: voltar para a pasta descarta o resultado do provedor", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-1", "local");
  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "jira", connectionId: "jira:acme" }, source: { kind: "provider", tracker: "jira", ready: true, connectionId: "jira:acme" } });
  client.socket().deliver({ t: "task_search_results", sessionId: "s-1", results: [{ tracker: "jira", key: "ABC-1", title: "Uma tarefa" }] });
  assert.ok(client.searchResults());

  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "local" }, source: { kind: "local", tracker: "local", ready: true, featuresDir: "docs/features" } });

  assert.equal(client.searchResults(), null, "resultado do provedor não pode sobrar num projeto que agora é pasta local");
  assert.equal(client.localTaskError(), "");
});

test("TSK-04: fonte que não pode servir chega com motivo — e o cliente o guarda em vez de lista vazia", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-1", "local");

  const reason = "este projeto declara jira como fonte, mas nenhuma conta está vinculada — vincule a conexão";
  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "jira" }, source: { kind: "provider", tracker: "jira", ready: false, code: "NO_CONNECTION", reason } });

  const source = client.taskSource();
  assert.equal(source.ready, false);
  assert.equal(source.code, "NO_CONNECTION");
  assert.equal(source.reason, reason, "é este texto que o painel mostra: sem ele, o usuário vê só uma lista vazia");
});

// TSK-05 (fatia E): a fonte MCP entra pela MESMA porta da lista local — o cliente não ganha um
// segundo caminho, só um rótulo diferente e a origem certa na tarefa armada.
test("TSK-05: lista vinda do MCP chega pelo frame da lista e traz o rótulo do servidor", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-1", "local");

  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "mcp", mcpServer: "linear-local" }, source: { kind: "mcp", tracker: "mcp", ready: true, mcpServer: "linear-local" } });
  client.socket().deliver({ t: "task_local_list", kind: "mcp", sessionId: "s-1", dir: "Linear local", files: [{ key: "PRI-1", title: "Uma tarefa" }], cached: false, scannedAt: 1 });

  assert.equal(client.taskSource().kind, "mcp");
  assert.equal(client.localTaskFiles().length, 1);
  assert.equal(client.localTaskError(), "");
});

test("TSK-05: recusa da máquina (servidor MCP ausente) vira motivo visível, não lista vazia", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-1", "local");
  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "mcp", mcpServer: "sumiu" }, source: { kind: "mcp", tracker: "mcp", ready: true, mcpServer: "sumiu" } });

  client.socket().deliver({ t: "task_local_list", kind: "mcp", sessionId: "s-1", dir: "", files: [], cached: false, scannedAt: 1, error: 'esta máquina não tem servidor MCP de tarefas chamado "sumiu"' });

  assert.match(client.localTaskError(), /não tem servidor MCP de tarefas chamado "sumiu"/);
});

test("TSK-05: trocar o servidor MCP descarta a lista do servidor anterior", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);
  client.setSession("s-1", "local");
  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "mcp", mcpServer: "a" }, source: { kind: "mcp", tracker: "mcp", ready: true, mcpServer: "a" } });
  client.socket().deliver({ t: "task_local_list", kind: "mcp", sessionId: "s-1", dir: "A", files: [{ key: "A-1", title: "de A" }], cached: false, scannedAt: 1 });
  assert.equal(client.localTaskFiles().length, 1);

  client.socket().deliver({ t: "task_binding", sessionId: "s-1", cwd: "C:/proj", binding: { tracker: "mcp", mcpServer: "b" }, source: { kind: "mcp", tracker: "mcp", ready: true, mcpServer: "b" } });

  assert.equal(client.localTaskFiles(), null, "outro servidor é outra fonte: a lista de A não pode ficar na tela de B");
});

// TSK-06 (fatia F): o frame de conexões é DIFUNDIDO a cada mudança. O cliente precisa absorver o
// que vem sem ter pedido — é isso que faz a tela de Configurações refletir o que outro aparelho fez.
test("TSK-06: frame difundido atualiza vínculos e máquinas sem nenhum pedido do cliente", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);

  client.socket().deliver({
    t: "task_connections",
    connections: [{ id: "jira:acme", provider: "jira", label: "Jira ACME", secretRef: "JIRA_TOKEN", envOk: true, identity: { login: "jon" } }],
    providers: [],
    bindings: [{ project: "c:/proj", binding: { tracker: "mcp", mcpServer: "linear-local", updatedAt: 1 } }],
    mcpMachines: [{ runnerId: "luby", label: "Luby", servers: ["linear-local"], known: true }],
  });

  assert.equal(client.taskBindings().length, 1);
  assert.equal(client.taskBindings()[0].binding.mcpServer, "linear-local");
  assert.equal(client.taskMcpMachines()[0].servers[0], "linear-local");
});

test("TSK-06: máquina que não reporta a allowlist não vira 'nenhum servidor'", async () => {
  const client = loadClient();
  await authenticate(client, MACHINES);

  client.socket().deliver({ t: "task_connections", connections: [], providers: [], bindings: [],
    mcpMachines: [{ runnerId: "antiga", label: "Antiga", servers: [], known: false }] });

  // `known:false` é o que separa "não sei" de "não tem" — a tela mostra "—", não "nenhum".
  assert.equal(client.taskMcpMachines()[0].known, false);
});

// ── TSK-08 (fatia H): a lista de tarefas DENTRO da execução. Uma execução com N itens tem de mostrar
// a FILA — o que terminou, o que roda e o que ainda não começou — e essa fila anda sozinha conforme
// os itens concluem. Ela é DERIVADA dos nós de execução que o painel já recebe: não existe segunda
// lista guardada, então não há como o painel mostrar uma fila diferente da execução real.
const EXEC_CAPS = {
  source: "jarvis_managed", observe: "live", transcript: "published_only", tools: true, cancel: "root",
  steer: "none", retry: false, resume: false, input: "none", files: "metadata", usage: "subtree",
  asynchronous: true, dependencies: true, isolatedWorkspace: "jarvis_worktree",
};
function execNode(over: any): any {
  return {
    schemaVersion: 1, journalId: "j-1", rootExecutionId: "root-1", rootTurnId: "turn-1",
    sessionId: "s-work", runnerId: "local", parentExecutionId: "root-1", dependsOn: [], depth: 1,
    kind: "agent", origin: "jarvis_managed", certification: "verified", state: "queued",
    title: "Item", queuedAt: 1_000, capabilities: { ...EXEC_CAPS }, metrics: { self: {} }, ...over,
  };
}
const EXEC_ROOT = execNode({ executionId: "root-1", parentExecutionId: undefined, depth: 0, kind: "workflow", title: "Conselho: cofre", state: "running", startedAt: 1_050 });
/** Três itens em estados diferentes: um terminou, um roda, um nem começou. */
function execItems(): any[] {
  return [
    execNode({ executionId: "item-1", title: "Levantar riscos", state: "succeeded", queuedAt: 1_001, startedAt: 1_100, endedAt: 1_200 }),
    execNode({ executionId: "item-2", title: "Propor desenho", state: "running", queuedAt: 1_002, startedAt: 1_150 }),
    execNode({ executionId: "item-3", title: "Revisar proposta", state: "queued", queuedAt: 1_003 }),
  ];
}
function execSnapshot(nodes: any[], nextCursor?: string): any {
  return { t: "executions_snapshot", scope: "all", nodes, generatedAt: 2_000, nextCursor };
}
let execSeq = 1;
function execDelta(executionId: string, from: string, to: string, reason?: string): any {
  execSeq += 1;
  return { t: "execution_delta", runnerId: "local", event: {
    schemaVersion: 1, journalId: "j-1", eventId: `j-1:${execSeq}`, executionId, rootExecutionId: "root-1",
    rootTurnId: "turn-1", seq: execSeq, at: 3_000 + execSeq, kind: "state_changed", from, to, reason } };
}
/** Abre o painel no nó pedido depois de entregar um snapshot. Devolve o socket para inspeção. */
async function openExecution(client: ClientHandle, nodes: any[], opts: { select?: string; nextCursor?: string } = {}): Promise<FakeSocket> {
  const sock = await authenticate(client, MACHINES);
  sock.deliver(execSnapshot(nodes, opts.nextCursor));
  client.openWork(opts.select || "root-1");
  return sock;
}

test("TSK-08: uma execução com N itens mostra a fila com o estado de cada item", async () => {
  const client = loadClient();
  await openExecution(client, [EXEC_ROOT, ...execItems()]);

  const queue = client.workQueue();
  assert.deepEqual(queue.map((i) => i.title), ["Levantar riscos", "Propor desenho", "Revisar proposta"]);
  // O contrato é o estado POR ITEM: o que terminou, o que roda e o que ainda não começou.
  assert.deepEqual(queue.map((i) => i.bucket), ["done", "running", "queued"]);

  const html = client.workQueueHtml();
  assert.match(html, /3 itens/, "a fila diz quantos itens a execução tem");
  assert.match(html, /1 em execução/);
  assert.match(html, /1 na fila/);
  assert.match(html, /1 concluído/);
});

test("TSK-08: a fila anda sozinha quando um item conclui — sem reload e sem o usuário pedir", async () => {
  const client = loadClient();
  const sock = await openExecution(client, [EXEC_ROOT, ...execItems()]);
  assert.deepEqual(client.workQueue().map((i) => i.bucket), ["done", "running", "queued"]);

  sock.sent.length = 0;
  // O evento é do FILHO, não do nó aberto. Antes desta fatia nada no detalhe reagia a ele: a fila
  // ficaria parada em "1 concluído" até o usuário reabrir o painel.
  sock.deliver(execDelta("item-2", "running", "succeeded"));

  assert.deepEqual(client.workQueue().map((i) => i.bucket), ["done", "done", "queued"], "o item concluído tem de aparecer concluído na hora");
  assert.match(client.workQueueHtml(), /2 concluídos/);
  assert.equal(sock.sent.filter((f: any) => f.t === "executions_list").length, 0, "atualizar a fila não pode custar um recarregamento da lista");
});

test("TSK-08: item que nasce depois entra na fila sem recarregar", async () => {
  const client = loadClient();
  // Uma raiz aberta ganha itens em ondas (é assim que rodada 2 de um debate entra na mesma execução).
  const sock = await openExecution(client, [EXEC_ROOT]);
  assert.equal(client.workQueueHtml(), "");

  execSeq += 1;
  sock.deliver({ t: "execution_delta", runnerId: "local", event: {
    schemaVersion: 1, journalId: "j-1", eventId: `j-1:${execSeq}`, executionId: "item-9", rootExecutionId: "root-1",
    rootTurnId: "turn-1", seq: execSeq, at: 3_500, kind: "node_created",
    node: execNode({ executionId: "item-9", title: "Rodada 2", state: "queued", queuedAt: 1_900 }) } });

  assert.deepEqual(client.workQueue().map((i) => i.title), ["Rodada 2"]);
  assert.match(client.workQueueHtml(), /1 item · 1 na fila/, "a fila tem de aparecer sozinha quando o primeiro item nasce");
});

test("TSK-08: a fila mantém a ordem de enfileiramento — concluir um item não embaralha as linhas", async () => {
  const client = loadClient();
  // O Hub serve a lista do mais recente para o mais antigo; a fila tem de desfazer isso.
  const sock = await openExecution(client, [...execItems().reverse(), EXEC_ROOT]);
  assert.deepEqual(client.workQueue().map((i) => i.id), ["item-1", "item-2", "item-3"]);

  sock.deliver(execDelta("item-3", "queued", "running"));
  sock.deliver(execDelta("item-3", "running", "succeeded"));

  assert.deepEqual(client.workQueue().map((i) => i.id), ["item-1", "item-2", "item-3"], "uma fila que reordena a cada conclusão deixa de ser fila");
});

test("TSK-08: item cujo estado o Hub não conhece aparece como desconhecido, com motivo", async () => {
  const client = loadClient();
  await openExecution(client, [EXEC_ROOT,
    execNode({ executionId: "item-1", title: "Sem lifecycle", state: "unknown", queuedAt: 1_001 }),
    execNode({ executionId: "item-2", title: "Perdeu a máquina", state: "orphaned", queuedAt: 1_002, summary: "conexão caiu antes do terminal" }),
  ]);

  const queue = client.workQueue();
  assert.deepEqual(queue.map((i) => i.bucket), ["unknown", "unknown"], "não saber nunca pode virar 'Concluído'");
  assert.equal(queue.length, 2, "e nunca pode sumir da lista");
  assert.match(queue[0].label, /desconhecid/i);
  assert.match(queue[0].why, /lifecycle/, "o motivo é o que separa 'não sei' de 'nada aconteceu'");
  assert.match(queue[1].why, /conexão caiu antes do terminal/, "o motivo publicado pela execução tem precedência sobre o texto genérico");
  assert.match(client.workQueueHtml(), /2 desconhecidos/);
});

test("TSK-08: máquina que parou de responder não deixa 'Em execução' passar por verdade", async () => {
  const client = loadClient();
  const sock = await openExecution(client, [EXEC_ROOT, ...execItems()]);
  assert.deepEqual(client.workQueue().map((i) => i.bucket), ["done", "running", "queued"]);

  sock.deliver({ t: "execution_connection", runnerId: "local", state: "offline", at: 4_000 });

  const queue = client.workQueue();
  assert.equal(queue[0].bucket, "done", "estado terminal é durável: já terminou antes de a máquina cair");
  assert.equal(queue[1].bucket, "unknown", "o que estava rodando na máquina muda vira desconhecido");
  assert.equal(queue[2].bucket, "unknown", "e o que estava na fila também — ninguém pode dizer se começou");
  assert.match(queue[1].why, /Desktop/, "o motivo nomeia a máquina que parou de responder");
  assert.match(queue[1].why, /Em execução/, "e preserva qual era a última visão, em vez de apagá-la");
  assert.match(client.workQueueHtml(), /2 desconhecidos/, "e a fila DESENHADA muda junto — não basta o cálculo estar certo");
});

test("TSK-08: navegador que perde o Hub para de afirmar o que os itens estão fazendo", async () => {
  const client = loadClient();
  const sock = await openExecution(client, [EXEC_ROOT, ...execItems()]);
  assert.match(client.workQueueHtml(), /1 em execução/);

  // Sem socket não chega evento nenhum: continuar desenhando "Em execução" seria o painel garantindo
  // um presente que ele deixou de observar.
  sock.drop();

  assert.doesNotMatch(client.workQueueHtml(), /1 em execução/, "a fila desenhada tem de deixar de afirmar isso");
  assert.match(client.workQueueHtml(), /2 desconhecidos/);
  assert.match(client.workQueue()[1].why, /offline/);
});

test("TSK-08: item parado na fila diz quem ele está esperando", async () => {
  const client = loadClient();
  await openExecution(client, [EXEC_ROOT,
    execNode({ executionId: "item-1", title: "Propor desenho", state: "running", queuedAt: 1_001 }),
    execNode({ executionId: "item-2", title: "Revisar proposta", state: "queued", queuedAt: 1_002, dependsOn: ["item-1"] }),
  ]);

  const [, blocked] = client.workQueue();
  assert.match(blocked.why, /aguarda Propor desenho/, "'Na fila' para sempre parece travamento; a dependência explica");
});

test("TSK-08: fila que pode estar incompleta avisa, em vez de fingir que aquilo é tudo", async () => {
  const client = loadClient();
  // Página pendente na lista de trabalhos: pode haver itens desta execução que ainda não chegaram.
  await openExecution(client, [EXEC_ROOT, ...execItems()], { nextCursor: "pagina-2" });

  assert.match(client.workQueueHtml(), /não carregados/, "faltar item tem de ser distinguível de 'a execução só tem estes'");
});

test("TSK-08: execução sem itens não inventa uma fila", async () => {
  const client = loadClient();
  await openExecution(client, [EXEC_ROOT]);

  assert.deepEqual(client.workQueue(), []);
  assert.equal(client.workQueueHtml(), "", "sem itens não há fila para mostrar");
});

// TSK-07 (fatia G): a frase do chat que declara a fonte precisa aparecer IGUAL nos dois lugares — na
// gaveta da sessão e em Configurações → 🎯 Tarefas. Os frames abaixo não são inventados à mão: saem
// do MESMO parser, do MESMO plano e da MESMA store que o Hub usa, montados aqui como ele monta.
test("TSK-07: a fonte declarada por frase chega igual na gaveta e em Configurações", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-tsk-g-web-"));
  try {
    const proj = process.platform === "win32" ? "C:\\proj" : "/home/u/proj";
    const store = new ProjectTaskBindingStore({ dir, platform: process.platform, now: () => 1 });

    // O que o Hub faz ao reconhecer a frase, na mesma ordem.
    const command = parseTaskSourceCommand("a fonte de tarefas deste projeto é a pasta docs/roadmap")!;
    const planned = planTaskSourceCommand({ command, projectDir: proj, current: null, connections: [] });
    assert.equal(planned.ok, true);
    const binding = store.set(proj, (planned as { ok: true; plan: { binding: any } }).plan.binding);
    const source = resolveTaskSource({ projectDir: proj, binding, connections: [] });

    const client = loadClient();
    await authenticate(client, MACHINES);
    client.setSession("s-1", "local");
    const sock = client.socket();

    // 1) frame da sessão (o mesmo do botão da gaveta) e 2) a difusão que Configurações consome.
    sock.deliver({ t: "task_binding", sessionId: "s-1", cwd: proj, binding, source });
    sock.deliver({ t: "task_connections", connections: [], providers: [], bindings: store.list(), mcpMachines: [] });

    assert.equal(client.taskSource().kind, "local");
    assert.equal(client.taskSource().featuresDir, "docs/roadmap", "a gaveta mostra a pasta que ficou valendo");
    const naTela = client.taskBindings().find((row: any) => row.binding.featuresDir === "docs/roadmap");
    assert.ok(naTela, "Configurações lista o MESMO vínculo — é a mesma store, sem cópia paralela");
    assert.equal(naTela.binding.tracker, source.tracker);

    // 3) a confirmação no chat mostra o caminho RESOLVIDO, não um "ok".
    const reply = formatTaskSourceConfirmation({ projectDir: proj, decision: source });
    sock.deliver({ t: "message", message: { sessionId: "s-1", role: "assistant", text: reply, ts: 1, agent: "jarvis" } });
    // O texto do balão vive num neto (`div.innerHTML = md(text)`), então a varredura é recursiva.
    const flatten = (el: any): string => String(el?.innerHTML || "") + String(el?.textContent || "") + (el?.children || []).map(flatten).join("");
    assert.match(flatten(client.el("log")), /docs\/roadmap/, "a confirmação precisa chegar ao chat com a pasta, não um 'ok'");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("TSK-07: pasta fora do projeto é recusada antes de virar vínculo — a tela não muda", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-tsk-g-web-"));
  try {
    const proj = process.platform === "win32" ? "C:\\proj" : "/home/u/proj";
    const store = new ProjectTaskBindingStore({ dir, platform: process.platform, now: () => 1 });
    const command = parseTaskSourceCommand("a pasta de tarefas deste projeto é ../fora")!;
    const planned = planTaskSourceCommand({ command, projectDir: proj, current: null, connections: [] });
    assert.equal(planned.ok, false);

    const client = loadClient();
    await authenticate(client, MACHINES);
    client.setSession("s-1", "local");
    // O Hub não grava e não difunde vínculo nenhum; só o recado com o motivo volta para o chat.
    client.socket().deliver({ t: "task_connections", connections: [], providers: [], bindings: store.list(), mcpMachines: [] });
    assert.equal(client.taskBindings().length, 0, "recusa não pode deixar vínculo pela metade na tela");
    assert.match(!planned.ok ? planned.error : "", /fora do projeto/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── TSK-I (fatia I): marcar 1..N tarefas abre 1..N subsessões ligadas à sessão mãe. A regra travada
// do épico é "lista selecionada manda, senão o Jarvis interpreta — nunca os dois"; do lado do cliente
// isso significa que os dois nunca viajam no MESMO pedido.
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Coloca o cliente numa sessão com uma lista de features na tela. */
async function withTaskList(client: ClientHandle, files: any[]): Promise<FakeSocket> {
  const sock = await authenticate(client, MACHINES);
  client.setSession("s-mae", "local");
  sock.deliver({ t: "task_binding", sessionId: "s-mae", cwd: "C:/proj", binding: { tracker: "local", featuresDir: "docs/features" }, source: { kind: "local", tracker: "local", ready: true, featuresDir: "docs/features" } });
  sock.deliver({ t: "task_local_list", sessionId: "s-mae", dir: "docs/features", files, cached: false, scannedAt: 1 });
  return sock;
}

const FEATURES = [
  { key: "docs/features/a.md", title: "Tarefa A", description: "a" },
  { key: "docs/features/b.md", title: "Tarefa B" },
  { key: "docs/features/c.md", title: "Tarefa C" },
];

test("TSK-I: 3 marcadas viajam como SELEÇÃO — e a frase digitada não vai junto", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, FEATURES);
  for (const f of FEATURES) client.fanoutToggle({ tracker: "local", key: f.key, title: f.title });
  assert.equal(client.fanoutMarks().length, 3);

  client.fanoutAsk("e de quebra arruma o build e sobe a versão");

  const pedido = sock.sent.filter((f) => f.t === "task_fanout_plan").at(-1);
  assert.equal(pedido.selected.length, 3);
  // A ausência da frase é o critério: é ela que ligaria o interpretador no Hub. Mandar as duas
  // deixaria o servidor desempatar uma ambiguidade que aqui já estava resolvida.
  assert.equal("phrase" in pedido, false, "com item marcado, a frase não pode acompanhar o pedido");
  assert.deepEqual(pedido.selected.map((t: any) => t.title), ["Tarefa A", "Tarefa B", "Tarefa C"]);
});

test("TSK-I: sem nenhuma marca, o pedido leva a FRASE e não leva seleção", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, FEATURES);

  client.fanoutAsk("corrige o login e atualiza o README");

  const pedido = sock.sent.filter((f) => f.t === "task_fanout_plan").at(-1);
  assert.equal(pedido.phrase, "corrige o login e atualiza o README");
  assert.equal("selected" in pedido, false, "sem marcas não existe seleção para mandar");
});

test("TSK-I: desmarcar o último item devolve o pedido ao caminho da interpretação", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, FEATURES);
  const uma = { tracker: "local", key: "docs/features/a.md", title: "Tarefa A" };
  client.fanoutToggle(uma);
  client.fanoutToggle(uma);
  assert.equal(client.fanoutMarks().length, 0, "o mesmo item marcado duas vezes desmarca");

  client.fanoutAsk("duas coisas");
  const pedido = sock.sent.filter((f) => f.t === "task_fanout_plan").at(-1);
  assert.equal(pedido.phrase, "duas coisas");
  assert.equal("selected" in pedido, false);
});

test("TSK-I: nada é aberto antes da confirmação — e cancelar não abre nada", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, FEATURES);
  for (const f of FEATURES) client.fanoutToggle({ tracker: "local", key: f.key, title: f.title });
  client.fanoutAsk("");

  sock.deliver({ t: "task_fanout_plan", sessionId: "s-mae", ok: true, planId: "plan-1", origin: "selection",
    tasks: FEATURES.map((f) => ({ tracker: "local", key: f.key, title: f.title })), confirm: "Vou abrir 3 subsessões..." });
  await tick();

  assert.equal(sock.sent.filter((f) => f.t === "task_fanout_open").length, 0, "o plano NÃO abre sozinho");
  client.dlgCancel();
  await tick();
  assert.equal(sock.sent.filter((f) => f.t === "task_fanout_open").length, 0, "cancelar não abre sessão nenhuma");
});

test("TSK-I: confirmado, o cliente manda abrir o PLANO que o Hub emitiu (não a lista dele)", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, FEATURES);
  for (const f of FEATURES) client.fanoutToggle({ tracker: "local", key: f.key, title: f.title });
  client.fanoutAsk("");

  sock.deliver({ t: "task_fanout_plan", sessionId: "s-mae", ok: true, planId: "plan-1", origin: "selection",
    tasks: FEATURES.map((f) => ({ tracker: "local", key: f.key, title: f.title })), confirm: "Vou abrir 3 subsessões..." });
  await tick();
  client.dlgConfirm();
  await tick();

  const abrir = sock.sent.filter((f) => f.t === "task_fanout_open").at(-1);
  assert.equal(abrir.planId, "plan-1");
  // Só o id do plano viaja: reenviar a lista abriria o que o cliente quiser, não o que foi confirmado.
  assert.equal("tasks" in abrir, false);
});

test("TSK-I: as 3 subsessões abertas nascem com a SUA tarefa armada", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, FEATURES);
  for (const f of FEATURES) client.fanoutToggle({ tracker: "local", key: f.key, title: f.title });
  client.fanoutAsk("");
  sock.deliver({ t: "task_fanout_plan", sessionId: "s-mae", ok: true, planId: "plan-1", origin: "selection",
    tasks: FEATURES.map((f) => ({ tracker: "local", key: f.key, title: f.title, description: f.description })), confirm: "x" });
  await tick();
  client.dlgConfirm();
  await tick();

  sock.deliver({ t: "task_fanout_opened", ok: true, sessionId: "s-mae", runnerId: "local", origin: "selection",
    sessions: FEATURES.map((f, i) => ({ sessionId: `filha-${i}`, title: f.title, tracker: "local", key: f.key })) });

  assert.equal(client.taskArmFor("local", "filha-0").task.key, "docs/features/a.md");
  assert.equal(client.taskArmFor("local", "filha-2").label, "Tarefa C");
  assert.equal(client.taskArmFor("local", "s-mae"), null, "a mãe não é armada com a tarefa da filha");
  assert.equal(client.fanoutMarks().length, 0, "abriu: as marcas somem, senão o próximo clique abriria de novo");
});

test("TSK-I: plano por interpretação chega MARCADO como interpretação, com a frase de origem", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, []);

  client.fanoutAsk("corrige o login e atualiza o README");
  sock.deliver({ t: "task_fanout_plan", sessionId: "s-mae", ok: true, planId: "plan-2", origin: "interpretation",
    tasks: [{ tracker: "interpretada", key: "interpretada-1", title: "Corrigir o login" }, { tracker: "interpretada", key: "interpretada-2", title: "Atualizar o README" }],
    interpretedFrom: "corrige o login e atualiza o README", confirm: "Vou abrir 2 subsessões a partir da MINHA INTERPRETAÇÃO..." });
  await tick();

  const plano = client.fanoutPlan();
  assert.equal(plano.origin, "interpretation", "a UI precisa distinguir palpite de escolha");
  assert.equal(plano.tasks.length, 2);
  assert.equal(plano.interpretedFrom, "corrige o login e atualiza o README");
  client.dlgConfirm();
  await tick();
  assert.equal(sock.sent.filter((f) => f.t === "task_fanout_open").at(-1).planId, "plan-2");
});

test("TSK-I: dúvida do interpretador vira pergunta na tela, não sessão aberta", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, []);
  client.fanoutAsk("arruma aquilo");

  sock.deliver({ t: "task_fanout_plan", sessionId: "s-mae", ok: false, tasks: [], question: "são duas tarefas ou uma só?" });
  await tick();

  assert.equal(client.fanoutPlan(), null, "sem plano não há o que confirmar");
  assert.equal(sock.sent.filter((f) => f.t === "task_fanout_open").length, 0);
});

test("TSK-I: trocar a fonte do projeto joga fora as marcas da fonte antiga", async () => {
  const client = loadClient();
  const sock = await withTaskList(client, FEATURES);
  client.fanoutToggle({ tracker: "local", key: "docs/features/a.md", title: "Tarefa A" });
  assert.equal(client.fanoutMarks().length, 1);

  sock.deliver({ t: "task_binding", sessionId: "s-mae", cwd: "C:/proj", binding: { tracker: "jira", connectionId: "jira:acme" }, source: { kind: "provider", tracker: "jira", ready: true, connectionId: "jira:acme" } });

  assert.equal(client.fanoutMarks().length, 0, "marca de outra fonte abriria subsessão para tarefa que sumiu da lista");
});

test("TSK-I: a gaveta 🎯 desenha a marca de cada item e o botão com o número", async () => {
  const client = loadClient();
  await withTaskList(client, FEATURES);
  const texts = (node: any, out: string[] = []): string[] => {
    for (const child of node.children || []) { out.push(String(child.textContent || ""), String(child.innerHTML || "")); texts(child, out); }
    return out;
  };

  const find = (node: any, needle: string): any => {
    for (const child of node.children || []) {
      if (String(child.innerHTML || child.textContent || "").includes(needle)) return child;
      const deep = find(child, needle); if (deep) return deep;
    }
    return null;
  };

  const fechada = texts(client.buildTaskDrawer()).join("\n");
  // Sem marcas, abrir várias conversas é uma gaveta fechada: não disputa espaço com a tarefa do fluxo
  // nem empresta o campo dela. Aberta, o rótulo diz de onde sai o conteúdo (a frase ao lado).
  assert.match(fechada, /Abrir várias conversas/);
  assert.doesNotMatch(fechada, /abrir uma conversa por tarefa desta frase/, "fechada, não paga campo nem botão");
  find(client.buildTaskDrawer(), "Abrir várias conversas").onclick();
  const fanAberta = texts(client.buildTaskDrawer()).join("\n");
  assert.match(fanAberta, /abrir uma conversa por tarefa desta frase/);
  assert.doesNotMatch(fanAberta, /Interpretar e abrir/, "o rótulo opaco não volta");

  // A lista de arquivos é uma gaveta dentro da gaveta: só depois de abri-la existem itens a marcar.
  find(client.buildTaskDrawer(), "Arquivos de feature").onclick();
  const vazio = texts(client.buildTaskDrawer()).join("\n");
  assert.match(vazio, /Tarefa A/);
  assert.match(vazio, /☐/, "cada item da lista tem sua marca");

  for (const f of FEATURES) client.fanoutToggle({ tracker: "local", key: f.key, title: f.title });
  const marcado = texts(client.buildTaskDrawer()).join("\n");
  // O número aparece ANTES de qualquer sessão existir — é o aviso exigido para ação com efeito.
  assert.match(marcado, /Abrir 3 conversas/);
  assert.match(marcado, /seleção manda — a frase acima é ignorada/);
  assert.match(marcado, /☑/);
});
