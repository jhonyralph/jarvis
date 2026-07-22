/**
 * Composer power-triggers that transform a message before/instead of a normal turn:
 *   - "!cmd"  runs cmd on THIS machine in the session cwd and INJECTS its output into the turn prompt
 *             (the model then sees the output as context). The chat still shows the raw "!cmd".
 *   - "#note" APPENDS the note to the session's instruction file (CLAUDE.md for Claude,
 *             GEMINI.md for Gemini, AGENTS.md for the other registered CLIs) — no turn; confirms first.
 * Both act on the machine that owns the session (hub for local, runner for remote).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { instructionFileName } from "./context.js";
import { writeTextAtomic } from "./persist.js";

const BANG_OUTPUT_MAX = 20000; // cap injected output so a chatty command can't blow up the prompt

/** If `text` starts with "!", run its command line in `cwd` and return the prompt to send the agent
 *  (raw "!cmd" is what the chat shows). Any lines AFTER the command line become the user's actual
 *  ask, with the command output injected below. Returns null when it isn't a "!" command. */
export function expandBang(text: string, cwd: string, timeoutMs = 30000): Promise<{ cmd: string; expanded: string; code: number } | null> {
  const t = (text || "").replace(/^\s+/, "");
  if (!t.startsWith("!")) return Promise.resolve(null);
  const nl = t.indexOf("\n");
  const cmd = (nl === -1 ? t.slice(1) : t.slice(1, nl)).trim();
  const rest = nl === -1 ? "" : t.slice(nl + 1).trim();
  if (!cmd) return Promise.resolve(null);
  return new Promise((resolve) => {
    let out = "", done = false;
    const finish = (code: number): void => {
      if (done) return; done = true;
      const clipped = out.length > BANG_OUTPUT_MAX ? out.slice(0, BANG_OUTPUT_MAX) + "\n… (saída truncada)" : out;
      const block = "Saída de `" + cmd + "` (exit " + code + "):\n```\n" + (clipped.trim() || "(sem saída)") + "\n```";
      resolve({ cmd, expanded: (rest ? rest + "\n\n" : "") + block, code });
    };
    let p: ReturnType<typeof spawn>;
    try { p = spawn(cmd, { cwd: cwd || process.cwd(), shell: true, windowsHide: true }); }
    catch (e: any) { out = String(e?.message ?? e); return finish(-1); }
    const timer = setTimeout(() => { try { p.kill(); } catch { /* ignore */ } out += "\n… (tempo esgotado — comando encerrado)"; finish(124); }, timeoutMs);
    p.stdout?.on("data", (d) => { out += d.toString(); });
    p.stderr?.on("data", (d) => { out += d.toString(); });
    p.on("error", (e: any) => { clearTimeout(timer); out += String(e?.message ?? e); finish(-1); });
    p.on("close", (code) => { clearTimeout(timer); finish(code ?? -1); });
  });
}

export interface MemoryAppendPreview {
  file: string;
  note: string;
  appendText: string;
  beforeHash: string;
  exists: boolean;
  createdAt: number;
}

export interface MemoryWriteProvenance {
  at: number;
  sessionId?: string;
  runnerId: string;
  userId?: string;
  deviceId?: string;
  agent?: string;
  cwd: string;
  target: string;
  beforeHash: string;
  afterHash: string;
  noteHash: string;
}

function sha256(text: string): string { return createHash("sha256").update(text).digest("hex"); }

/** Produce an exact, side-effect-free instruction-file write preview. */
export function previewMemoryAppend(text: string, cwd: string, agent: string | null): MemoryAppendPreview {
  const note = text.replace(/^\s*#+\s*/, "").trim();
  if (!note) throw new Error("a nota de memória está vazia");
  if (note.length > 8000) throw new Error("a nota de memória excede 8000 caracteres");
  const file = resolve(cwd || process.cwd(), instructionFileName(agent || undefined));
  const fileExists = existsSync(file);
  const before = fileExists ? readFileSync(file, "utf8") : "";
  return {
    file,
    note,
    appendText: (before ? "\n" : "") + "- " + note + "\n",
    beforeHash: sha256(before),
    exists: fileExists,
    createdAt: Date.now(),
  };
}

/** Apply a server-held preview once. A changed file invalidates the preview instead of overwriting it. */
export function applyMemoryAppend(preview: MemoryAppendPreview): { file: string; note: string; beforeHash: string; afterHash: string } {
  const before = existsSync(preview.file) ? readFileSync(preview.file, "utf8") : "";
  const beforeHash = sha256(before);
  if (beforeHash !== preview.beforeHash) throw new Error("o arquivo mudou depois da prévia; gere uma nova prévia");
  const after = before + preview.appendText;
  writeTextAtomic(preview.file, after);
  return { file: preview.file, note: preview.note, beforeHash, afterHash: sha256(after) };
}

/** Compatibility helper for trusted internal callers. Interactive writes must use preview/apply. */
export function appendMemory(text: string, cwd: string, agent: string | null): { file: string; note: string } {
  const result = applyMemoryAppend(previewMemoryAppend(text, cwd, agent));
  return { file: result.file, note: result.note };
}

export class MemoryProvenanceStore {
  readonly path: string;
  constructor(dir = join(process.env.JARVIS_HOME || homedir(), ".jarvis")) {
    this.path = join(dir, "memory-provenance.jsonl");
  }
  append(record: MemoryWriteProvenance): void {
    mkdirSync(dirname(this.path), { recursive: true });
    try {
      if (existsSync(this.path) && statSync(this.path).size >= 10 * 1024 * 1024) {
        const previous = this.path + ".1";
        try { if (existsSync(previous)) unlinkSync(previous); } catch { /* best effort */ }
        renameSync(this.path, previous);
      }
    } catch { /* provenance rotation is best effort */ }
    appendFileSync(this.path, JSON.stringify(record) + "\n", "utf8");
  }
}
