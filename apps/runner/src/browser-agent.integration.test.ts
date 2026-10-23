/**
 * BRW-IDE-00 F2 com Chrome HEADLESS DE VERDADE: as ferramentas da IA sobre o `BrowserManager` real.
 *
 * Prova: snapshot → clique por ref → a navegação acontece; digitar + Enter envia o formulário; o nível
 * Ver recusa ação no perfil do dono (a página NÃO muda); o perfil do agente não enxerga os cookies do
 * dono (perfis isolados); a seleção de pontos acha o elemento, recorta a imagem e não vaza senha; o
 * nível 3 liberado deixa clicar no perfil do dono e cai no fim do turno. Perfis SEMPRE em pasta
 * temporária (nunca ~/.jarvis/browser); no fim, nenhum Chrome com essas pastas pode sobrar.
 * Pulado sozinho quando a máquina não tem Chrome/Edge/Chromium.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import WebSocket from "ws";
import { BrowserAgentService, BrowserManager, listProcesses, matchesProfileCmdline, resolveBrowserExecutable } from "@jarvis/core";

const exe = resolveBrowserExecutable().path;
const skip = exe ? false : "sem Chrome/Edge/Chromium nesta máquina";

const HOME_PAGE = `<!doctype html><meta charset=utf-8><title>inicio</title>
<style>body{margin:0;font:16px system-ui}#go{position:absolute;left:20px;top:20px;width:220px;height:60px}</style>
<button id=go onclick="location.href='/next'">Ir para a próxima</button>
<form action="/busca" method=get style="position:absolute;left:20px;top:120px"><label>Busca <input id=q name=q></label></form>
<label style="position:absolute;left:20px;top:200px">Senha <input id=pw type=password value="segredo-do-dono-123"></label>`;

let server: Server, base = "", root = "";
let mgr: BrowserManager;

function page(req: any, res: any): void {
  const u = new URL(req.url || "/", "http://x");
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (u.pathname === "/next") { res.end(`<!doctype html><meta charset=utf-8><title>proxima</title><h1>Chegou</h1>`); return; }
  if (u.pathname === "/busca") { res.end(`<!doctype html><meta charset=utf-8><title>busca:${(u.searchParams.get("q") || "").replace(/[<&]/g, "")}</title><p>ok`); return; }
  if (u.pathname === "/setcookie") { res.setHeader("set-cookie", "sess=dono123; Path=/; Max-Age=3600"); res.end(`<!doctype html><title>cookie</title><p>ok`); return; }
  if (u.pathname === "/whoami") { const c = String(req.headers.cookie || "sem-cookie").replace(/[<&]/g, ""); res.end(`<!doctype html><meta charset=utf-8><title>whoami</title><p id=c>cookie: ${c}</p>`); return; }
  res.end(HOME_PAGE);
}

before(async () => {
  if (skip) return;
  server = createServer(page);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  root = mkdtempSync(join(tmpdir(), "jarvis-f2-agent-"));
  mgr = new BrowserManager({ executablePath: exe, rootDir: root, allowedProfiles: ["owner", "agent"], idleMs: 0, connect: (url) => new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 }) });
});

after(async () => {
  if (skip) return;
  await mgr.shutdown().catch(() => {});
  server.close();
  // Nenhum Chrome com as pastas temporárias pode sobrar.
  const rows = await listProcesses(basename(exe!));
  const left = (rows || []).filter((r) => matchesProfileCmdline(r.cmdline, join(root, "owner")) || matchesProfileCmdline(r.cmdline, join(root, "agent")));
  rmSync(root, { recursive: true, force: true });
  assert.deepEqual(left.map((r) => r.pid), [], "Chrome órfão dos perfis de teste");
});

const textOf = (r: { content: any[] }) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const refOf = (snap: string, re: RegExp) => { const m = re.exec(snap); assert.ok(m, `ref não achado em:\n${snap}`); return m![1]; };
async function ownerNavigate(url: string): Promise<string> {
  const st = await mgr.open("owner");
  const pageId = st.activePageId || st.pages[0].pageId;
  await mgr.navigate(pageId, { url });
  for (let i = 0; i < 100; i++) { const r = await mgr.pageCommand(pageId, "Runtime.evaluate", { expression: "[location.href, document.readyState]", returnByValue: true }); const [href, rs] = r.result.value; if (href.startsWith(url) && rs === "complete") break; await new Promise((x) => setTimeout(x, 50)); }
  return pageId;
}

test("agente: snapshot → clique por ref navega; digitar + Enter envia o formulário", { skip }, async () => {
  const svc = new BrowserAgentService(mgr);
  const tok = svc.openTurn("S1");
  const nav = await svc.call(tok, "browser_navigate", { url: base + "/" });
  assert.equal(nav.ok, true, nav.error);
  assert.equal(mgr.isRunning("agent"), true, "perfil do agente subiu sob demanda");
  assert.equal(mgr.isRunning("owner"), false, "a IA não abriu o browser do dono");
  const snap = await svc.call(tok, "browser_snapshot", {});
  assert.equal(snap.ok, true, snap.error);
  const s = textOf(snap);
  assert.match(s, /URL: http:\/\/127\.0\.0\.1:\d+\/\nTítulo: inicio/);
  assert.match(s, /\[value=oculto\]/, "o valor da senha não aparece");
  assert.doesNotMatch(s, /segredo-do-dono-123/);
  const btn = refOf(s, /button "Ir para a próxima" \[ref=(e\d+)\]/);
  const click = await svc.call(tok, "browser_click", { ref: btn });
  assert.equal(click.ok, true, click.error);
  assert.match(textOf(click), /A página foi para http:\/\/127\.0\.0\.1:\d+\/next/);
  // ref velho depois da navegação: recusa clara em vez de clicar no lugar errado
  const stale = await svc.call(tok, "browser_click", { ref: btn });
  assert.equal(stale.ok, false);
  assert.match(stale.error!, /snapshot/);
  await svc.call(tok, "browser_navigate", { action: "back" });
  const snap2 = textOf(await svc.call(tok, "browser_snapshot", {}));
  const q = refOf(snap2, /textbox "Busca" \[ref=(e\d+)\]/);
  const typed = await svc.call(tok, "browser_type", { ref: q, text: "jarvis f2", submit: true });
  assert.equal(typed.ok, true, typed.error);
  const loc = textOf(await svc.call(tok, "browser_snapshot", {}));
  assert.match(loc, /Título: busca:jarvis f2/);
  const shot = await svc.call(tok, "browser_screenshot", {});
  assert.equal(shot.ok, true, shot.error);
  const img = shot.content.find((c: any) => c.type === "image") as any;
  assert.equal(Buffer.from(img.data, "base64").subarray(0, 2).toString("hex"), "ffd8", "JPEG");
  svc.closeTurn(tok);
});

test("nível Ver: lê o perfil do dono mas NÃO clica nele; perfil do agente não vê os cookies do dono", { skip }, async () => {
  const svc = new BrowserAgentService(mgr);
  const tok = svc.openTurn("S1");
  // o DONO loga (cookie) no perfil dele
  await ownerNavigate(base + "/setcookie");
  const ownerPage = await ownerNavigate(base + "/whoami");
  const ownerSnap = textOf(await svc.call(tok, "browser_snapshot", { profile: "owner" }));
  assert.match(ownerSnap, /cookie: sess=dono123/, "a análise VÊ o conteúdo logado do dono");
  assert.match(ownerSnap, /só leitura/);
  // ação no perfil do dono sem liberação: recusada e a página não muda
  await ownerNavigate(base + "/");
  const btn = refOf(textOf(await svc.call(tok, "browser_snapshot", { profile: "owner" })), /button "Ir para a próxima" \[ref=(e\d+)\]/);
  const denied = await svc.call(tok, "browser_click", { profile: "owner", ref: btn });
  assert.equal(denied.ok, false);
  assert.match(denied.error!, /só leitura/);
  await new Promise((r) => setTimeout(r, 400));
  const still = await mgr.pageCommand(ownerPage, "Runtime.evaluate", { expression: "location.pathname", returnByValue: true });
  assert.equal(still.result.value, "/", "a página do dono não mudou");
  // o perfil do agente, no MESMO site, não tem o cookie do dono
  const nav = await svc.call(tok, "browser_navigate", { profile: "agent", url: base + "/whoami" });
  assert.equal(nav.ok, true, nav.error);
  const agentSnap = textOf(await svc.call(tok, "browser_snapshot", { profile: "agent" }));
  assert.match(agentSnap, /cookie: sem-cookie/);
  assert.doesNotMatch(agentSnap, /dono123/);
  // aba do dono numa chamada do perfil do agente: recusada
  const cross = await svc.call(tok, "browser_snapshot", { profile: "agent", pageId: ownerPage });
  assert.equal(cross.ok, false);
  svc.closeTurn(tok);
});

test("nível 3: liberado clica no perfil do dono; no fim do turno volta a só leitura", { skip }, async () => {
  const svc = new BrowserAgentService(mgr);
  const tok = svc.openTurn("S9");
  const ownerPage = await ownerNavigate(base + "/");
  svc.setOwnerDrive("S9", true);
  const btn = refOf(textOf(await svc.call(tok, "browser_snapshot", { profile: "owner" })), /button "Ir para a próxima" \[ref=(e\d+)\]/);
  const click = await svc.call(tok, "browser_click", { profile: "owner", ref: btn });
  assert.equal(click.ok, true, click.error);
  const now = await mgr.pageCommand(ownerPage, "Runtime.evaluate", { expression: "location.pathname", returnByValue: true });
  assert.equal(now.result.value, "/next");
  svc.closeTurn(tok);
  const tok2 = svc.openTurn("S9");
  const back = await svc.call(tok2, "browser_navigate", { profile: "owner", action: "back" });
  assert.equal(back.ok, false, "a liberação expirou com o turno anterior");
  svc.closeTurn(tok2);
});

test("seleção de pontos no perfil do dono: elemento, recorte JPEG e senha que nunca sai", { skip }, async () => {
  const svc = new BrowserAgentService(mgr);
  const pageId = await ownerNavigate(base + "/");
  const g = await svc.grab(pageId, 60, 40);
  assert.equal(g.tag, "button");
  assert.equal(g.selector, "#go");
  assert.equal(g.text, "Ir para a próxima");
  assert.match(g.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.ok(g.rect.width >= 200 && g.rect.height >= 50, JSON.stringify(g.rect));
  assert.match(g.image || "", /^data:image\/jpeg;base64,\/9j\//, "recorte JPEG");
  const pw = await svc.grab(pageId, 120, 210);
  assert.equal(pw.tag, "input");
  assert.equal(pw.text, "[senha oculta]");
  assert.doesNotMatch(JSON.stringify(pw), /segredo-do-dono-123/);
});
