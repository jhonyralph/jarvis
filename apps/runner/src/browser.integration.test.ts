/**
 * Integração do browser remoto (BRW-IDE-00 F1) com um Chrome HEADLESS DE VERDADE.
 *
 * Mora no runner porque é ele quem hospeda o BrowserManager em produção e quem declara `ws` (o core
 * recebe a fábrica de WebSocket injetada). Pulado sozinho quando a máquina não tem Chrome/Edge/Chromium.
 *
 * Prova, ponta a ponta: abre o perfil → frames JPEG chegam no formato binário do fio → clique e
 * teclado mudam a página → navegação/abas → encerramento não deixa processo → um Chrome "órfão"
 * (de um host que morreu sem fechar) é recolhido pelo próximo host antes de abrir o perfil.
 * Perfil SEMPRE em pasta temporária: nunca toca ~/.jarvis/browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import WebSocket from "ws";
import { BrowserManager, decodeBrowserFrame, listProcesses, matchesProfileCmdline, reapProfileProcesses, resolveBrowserExecutable, type BrowserFrameHeader } from "@jarvis/core";
import type { BrowserStateInfo } from "@jarvis/protocol";

const found = resolveBrowserExecutable();
const exe = found.path;

const PAGE = `<!doctype html><meta charset=utf-8><title>inicio</title>
<style>body{margin:0;font:16px system-ui;background:#fff}#b{position:absolute;left:0;top:0;width:300px;height:150px;background:#36f;color:#fff;border:0}
#f{position:absolute;left:0;top:200px}#q{width:300px;height:40px;font-size:18px}</style>
<button id=b onclick="document.title='clicked';this.textContent='ok '+Date.now();this.style.background='#c30'">clique</button>
<form id=f method=get action="/r"><input id=q name=q autocomplete=off oninput="document.title='typed:'+this.value"></form>`;

function startServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      const u = new URL(req.url || "/", "http://x");
      if (u.pathname === "/r") res.end(`<!doctype html><title>result:${(u.searchParams.get("q") || "").replace(/[<&]/g, "")}</title><p>ok`);
      else res.end(PAGE);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${(server.address() as any).port}` }));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | undefined | null | false, ms: number, what: string): Promise<T> {
  const t = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`timeout esperando: ${what}`);
    await sleep(40);
  }
}

/** Largura/altura reais do JPEG (marcador SOF0/SOF2). */
function jpegSize(jpeg: Buffer): { w: number; h: number } | null {
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) { i++; continue; }
    const marker = jpeg[i + 1];
    if (marker === 0xc0 || marker === 0xc2) return { h: jpeg.readUInt16BE(i + 5), w: jpeg.readUInt16BE(i + 7) };
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
  return null;
}

function harness(rootDir: string) {
  const frames: Array<{ header: BrowserFrameHeader; jpeg: Buffer }> = [];
  const states: BrowserStateInfo[] = [];
  const mgr = new BrowserManager({
    executablePath: exe,
    rootDir,
    connect: (url) => new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 }),
    onFrame: (frame) => { const d = decodeBrowserFrame(frame); if (d) frames.push(d); },
    onState: (s) => states.push(s),
    maxFps: 15,
    idleMs: 0,
  });
  return { mgr, frames, states, last: () => states[states.length - 1] };
}

async function profileProcesses(dir: string): Promise<number[]> {
  const rows = await listProcesses(exe ? basename(exe) : undefined);
  return (rows || []).filter((r) => matchesProfileCmdline(r.cmdline, dir)).map((r) => r.pid);
}

