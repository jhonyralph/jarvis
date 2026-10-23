/**
 * Integração do VS Code por máquina (BRW-IDE-00 F4) com o code-server DE VERDADE (4.141.0).
 *
 * OPT-IN (`JARVIS_IDE_IT=1`): baixa ~218 MB na primeira vez — não pode rodar em todo `npm test`/CI.
 * O .tar.gz fica num cache em pasta temporária (`JARVIS_IDE_TEST_CACHE`, padrão
 * `<tmp>/jarvis-ide-test-cache`) e é reaproveitado; apague a pasta para forçar outro download. Sem
 * rede e sem cache, o teste é pulado. Tudo em pastas temporárias: nunca toca `~/.jarvis/ide`.
 *
 * Prova, ponta a ponta, com o Hub e o runner REAIS (processos) e Chromium headless (playwright-core):
 *   - instalação real: SHA-256 fixado conferido, extração pelo tar do sistema, rename atômico;
 *   - para a máquina do Hub (proxy LOCAL direto) e para uma máquina REMOTA (túnel na conexão do runner):
 *     o workbench carrega, o Explorer lista os arquivos, o terminal integrado escreve um arquivo de prova
 *     e a webview (preview de Markdown) renderiza — os passos do spike F0 (§13.2);
 *   - parar a IDE e encerrar Hub/runner não deixa processo do code-server para trás.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { IdeManager, codeServerAsset, downloadVerified, listProcesses, sha256File } from "@jarvis/core";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ENABLED = process.env.JARVIS_IDE_IT === "1";
const asset = codeServerAsset();
const CACHE = process.env.JARVIS_IDE_TEST_CACHE || join(tmpdir(), "jarvis-ide-test-cache");
const SHOTS = process.env.JARVIS_IDE_IT_SHOTS || join(tmpdir(), "jarvis-ide-it-shots");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let chromiumPath = "";
try { const { chromium } = await import("playwright-core"); chromiumPath = chromium.executablePath(); if (!existsSync(chromiumPath)) chromiumPath = ""; } catch { chromiumPath = ""; }

const skip = !ENABLED ? "opt-in: JARVIS_IDE_IT=1 (baixa ~218 MB na primeira vez)"
  : !asset ? `o code-server não publica build para ${process.platform}/${process.arch}`
  : !chromiumPath ? "sem Chromium do playwright (npx playwright install chromium)" : false;

async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => resolve(s));
  })));
  const ports = servers.map((s) => (s.address() as any).port as number);
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  return ports;
}
async function stopChild(p: ChildProcess | undefined): Promise<void> {
  if (!p || p.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => p.once("exit", () => resolve()));
  if (process.platform === "win32" && p.pid) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else p.kill("SIGTERM");
  await Promise.race([exited, sleep(5000)]);
}
function rmrf(p: string) { for (let i = 0; i < 30; i++) { try { rmSync(p, { recursive: true, force: true }); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); } } }

class Inbox {
  readonly json: any[] = [];
  constructor(readonly ws: WebSocket) { ws.on("message", (raw, bin) => { if (!bin) try { this.json.push(JSON.parse(raw.toString())); } catch { /* ignore */ } }); }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  async take(pred: (m: any) => boolean, timeout = 20_000): Promise<any> {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const i = this.json.findIndex(pred); if (i >= 0) return this.json.splice(i, 1)[0]; await sleep(50); }
    throw new Error("timeout; últimos frames: " + JSON.stringify(this.json.slice(-6)).slice(0, 1500));
  }
}

async function cachedArchive(): Promise<string | null> {
  const file = join(CACHE, asset!.name);
  if (existsSync(file) && statSync(file).size === asset!.size && (await sha256File(file)) === asset!.sha256) return file;
  mkdirSync(CACHE, { recursive: true });
  try { await downloadVerified(asset!.url, file, { size: asset!.size, sha256: asset!.sha256 }); return file; }
  catch (e) { console.log(`[ide-it] sem download (${String((e as Error)?.message || e)}) — pulando`); return null; }
}

