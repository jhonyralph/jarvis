/**
 * Flagra ONDE o event loop do Hub está preso, enquanto ele está preso.
 *
 * Por que existe (2026-10-26): o Hub caiu 6 vezes num dia por event loop travado de 48 a 142 s
 * (5 pelo guarda `hub_loop_stall_exit`, 1 pelo watchdog). O guarda só sabe QUANTO tempo durou — o
 * trecho que travou é síncrono e não deixa rastro no log, e adivinhar pelo código já errou antes
 * (INC-03). Daqui sai a pilha de chamadas da thread principal no meio da trava.
 *
 * Como: uma worker thread recebe uma batida da thread principal a cada 500 ms. Se a batida some por
 * `marks[i]` ms, ela se conecta à thread principal pelo inspector embutido do V8
 * (`Session.connectToMainThread`, sem --inspect e sem porta aberta), pede `Debugger.pause`, lê a pilha
 * e RETOMA na hora. Preso em JavaScript, a pausa entra imediatamente; preso numa chamada nativa
 * síncrona (readFileSync…), entra quando ela devolve — a pilha aponta quem chamou do mesmo jeito.
 *
 * O registro vai para `logFile` pela PRÓPRIA worker, de forma síncrona: o guarda pode encerrar o Hub
 * logo depois da trava, e o logger da thread principal não existe enquanto ela está presa.
 *
 * Segurança da pausa: o handler de `Debugger.paused` grava e retoma num try/finally — retomar é a
 * única coisa que não pode deixar de acontecer, senão a thread principal ficaria pausada para sempre.
 */
import { Worker } from "node:worker_threads";

export interface StallFrame { fn: string; url: string; line: number }
export interface StallTrace { t: string; ev: "hub_loop_stall_trace"; stalledMs: number; captureMs: number; frames: StallFrame[]; error?: string }

export interface StallForensicsOptions {
  /** atrasos (ms sem batida) em que a pilha é capturada, em ordem; ex.: [10_000, 30_000] */
  marks: number[];
  /** arquivo JSONL gravado pela worker (síncrono) */
  logFile: string;
  /** chamado na thread principal quando ela volta a rodar */
  onTrace?: (trace: StallTrace) => void;
  onError?: (err: Error) => void;
  beatMs?: number;
}

// JavaScript puro (worker `eval`): não passa pelo tsx, e não depende de nada do Hub.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { Session } = require("node:inspector");
const { appendFileSync } = require("node:fs");
const marks = workerData.marks, logFile = workerData.logFile;
let last = Date.now(), next = 0, busy = false;
parentPort.on("message", () => { last = Date.now(); next = 0; });
function short(url) { const s = String(url || "").replace(/^file:\\/\\/\\/?/, ""); const i = Math.max(s.lastIndexOf("/src/"), s.lastIndexOf("node_modules/")); return i >= 0 ? s.slice(i + 1) : s.split(/[\\\\/]/).slice(-2).join("/"); }
function write(rec) { try { appendFileSync(logFile, JSON.stringify(rec) + "\\n"); } catch (_) {} }
function capture(stalledMs) {
  busy = true;
  const t0 = Date.now();
  let s;
  try { s = new Session(); s.connectToMainThread(); }
  catch (e) { busy = false; const rec = { t: new Date().toISOString(), ev: "hub_loop_stall_trace", stalledMs, captureMs: 0, frames: [], error: String(e && e.message || e) }; write(rec); parentPort.postMessage(rec); return; }
  // O V8 novo não preenche mais callFrames[].url: o endereço vem do scriptId, traduzido pelos
  // scriptParsed que o Debugger.enable emite para cada script já carregado.
  const urls = new Map();
  s.on("Debugger.scriptParsed", (ev) => { if (ev.params.url) urls.set(ev.params.scriptId, ev.params.url); });
  s.once("Debugger.paused", (ev) => {
    let rec;
    try {
      const frames = (ev.params.callFrames || []).slice(0, 30).map((f) => ({ fn: f.functionName || "(anon)", url: short(f.url || urls.get(f.location.scriptId) || ""), line: f.location.lineNumber + 1 }));
      rec = { t: new Date().toISOString(), ev: "hub_loop_stall_trace", stalledMs, captureMs: Date.now() - t0, frames };
      write(rec);
    } finally {
      s.post("Debugger.resume", () => { s.post("Debugger.disable", () => { try { s.disconnect(); } catch (_) {} busy = false; if (rec) parentPort.postMessage(rec); }); });
    }
  });
  s.post("Debugger.enable", (err) => { if (err) { busy = false; try { s.disconnect(); } catch (_) {} return; } s.post("Debugger.pause"); });
}
setInterval(() => {
  if (busy || next >= marks.length) return;
  const stalled = Date.now() - last;
  if (stalled < marks[next]) return;
  next++;
  capture(stalled);
}, 100);
`;

export function startStallForensics(opts: StallForensicsOptions): { stop(): void } {
  const marks = [...opts.marks].filter((m) => m > 0).sort((a, b) => a - b);
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { marks, logFile: opts.logFile } });
  worker.unref();   // a worker nunca segura o Hub vivo
  worker.on("message", (m: StallTrace) => { try { opts.onTrace?.(m); } catch { /* nunca derruba o Hub */ } });
  worker.on("error", (e) => { try { opts.onError?.(e); } catch { /* idem */ } });
  const beat = setInterval(() => { try { worker.postMessage(0); } catch { /* worker saiu */ } }, opts.beatMs ?? 500);
  beat.unref?.();
  return { stop() { clearInterval(beat); void worker.terminate(); } };
}
