/**
 * STT bridge — talks to a PERSISTENT faster-whisper service (services/voice/whisper_service.py)
 * over stdio JSON lines. The model (large-v3-turbo by default) is loaded ONCE and kept warm, so
 * each voice message is fast — no per-call model reload. Local & offline.
 *
 * Language is AUTO-DETECTED (pt / en / es …) unless a hint is passed. A hotwords glossary biases
 * the decoder toward the vocabulary we actually use (tools, names, English tech terms spoken inside
 * Portuguese). Extra terms can be added, one per line, in ~/.jarvis/stt-hotwords.txt.
 */
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface, Interface } from "node:readline";

const SERVICE = fileURLToPath(new URL("../../../services/voice/whisper_service.py", import.meta.url));
const PY = process.env.JARVIS_PYTHON || "python";

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

interface Pending { resolve: (text: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; }

let proc: ChildProcessWithoutNullStreams | null = null;
let rl: Interface | null = null;
let ready: Promise<void> | null = null;
const pending = new Map<number, Pending>();
let seq = 0;

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
    if (!started && ("ready" in o)) { started = true; if (o.ready) readyResolve(); else killProc(new Error("STT: " + (o.error || "modelo não carregou"))); return; }
    const id = o.id; if (id == null) return;
    const p = pending.get(id); if (!p) return;
    pending.delete(id); clearTimeout(p.timer);
    if (o.error) p.reject(new Error("STT: " + o.error)); else p.resolve(String(o.text || ""));
  });
  child.stderr.on("data", () => { /* faster-whisper loga progresso no stderr — ignora */ });
  child.on("error", (e) => { if (!started) readyReject(e); killProc(e instanceof Error ? e : new Error(String(e))); });
  child.on("close", () => { if (!started) readyReject(new Error("STT: serviço encerrou antes de ficar pronto")); killProc(new Error("STT: serviço encerrou")); });
  return ready;
}

export async function transcribe(audio: Buffer, lang?: string, ext = "webm"): Promise<string> {
  const path = join(tmpdir(), `jarvis_stt_${Date.now()}_${++seq}.${ext}`);
  writeFileSync(path, audio);
  try {
    await ensureProc();
    const id = ++seq;
    const req = JSON.stringify({ id, path, lang: lang || null, hotwords: hotwords() }) + "\n";
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("STT: tempo esgotado")); }, 60000);
      pending.set(id, { resolve, reject, timer });
      try { proc!.stdin.write(req); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  } finally {
    try { unlinkSync(path); } catch { /* ignore */ }
  }
}
