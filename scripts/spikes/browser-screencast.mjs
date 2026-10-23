#!/usr/bin/env node
// Spike F0 do BRW-IDE-00 (docs/specs/BRW-IDE-00-remote-browser-and-ide.md) — DESCARTÁVEL.
//
// Mede o caminho runner → Hub → cliente do browser remoto SEM tocar no Hub real:
//   runner  : Chrome headless com perfil próprio, CDP só em 127.0.0.1, Page.startScreencast,
//             frames JPEG crus (não base64) em mensagem binária; input chega e vira Input.dispatch*.
//   relay   : faz o papel do Hub — repassa binário OPACO (não interpreta frame), descarta quando o
//             socket do espectador acumula (backpressure) e mede o lag do PRÓPRIO event loop.
//   viewer  : espectador sintético — fps, bytes, latência do frame e ida-e-volta do clique.
//
// Uso:
//   node scripts/spikes/browser-screencast.mjs                 # bateria medida (1 e 3 espectadores)
//   node scripts/spikes/browser-screencast.mjs serve [--url U] # manual: abre http://127.0.0.1:<porta>
//
// Env: SPIKE_CHROME (caminho do Chrome/Edge/Chromium), SPIKE_SECONDS (padrão 12), SPIKE_QUALITY (60).

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

const SELF = fileURLToPath(import.meta.url);
const SECONDS = Number(process.env.SPIKE_SECONDS || 12);
const QUALITY = Number(process.env.SPIKE_QUALITY || 60);
const BACKLOG = 2 * 1024 * 1024; // bytes pendentes no socket a partir dos quais o frame é descartado
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.SPIKE_CHROME) return process.env.SPIKE_CHROME;
  const c = platform() === "win32"
    ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]
    : platform() === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  const hit = c.find((p) => existsSync(p));
  if (!hit) throw new Error("nenhum Chrome/Edge/Chromium encontrado — defina SPIKE_CHROME");
  return hit;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (platform() === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* já morreu */ } }
}

// Frame no fio: [u32 tamanho do cabeçalho][cabeçalho JSON][JPEG cru]
function encodeFrame(header, jpeg) {
  const h = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(4); len.writeUInt32BE(h.length, 0);
  return Buffer.concat([len, h, jpeg]);
}
function decodeHeader(buf) { const n = buf.readUInt32BE(0); return JSON.parse(buf.subarray(4, 4 + n).toString()); }

// Página de teste: animação contínua (pior caso para screencast) + contador de cliques.
const TEST_PAGE = `<!doctype html><meta charset=utf-8><title>spike</title>
<style>body{margin:0;font:20px system-ui;background:#111;color:#eee}#b{position:absolute;width:180px;height:180px;border-radius:24px;background:linear-gradient(45deg,#f60,#0cf)}</style>
<div id=c style="padding:16px">cliques: 0</div><div id=t style="padding:0 16px"></div><div id=b></div>
<script>let n=0;addEventListener('mousedown',()=>{document.getElementById('c').textContent='cliques: '+(++n)});
(function f(ts){const b=document.getElementById('b');b.style.left=(300+260*Math.cos(ts/700))+'px';b.style.top=(300+200*Math.sin(ts/500))+'px';
document.getElementById('t').textContent=new Date().toISOString();requestAnimationFrame(f)})(0)</script>`;

// Pior caso para JPEG: ruído em tela cheia a cada frame (página real com foto/vídeo fica entre os dois).
const HEAVY_PAGE = `<!doctype html><meta charset=utf-8><body style=margin:0><canvas id=k width=1280 height=800></canvas>
<script>const k=document.getElementById('k').getContext('2d'),d=k.createImageData(1280,800),u=new Uint32Array(d.data.buffer);
(function f(){for(let i=0;i<u.length;i++)u[i]=0xff000000|(Math.random()*0xffffff);k.putImageData(d,0,0);requestAnimationFrame(f)})()</script>`;

