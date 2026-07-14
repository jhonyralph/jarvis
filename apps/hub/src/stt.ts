/**
 * STT bridge — v1 invokes faster-whisper (services/voice/whisper_stt.py) per call.
 * Local & offline. Later: a persistent Python voice service (model loaded once).
 * PyAV decodes webm/opus (what browsers record) directly — no wav conversion.
 */
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../../services/voice/whisper_stt.py", import.meta.url));
const PY = process.env.JARVIS_PYTHON || "python";

export async function transcribe(audio: Buffer, lang?: string, ext = "webm"): Promise<string> {
  const path = join(tmpdir(), `jarvis_stt_${Date.now()}.${ext}`);
  writeFileSync(path, audio);
  try {
    const args = [SCRIPT, path];
    if (lang) args.push("--lang", lang);
    const out = await run(PY, args);
    const m = out.match(/\[whisper\]\s*\([^)]*\)\s*([\s\S]*)/);
    return (m ? m[1] : out).trim();
  } finally {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `stt exited ${code}`))));
  });
}
