/**
 * Embedding bridge — the Hub talks to a PERSISTENT python service (services/voice/embed_service.py)
 * that loads sentence-transformers ONCE and stays warm, instead of spawning a fresh interpreter that
 * cold-loads torch + the model on every call. The old per-call spawn was the dominant cost of the
 * post-turn background work (tens of seconds to over a minute on CPU, every turn). This mirrors the
 * warm-daemon pattern already used for TTS/STT (tts.ts + piper_service.py).
 *
 * Protocol: line-delimited JSON. On spawn the service emits {"ready":true} once (or {"ready":false,
 * "error":...} if sentence-transformers is missing); each request {"id",​"texts"} gets exactly one
 * reply {"id","vecs"} or {"id","error"}. A hung request kills+respawns the process so the next call
 * starts clean. Requires `pip install sentence-transformers` on the Hub machine.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";

const SERVICE = fileURLToPath(new URL("../../../services/voice/embed_service.py", import.meta.url));
const PY = process.env.JARVIS_PYTHON || "python";
const REQUEST_TIMEOUT_MS = 60000;

interface Pending {
  resolve: (vecs: number[][]) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

let proc: ChildProcessWithoutNullStreams | null = null;
let rl: Interface | null = null;
let ready: Promise<void> | null = null;
const pending = new Map<number, Pending>();
let seq = 0;

/** Fail every in-flight request and drop the process so the next call respawns a clean one. */
function killProc(err: Error): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
  try { rl?.close(); } catch { /* ignore */ }
  try { proc?.kill(); } catch { /* ignore */ }
  proc = null;
  rl = null;
  ready = null;
}

/** Spawn (once) the warm embedding service and resolve when it reports {"ready":true}. */
function ensureProc(): Promise<void> {
  if (proc && ready) return ready;
  const child = spawn(PY, [SERVICE], {
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  });
  proc = child;
  let readyResolve!: () => void;
  let readyReject!: (e: Error) => void;
  ready = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej; });
  let started = false;

  rl = createInterface({ input: child.stdout });
  rl.on("line", (raw) => {
    const line = raw.trim();
    if (!line) return;
    let o: { ready?: boolean; error?: string; id?: number; vecs?: number[][] };
    try { o = JSON.parse(line); } catch { return; }
    if (!started && "ready" in o) {
      started = true;
      if (o.ready) { readyResolve(); return; }
      // Service reported it can't start (e.g. sentence-transformers missing). Reject the awaiter —
      // killProc alone would leave `ready` pending forever and hang every caller. embedOne's caller
      // (indexSession) catches and no-ops, so semantic memory stays gracefully opt-in.
      readyReject(new Error("embed: " + (o.error || "serviço não iniciou (sentence-transformers instalado?)")));
      killProc(new Error("embed: serviço não iniciou"));
      return;
    }
    const id = o.id;
    if (id == null) return;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (o.error) p.reject(new Error("embed: " + o.error));
    else p.resolve(Array.isArray(o.vecs) ? o.vecs : []);
  });

  child.stderr.on("data", () => { /* torch/model progress noise — ignore */ });
  child.on("error", (e) => {
    const err = e instanceof Error ? e : new Error(String(e));
    if (!started) { started = true; readyReject(err); }
    killProc(err);
  });
  child.on("close", () => {
    const err = new Error("embed: serviço encerrou");
    if (!started) { started = true; readyReject(err); }
    killProc(err);
  });
  return ready;
}

/** Embed a batch of texts → one vector each. Empty input short-circuits (no spawn). */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  await ensureProc();
  const id = ++seq;
  const req = JSON.stringify({ id, texts }) + "\n";
  return await new Promise<number[][]>((resolve, reject) => {
    const timer = setTimeout(() => killProc(new Error("embed: tempo esgotado")), REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      proc!.stdin.write(req);
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export async function embedOne(text: string): Promise<number[]> {
  const v = await embed([text]);
  return v[0] || [];
}
