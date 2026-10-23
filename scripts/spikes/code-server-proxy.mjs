#!/usr/bin/env node
// Spike F0 do BRW-IDE-00 — DESCARTÁVEL. Prova que o code-server (build Windows) funciona ATRÁS de
// um proxy com prefixo, que é como o Hub vai servi-lo: /ide/<runnerId>/… → 127.0.0.1:<porta>.
//
//   code-server : só em 127.0.0.1, --auth none (a auth é a do Jarvis, no proxy)
//   proxy       : remove o prefixo e repassa HTTP + upgrade de WebSocket, sem entender o conteúdo
//   prova       : Chromium headless (playwright-core) abre a IDE pelo proxy, espera o workbench,
//                 confere a árvore de arquivos e um terminal integrado, e conta requisições falhas.
//
// Uso: node scripts/spikes/code-server-proxy.mjs <pasta-do-code-server> [pasta-para-abrir]

import { spawn, execFileSync } from "node:child_process";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const CS = process.argv[2];
const FOLDER = process.argv[3] || process.cwd();
const PREFIX = "/ide/spike-machine";
if (!CS) { console.error("uso: code-server-proxy.mjs <pasta-do-code-server> [pasta]"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

const csPort = await freePort();
const data = mkdtempSync(join(tmpdir(), "jarvis-spike-cs-"));
const node = platform() === "win32" ? join(CS, "lib", "node.exe") : join(CS, "lib", "node");
const t0 = Date.now();
const cs = spawn(node, [CS, "--bind-addr", `127.0.0.1:${csPort}`, "--auth", "none", "--disable-telemetry", "--disable-update-check",
  "--disable-workspace-trust", "--user-data-dir", join(data, "user"), "--extensions-dir", join(data, "ext")], { stdio: ["ignore", "pipe", "pipe"] });
let csLog = ""; cs.stdout.on("data", (d) => { csLog += d; }); cs.stderr.on("data", (d) => { csLog += d; });

// proxy com prefixo — o papel do Hub. O Host ORIGINAL é preservado: o code-server recusa WebSocket
// cujo Origin não bate com o Host (anti-CSRF dele) — reescrever o Host derruba a conexão com 1006.
const strip = (url) => (url.startsWith(PREFIX) ? url.slice(PREFIX.length) || "/" : null);
const proxy = createServer((req, res) => {
  const path = strip(req.url);
  if (path === null) { res.writeHead(404).end(); return; }
  const up = request({ host: "127.0.0.1", port: csPort, path, method: req.method, headers: req.headers }, (r) => {
    // Bug do code-server no Windows: ele só põe Service-Worker-Allowed quando o caminho em disco termina
    // em "/serviceWorker.js" — com "\" isso nunca acontece e as webviews perdem o service worker.
    const headers = { ...r.headers };
    if (process.env.SPIKE_NO_SW_FIX !== "1" && path.split("?")[0].endsWith("/serviceWorker.js")) headers["service-worker-allowed"] = `${PREFIX}/`;
    res.writeHead(r.statusCode, headers); r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502).end(); });
  req.pipe(up);
});
let wsUpgrades = 0;
proxy.on("upgrade", (req, sock, head) => {
  const path = strip(req.url);
  if (path === null) { sock.destroy(); return; }
  wsUpgrades++;
  const up = connect(csPort, "127.0.0.1", () => {
    const lines = [`${req.method} ${path} HTTP/1.1`, ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`), "", ""];
    up.write(lines.join("\r\n")); if (head?.length) up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
  up.on("error", () => sock.destroy()); sock.on("error", () => up.destroy());
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}${PREFIX}/`;

const cleanup = () => {
  try { if (platform() === "win32") execFileSync("taskkill", ["/pid", String(cs.pid), "/T", "/F"], { stdio: "ignore" }); else cs.kill("SIGKILL"); } catch { /* já saiu */ }
  for (let i = 0; i < 20; i++) { try { rmSync(data, { recursive: true, force: true }); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); } }
};
process.on("exit", cleanup);

const result = { csPort, proxyUrl, folder: FOLDER };
try {
  // espera o code-server responder
  for (;;) {
    const ok = await new Promise((r) => { const q = request({ host: "127.0.0.1", port: csPort, path: "/healthz" }, (s) => { s.resume(); r(s.statusCode === 200); }); q.on("error", () => r(false)); q.end(); });
    if (ok) break;
    if (Date.now() - t0 > 60000) throw new Error("code-server não respondeu em 60 s\n" + csLog);
    await sleep(200);
  }
  result.bootMs = Date.now() - t0;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  globalThis.__page = page;
  const failed = []; const consoleErrors = [];
  page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  const tNav = Date.now();
  // No Windows o code-server só lista a pasta no formato de URI "/c:/…" — "C:/…" abre a raiz VAZIA.
  const folderParam = /^[a-zA-Z]:[\\/]/.test(FOLDER) ? "/" + FOLDER.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, (_m, d) => d.toLowerCase() + ":") : FOLDER;
  result.folderParam = folderParam;
  await page.goto(`${proxyUrl}?folder=${encodeURIComponent(folderParam)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".monaco-workbench", { timeout: 60000 });
  for (let i = 0; i < 60 && (await page.locator(".explorer-folders-view .monaco-list-row").count()) < 3; i++) await sleep(250);
  result.workbenchMs = Date.now() - tNav;
  result.explorerRows = await page.locator(".explorer-folders-view .monaco-list-row").count();

  // terminal integrado (pty do code-server) através do proxy
  // abre pelo Command Palette (atalho de teclado depende de foco/layout do teclado no headless)
  await page.locator(".monaco-workbench").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("F1");
  await page.waitForSelector(".quick-input-widget input", { timeout: 15000 });
  await page.keyboard.type("Terminal: Create New Terminal");
  await sleep(800);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".terminal-wrapper .xterm, .xterm", { timeout: 30000 });
  await sleep(2500);
  // o xterm desenha em canvas, então a prova é um efeito colateral: o shell escreve um arquivo
  const marker = join(tmpdir(), "jarvis-spike-term.txt"); rmSync(marker, { force: true });
  await page.keyboard.type(platform() === "win32" ? `Set-Content -Path '${marker}' -Value (6*7)` : `echo $((6*7)) > '${marker}'`);
  await page.keyboard.press("Enter");
  for (let i = 0; i < 40 && !existsSync(marker); i++) await sleep(250);
  result.terminalWroteFile = existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;

  // webview (preview de Markdown) — é o mesmo mecanismo do painel da extensão do Claude Code
  // fill() no Quick Input em vez de digitar: digitação no headless corre com o filtro da lista
  const palette = async (text) => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("F1");
    await page.waitForSelector(".quick-input-widget input", { timeout: 15000 });
    await page.fill(".quick-input-widget input", text);
    await page.waitForSelector(".quick-input-list .monaco-list-row", { timeout: 15000 });
    await sleep(400);
    await page.keyboard.press("Enter");
    await sleep(1500);
  };
  await palette("README.md");
  await palette(">Markdown: Open Preview to the Side");
  let previewText = null;
  for (let i = 0; i < 60 && !previewText; i++) {
    for (const fr of page.frames()) {
      try { const t = await fr.evaluate(() => document.body?.innerText || ""); if (/Jarvis/i.test(t) && fr !== page.mainFrame()) { previewText = t.slice(0, 80); break; } } catch { /* frame em navegação */ }
    }
    if (!previewText) await sleep(500);
  }
  result.webviewRendered = previewText;
  result.serviceWorker = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.())?.map((r) => r.scope) || []);
  result.terminalOpened = (await page.locator(".xterm").count()) > 0;
  await page.screenshot({ path: join(tmpdir(), "jarvis-spike-ide.png") });
  result.screenshot = join(tmpdir(), "jarvis-spike-ide.png");
  result.wsUpgradesThroughProxy = wsUpgrades;
  result.failedRequests = failed.slice(0, 15);
  result.failedCount = failed.length;
  result.consoleErrors = consoleErrors.slice(0, 10);
  await browser.close();
} catch (e) {
  result.error = String(e.message || e).slice(0, 2000);
  try { const p = globalThis.__page; if (p) { await p.screenshot({ path: join(tmpdir(), "jarvis-spike-ide-fail.png") }); result.failShot = join(tmpdir(), "jarvis-spike-ide-fail.png"); } } catch { /* sem tela */ }
  result.csLogTail = csLog.slice(-2000);
}
console.log(JSON.stringify(result, null, 2));
proxy.close();
process.exit(result.error ? 1 : 0);
