/**
 * Agnostic agent layer. Adding an agent = one adapter + register it; routing never
 * changes. Each adapter exposes capabilities() (models + effort levels) so the UI
 * can offer a searchable model/effort picker per agent — dynamic, not hardcoded in
 * the client. (Today the lists live in the adapter; can be made API-backed later.)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentReply {
  text: string;
  usage?: { costUsd?: number; inputTokens?: number; outputTokens?: number };
}

export interface AgentCaps {
  models: string[];
  efforts: string[];
  defaultModel?: string;
  defaultEffort?: string;
}

export interface SendOpts {
  model?: string;
  effort?: string;
}

export interface AgentAdapter {
  readonly name: string;
  capabilities(): AgentCaps;
  available(): Promise<boolean>;
  send(sessionId: string, text: string, cwd: string, opts?: SendOpts): Promise<AgentReply>;
}

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
  /** [{ name, models, efforts, ... }] for the UI's agent + model + effort pickers */
  describe(): Array<{ name: string } & AgentCaps> {
    return [...this.byName.values()].map((a) => ({ name: a.name, ...a.capabilities() }));
  }
  setDefault(name: string): void {
    if (this.byName.has(name)) this.defaultName = name;
  }
  get default(): string {
    return this.defaultName;
  }
}

// ---------------------------------------------------------------------------

export class MockAgentAdapter implements AgentAdapter {
  readonly name = "mock";
  capabilities(): AgentCaps {
    return { models: [], efforts: [] };
  }
  async available(): Promise<boolean> {
    return true;
  }
  async send(_sid: string, text: string): Promise<AgentReply> {
    return { text: `Recebi: "${text}". (agente mock — Hub/chat/voz OK.)` };
  }
}

/** Native Claude Code, headless. Requires `claude` logged in (claude /login). */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";
  private sessions = new Map<string, string>();
  private bin =
    existsSync(join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"))
      ? join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude")
      : "claude";

  capabilities(): AgentCaps {
    return {
      models: ["opus", "sonnet", "haiku"],
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultModel: "opus",
      defaultEffort: "high",
    };
  }

  /** the native claude session id backing a Jarvis session (for a future "open in native Claude") */
  claudeSessionId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId);
  }

  async available(): Promise<boolean> {
    try {
      const out = await run(this.bin, ["-p", "ok", "--output-format", "json"], homedir(), "", false);
      return !JSON.parse(out).is_error;
    } catch {
      return false;
    }
  }

  async send(sessionId: string, text: string, cwd: string, opts?: SendOpts): Promise<AgentReply> {
    const prev = this.sessions.get(sessionId);
    const args = ["-p", text, "--output-format", "json", "--permission-mode", "bypassPermissions"];
    if (opts?.model) args.push("--model", opts.model);
    if (opts?.effort) args.push("--effort", opts.effort);
    if (prev) args.unshift("--resume", prev);
    const raw = await run(this.bin, args, cwd, "", false);
    const json = JSON.parse(raw);
    if (json.is_error) throw new Error(json.result || "claude error");
    if (json.session_id) this.sessions.set(sessionId, json.session_id);
    return {
      text: json.result ?? "",
      usage: { costUsd: json.total_cost_usd, inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens },
    };
  }
}

/** Native OpenAI Codex, headless (`codex exec`). Requires `codex login` once. */
export class CodexAdapter implements AgentAdapter {
  readonly name = "codex";
  private started = new Set<string>();

  capabilities(): AgentCaps {
    return {
      models: ["gpt-5-codex", "gpt-5", "o3"],
      efforts: ["low", "medium", "high"],
      defaultEffort: "medium",
    };
  }

  async available(): Promise<boolean> {
    try {
      const out = await run("codex", ["login", "status"], homedir(), "", true);
      return /logged in|authenticated|active/i.test(out);
    } catch {
      return false;
    }
  }

  async send(sessionId: string, text: string, cwd: string, opts?: SendOpts): Promise<AgentReply> {
    const args = ["exec", "--cd", cwd, "--dangerously-bypass-approvals-and-sandbox"];
    if (opts?.model) args.push("-m", opts.model);
    if (opts?.effort) args.push("-c", `model_reasoning_effort=${opts.effort}`);
    const out = await run("codex", args, cwd, text, true);
    this.started.add(sessionId);
    return { text: out.trim() };
  }
}

// ---------------------------------------------------------------------------

function run(cmd: string, args: string[], cwd: string, stdin: string, useShell: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true, shell: useShell });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    if (stdin) p.stdin.write(stdin);
    p.stdin.end();
    p.on("close", (code) => {
      if (out.trim()) resolve(out);
      else reject(new Error(err.trim() || `${cmd} exited with ${code}`));
    });
  });
}