// ---------------------------------------------------------------------------------------- runner
async function runRunner() {
  const relayUrl = arg("relay");
  let url = arg("url");
  const http = createServer((_q, s) => { s.setHeader("content-type", "text/html"); s.end(process.env.SPIKE_PAGE === "heavy" ? HEAVY_PAGE : TEST_PAGE); });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  if (!url) url = `http://127.0.0.1:${http.address().port}/`;

  const profile = mkdtempSync(join(tmpdir(), "jarvis-spike-profile-"));
  const chrome = spawn(findChrome(), [
    "--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,800", "about:blank",
  ], { stdio: "ignore", detached: platform() !== "win32" });
  // Dentro de "exit" só roda código síncrono: espera o Chrome soltar o lock do perfil com Atomics.wait.
  const cleanup = () => {
    killTree(chrome);
    for (let i = 0; i < 20; i++) {
      try { rmSync(profile, { recursive: true, force: true }); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); }
    }
  };
  process.on("exit", cleanup);
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  // Windows: child.kill() é TerminateProcess e NÃO roda o "exit" — o Chrome ficaria órfão. O pai
  // pede "stop" por IPC; se o pai morrer, o canal cai e saímos do mesmo jeito.
  process.on("message", (m) => { if (m === "stop") process.exit(0); });
  process.on("disconnect", () => process.exit(0));

  const portFile = join(profile, "DevToolsActivePort");
  const tLaunch = Date.now();
  while (!existsSync(portFile)) { if (Date.now() - tLaunch > 20000) throw new Error("Chrome não abriu o CDP em 20 s"); await sleep(50); }
  await sleep(50);
  const [port, path] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  const cdp = new WebSocket(`ws://127.0.0.1:${port}${path}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((r, j) => { cdp.once("open", r); cdp.once("error", j); });
  const launchMs = Date.now() - tLaunch;

  let nextId = 1; const pending = new Map(); const handlers = new Map();
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    cdp.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  cdp.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
    handlers.get(m.method)?.(m.params, m.sessionId);
  });

  const { targetId } = await call("Target.createTarget", { url });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId);

  const relay = new WebSocket(`${relayUrl}/runner`, { perMessageDeflate: false });
  await new Promise((r, j) => { relay.once("open", r); relay.once("error", j); });

  let seq = 0, frames = 0, bytes = 0, b64Bytes = 0, sent = 0, coalesced = 0;
  const MAX_FPS = Number(process.env.SPIKE_MAXFPS || 60);
  // "O mais recente vence": o Chrome é confirmado na hora (ele não espera o ack frame a frame — medido),
  // e o runner só despacha no ritmo do teto e quando o link até o Hub escoou. Frame intermediário é
  // substituído, nunca enfileirado: memória limitada e a tela nunca fica velha.
  let latest = null;
  handlers.set("Page.screencastFrame", (p) => {
    call("Page.screencastFrameAck", { sessionId: p.sessionId }, sessionId).catch(() => {});
    const jpeg = Buffer.from(p.data, "base64");
    frames++; bytes += jpeg.length; b64Bytes += p.data.length;
    if (latest) coalesced++;
    latest = { jpeg, w: p.metadata.deviceWidth, h: p.metadata.deviceHeight, t0: Date.now() };
  });
  setInterval(() => {
    if (!latest || relay.bufferedAmount >= BACKLOG) return;
    relay.send(encodeFrame({ seq: seq++, t0: latest.t0, w: latest.w, h: latest.h }, latest.jpeg));
    sent++; latest = null;
  }, 1000 / MAX_FPS);

  // Teclas especiais mapeadas para dispatchKeyEvent; texto comum vai por insertText.
  const KEYS = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
  relay.on("message", async (raw, isBinary) => {
    if (isBinary) return;
    const m = JSON.parse(raw);
    try {
      if (m.t === "click") {
        await call("Input.dispatchMouseEvent", { type: "mousePressed", x: m.x, y: m.y, button: "left", clickCount: 1 }, sessionId);
        await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: m.x, y: m.y, button: "left", clickCount: 1 }, sessionId);
        relay.send(JSON.stringify({ t: "ack", id: m.id, ts: m.ts }));
      } else if (m.t === "wheel") {
        await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: m.x, y: m.y, deltaX: 0, deltaY: m.dy }, sessionId);
      } else if (m.t === "key") {
        if (KEYS[m.key]) {
          for (const type of ["rawKeyDown", "keyUp"]) await call("Input.dispatchKeyEvent", { type, key: m.key, windowsVirtualKeyCode: KEYS[m.key] }, sessionId);
        } else if (m.key.length === 1) await call("Input.insertText", { text: m.key }, sessionId);
      } else if (m.t === "nav") {
        await call("Page.navigate", { url: /^https?:/.test(m.url) ? m.url : `https://${m.url}` }, sessionId);
      }
    } catch (e) { relay.send(JSON.stringify({ t: "error", message: String(e.message || e) })); }
  });

  await call("Page.startScreencast", { format: "jpeg", quality: QUALITY, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 }, sessionId);
  out({ role: "runner", ready: true, launchMs, url });

  const report = () => out({ role: "runner", frames, sent, coalesced, bytes, b64Bytes });
  process.on("message", (m) => { if (m === "report") report(); });
  if (arg("report-after")) setTimeout(() => { report(); setTimeout(() => process.exit(0), 200); }, Number(arg("report-after")) * 1000);
}

