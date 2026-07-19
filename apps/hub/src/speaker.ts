/**
 * Speaker-ID bridge — Hub shells out to services/voice/voice_cli.py (Resemblyzer).
 * Local & offline. Identifies who spoke a voice utterance and manages enrolled
 * voiceprints (stored under ~/.jarvis/voiceprints — never leaves the machine).
 * Later: fold into a persistent Python voice service so torch loads once.
 */
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../../services/voice/voice_cli.py", import.meta.url));
const PY = process.env.JARVIS_PYTHON || "python";

export interface SpeakerId {
  name: string | null; // enrolled name if score cleared threshold, else null
  best?: string; // closest enrolled name regardless of threshold
  score: number;
  known: boolean;
  threshold?: number;
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(PY, [SCRIPT, ...args], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `voice_cli exited ${code}`))));
  });
}

/** Parse the LAST {...} JSON object on stdout (torch/model noise may precede it). */
function lastJson(s: string): any {
  const m = s.trim().match(/\{[\s\S]*\}\s*$/);
  if (!m) throw new Error("voice_cli: no JSON in output");
  return JSON.parse(m[0]);
}

function tmp(ext: string): string {
  // `ext` is client-supplied — reject anything that isn't a short alphanumeric extension, so it can't
  // steer the write out of tmp (e.g. "../../../foo.cmd"). Falls back to a safe default.
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext : "webm";
  return join(tmpdir(), `jarvis_spk_${randomUUID()}.${safeExt}`);
}

/** Identify the speaker of one utterance. Returns known=false if no voiceprint matches. */
export async function identifySpeaker(audio: Buffer, ext = "webm", threshold?: number): Promise<SpeakerId> {
  const path = tmp(ext);
  writeFileSync(path, audio);
  try {
    const args = ["identify", path];
    if (threshold != null) args.push("--threshold", String(threshold));
    return lastJson(await run(args)) as SpeakerId;
  } finally {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

/** Enroll (or overwrite) a named voiceprint from a few short samples. */
export async function enrollSpeaker(name: string, samples: Buffer[], ext = "webm"): Promise<{ name: string; samples: number }> {
  const paths = samples.map(() => tmp(ext));
  samples.forEach((b, i) => writeFileSync(paths[i], b));
  try {
    return lastJson(await run(["enroll", "--name", name, ...paths]));
  } finally {
    for (const p of paths) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

export async function listSpeakers(): Promise<string[]> {
  try {
    return lastJson(await run(["list"])).speakers ?? [];
  } catch {
    return [];
  }
}

export async function deleteSpeaker(name: string): Promise<boolean> {
  try {
    return !!lastJson(await run(["delete", "--name", name])).deleted;
  } catch {
    return false;
  }
}
