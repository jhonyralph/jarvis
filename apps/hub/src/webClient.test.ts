/**
 * Regression tests for the WEB CLIENT (apps/hub/web/app.js).
 *
 * That file carries the whole machine/session routing model and had zero coverage — the Desktop⇄Luby
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
  { id: "luby-1", label: "Luby", local: false, online: true, agents: ["claude-code"] },
];

test("client boots into the unified view and STAYS there across a reconnect", async () => {
  const client = loadClient({ machine: "all" });
  await authenticate(client, MACHINES);

  // Regression: postAuth() flagged 'all' as a machine to restore; the 'machines' handler then found no
  // machines[].id === 'all', fell into the else, and dropped the view to 'local' while the aggregated
  // (two-machine) list stayed on screen — with the per-row machine chips gone, since those only render
  // when currentMachine === 'all'. That is exactly the "Desktop stuff on Luby" report.
  assert.equal(client.currentMachine, "all", "a visão unificada não pode virar 'local' sozinha");
  assert.equal(client.store["jarvis_machine"], "all", "a preferência salva não pode ser apagada");
  assert.equal(client.restoringMachine, false, "'all' não é uma máquina a restaurar");
});

test("a reconnect resets routedMachine so the client re-asserts routing to the Hub", async () => {
  const client = loadClient({ machine: "all" });
  const sock = await authenticate(client, MACHINES);

  // The Hub's clientRunner is per-socket and starts at LOCAL. If the client kept believing it was
  // still routed to Luby, openSession() would skip {t:'runner'} and every open/send would execute on
  // the Desktop against a session id that only exists on Luby.
  assert.equal(client.routedMachine, "local", "socket novo => o espelho do roteamento volta a 'local'");

  sock.sent.length = 0;
  client.openSession("sessao-da-luby", "luby-1");
  const runnerFrames = sock.sent.filter((f) => f && f.t === "runner");
  assert.deepEqual(runnerFrames.map((f) => f.runnerId), ["luby-1"], "abrir sessão remota tem de reafirmar a máquina");
  const openFrame = sock.sent.find((f) => f && f.t === "open");
  assert.ok(openFrame, "o open precisa ser enviado");
  assert.ok(sock.sent.indexOf(runnerFrames[0]) < sock.sent.indexOf(openFrame), "{t:'runner'} tem de vir ANTES do open");
});

test("a real remote machine IS restored after a reconnect", async () => {
  const client = loadClient({ machine: "luby-1" });
  const sock = await authenticate(client, MACHINES);

  // The counterpart of the fix: a genuine runner id must still be re-selected on the Hub, otherwise
  // the machine bar shows Luby while the Hub serves the Desktop.
  assert.equal(client.currentMachine, "luby-1");
  assert.ok(sock.sent.some((f) => f && f.t === "runner" && f.runnerId === "luby-1"), "deve reenviar {t:'runner'} para a máquina salva");
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
    { id: "s-luby", title: "Luby 1", runnerId: "luby-1", machine: "Luby", updatedAt: 100 },
  ], machines: [
    { runnerId: "local", label: "Desktop", online: true, contributed: true },
    { runnerId: "luby-1", label: "Luby", online: true, contributed: true },
  ] });
  assert.deepEqual(client.sessions.map((s: any) => s.id), ["s-desktop", "s-luby"]);

  // A stray single-machine list must NOT replace the aggregate — that would drop the other machine's
  // sessions and leave the rows unlabelled.
  sock.deliver({ t: "sessions", runnerId: "luby-1", sessions: [{ id: "s-luby", title: "Luby 1", updatedAt: 100 }], recentDirs: [] });
  assert.deepEqual(client.sessions.map((s: any) => s.id), ["s-desktop", "s-luby"], "lista de máquina única não pode sobrescrever o agregado");
});

test("a machine missing from the unified view is named, not silently dropped", async () => {
  const client = loadClient({ machine: "all" });
  const sock = await authenticate(client, MACHINES);

  // Offline and online-but-silent are different failures and the user needs to tell them apart —
  // before this, both just produced a shorter list with no explanation.
  sock.deliver({ t: "sessions", runnerId: "all", sessions: [{ id: "s-desktop", runnerId: "local", machine: "Desktop", updatedAt: 1 }], machines: [
    { runnerId: "local", label: "Desktop", online: true, contributed: true },
    { runnerId: "luby-1", label: "Luby", online: false, contributed: false },
  ] });
  const warning = client.recentsRows.find((r) => r.includes("⚠"));
  assert.ok(warning, "a visão parcial precisa avisar quais máquinas ficaram de fora");
  assert.match(warning!, /Luby \(offline\)/);

  sock.deliver({ t: "sessions", runnerId: "all", sessions: [{ id: "s-desktop", runnerId: "local", machine: "Desktop", updatedAt: 1 }], machines: [
    { runnerId: "local", label: "Desktop", online: true, contributed: true },
    { runnerId: "luby-1", label: "Luby", online: true, contributed: false },
  ] });
  assert.match(client.recentsRows.find((r) => r.includes("⚠"))!, /Luby \(não respondeu\)/);

  // Complete aggregation => no warning at all.
  sock.deliver({ t: "sessions", runnerId: "all", sessions: [{ id: "s-desktop", runnerId: "local", machine: "Desktop", updatedAt: 1 }], machines: [
    { runnerId: "local", label: "Desktop", online: true, contributed: true },
    { runnerId: "luby-1", label: "Luby", online: true, contributed: true },
  ] });
  assert.equal(client.recentsRows.find((r) => r.includes("⚠")), undefined, "visão completa não mostra aviso");
});