// ----------------------------------------------------------------------------------------- relay
async function runRelay() {
  const host = arg("host", "127.0.0.1");
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const cpu0 = process.cpuUsage();
  let runner = null; const viewers = new Set();
  let inBytes = 0, outBytes = 0, dropped = 0, relayed = 0, rssMax = 0;
  const INFLIGHT = 2;
  setInterval(() => { rssMax = Math.max(rssMax, process.memoryUsage().rss); }, 100);

  const http = createServer((_q, s) => { s.setHeader("content-type", "text/html"); s.end(VIEWER_PAGE); });
  const wss = new WebSocketServer({ server: http, perMessageDeflate: false });
  wss.on("connection", (ws, req) => {
    if (req.url === "/runner") {
      runner = ws;
      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          inBytes += data.length;
          // repasse OPACO (sem parse). Crédito por espectador: no máximo INFLIGHT frames sem "fack";
          // acima disso guarda só o MAIS RECENTE — atraso limitado ao RTT do espectador, não à fila.
          for (const v of viewers) {
            if (v.inflight < INFLIGHT) { v.send(data, { binary: true }); v.inflight++; outBytes += data.length; relayed++; }
            else { if (v.latest) dropped++; v.latest = data; }
          }
        } else for (const v of viewers) v.send(data.toString());
      });
    } else {
      ws.inflight = 0; ws.latest = null; viewers.add(ws);
      ws.on("message", (data) => {
        const text = data.toString();
        if (text === "fack") {
          ws.inflight = Math.max(0, ws.inflight - 1);
          if (ws.latest && ws.inflight < INFLIGHT) { ws.send(ws.latest, { binary: true }); outBytes += ws.latest.length; relayed++; ws.inflight++; ws.latest = null; }
          return;
        }
        runner?.send(text);
      });
      ws.on("close", () => viewers.delete(ws));
    }
  });
  await new Promise((r) => http.listen(Number(arg("port", 0)), host, r));
  out({ role: "relay", ready: true, port: http.address().port, host });

  const report = () => {
    const c = process.cpuUsage(cpu0);
    out({ role: "relay", inBytes, outBytes, relayed, dropped, rssMaxMB: Math.round(rssMax / 1048576), cpuMs: Math.round((c.user + c.system) / 1000),
      lagP50: +(lag.percentile(50) / 1e6).toFixed(1), lagP99: +(lag.percentile(99) / 1e6).toFixed(1), lagMax: +(lag.max / 1e6).toFixed(1) });
  };
  process.on("message", (m) => { if (m === "report") report(); if (m === "stop") process.exit(0); });
}

