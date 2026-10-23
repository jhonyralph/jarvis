/**
 * BRW-IDE-00 F2 — a IA no browser: níveis (§3.1), tokens por turno, liberação do nível 3 (expira no
 * fim do turno / Assumir / tempo), snapshot com refs, redação, esquema das ferramentas e a PONTE MCP
 * de verdade (processo stdio → HTTP loopback → serviço). Sem Chrome: o host é um falso que grava
 * cada comando — "recusado" aqui quer dizer que NENHUM comando que muda a página chegou ao browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserPageInfo, BrowserProfileName, BrowserStateInfo } from "@jarvis/protocol";
import {
  AxRefTable, BROWSER_AGENT_TOOLS, BROWSER_BRIDGE_SCRIPT, BROWSER_READ_TOOLS, BrowserAgentService, CLAUDE_BROWSER_ALLOWED_TOOLS, GRAB_FUNCTION,
  browserBridgeMcpServer, browserToolDecision, codexBrowserMcpArgs, ensureBrowserBridge, formatAxSnapshot, normalizeAgentUrl, parseKeyCombo, redactSecrets, serveBrowserBridgeHttp,
  type AxNode, type BrowserAgentHost,
} from "./browser-agent.js";

// Árvore real (forma do `Accessibility.getFullAXTree` medida no Chrome do spike da F2).
const AX: AxNode[] = [
  { nodeId: "4", role: { value: "RootWebArea" }, name: { value: "Spike" }, backendDOMNodeId: 4, childIds: ["6"] },
  { nodeId: "6", ignored: true, role: { value: "none" }, backendDOMNodeId: 6, parentId: "4", childIds: ["9"] },
  { nodeId: "9", ignored: true, role: { value: "none" }, backendDOMNodeId: 9, parentId: "6", childIds: ["10", "11", "13", "15", "17", "3", "30", "31"] },
  { nodeId: "10", role: { value: "heading" }, name: { value: "Olá mundo" }, properties: [{ name: "level", value: { value: 1 } }], backendDOMNodeId: 10, parentId: "9", childIds: ["32"] },
  { nodeId: "32", role: { value: "StaticText" }, name: { value: "Olá mundo" }, backendDOMNodeId: 32, parentId: "10", childIds: ["-1"] },
  { nodeId: "-1", role: { value: "InlineTextBox" }, name: { value: "Olá mundo" }, parentId: "32" },
  { nodeId: "11", role: { value: "navigation" }, name: { value: "" }, backendDOMNodeId: 11, parentId: "9", childIds: ["12"] },
  { nodeId: "12", role: { value: "link" }, name: { value: "Link um" }, properties: [{ name: "url", value: { value: "http://x/a" } }], backendDOMNodeId: 12, parentId: "11", childIds: ["33"] },
  { nodeId: "33", role: { value: "StaticText" }, name: { value: "Link um" }, backendDOMNodeId: 33, parentId: "12" },
  { nodeId: "13", role: { value: "LabelText" }, name: { value: "" }, backendDOMNodeId: 13, parentId: "9", childIds: ["34", "1"] },
  { nodeId: "34", role: { value: "StaticText" }, name: { value: "Nome " }, backendDOMNodeId: 34, parentId: "13" },
  { nodeId: "1", role: { value: "textbox" }, name: { value: "Nome" }, value: { value: "abc" }, backendDOMNodeId: 1, parentId: "13", childIds: ["14"] },
  { nodeId: "14", role: { value: "generic" }, name: { value: "" }, backendDOMNodeId: 14, parentId: "1", childIds: ["35"] },
  { nodeId: "35", role: { value: "StaticText" }, name: { value: "abc" }, backendDOMNodeId: 35, parentId: "14" },
  { nodeId: "15", role: { value: "LabelText" }, name: { value: "" }, backendDOMNodeId: 15, parentId: "9", childIds: ["36", "2"] },
  { nodeId: "36", role: { value: "StaticText" }, name: { value: "Senha " }, backendDOMNodeId: 36, parentId: "15" },
  { nodeId: "2", role: { value: "textbox" }, name: { value: "Senha" }, value: { value: "••••••••••" }, backendDOMNodeId: 2, parentId: "15", childIds: ["16"] },
  { nodeId: "16", role: { value: "generic" }, name: { value: "" }, backendDOMNodeId: 16, parentId: "2", childIds: ["37"] },
  { nodeId: "37", role: { value: "StaticText" }, name: { value: "••••••••••" }, backendDOMNodeId: 37, parentId: "16" },
  { nodeId: "17", role: { value: "button" }, name: { value: "Enviar agora" }, backendDOMNodeId: 17, parentId: "9", childIds: ["38"] },
  { nodeId: "38", role: { value: "StaticText" }, name: { value: "Enviar agora" }, backendDOMNodeId: 38, parentId: "17" },
  { nodeId: "3", role: { value: "combobox" }, name: { value: "" }, value: { value: "um" }, properties: [{ name: "expanded", value: { value: false } }], backendDOMNodeId: 3, parentId: "9", childIds: ["20"] },
  { nodeId: "20", role: { value: "MenuListPopup" }, name: { value: "" }, backendDOMNodeId: 20, parentId: "3", childIds: ["24", "27"] },
  { nodeId: "24", role: { value: "option" }, name: { value: "um" }, properties: [{ name: "selected", value: { value: true } }], backendDOMNodeId: 24, parentId: "20" },
  { nodeId: "27", role: { value: "option" }, name: { value: "dois" }, properties: [{ name: "selected", value: { value: false } }], backendDOMNodeId: 27, parentId: "20" },
  { nodeId: "30", role: { value: "checkbox" }, name: { value: "Marcar" }, properties: [{ name: "checked", value: { value: "true" } }], backendDOMNodeId: 30, parentId: "9", childIds: ["39"] },
  { nodeId: "39", role: { value: "StaticText" }, name: { value: "Marcar" }, backendDOMNodeId: 39, parentId: "30" },
  { nodeId: "31", role: { value: "paragraph" }, name: { value: "" }, backendDOMNodeId: 31, parentId: "9", childIds: ["40"] },
  { nodeId: "40", role: { value: "StaticText" }, name: { value: "token ghp_abcdefghijklmnopqrstuvwxyz123456 aqui" }, backendDOMNodeId: 40, parentId: "31" },
];

test("snapshot: árvore → texto com refs, senha oculta, sem repetir texto do nome, campo sem eco do valor", () => {
  const refs = new AxRefTable();
  const s = formatAxSnapshot(AX, refs, {});
  assert.match(s.text, /^- heading "Olá mundo" \[level=1\] \[ref=e\d+\]$/m);
  assert.match(s.text, /- link "Link um" \[url=http:\/\/x\/a\] \[ref=e\d+\]/);
  assert.match(s.text, /- textbox "Nome" \[value="abc"\] \[ref=e\d+\]/);
  assert.match(s.text, /- textbox "Senha" \[value=oculto\] \[ref=e\d+\]/);
  assert.doesNotMatch(s.text, /•/, "nada do valor mascarado do Chrome vaza nem como texto filho");
  assert.match(s.text, /- button "Enviar agora" \[ref=e\d+\]/);
  assert.equal((s.text.match(/Enviar agora/g) || []).length, 1, "o texto do botão não se repete como filho");
  assert.match(s.text, /- combobox \[value="um"\] \[expanded=false\] \[ref=e\d+\]\n {2}- option "um" \[selected\]/);
  assert.match(s.text, /- checkbox "Marcar" \[checked=true\]/);
  assert.doesNotMatch(s.text, /InlineTextBox|RootWebArea|- none|- generic/);
  assert.match(s.text, /ghp_abcdefghijklmnopqrstuvwxyz123456/, "perfil do agente: sem redação");
  assert.equal(s.truncated, false);
  // refs estáveis entre snapshots do mesmo documento; o ref resolve para o backendNodeId certo
  const btnRef = /- button "Enviar agora" \[ref=(e\d+)\]/.exec(s.text)![1];
  assert.equal(refs.backendFor(btnRef), 17);
  assert.equal(refs.backendFor(`[ref=${btnRef}]`), 17, "aceita o ref como aparece no texto");
  const again = formatAxSnapshot(AX, refs, {});
  assert.equal(/- button "Enviar agora" \[ref=(e\d+)\]/.exec(again.text)![1], btnRef);
  // documento novo zera
  refs.reset("L2");
  assert.equal(refs.backendFor(btnRef), undefined);
});

test("snapshot: redação no perfil do dono, subárvore por ref e corte por tamanho", () => {
  const refs = new AxRefTable();
  const red = formatAxSnapshot(AX, refs, { redact: true });
  assert.doesNotMatch(red.text, /ghp_abc/);
  assert.match(red.text, /\[redacted\]/);
  assert.equal(red.redactions, 1);
  const sub = formatAxSnapshot(AX, refs, { rootBackendId: 3 });
  assert.match(sub.text, /^- combobox/);
  assert.doesNotMatch(sub.text, /Enviar/);
  const many: AxNode[] = [{ nodeId: "r", role: { value: "RootWebArea" }, childIds: Array.from({ length: 400 }, (_, i) => "n" + i) },
    ...Array.from({ length: 400 }, (_, i) => ({ nodeId: "n" + i, parentId: "r", role: { value: "button" }, name: { value: "Botão número " + i }, backendDOMNodeId: 1000 + i }))];
  const cut = formatAxSnapshot(many, new AxRefTable(), { maxChars: 2000 });
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length <= 2000, String(cut.text.length));
  assert.ok(cut.omitted > 300, String(cut.omitted));
});

test("redação de segredos (porta do Design Mode)", () => {
  const r = redactSecrets("Authorization: Bearer abcdefghijklmnop.qrs e sk-ABCDEFGHIJKLMNOPQRSTUV e eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4 fim");
  assert.equal(r.count, 3);
  assert.doesNotMatch(r.text, /abcdefghijklmnop\.qrs|sk-ABCD|eyJhbGci/);
  assert.match(r.text, /Bearer \[redacted\]/);
  assert.equal(redactSecrets("texto normal, nada aqui").count, 0);
});

test("teclas e URL que a IA pode abrir", () => {
  assert.deepEqual(parseKeyCombo("Enter"), { key: "Enter", modifiers: 0 });
  assert.deepEqual(parseKeyCombo("Control+Shift+K"), { key: "K", modifiers: 2 | 8 });
  assert.deepEqual(parseKeyCombo("ctrl+a"), { key: "a", modifiers: 2 });
  assert.deepEqual(parseKeyCombo("esc"), { key: "Escape", modifiers: 0 });
  assert.deepEqual(parseKeyCombo("arrowdown"), { key: "ArrowDown", modifiers: 0 });
  assert.deepEqual(parseKeyCombo("+"), { key: "+", modifiers: 0 });
  assert.equal(parseKeyCombo("Hyper+X"), null);
  assert.equal(parseKeyCombo("NotAKey"), null);
  assert.equal(normalizeAgentUrl("example.com"), "https://example.com");
  assert.equal(normalizeAgentUrl("localhost:3000/x"), "http://localhost:3000/x");
  assert.equal(normalizeAgentUrl("about:blank"), "about:blank");
  for (const bad of ["javascript:alert(1)", "file:///C:/Users", "chrome://settings/passwords", "view-source:https://x", "data:text/html,<b>x", "ftp://x/y"]) assert.equal(normalizeAgentUrl(bad), null, bad);
});

test("esquema MCP das ferramentas: nomes únicos, objeto, required ⊂ properties, sem eval/cookies", () => {
  const names = BROWSER_AGENT_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of BROWSER_AGENT_TOOLS) {
    assert.match(t.name, /^browser_[a-z_]+$/);
    assert.ok(t.description.length > 10, t.name);
    const sch = t.inputSchema as any;
    assert.equal(sch.type, "object", t.name);
    for (const r of sch.required || []) assert.ok(r in sch.properties, `${t.name}.${r}`);
    if (sch.properties.profile) assert.deepEqual(sch.properties.profile.enum, ["agent", "owner"]);
  }
  for (const r of BROWSER_READ_TOOLS) assert.ok(names.includes(r), r);
  assert.ok(!names.some((n) => /eval|script|cookie|storage|execute|javascript/i.test(n)), "nenhuma ferramenta de JS/cookie em nenhum nível");
  // A ponte embute exatamente este conjunto
  assert.ok(BROWSER_BRIDGE_SCRIPT.includes(JSON.stringify(BROWSER_AGENT_TOOLS)));
  assert.doesNotThrow(() => new Function(`return (${GRAB_FUNCTION})`), "a função de seleção compila como JS puro");
});

// ------------------------------------------------------------------------------------------ nível

const ACTIONS = BROWSER_AGENT_TOOLS.map((t) => t.name).filter((n) => !BROWSER_READ_TOOLS.has(n));
test("nível (§3.1): cada ferramenta × perfil × liberação × modo planejamento", () => {
  for (const tool of BROWSER_AGENT_TOOLS.map((t) => t.name)) {
    const read = BROWSER_READ_TOOLS.has(tool);
    // Ver: dono, sem liberação
    const ver = browserToolDecision({ tool, profile: "owner", ownerDrive: false });
    assert.deepEqual(ver, read ? { ok: true, level: "ver" } : { ok: false, reason: (ver as any).reason }, tool);
    if (!read) assert.match((ver as any).reason, /só leitura/);
    // Dirigir no perfil do agente
    assert.deepEqual(browserToolDecision({ tool, profile: "agent", ownerDrive: false }), { ok: true, level: "agente" }, tool);
    // Dirigir no perfil do dono (liberado)
    assert.deepEqual(browserToolDecision({ tool, profile: "owner", ownerDrive: true }), { ok: true, level: read ? "ver" : "dono" }, tool);
    // Modo planejamento: só leitura em qualquer perfil
    for (const profile of ["owner", "agent"] as BrowserProfileName[]) {
      const d = browserToolDecision({ tool, profile, ownerDrive: true, readOnly: true });
      assert.equal(d.ok, read, `${tool}/${profile}/plan`);
    }
  }
  assert.equal(browserToolDecision({ tool: "browser_evaluate", profile: "agent", ownerDrive: true }).ok, false);
  assert.equal(browserToolDecision({ tool: "browser_click", profile: "root" as any, ownerDrive: true }).ok, false);
  assert.ok(ACTIONS.length >= 8);
});

// ------------------------------------------------------------------------------- host falso

const MUTATING = /^(navigate|tab:new|tab:close|dialog|cmd:[^:]+:(Input\.|DOM\.focus|Runtime\.callFunctionOn))/;
function fakeHost(opts: { ownerRunning?: boolean } = {}) {
  const calls: string[] = [];
  const pages: Record<BrowserProfileName, BrowserPageInfo[]> = {
    owner: [{ pageId: "OWNER1", url: "https://banco.example/", title: "Banco" }],
    agent: [{ pageId: "AGENT1", url: "about:blank", title: "" }],
  };
  const running: Record<BrowserProfileName, boolean> = { owner: opts.ownerRunning !== false, agent: false };
  const state = (p: BrowserProfileName): BrowserStateInfo => ({ profile: p, running: running[p], pages: running[p] ? pages[p] : [], activePageId: running[p] ? pages[p][0]?.pageId : undefined });
  const host: BrowserAgentHost = {
    available: true,
    allows: () => true,
    open: async (p) => { calls.push("open:" + p); running[p] = true; return state(p); },
    state, isRunning: (p) => running[p],
    profileOf: (id) => (["owner", "agent"] as BrowserProfileName[]).find((p) => running[p] && pages[p].some((x) => x.pageId === id)),
    pageInfo: (id) => [...pages.owner, ...pages.agent].find((x) => x.pageId === id),
    tab: async (op, a) => { calls.push(`tab:${op}:${a.profile || a.pageId || ""}`); if (op === "new") { const id = "AGENT" + (pages[a.profile || "owner"].length + 1); pages[a.profile || "owner"].push({ pageId: id, url: a.url || "about:blank", title: "" }); return id; } return a.pageId; },
    navigate: async (id, nav) => { calls.push(`navigate:${id}:${nav.url || nav.action}`); },
    dialog: async (id) => { calls.push("dialog:" + id); },
    pageCommand: async (id, method, params: any = {}) => {
      calls.push(`cmd:${id}:${method}`);
      switch (method) {
        case "Accessibility.getFullAXTree": return { nodes: AX };
        case "Page.getFrameTree": return { frameTree: { frame: { id, loaderId: "L1" } } };
        case "Page.createIsolatedWorld": return { executionContextId: 7 };
        case "Runtime.evaluate": {
          const e = String(params.expression);
          if (e.includes("location.href, document.title")) return { result: { value: [pages.owner.concat(pages.agent).find((x) => x.pageId === id)?.url || "", "Título", "complete"] } };
          if (e.includes("innerText.indexOf")) return { result: { value: true } };
          if (e.includes("elementFromPoint")) return { result: { value: { url: "https://banco.example/conta?t=eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4", title: "Banco", tag: "button", selector: "#pagar", role: "button", name: "Pagar", text: "Pagar boleto", attributes: { id: "pagar", "data-k": "sk-ABCDEFGHIJKLMNOPQRSTUV" }, htmlSnippet: "<button id=\"pagar\">Pagar boleto</button>", rect: { x: 10, y: 20, width: 100, height: 30 }, viewport: { width: 1264, height: 701 }, scroll: { x: 0, y: 400 }, redactions: 0 } } };
          if (e.includes("scrollY")) return { result: { value: [0, 600, 3000, 700] } };
          return { result: { value: null } };
        }
        case "DOM.getContentQuads": return { quads: [[10, 10, 110, 10, 110, 40, 10, 40]] };
        case "Page.getLayoutMetrics": return { cssLayoutViewport: { clientWidth: 1000, clientHeight: 700 }, cssVisualViewport: { pageX: 0, pageY: 0 } };
        case "Page.captureScreenshot": calls.push("clip:" + JSON.stringify(params.clip || null)); return { data: "QUJDRA==" };
        case "DOM.resolveNode": return { object: { objectId: "obj1" } };
        default: return {};
      }
    },
  };
  return { host, calls, pages, running };
}

const argsFor = (tool: string, profile: BrowserProfileName, ref: string): Record<string, unknown> => ({
  browser_tabs: { profile }, browser_snapshot: { profile }, browser_screenshot: { profile }, browser_wait: { profile, ms: 1 },
  browser_navigate: { profile, url: "example.com" }, browser_click: { profile, ref }, browser_type: { profile, ref, text: "minha-senha-123", submit: true },
  browser_press: { profile, key: "Enter" }, browser_scroll: { profile, dy: 300 }, browser_new_tab: { profile, url: "example.com" },
  browser_close_tab: { profile, pageId: profile === "owner" ? "OWNER1" : "AGENT1" }, browser_handle_dialog: { profile, accept: true },
}[tool] || {});

test("serviço: cada ferramenta × cada nível no host — recusa não encosta no browser; auditoria sem texto digitado", async () => {
  for (const scenario of ["ver", "agente", "dono", "plan"] as const) {
    for (const tool of BROWSER_AGENT_TOOLS.map((t) => t.name)) {
      const { host, calls, pages } = fakeHost();
      pages.owner[0].dialog = tool === "browser_handle_dialog" ? { type: "confirm", message: "ok?" } : undefined;
      pages.agent[0].dialog = tool === "browser_handle_dialog" ? { type: "confirm", message: "ok?" } : undefined;
      const actions: any[] = [];
      const svc = new BrowserAgentService(host, { onAction: (a) => actions.push(a) });
      const token = svc.openTurn("S1", { readOnly: scenario === "plan" });
      const profile: BrowserProfileName = scenario === "agente" ? "agent" : "owner";
      if (scenario === "dono" || scenario === "plan") svc.setOwnerDrive("S1", true);
      // refs vêm de um snapshot (leitura vale em todo nível)
      let ref = "e1";
      if (tool !== "browser_handle_dialog") {
        const snap = await svc.call(token, "browser_snapshot", { profile });
        assert.equal(snap.ok, true, `${scenario}/${tool}: snapshot ${snap.error}`);
        ref = /button "Enviar agora" \[ref=(e\d+)\]/.exec((snap.content[0] as any).text)![1];
      }
      calls.length = 0; actions.length = 0;
      const r = await svc.call(token, tool, argsFor(tool, profile, ref));
      const read = BROWSER_READ_TOOLS.has(tool);
      const allowed = read || scenario === "agente" || scenario === "dono";
      assert.equal(r.ok, allowed, `${scenario}/${tool}: ${r.error}`);
      if (!allowed) assert.deepEqual(calls.filter((c) => MUTATING.test(c)), [], `${scenario}/${tool} não pode encostar no browser`);
      else if (!read) assert.ok(calls.some((c) => MUTATING.test(c)), `${scenario}/${tool} deveria agir: ${calls.join(" ")}`);
      // perfil do dono nunca é LANÇADO pela leitura; o do agente sobe sob demanda
      if (scenario === "agente") assert.ok(!calls.includes("open:owner"));
      assert.equal(actions.length, 1, `${scenario}/${tool}: uma linha de auditoria`);
      assert.equal(actions[0].ok, allowed);
      assert.equal(actions[0].sessionId, "S1");
      assert.doesNotMatch(JSON.stringify(actions), /minha-senha-123/, "texto digitado nunca vai para a auditoria");
    }
  }
});

test("serviço: token por turno, Hub desconectado, aba de outro perfil, browser do dono fechado", async () => {
  const { host, calls } = fakeHost({ ownerRunning: false });
  let linkUp = true;
  const svc = new BrowserAgentService(host, { canAct: () => linkUp });
  assert.equal((await svc.call("nada", "browser_tabs", {})).ok, false, "sem turno não há ferramenta");
  const tok = svc.openTurn("S1");
  // Ver no dono com o browser dele fechado: a IA NÃO abre o browser do dono
  const closed = await svc.call(tok, "browser_snapshot", { profile: "owner" });
  assert.equal(closed.ok, false);
  assert.match(closed.error!, /fechado/);
  assert.ok(!calls.includes("open:owner"));
  // perfil do agente sobe sob demanda
  assert.equal((await svc.call(tok, "browser_tabs", {})).ok, true);
  assert.ok(calls.includes("open:agent"));
  // aba do dono passada numa chamada do perfil do agente: recusada (a checagem que segura o nível)
  await host.open("owner");
  calls.length = 0;
  const cross = await svc.call(tok, "browser_navigate", { profile: "agent", pageId: "OWNER1", url: "evil.example" });
  assert.equal(cross.ok, false);
  assert.match(cross.error!, /não existe no browser do agente/);
  assert.deepEqual(calls.filter((c) => MUTATING.test(c)), []);
  // URL proibida
  const js = await svc.call(tok, "browser_navigate", { profile: "agent", url: "javascript:alert(1)" });
  assert.equal(js.ok, false);
  // Hub caiu: tudo recusado
  linkUp = false;
  const down = await svc.call(tok, "browser_tabs", {});
  assert.equal(down.ok, false);
  assert.match(down.error!, /Hub desconectado/);
  linkUp = true;
  // fim do turno: o token morre
  svc.closeTurn(tok);
  assert.equal((await svc.call(tok, "browser_tabs", {})).ok, false);
});

test("nível 3: liga por sessão, expira no fim do turno, no Assumir e no tempo máximo", async () => {
  let now = 1_000_000;
  const states: any[][] = [];
  const { host } = fakeHost();
  const svc = new BrowserAgentService(host, { now: () => now, grantTtlMs: 60_000, onGrants: (g) => states.push(g) });
  const click = async (tok: string) => {
    const snap = await svc.call(tok, "browser_snapshot", { profile: "owner" });
    const ref = /button "Enviar agora" \[ref=(e\d+)\]/.exec((snap.content[0] as any).text)![1];
    return svc.call(tok, "browser_click", { profile: "owner", ref });
  };
  // liberado ANTES do turno: vale durante o próximo turno e cai quando ele termina
  svc.setOwnerDrive("S1", true);
  assert.equal(states.at(-1)!.length, 1);
  assert.equal(states.at(-1)![0].turnActive, false);
  const t1 = svc.openTurn("S1");
  assert.equal(states.at(-1)![0].turnActive, true, "o painel sabe que a IA pode estar agindo");
  assert.equal((await click(t1)).ok, true);
  // outra sessão não herda a liberação
  const other = svc.openTurn("S2");
  assert.equal((await click(other)).ok, false);
  svc.closeTurn(other);
  assert.equal(svc.grants().length, 1, "fim de turno de OUTRA sessão não derruba");
  svc.closeTurn(t1);
  assert.deepEqual(svc.grants(), [], "fim do turno expira a liberação");
  assert.deepEqual(states.at(-1), []);
  const t2 = svc.openTurn("S1");
  assert.equal((await click(t2)).ok, false, "turno seguinte volta ao só-leitura");
  // ligado DURANTE o turno, e "Assumir"
  svc.setOwnerDrive("S1", true);
  assert.equal((await click(t2)).ok, true);
  svc.revokeAll("assumir");
  assert.equal((await click(t2)).ok, false, "Assumir revoga na hora");
  // teto de tempo
  svc.setOwnerDrive("S1", true);
  now += 61_000;
  assert.equal((await click(t2)).ok, false, "passou do teto");
  assert.deepEqual(svc.grants(), []);
  // desligar explicitamente
  svc.setOwnerDrive("S1", true);
  svc.setOwnerDrive("S1", false);
  assert.equal((await click(t2)).ok, false);
  svc.closeTurn(t2);
});

test("seleção de pontos: elemento + recorte em coordenadas do documento, segredos redigidos de novo no host", async () => {
  const { host, calls } = fakeHost();
  const svc = new BrowserAgentService(host);
  const g = await svc.grab("OWNER1", 50, 30);
  assert.equal(g.tag, "button");
  assert.equal(g.selector, "#pagar");
  assert.equal(g.text, "Pagar boleto");
  assert.doesNotMatch(JSON.stringify(g), /eyJhbGci|sk-ABCD/);
  assert.equal(g.redactions, 2);
  assert.equal(g.image, "data:image/jpeg;base64,QUJDRA==");
  const clip = JSON.parse(calls.find((c) => c.startsWith("clip:"))!.slice(5));
  assert.equal(clip.x, 4); // 10 - 6 de folga
  assert.equal(clip.y, 414, "rolagem somada: o clip do CDP é em coordenadas do documento");
  await assert.rejects(svc.grab("NAO-EXISTE", 1, 1), /aba não encontrada/);
});

// ----------------------------------------------------------------------- ponte MCP (stdio → HTTP)

function rpc(child: ReturnType<typeof spawn>) {
  let buf = "";
  const waiting = new Map<number, (v: any) => void>();
  child.stdout!.on("data", (d) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); waiting.get(m.id)?.(m); } catch { /* ignore */ } }
  });
  let id = 0;
  return (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const my = ++id;
    const timer = setTimeout(() => reject(new Error("timeout " + method)), 15000);
    waiting.set(my, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n");
  });
}

