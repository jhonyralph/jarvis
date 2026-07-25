/**
 * TTS bridge — talks to a PERSISTENT Piper service (services/voice/piper_service.py) over stdio
 * JSON lines, mirroring the STT bridge (stt.ts) talking to whisper_service.py. Voice models are
 * loaded ONCE (lazily, per voice) and kept warm, so each spoken reply skips the Python-startup +
 * model-load cost that spawning `python -m piper` on every call used to pay — this was the biggest
 * structural latency source in the voice pipeline (Gap 1). Local & offline.
 */
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface, Interface } from "node:readline";

const SERVICE = fileURLToPath(new URL("../../../services/voice/piper_service.py", import.meta.url));
const PY = process.env.JARVIS_PYTHON || "python";
const VOICES = join(homedir(), ".jarvis", "voices");

// fluidity tuning (env-overridable): slightly slower + a pause after each sentence reads
// more naturally than Piper's default; noise-w adds a touch of prosody variation.
const LENGTH = Number(process.env.JARVIS_TTS_LENGTH || "1.06");
const SILENCE = Number(process.env.JARVIS_TTS_SILENCE || "0.32");
const NOISEW = Number(process.env.JARVIS_TTS_NOISEW || "0.9");

/** Nomes das vozes Piper instaladas em ~/.jarvis/voices (arquivos *.onnx, sem extensão). */
export function listVoices(): string[] {
  try {
    return readdirSync(VOICES)
      .filter((f) => f.endsWith(".onnx"))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/** true se o modelo de voz existe localmente. */
export function hasVoice(voice: string): boolean {
  return !!voice && existsSync(join(VOICES, `${voice}.onnx`));
}

interface Pending { resolve: (wav: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; }

let proc: ChildProcessWithoutNullStreams | null = null;
let rl: Interface | null = null;
let ready: Promise<void> | null = null;
const pending = new Map<number, Pending>();
let seq = 0;

// Mirrors stt.ts: se um pedido travar (processo Piper morto-vivo), matar + respawnar limpo em vez
// de deixar cada pedido seguinte enfileirar atrás dele até o próximo restart manual do hub.
function killProc(err: Error): void {
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); }
  pending.clear();
  try { rl?.close(); } catch { /* ignore */ }
  try { proc?.kill(); } catch { /* ignore */ }
  proc = null; rl = null; ready = null;
}

function ensureProc(): Promise<void> {
  if (proc && ready) return ready;
  const child = spawn(PY, [SERVICE], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  proc = child;
  let readyResolve!: () => void, readyReject!: (e: Error) => void;
  ready = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej; });
  let started = false;
  rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    line = line.trim(); if (!line) return;
    let o: any; try { o = JSON.parse(line); } catch { return; }
    if (!started && ("ready" in o)) { started = true; if (o.ready) readyResolve(); else killProc(new Error("TTS: " + (o.error || "serviço não iniciou"))); return; }
    const id = o.id; if (id == null) return;
    const p = pending.get(id); if (!p) return;
    pending.delete(id); clearTimeout(p.timer);
    if (o.error) p.reject(new Error("TTS: " + o.error)); else p.resolve(Buffer.from(String(o.wav_b64 || ""), "base64"));
  });
  child.stderr.on("data", () => { /* piper loga progresso no stderr — ignora */ });
  child.on("error", (e) => { if (!started) readyReject(e); killProc(e instanceof Error ? e : new Error(String(e))); });
  child.on("close", () => { if (!started) readyReject(new Error("TTS: serviço encerrou antes de ficar pronto")); killProc(new Error("TTS: serviço encerrou")); });
  return ready;
}

export async function synthesize(text: string, voice = "en_GB-alan-medium"): Promise<Buffer> {
  if (!hasVoice(voice)) throw new Error(`voice model not found: ${join(VOICES, `${voice}.onnx`)}`);
  await ensureProc();
  const id = ++seq;
  const req = JSON.stringify({ id, text, voice, length_scale: LENGTH, sentence_silence: SILENCE, noise_w_scale: NOISEW }) + "\n";
  return await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => { killProc(new Error("TTS: tempo esgotado")); }, 60000);
    pending.set(id, { resolve, reject, timer });
    try { proc!.stdin.write(req); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); }
  });
}