// ---------------------------------------------------------------------------------------- viewer
async function runViewer() {
  const ws = new WebSocket(`${arg("relay")}/viewer`, { perMessageDeflate: false });
  await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
  let frames = 0, bytes = 0, firstAt = 0, lastAt = 0; const lat = []; const rtt = [];
  ws.on("message", (data, isBinary) => {
    const now = Date.now();
    if (isBinary) {
      ws.send("fack");
      const h = decodeHeader(data); frames++; bytes += data.length; lat.push(now - h.t0);
      if (!firstAt) firstAt = now; lastAt = now;
    } else { const m = JSON.parse(data); if (m.t === "ack") rtt.push(now - m.ts); }
  });
  // Espectador lento (rede ruim): para de ler o socket metade do tempo — a fila cresce no relay.
  if (process.env.SPIKE_SLOW) setInterval(() => { ws._socket.pause(); setTimeout(() => ws._socket.resume(), 700); }, 1000);
  let id = 0;
  const clicker = setInterval(() => ws.send(JSON.stringify({ t: "click", id: id++, ts: Date.now(), x: 100 + (id % 5) * 40, y: 30 })), 500);
  const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const report = () => {
    clearInterval(clicker);
    const secs = Math.max(0.001, (lastAt - firstAt) / 1000);
    out({ role: "viewer", frames, fps: +(frames / secs).toFixed(1), kbps: Math.round((bytes * 8) / 1000 / secs),
      avgFrameKB: frames ? +(bytes / frames / 1024).toFixed(1) : 0,
      latP50: pct(lat, 0.5), latP95: pct(lat, 0.95), clickRttP50: pct(rtt, 0.5), clickRttP95: pct(rtt, 0.95), clicks: rtt.length });
  };
  process.on("message", (m) => { if (m === "report") report(); if (m === "stop") process.exit(0); });
}