test("browser remoto: Chrome headless real — frames, clique, teclado, abas, sem órfão", { skip: !exe ? `sem navegador: ${found.reason}` : false, timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-brw-it-"));
  const dir = join(root, "owner");
  const { server, base } = await startServer();
  const h = harness(root);
  try {
    const st = await h.mgr.open("owner");
    assert.equal(st.running, true);
    assert.ok(st.pages.length >= 1, "abre com pelo menos uma aba");
    assert.ok(existsSync(join(root, "owner.pid")), "pidfile do perfil existe enquanto o Chrome vive");
    const pageId = st.activePageId || st.pages[0].pageId;

    await h.mgr.navigate(pageId, { url: base + "/" });
    await waitFor(() => h.last()?.pages.find((p) => p.pageId === pageId && p.title === "inicio"), 15000, "título da página de teste");

    // Sem espectador, nenhum frame (lei §3.5).
    await sleep(400);
    assert.equal(h.frames.length, 0, "screencast desligado sem espectador");

    await h.mgr.view(pageId, true, { maxWidth: 640, maxHeight: 640 });
    const first = await waitFor(() => h.frames[0], 10000, "primeiro frame");
    assert.equal(first.header.pageId, pageId);
    assert.equal(first.jpeg[0], 0xff); assert.equal(first.jpeg[1], 0xd8, "JPEG cru (SOI), não base64");
    assert.ok(first.header.width > 300 && first.header.width <= 1280, `largura CSS do viewport: ${first.header.width}`);
    const size = jpegSize(first.jpeg);
    assert.ok(size && size.w <= 640, `JPEG respeita maxWidth: ${JSON.stringify(size)}`);
    assert.ok(h.last()?.pages.find((p) => p.pageId === pageId)?.viewing, "estado marca a aba como assistida");

    // Clique no botão (coordenadas CSS) muda o título.
    const before = h.frames.length;
    h.mgr.input(pageId, { kind: "mouse", type: "move", x: 100, y: 60 });
    h.mgr.input(pageId, { kind: "mouse", type: "down", x: 100, y: 60, button: "left", clickCount: 1 });
    h.mgr.input(pageId, { kind: "mouse", type: "up", x: 100, y: 60, button: "left", clickCount: 1 });
    await waitFor(() => h.last()?.pages.find((p) => p.pageId === pageId && p.title === "clicked"), 10000, "clique mudou o título");

    // A página mudou → chega frame novo depois do clique.
    await waitFor(() => h.frames.length > before || null, 10000, "frame depois da mudança");

    // Teclado: foca o input, digita (keyDown com texto) e Enter envia o form.
    h.mgr.input(pageId, { kind: "mouse", type: "down", x: 150, y: 220, button: "left", clickCount: 1 });
    h.mgr.input(pageId, { kind: "mouse", type: "up", x: 150, y: 220, button: "left", clickCount: 1 });
    for (const k of ["a", "b"]) { h.mgr.input(pageId, { kind: "key", type: "down", key: k, code: "Key" + k.toUpperCase() }); h.mgr.input(pageId, { kind: "key", type: "up", key: k, code: "Key" + k.toUpperCase() }); }
    h.mgr.input(pageId, { kind: "text", text: "ç" });
    await waitFor(() => h.last()?.pages.find((p) => p.pageId === pageId && p.title === "typed:abç"), 10000, "digitação chegou ao input");
    h.mgr.input(pageId, { kind: "key", type: "down", key: "Enter", code: "Enter" });
    h.mgr.input(pageId, { kind: "key", type: "up", key: "Enter", code: "Enter" });
    await waitFor(() => h.last()?.pages.find((p) => p.pageId === pageId && p.title === "result:abç" && p.canGoBack), 10000, "Enter enviou o form (e há histórico)");

    // Voltar no histórico.
    await h.mgr.navigate(pageId, { action: "back" });
    await waitFor(() => h.last()?.pages.find((p) => p.pageId === pageId && /\/$/.test(p.url) && p.canGoForward), 10000, "voltou para a página inicial");

    // Re-iniciar o screencast com outra largura não pode quebrar o fluxo de frames.
    const n0 = h.frames.length;
    await h.mgr.view(pageId, true, { maxWidth: 320, maxHeight: 320 });
    h.mgr.input(pageId, { kind: "wheel", x: 100, y: 100, dx: 0, dy: 50 });
    await h.mgr.navigate(pageId, { action: "reload" });
    const small = await waitFor(() => h.frames.slice(n0).find((f) => (jpegSize(f.jpeg)?.w || 999) <= 320), 10000, "frame com a largura nova");
    assert.ok(small.header.seq > first.header.seq, "seq cresce");

    // Abas: abrir, ativar, fechar.
    const tab2 = await h.mgr.tab("new", { url: base + "/r?q=tab2" });
    assert.ok(tab2);
    await waitFor(() => h.last()?.pages.find((p) => p.pageId === tab2 && p.title === "result:tab2"), 10000, "aba nova carregou");
    assert.equal(h.last()?.activePageId, tab2);
    await h.mgr.tab("activate", { pageId });
    await waitFor(() => h.last()?.activePageId === pageId, 5000, "aba ativada");
    await h.mgr.tab("close", { pageId: tab2 });
    await waitFor(() => h.last() && !h.last()!.pages.some((p) => p.pageId === tab2), 5000, "aba fechada sumiu do estado");

    // Desliga o espectador: para de chegar frame.
    await h.mgr.view(pageId, false);
    await sleep(300);
    const quiet = h.frames.length;
    h.mgr.input(pageId, { kind: "mouse", type: "down", x: 100, y: 60, button: "left", clickCount: 1 });
    h.mgr.input(pageId, { kind: "mouse", type: "up", x: 100, y: 60, button: "left", clickCount: 1 });
    await sleep(600);
    assert.equal(h.frames.length, quiet, "sem espectador o produtor não emite");

    const pid = h.mgr.pid("owner");
    assert.ok(pid);
    assert.deepEqual((await profileProcesses(dir)).length > 0, true, "Chrome do perfil está vivo antes do encerramento");
    await h.mgr.shutdown("owner", "teste");
    assert.equal(h.last()?.running, false);
    assert.deepEqual(await profileProcesses(dir), [], "nenhum processo do perfil depois do encerramento");
    assert.ok(!existsSync(join(root, "owner.pid")), "pidfile removido no encerramento");
  } finally {
    h.mgr.shutdownSync();
    await reapProfileProcesses(dir, { exeName: exe ? basename(exe) : undefined });
    server.close();
    for (let i = 0; i < 20; i++) { try { rmSync(root, { recursive: true, force: true }); break; } catch { await sleep(150); } }
  }
});

