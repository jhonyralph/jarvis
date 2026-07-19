/**
 * Composer power-triggers that transform a message before/instead of a normal turn:
 *   - "!cmd"  runs cmd on THIS machine in the session cwd and INJECTS its output into the turn prompt
 *             (the model then sees the output as context). The chat still shows the raw "!cmd".
 *   - "#note" APPENDS the note to the session's memory file (CLAUDE.md for Claude / AGENTS.md for
 *             Codex) in the cwd — no turn; the client confirms first.
 * Both act on the machine that owns the session (hub for local, runner for remote).
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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

/** Append a "#" note to the session's memory file for `agent` (CLAUDE.md / AGENTS.md) under `cwd`.
 *  Returns the file written and the cleaned note. Never invoked without the user confirming first. */
export function appendMemory(text: string, cwd: string, agent: "claude" | "codex" | null): { file: string; note: string } {
  const note = text.replace(/^\s*#+\s*/, "").trim();
  const fname = agent === "codex" ? "AGENTS.md" : "CLAUDE.md";
  const file = join(cwd || process.cwd(), fname);
  if (note) appendFileSync(file, (existsSync(file) ? "\n" : "") + "- " + note + "\n", "utf8");
  return { file, note };
}