// Página de visualização manual (modo `serve`): canvas + mouse/roda/teclado/URL.
const VIEWER_PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width">
<title>Jarvis — spike browser remoto</title><style>body{margin:0;background:#222;color:#ddd;font:14px system-ui}
#bar{display:flex;gap:6px;padding:6px}#u{flex:1}canvas{display:block;max-width:100%;outline:none}</style>
<div id=bar><input id=u placeholder="endereço e Enter"><span id=s></span></div><canvas id=c tabindex=0></canvas>
<script>const ws=new WebSocket('ws://'+location.host+'/viewer');ws.binaryType='arraybuffer';const c=document.getElementById('c'),x=c.getContext('2d');
let n=0,t=Date.now();ws.onmessage=async e=>{if(typeof e.data==='string')return;ws.send('fack');const dv=new DataView(e.data),hl=dv.getUint32(0);
const b=await createImageBitmap(new Blob([e.data.slice(4+hl)],{type:'image/jpeg'}));if(c.width!==b.width){c.width=b.width;c.height=b.height}x.drawImage(b,0,0);
n++;if(Date.now()-t>1000){document.getElementById('s').textContent=n+' fps';n=0;t=Date.now()}};
const pos=e=>{const r=c.getBoundingClientRect();return{x:Math.round((e.clientX-r.left)*c.width/r.width),y:Math.round((e.clientY-r.top)*c.height/r.height)}};
c.onmousedown=e=>{c.focus();ws.send(JSON.stringify({t:'click',id:0,ts:Date.now(),...pos(e)}))};
c.onwheel=e=>{e.preventDefault();ws.send(JSON.stringify({t:'wheel',dy:e.deltaY,...pos(e)}))};
c.onkeydown=e=>{e.preventDefault();ws.send(JSON.stringify({t:'key',key:e.key}))};
document.getElementById('u').onkeydown=e=>{if(e.key==='Enter')ws.send(JSON.stringify({t:'nav',url:e.target.value}))};</script>`;

// ---------------------------------------------------------------------------------- orquestrador
function child(role, extra = []) {
  const p = spawn(process.execPath, [SELF, role, ...extra], { stdio: ["ignore", "pipe", "inherit", "ipc"] });
  p.lines = []; let buf = "";
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { p.lines.push(JSON.parse(l)); } catch { /* ruído */ } } });
  return p;
}
async function waitLine(p, pred, ms = 30000) {
  const t = Date.now();
  for (;;) { const hit = p.lines.find(pred); if (hit) return hit; if (Date.now() - t > ms) throw new Error("timeout esperando filho"); await sleep(50); }
}

async function scenario(viewerCount) {
  const relay = child("relay");
  const kids = [relay];
  try {
    const { port } = await waitLine(relay, (l) => l.ready);
    const url = `ws://127.0.0.1:${port}`;
    const viewers = Array.from({ length: viewerCount }, () => child("viewer", ["--relay", url]));
    kids.push(...viewers);
    await sleep(300);
    const runner = child("runner", ["--relay", url, ...(process.env.SPIKE_URL ? ["--url", process.env.SPIKE_URL] : [])]); kids.push(runner);
    const ready = await waitLine(runner, (l) => l.ready);
    await sleep(SECONDS * 1000);
    for (const k of kids) k.send("report");
    await sleep(800);
    const pick = (p, role) => p.lines.filter((l) => l.role === role && !l.ready).pop();
    return { viewerCount, launchMs: ready.launchMs, relay: pick(relay, "relay"), runner: pick(runner, "runner"), viewers: viewers.map((v) => pick(v, "viewer")) };
  } finally {
    // espera a saída LIMPA (o runner mata o Chrome e apaga o perfil); só força depois de 8 s
    await Promise.all(kids.map((k) => new Promise((done) => {
      if (k.exitCode !== null) return done();
      const t = setTimeout(() => { try { k.kill(); } catch { /* ok */ } done(); }, 8000);
      k.once("exit", () => { clearTimeout(t); done(); });
      try { k.send("stop"); } catch { /* canal já caiu */ }
    })));
  }
}

async function main() {
  const role = process.argv[2] || "all";
  if (role === "runner") return runRunner();
  if (role === "relay") return runRelay();
  if (role === "viewer") return runViewer();
  if (role === "serve") {
    const relay = child("relay", ["--host", arg("host", "127.0.0.1"), "--port", arg("port", "0")]);
    const { port, host } = await waitLine(relay, (l) => l.ready);
    // o relay escuta só no --host pedido (ex.: IP do Tailscale); o runner tem de discar o MESMO endereço
    const dial = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    const runner = child("runner", ["--relay", `ws://${dial}:${port}`, ...(arg("url") ? ["--url", arg("url")] : [])]);
    await waitLine(runner, (l) => l.ready);
    console.log(`abra http://${host}:${port}/  (Ctrl+C encerra)`);
    const stop = () => { for (const k of [runner, relay]) { try { k.send("stop"); } catch { /* ok */ } } setTimeout(() => process.exit(0), 1500); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    return;
  }
  if (role === "baseline") {
    // lag do event loop OCIOSO nesta máquina — o piso contra o qual o relay é comparado
    const h = monitorEventLoopDelay({ resolution: 10 }); h.enable(); await sleep(5000);
    console.log(JSON.stringify({ baseline: true, lagP50: +(h.percentile(50) / 1e6).toFixed(1), lagP99: +(h.percentile(99) / 1e6).toFixed(1), lagMax: +(h.max / 1e6).toFixed(1) }));
    return;
  }
  console.log(`page: ${process.env.SPIKE_PAGE || "anim"} | chrome: ${findChrome()} | ${SECONDS}s por cenário | JPEG q${QUALITY} | 1280x800, página animada (pior caso)`);
  const results = [];
  for (const n of [1, 3]) results.push(await scenario(n));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
