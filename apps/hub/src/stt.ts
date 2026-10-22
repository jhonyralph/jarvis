/**
 * STT bridge — talks to a PERSISTENT faster-whisper service (services/voice/whisper_service.py)
 * over stdio JSON lines. The model (large-v3-turbo by default) is loaded ONCE and kept warm, so
 * each voice message is fast — no per-call model reload. Local & offline.
 *
 * Language: pinned to Portuguese by the service (JARVIS_STT_LANG, default "pt") unless the request
 * names one language (`lang`) or a SET to choose from (`langs`, VOZ-00 RN-H3 — detection restricted
 * to those, never free over ~100 languages). A hotwords glossary biases
 * the decoder toward the vocabulary we actually use (tools, names, English tech terms spoken inside
 * Portuguese). Extra terms can be added, one per line, in ~/.jarvis/stt-hotwords.txt.
 */
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface, Interface } from "node:readline";
import { log } from "./logger.js";
import { pythonBin } from "./python.js";

const SERVICE = fileURLToPath(new URL("../../../services/voice/whisper_service.py", import.meta.url));

// Domain glossary: high-value, easily-misheard terms (mostly English tech spoken inside pt-BR).
// Kept compact on purpose — Whisper only weighs the last ~224 tokens of the biasing context.
const BASE_HOTWORDS = [
  "Jarvis", "Claude", "Codex", "Opus", "Sonnet", "Haiku", "Docker", "Kubernetes", "git", "commit",
  "push", "pull", "merge", "rebase", "deploy", "runner", "hub", "endpoint", "API", "WebSocket",
  "TypeScript", "JavaScript", "Node", "npm", "PowerShell", "localhost", "token", "log", "build",
  "restart", "backend", "frontend", "branch", "pull request", "PR", "bug", "debug", "prompt",
  "faster-whisper", "Tailscale", "Cloudflare",
];
function hotwords(): string {
  let extra: string[] = [];
  try { extra = readFileSync(join(homedir(), ".jarvis", "stt-hotwords.txt"), "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean); } catch { /* opcional */ }
  return [...BASE_HOTWORDS, ...extra].join(" ");
}

/** Resultado completo de uma transcrição: texto, idioma usado e confiança 0..1 (quando o serviço informa). */
export interface Transcription { text: string; lang?: string; conf?: number }
interface Pending { resolve: (result: Transcription) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; }

let proc: ChildProcessWithoutNullStreams | null = null;
let rl: Interface | null = null;
let ready: Promise<void> | null = null;
const pending = new Map<number, Pending>();
let seq = 0;

/** Evento de uma gravação em andamento (VOZ-00 F4/F5): detector de voz e transcrição parcial. */
export interface StreamEvent {
  event: "vad" | "partial" | "error";
  speechMs?: number; silenceMs?: number; durMs?: number; partialFresh?: boolean;
  text?: string; fresh?: boolean; error?: string;
}
const streamListeners = new Map<string, (ev: StreamEvent) => void>();

function killProc(err: Error): void {
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); }
  pending.clear();
  // Gravações em andamento perdem o serviço: avisa, e o aparelho volta ao fim de fala local.
  for (const [, listener] of streamListeners) { try { listener({ event: "error", error: err.message }); } catch { /* ignore */ } }
  streamListeners.clear();
  try { rl?.close(); } catch { /* ignore */ }
  try { proc?.kill(); } catch { /* ignore */ }
  proc = null; rl = null; ready = null;
}

// Dedup do arranque. `pythonBin()` é assíncrono (sonda interpretadores), então o `await` abaixo
// fica ENTRE o guard `proc && ready` e a atribuição `proc = child`: duas chamadas concorrentes
// passavam as duas pelo guard e spawnavam DOIS serviços, com o primeiro virando órfão — modelo
// carregado, RAM presa e ninguém para matá-lo, porque `proc` já apontava para o segundo. Enquanto
// o ensureProc era síncrono até o spawn isso era impossível; voltou a ser possível com o resolvedor
// assíncrono. `starting` fecha a janela: a primeira chamada arranca, as outras esperam a MESMA
// promessa. Zerado no fim para que uma falha de spawn possa ser tentada de novo.
let starting: Promise<void> | null = null;

function ensureProc(): Promise<void> {
  if (proc && ready) return ready;
  starting ??= spawnProc().finally(() => { starting = null; });
  return starting;
}

