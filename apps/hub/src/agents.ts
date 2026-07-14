/**
 * Agnostic agent layer. Adding an agent = one adapter + register it; the Hub's
 * routing never changes. Ships: mock, claude-code (native Claude), codex (native
 * OpenAI Codex). Any other CLI agent slots in the same way.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentReply {
  text: string;
}

export interface AgentAdapter {
  /** stable id used by clients to pick this agent, e.g. "claude-code" | "codex" */
  readonly name: string;
  /** whether the agent is usable right now (installed + logged in) */
  available(): Promise<boolean>;
  send(sessionId: string, text: string, cwd: string): Promise<AgentReply>;
}

/** Registry: the Hub holds many adapters and routes by name. This is the agnostic core. */
export class AgentRegistry {
  private byName = new Map<string, AgentAdapter>();
  constructor(private defaultName: string) {}
  register(a: AgentAdapter): this {
    this.byName.set(a.name, a);
    return this;
  }
  get(name?: string): AgentAdapter {
    const a = this.byName.get(name || this.defaultName) || this.byName.get(this.defaultName);
    if (!a) throw new Error(`no agent '${name}' and no default '${this.defaultName}'`);
    return a;
  }
  names(): string[] {
    return [...this.byName.keys()];
  }
  setDefault(name: string): void {
    if (this.byName.has(name)) this.defaultName = name;
  }
  get default(): string {
    return this.defaultName;
  }
}

// ---------------------------------------------------------------------------

/** v1 fallback so the server is testable even with no agent logged in. */
export class MockAgentAdapter implements AgentAdapter {
  readonly name = "mock";
  async available(): Promise<boolean> {
    return true;
  }
  async send(_sid: string, text: string): Promise<AgentReply> {
    return { text: `Recebi: "${text}". (agente mock — o Hub/chat/voz estão OK.)` };
  }
}

/** Native Claude Code, headless. Requires `claude` logged in (claude /login). */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";
  private sessions = new Map<string, string>();
  private bin =
    (existsSync(join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"))
      ? join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude")
      : "claude");

  async available(): Promise<boolean> {
    try {
      const out = await run(this.bin, ["-p", "ok", "--output-format", "json"], homedir(), "", false);
      return !JSON.parse(out).is_error;
    } catch {
      return false;
    }
  }

  async send(sessionId: string, text: string, cwd: string): Promise<AgentReply> {
    const prev = this.sessions.get(sessionId);
    const args = ["-p", text, "--output-format", "json", "--permission-mode", "bypassPermissions"];
    if (prev) args.unshift("--resume", prev);
    const raw = await run(this.bin, args, cwd, "", false);
    const json = JSON.parse(raw);
    if (json.is_error) throw new Error(json.result || "claude error");
    if (json.session_id) this.sessions.set(sessionId, json.session_id);
    return { text: json.result ?? "" };
  }
}

/**
 * Native OpenAI Codex, headless (`codex exec`, prompt via stdin, cwd = spawn cwd).
 * Requires `codex login` once. v1: reply = raw stdout; session continuity via
 * `resume --last`. Parsing/continuity to be refined after a real logged-in run.
 */
export class CodexAdapter implements AgentAdapter {
  readonly name = "codex";
  private started = new Set<string>();

  async available(): Promise<boolean> {
    try {
      const out = await run("codex", ["login", "status"], homedir(), "", true);
      return /logged in|authenticated|active/i.test(out);
    } catch {
      return false;
    }
  }

  async send(sessionId: string, text: string, cwd: string): Promise<AgentReply> {
    const args = ["exec", "--sandbox", "workspace-write"];
    if (this.started.has(sessionId)) args.splice(1, 0, "resume", "--last");
    const out = await run("codex", args, cwd, text, true);
    this.started.add(sessionId);
    return { text: out.trim() };
  }
}

// ---------------------------------------------------------------------------

/** Run a command; feed `stdin` if given; `useShell` for npm .cmd shims on Windows. */
function run(cmd: string, args: string[], cwd: string, stdin: string, useShell: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true, shell: useShell });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    if (stdin) {
      p.stdin.write(stdin);
    }
    p.stdin.end();
    p.on("close", (code) => {
      if (out.trim()) resolve(out);
      else reject(new Error(err.trim() || `${cmd} exited with ${code}`));
    });
  });
}