test("ponte MCP de verdade: processo stdio lista as ferramentas e chama o serviço pelo HTTP loopback com o token do turno", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-brbridge-"));
  const { host } = fakeHost();
  const svc = new BrowserAgentService(host);
  const server: Server = createServer((req, res) => serveBrowserBridgeHttp(svc, req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as any).port}/internal/browser`;
  const token = svc.openTurn("S1");
  const path = ensureBrowserBridge(dir);
  assert.equal(readFileSync(path, "utf8"), BROWSER_BRIDGE_SCRIPT);
  const cfg = browserBridgeMcpServer({ url, token }, path);
  const child = spawn(process.execPath, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const call = rpc(child);
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "1" } });
    assert.equal(init.result.serverInfo.name, "jarvisbrowser");
    assert.match(init.result.instructions, /profile:"agent"/);
    const list = await call("tools/list");
    assert.deepEqual(list.result.tools.map((t: any) => t.name), BROWSER_AGENT_TOOLS.map((t) => t.name));
    const tabs = await call("tools/call", { name: "browser_tabs", arguments: { profile: "owner" } });
    assert.equal(tabs.result.isError, false);
    assert.match(tabs.result.content[0].text, /OWNER1 · Banco/);
    const shot = await call("tools/call", { name: "browser_screenshot", arguments: { profile: "owner" } });
    assert.equal(shot.result.content[0].type, "image");
    assert.equal(shot.result.content[0].mimeType, "image/jpeg");
    const denied = await call("tools/call", { name: "browser_navigate", arguments: { profile: "owner", url: "example.com" } });
    assert.equal(denied.result.isError, true);
    assert.match(denied.result.content[0].text, /só leitura/);
    // turno acabou: a mesma ponte não consegue mais nada
    svc.closeTurn(token);
    const late = await call("tools/call", { name: "browser_tabs", arguments: {} });
    assert.equal(late.result.isError, true);
    assert.match(late.result.content[0].text, /turno/);
  } finally {
    child.kill();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registro na IA: entrada do mcp-config do Claude e overrides -c do Codex", () => {
  const access = { url: "http://127.0.0.1:5/internal/browser", token: "tok123" };
  const claude = browserBridgeMcpServer(access, "C:\\Users\\x\\.jarvis\\browser-bridge.mjs");
  assert.deepEqual(claude, { command: "node", args: ["C:/Users/x/.jarvis/browser-bridge.mjs"], env: { JARVIS_BROWSER_URL: access.url, JARVIS_BROWSER_TOKEN: "tok123" } });
  assert.equal(CLAUDE_BROWSER_ALLOWED_TOOLS, "mcp__jarvisbrowser");
  const codex = codexBrowserMcpArgs(access, "/home/x/.jarvis/browser-bridge.mjs");
  const pairs = codex.filter((_, i) => i % 2 === 1);
  assert.ok(codex.filter((_, i) => i % 2 === 0).every((f) => f === "-c"));
  assert.ok(pairs.includes('mcp_servers.jarvisbrowser.command="node"'));
  assert.ok(pairs.includes('mcp_servers.jarvisbrowser.args=["/home/x/.jarvis/browser-bridge.mjs"]'));
  assert.ok(pairs.includes('mcp_servers.jarvisbrowser.env.JARVIS_BROWSER_TOKEN="tok123"'));
  assert.ok(pairs.includes('mcp_servers.jarvisbrowser.default_tools_approval_mode="approve"'));
});
