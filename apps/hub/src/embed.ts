/**
 * Embedding bridge — Hub shells out to services/voice/embed.py (sentence-transformers) for LOCAL
 * text embeddings. Same pattern as speaker.ts: spawn python, feed JSON on stdin, parse the trailing
 * JSON array on stdout. Requires `pip install sentence-transformers` on the Hub machine.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../../services/voice/embed.py", import.meta.url));
const PY = process.env.JARVIS_PYTHON || "python";

/** Parse the LAST JSON array on stdout (torch/model load may print noise before it). */
function lastJsonArray(s: string): number[][] {
  const m = s.trim().match(/\[[\s\S]*\]\s*$/);
  if (!m) throw new Error("embed: sem array JSON na saída (sentence-transformers instalado?)");
  return JSON.parse(m[0]);
}

/** Embed a batch of texts → one vector each. Empty input short-circuits (no python spawn). */
export function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const p = spawn(PY, [SCRIPT], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) { try { resolve(lastJsonArray(out)); } catch (e) { reject(e); } }
      else reject(new Error(err.trim() || `embed saiu com ${code}`));
    });
    p.stdin.write(JSON.stringify(texts));
    p.stdin.end();
  });
}

export async function embedOne(text: string): Promise<number[]> {
  const v = await embed([text]);
  return v[0] || [];
}