test("browser remoto: Chrome de um host que morreu é recolhido antes de reabrir o perfil", { skip: !exe ? `sem navegador: ${found.reason}` : false, timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-brw-reap-"));
  const dir = join(root, "owner");
  const a = harness(root), b = harness(root);
  try {
    await a.mgr.open("owner");
    const orphanPid = a.mgr.pid("owner")!;
    assert.ok(orphanPid > 0);
    // "a" some sem encerrar (como um runner morto à força): o Chrome dele segue vivo segurando o perfil.
    // "b" abre o MESMO perfil — tem de recolher o Chrome de "a" antes, senão o Chrome novo entregaria
    // o perfil à instância antiga e sairia.
    const st = await b.mgr.open("owner");
    assert.equal(st.running, true);
    assert.notEqual(b.mgr.pid("owner"), orphanPid);
    const alive = await profileProcesses(dir);
    assert.ok(!alive.includes(orphanPid), "o Chrome órfão foi morto");
    await waitFor(() => a.last()?.running === false || null, 10000, "o host antigo percebe que o Chrome dele caiu");
    await b.mgr.shutdown("owner");
    assert.deepEqual(await profileProcesses(dir), [], "nada sobra do perfil");
  } finally {
    a.mgr.shutdownSync(); b.mgr.shutdownSync();
    await reapProfileProcesses(dir, { exeName: exe ? basename(exe) : undefined });
    for (let i = 0; i < 20; i++) { try { rmSync(root, { recursive: true, force: true }); break; } catch { await sleep(150); } }
  }
});

test("browser remoto: no boot do host, Chrome órfão do perfil é recolhido sem esperar o primeiro open", { skip: !exe ? `sem navegador: ${found.reason}` : false, timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-brw-boot-"));
  const dir = join(root, "owner");
  const a = harness(root), b = harness(root);
  try {
    await a.mgr.open("owner");
    assert.ok((await profileProcesses(dir)).length > 0);
    // "b" é o host que acabou de subir depois de "a" morrer: o boot recolhe o que sobrou de "a".
    const reaped = await b.mgr.reapOrphans();
    assert.ok(reaped.includes(a.mgr.pid("owner") ?? -1) || reaped.length > 0, `recolheu: ${reaped}`);
    assert.deepEqual(await profileProcesses(dir), [], "nenhum processo do perfil depois do recolhimento de boot");
    assert.equal(b.mgr.isRunning("owner"), false, "recolher no boot não abre Chrome");
    assert.deepEqual(await b.mgr.reapOrphans(), [], "segunda chamada: nada a fazer");
  } finally {
    a.mgr.shutdownSync(); b.mgr.shutdownSync();
    await reapProfileProcesses(dir, { exeName: exe ? basename(exe) : undefined });
    for (let i = 0; i < 20; i++) { try { rmSync(root, { recursive: true, force: true }); break; } catch { await sleep(150); } }
  }
});