/** Os passos do spike F0, numa página já autenticada pelo Hub. */
async function proveWorkbench(page: any, url: string, folder: string, label: string) {
  const failed: string[] = []; let sockets = 0;
  page.on("response", (r: any) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on("requestfailed", (r: any) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
  page.on("websocket", () => { sockets++; });
  const consoleErrors: string[] = [];
  const webviewIndex: string[] = [];
  page.on("response", async (r: any) => {
    if (!/webview\/browser\/pre\/index\.html/.test(r.url())) return;
    let body = ""; try { body = await r.text(); } catch { /* ignore */ }
    const h = await r.allHeaders().catch(() => ({}));
    webviewIndex.push(`status=${r.status()} cspHeader=${String((h as any)["content-security-policy"] || "").slice(0, 160)} injetadoPorTerceiro=${/<script[^>]+src="https?:\/\//i.test(body)}`);
  });
  page.on("console", (m: any) => { if (m.type() === "error" && !/vsda|copilot|CloudSandbox|AgentHost/.test(m.text())) consoleErrors.push(m.text().slice(0, 900)); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".monaco-workbench", { timeout: 90_000 });
  for (let i = 0; i < 120 && (await page.locator(".explorer-folders-view .monaco-list-row").count()) < 3; i++) await sleep(250);
  const workbenchMs = Date.now() - t0;
  const explorerRows = await page.locator(".explorer-folders-view .monaco-list-row").count();
  // terminal integrado (pty do code-server) pelo proxy/túnel: a prova é o arquivo que o shell escreve
  await page.locator(".monaco-workbench").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("F1");
  await page.waitForSelector(".quick-input-widget input", { timeout: 20_000 });
  await page.keyboard.type("Terminal: Create New Terminal");
  await sleep(800);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".xterm", { timeout: 40_000 });
  await sleep(3000);
  const marker = join(folder, `marcador-${label}.txt`);
  await page.keyboard.type(process.platform === "win32" ? `Set-Content -Path '${marker}' -Value (6*7)` : `echo $((6*7)) > '${marker}'`);
  await page.keyboard.press("Enter");
  for (let i = 0; i < 80 && !existsSync(marker); i++) await sleep(250);
  const terminalWrote = existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;
  // webview (preview de Markdown) — o mesmo mecanismo do painel da extensão do Claude Code
  const palette = async (text: string) => {
    await page.keyboard.press("Escape"); await page.keyboard.press("F1");
    await page.waitForSelector(".quick-input-widget input", { timeout: 20_000 });
    await page.fill(".quick-input-widget input", text);
    await page.waitForSelector(".quick-input-list .monaco-list-row", { timeout: 20_000 });
    await sleep(500); await page.keyboard.press("Enter"); await sleep(1500);
  };
  await palette("README.md");
  await palette(">Markdown: Open Preview to the Side");
  let preview: string | null = null;
  for (let i = 0; i < 80 && !preview; i++) {
    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      try { const t: string = await fr.evaluate(() => document.body?.innerText || ""); if (/Projeto de prova do Jarvis/.test(t)) { preview = t.slice(0, 80); break; } } catch { /* frame navegando */ }
    }
    if (!preview) await sleep(500);
  }
  const frames: string[] = [];
  if (!preview) for (const fr of page.frames()) { let n = -1; try { n = (await fr.evaluate(() => (document.body?.innerText || "").length)) as number; } catch { /* ignore */ } frames.push(`${fr.url().replace(/\?.*$/, "").slice(-90)} (${n})`); }
  mkdirSync(SHOTS, { recursive: true });
  const shot = join(SHOTS, `ide-${label}.png`);
  await page.screenshot({ path: shot });
  return { workbenchMs, explorerRows, terminalWrote, preview, sockets, failed: failed.filter((f) => !/vsda/.test(f)), shot, ...(frames.length ? { frames, consoleErrors: consoleErrors.slice(-12), webviewIndex } : {}) };
}

test("code-server real pelo Hub: LOCAL direto e REMOTO pelo túnel — workbench, Explorer, terminal e webview", { skip, timeout: 600_000 }, async (t) => {
  const archive = await cachedArchive();
  if (!archive) { t.skip("sem rede e sem cache do code-server"); return; }
  const work = mkdtempSync(join(tmpdir(), "jarvis-ide-it-"));
  const hubHome = join(work, "hub-home"), runnerHome = join(work, "runner-home"), project = join(work, "projeto");
  for (const d of [join(hubHome, ".jarvis"), join(runnerHome, ".jarvis"), join(project, "src")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(project, "README.md"), "# Projeto de prova do Jarvis\n\nAberto pelo VS Code da máquina através do Hub.\n");
  writeFileSync(join(project, "src", "index.ts"), "export const ok = 42;\n");
  writeFileSync(join(project, "package.json"), "{\"name\":\"prova\"}\n");
  let hub: ChildProcess | undefined, runner: ChildProcess | undefined, browser: any;
  const logs = { hub: "", runner: "" };
  const result: Record<string, unknown> = {};
  let installDir = "";
  try {
    // 1) instalação real (hash fixado + tar + rename) numa raiz temporária; Hub e runner usam esse binário
    const installRoot = join(work, "install");
    const mgr = new IdeManager({ rootDir: installRoot, download: async (_a, dest, onProgress) => { copyFileSync(archive, dest); onProgress({ received: asset!.size, total: asset!.size }); } });
    const ti = Date.now();
    await mgr.install();
    result.installMs = Date.now() - ti;
    installDir = mgr.installDir;
    assert.ok(mgr.installed);
    assert.equal(JSON.parse(readFileSync(join(installDir, ".jarvis-install.json"), "utf8")).sha256, asset!.sha256);

    // 2) Hub + runner reais, auth ligada
    const [hubPort, adminPort] = await freePorts(2);
    const base = `http://127.0.0.1:${hubPort}`;
    const common = { JARVIS_BROWSER: "0", JARVIS_IDE_CODE_SERVER: installDir, JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock", NODE_ENV: "test", JARVIS_VOICE_WARMUP: "0" };
    hub = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...common, JARVIS_AUTH: "on", JARVIS_CWD: project, JARVIS_HOME: hubHome, USERPROFILE: hubHome, HOME: hubHome, JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort) } });
    hub.stdout?.on("data", (b) => { logs.hub = (logs.hub + b).slice(-8000); }); hub.stderr?.on("data", (b) => { logs.hub = (logs.hub + b).slice(-8000); });
    for (const end = Date.now() + 30_000; ;) { try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* subindo */ } if (Date.now() > end) throw new Error("Hub não subiu:\n" + logs.hub); await sleep(150); }
    const owner = new Inbox(new WebSocket(`ws://127.0.0.1:${hubPort}`));
    await new Promise<void>((r, j) => { owner.ws.once("open", () => r()); owner.ws.once("error", j); });
    owner.send({ t: "claim", code: readFileSync(join(hubHome, ".jarvis", "claim-code.txt"), "utf8").trim(), label: "dono" });
    await owner.take((m) => m.t === "authed");
    owner.send({ t: "mint_runner", label: "Remota" });
    const { runnerId, token } = await owner.take((m) => m.t === "runner_token");
    writeFileSync(join(runnerHome, ".jarvis", "runner-id"), runnerId);
    runner = spawn(process.execPath, ["--import", "tsx", "apps/runner/src/index.ts"], { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...common, JARVIS_HUB: `ws://127.0.0.1:${hubPort}`, JARVIS_TOKEN: token, JARVIS_CWD: project, JARVIS_HOME: runnerHome, USERPROFILE: runnerHome, HOME: runnerHome } });
    runner.stdout?.on("data", (b) => { logs.runner = (logs.runner + b).slice(-8000); }); runner.stderr?.on("data", (b) => { logs.runner = (logs.runner + b).slice(-8000); });
    for (const end = Date.now() + 60_000; ;) {
      owner.send({ t: "machines" });
      const ms = await owner.take((m) => m.t === "machines", 5000).catch(() => null);
      if (ms?.machines?.some((x: any) => x.id === runnerId && x.online && x.ide)) break;
      if (Date.now() > end) throw new Error("runner não registrou com ide:true:\n" + logs.runner);
      await sleep(500);
    }

    const { chromium } = await import("playwright-core");
    // Sem `executablePath`: o playwright usa o chromium-headless-shell (como o spike F0). Com o Chrome
    // "completo", o antivírus desta máquina (Kaspersky Web Anti-Virus) reconhece um navegador e INJETA
    // um <script> + `child-src` na CSP do HTML servido em HTTP — e o `child-src` injetado bloqueia o
    // service worker das webviews (medido: o preview de Markdown não renderiza). Ver §17 da spec.
    browser = await chromium.launch({ headless: true });
    for (const [label, rid] of [["local", "local"], ["remota", runnerId]] as const) {
      const t0 = Date.now();
      owner.send({ t: "ide_open", runnerId: rid, reqId: `open-${label}`, cwd: project });
      const ready = await owner.take((m) => (m.t === "ide_ready" || m.t === "ide_error") && m.reqId === `open-${label}`, 120_000);
      assert.equal(ready.t, "ide_ready", JSON.stringify(ready) + "\n" + (label === "local" ? logs.hub : logs.runner));
      const openMs = Date.now() - t0;
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await ctx.newPage();
      const proof = await proveWorkbench(page, base + ready.url, project, label);
      // a página ficou NA IDE (a URL de troca do bilhete não aparece mais) e o cookie é HttpOnly
      assert.ok(page.url().startsWith(`${base}/ide/${rid}/`), page.url());
      const cookies = await ctx.cookies();
      const c = cookies.find((x: any) => x.name === "jarvis_ide");
      assert.ok(c && c.httpOnly && c.sameSite === "Strict" && c.path === `/ide/${rid}/`, JSON.stringify(cookies));
      result[label] = { openMs, ...proof };
      if (label === "remota") {
        const rows = (await listProcesses(process.platform === "win32" ? "node.exe" : undefined)) || [];
        result.processes = rows.filter((r) => r.cmdline.includes(installDir)).map((r) => r.cmdline.replace(installDir, "<cs>").slice(0, 140));
      }
      await ctx.close();
      console.log(`[ide-it] ${label}: ` + JSON.stringify(result[label]));
      assert.ok(proof.explorerRows >= 3, `${label}: Explorer com ${proof.explorerRows} linhas`);
      assert.equal(proof.terminalWrote, "42", `${label}: o terminal integrado não escreveu o arquivo`);
      assert.ok(proof.preview, `${label}: a webview do preview de Markdown não renderizou`);
      assert.ok(proof.sockets >= 1, `${label}: nenhum WebSocket`);
    }

    // 3) parar as duas IDEs: nenhum processo do code-server fica
    owner.send({ t: "ide_stop", runnerId: "local", reqId: "s1" });
    owner.send({ t: "ide_stop", runnerId, reqId: "s2" });
    await owner.take((m) => m.t === "ide_state" && m.reqId === "s1", 30_000);
    await owner.take((m) => m.t === "ide_state" && m.reqId === "s2", 30_000);
    await sleep(1500);
    const after = ((await listProcesses(process.platform === "win32" ? "node.exe" : undefined)) || []).filter((r) => r.cmdline.includes(installDir));
    assert.deepEqual(after.map((r) => r.cmdline.slice(0, 120)), [], "processos do code-server sobrando depois do ide_stop");
    const audit = readFileSync(join(hubHome, ".jarvis", "audit.log"), "utf8");
    assert.match(audit, /"event":"ide_open"/); assert.match(audit, /"event":"ide_session"/); assert.match(audit, /"event":"ide_stop"/);
    owner.ws.close();
    console.log("[ide-it] " + JSON.stringify(result, null, 2));
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    await stopChild(runner); await stopChild(hub);
    await sleep(1000);
    if (installDir) {
      const left = ((await listProcesses(process.platform === "win32" ? "node.exe" : undefined)) || []).filter((r) => r.cmdline.includes(installDir));
      for (const r of left) { try { process.kill(r.pid); } catch { /* ignore */ } }
      if (left.length) console.log("[ide-it] ÓRFÃOS mortos na limpeza: " + left.map((r) => r.pid).join(","));
    }
    rmrf(work);
  }
});