async function spawnProc(): Promise<void> {
  // Timing: separates "cold spawn + model load" (this fn) from "decode of one clip" (transcribe's
  // own timer), so a slow voice reply can be diagnosed as one or the other instead of one lump sum.
  const tSpawn = Date.now();
  const child = spawn(await pythonBin(), [SERVICE], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  proc = child;
  let readyResolve!: () => void, readyReject!: (e: Error) => void;
  ready = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej; });
  let started = false;
  rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    line = line.trim(); if (!line) return;
    let o: any; try { o = JSON.parse(line); } catch { return; }
    if (!started && ("ready" in o)) {
      started = true;
      if (o.ready) { log.debug("stt_cold_start", { ms: Date.now() - tSpawn, device: o.device, compute: o.compute, model: o.model }); readyResolve(); }
      else killProc(new Error("STT: " + (o.error || "modelo não carregou")));
      return;
    }
    if (typeof o.sid === "string" && typeof o.event === "string") { streamListeners.get(o.sid)?.(o as StreamEvent); return; }
    const id = o.id; if (id == null) return;
    const p = pending.get(id); if (!p) return;
    pending.delete(id); clearTimeout(p.timer);
    if (o.error) p.reject(new Error("STT: " + o.error));
    else p.resolve({ text: String(o.text || ""), lang: typeof o.lang === "string" ? o.lang : undefined, conf: typeof o.conf === "number" ? o.conf : undefined });
  });
  // O serviço prefixa os diagnósticos DELE com "[stt]"; o resto do stderr é progresso de
  // carga de modelo e não interessa. Antes isto descartava tudo, então um aviso do serviço
  // (ex.: "este Mac roda STT só em CPU") não chegava a lugar nenhum — nem ao hub.log.
  let errTail = "";
  child.stderr.on("data", (d) => {
    errTail += String(d);
    const lines = errTail.split(/\r?\n/);
    errTail = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("[stt]")) continue;
      console.warn(line);
      log.info("stt_service", { line });
    }
  });
  child.on("error", (e) => { if (!started) readyReject(e); killProc(e instanceof Error ? e : new Error(String(e))); });
  child.on("close", () => { if (!started) readyReject(new Error("STT: serviço encerrou antes de ficar pronto")); killProc(new Error("STT: serviço encerrou")); });
  return ready;
}

/** Pay the cold-start (spawn + model load) at Hub boot instead of on the first live voice message.
 *  Fire-and-forget: failure just means the first real transcribe() call pays the cost inline, same
 *  as before this existed — voice stays fully functional either way. */
export function warmUp(): void {
  ensureProc().catch((e) => console.warn("[stt] pré-aquecimento falhou (seguirá sob demanda no 1º uso):", String((e as Error)?.message || e)));
}

export async function transcribe(audio: Buffer, lang?: string, ext = "webm"): Promise<string> {
  return (await transcribeDetailed(audio, { lang, ext })).text;
}

/** Gravação em andamento enviada ao serviço em pedaços (VOZ-00 F4/F5). O serviço responde com o
 *  detector de voz (silêncio desde a última FALA) e transcrições parciais; quem decide o fim do turno
 *  é o Hub. A transcrição final continua pelo pedido normal (`transcribeDetailed`). */
export interface TranscriptionStream { push(pcmB64: string): void; close(): void }

export async function openTranscriptionStream(sid: string, opts: { lang?: string; langs?: string[] }, onEvent: (ev: StreamEvent) => void): Promise<TranscriptionStream> {
  await ensureProc();
  const write = (obj: unknown): void => { try { proc?.stdin.write(JSON.stringify(obj) + "\n"); } catch { /* o serviço caiu: killProc avisa */ } };
  streamListeners.set(sid, onEvent);
  write({ op: "stream_open", sid, lang: opts.lang || null, langs: Array.isArray(opts.langs) && opts.langs.length ? opts.langs : null, hotwords: hotwords() });
  let closed = false;
  return {
    push(pcmB64: string) { if (!closed) write({ op: "stream_audio", sid, pcm: pcmB64 }); },
    close() { if (closed) return; closed = true; streamListeners.delete(sid); write({ op: "stream_close", sid }); },
  };
}

/** Como `transcribe`, mas com idioma usado e confiança — e aceitando um CONJUNTO de idiomas. */
export async function transcribeDetailed(audio: Buffer, opts: { lang?: string; langs?: string[]; ext?: string } = {}): Promise<Transcription> {
  const lang = opts.lang, ext = opts.ext || "webm";
  // `ext` comes straight from the client — a value like "../../evil.cmd" would write outside tmp.
  // Allow only a short alphanumeric extension; anything else falls back to a safe default.
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext : "webm";
  const path = join(tmpdir(), `jarvis_stt_${Date.now()}_${++seq}.${safeExt}`);
  writeFileSync(path, audio);
  try {
    const tEnsure = Date.now();
    await ensureProc();
    const ensureMs = Date.now() - tEnsure; // ~0 when already warm; the cold-start log above fires only on a real spawn
    const tDecode = Date.now();
    const id = ++seq;
    const langs = Array.isArray(opts.langs) && opts.langs.length ? opts.langs : null;
    const req = JSON.stringify({ id, path, lang: lang || null, langs, hotwords: hotwords() }) + "\n";
    return await new Promise<Transcription>((resolve, reject) => {
      // whisper_service.py processa UM pedido por vez (loop single-threaded): se este travar,
      // qualquer pedido subsequente ficaria preso atrás dele e estouraria o mesmo timeout, um a
      // um, indefinidamente. Tratamos o timeout como sinal de processo travado: mata + respawna
      // limpo (killProc rejeita todos os pendentes de uma vez, incluindo este).
      const timer = setTimeout(() => { killProc(new Error("STT: tempo esgotado")); }, 60000);
      pending.set(id, {
        resolve: (result) => { log.debug("stt_transcribe", { ensureMs, decodeMs: Date.now() - tDecode }); resolve(result); },
        reject, timer,
      });
      try { proc!.stdin.write(req); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  } finally {
    try { unlinkSync(path); } catch { /* ignore */ }
  }
}
