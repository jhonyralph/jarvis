/**
 * TTS bridge — v1 invokes Piper directly (local, offline). Later this becomes a
 * call to the persistent Python voice service (services/voice) over local WS.
 */
import { spawn } from "node:child_process";
import { readFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const VOICES = join(homedir(), ".jarvis", "voices");

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
const PY = process.env.JARVIS_PYTHON || "python";
// fluidity tuning (env-overridable): slightly slower + a pause after each sentence reads
// more naturally than Piper's default; noise-w adds a touch of prosody variation.
const LENGTH = process.env.JARVIS_TTS_LENGTH || "1.06";
const SILENCE = process.env.JARVIS_TTS_SILENCE || "0.32";
const NOISEW = process.env.JARVIS_TTS_NOISEW || "0.9";

export async function synthesize(text: string, voice = "en_GB-alan-medium"): Promise<Buffer> {
  const model = join(VOICES, `${voice}.onnx`);
  if (!existsSync(model)) throw new Error(`voice model not found: ${model}`);
  const out = join(tmpdir(), `jarvis_tts_${Date.now()}.wav`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PY, ["-m", "piper", "-m", model, "-f", out, "--length-scale", LENGTH, "--sentence-silence", SILENCE, "--noise-w-scale", NOISEW], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } }); // UTF-8: acentos no texto falado
    p.stdin.write(text);
    p.stdin.end();
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || `piper exited ${code}`))));
  });
  const buf = readFileSync(out);
  try {
    unlinkSync(out);
  } catch {
    /* ignore */
  }
  return buf;
}
