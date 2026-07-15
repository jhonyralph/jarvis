/**
 * Agnostic agent layer. Adding an agent = one adapter + register it; routing never
 * changes. capabilities() is DISCOVERED AT RUNTIME (no hardcoded lists):
 *   - claude-code: GET https://api.anthropic.com/v1/models (OAuth token from
 *     ~/.claude/.credentials.json). Efforts = the --effort ladder (low..max) plus
 *     "ultracode" (a Claude-Code menu mode = xhigh + orchestration; mapped to
 *     --effort xhigh when sent). Models are PER-family; efforts shared.
 *   - codex: `codex debug models` (JSON catalog); efforts are PER-MODEL
 *     (supported_reasoning_levels); falls back to ~/.codex/models_cache.json.
 * Results cache ~1h; on any failure we fall back to a small pinned list.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentReply {
  text: string;
  usage?: { costUsd?: number; inputTokens?: number; outputTokens?: number };
}

/** A model + the effort levels IT supports (efforts can differ per model). */
export interface ModelInfo {
  id: string;
  label?: string;
  efforts: string[];
  defaultEffort?: string;
}

export interface AgentCaps {
  models: ModelInfo[];
  defaultModel?: string;
}

export interface SendOpts {
  model?: string;
  effort?: string;
}

export interface AgentAdapter {
  readonly name: string;
  capabilities(): Promise<AgentCaps>;
  available(): Promise<boolean>;
  send(sessionId: string, text: string, cwd: string, opts?: SendOpts): Promise<AgentReply>;
  /** Stateless one-off prompt (no session, no context) — used by cross-session search. */
  oneShot?(text: string, opts?: SendOpts): Promise<AgentReply>;
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
  /** Agent used for cross-session search reasoning (JARVIS_SEARCH_AGENT, else claude-code, else default). */
  searchAgent(): AgentAdapter {
    const pref = process.env.JARVIS_SEARCH_AGENT;
    if (pref && this.byName.has(pref)) return this.byName.get(pref)!;
    return this.byName.get("claude-code") || this.get();
  }
  /** [{ name, models:[{id,label,efforts,defaultEffort}], defaultModel }] for the UI pickers */
  async describe(): Promise<Array<{ name: string } & AgentCaps>> {
    return Promise.all([...this.byName.values()].map(async (a) => ({ name: a.name, ...(await a.capabilities()) })));
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
  async capabilities(): Promise<AgentCaps> {
    return { models: [] };
  }
  async available(): Promise<boolean> {
    return true;
  }
  async send(_sid: string, text: string): Promise<AgentReply> {
    return { text: `Recebi: "${text}". (agente mock — Hub/chat/voz OK.)` };
  }
  async oneShot(): Promise<AgentReply> {
    return { text: '{"answer":"(busca mock — defina JARVIS_SEARCH_AGENT=claude-code para busca real)","matches":[],"action":null}' };
  }
}

/** Native Claude Code, headless. Requires `claude` logged in. */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";
  private sessions = new Map<string, string>();
  private capsCache?: { at: number; caps: AgentCaps };
  private bin =
    existsSync(join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"))
      ? join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude")
      : "claude";

  async capabilities(): Promise<AgentCaps> {
    if (this.capsCache && Date.now() - this.capsCache.at < 3_600_000) return this.capsCache.caps;
    // --effort ladder (low..max) + Claude-Code "ultracode" pseudo-level.
    const efforts = ["low", "medium", "high", "xhigh", "max", "ultracode"];
    let models: ModelInfo[];
    try {
      const token = JSON.parse(readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8"))?.claudeAiOauth?.accessToken;
      if (!token) throw new Error("no token");
      const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
        headers: { authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20" },
      });
      const json: any = await res.json();
      models = (json?.data || []).map((m: any) => ({ id: m.id, label: m.display_name, efforts, defaultEffort: "high" }));
      // family aliases up front (opus/sonnet/haiku/fable resolve to the newest of each)
      models = [
        ...["opus", "sonnet", "haiku", "fable"].map((id) => ({ id, label: id, efforts, defaultEffort: "high" })),
        ...models,
      ];
      if (models.length <= 4) throw new Error("empty models");
    } catch {
      models = ["opus", "sonnet", "haiku", "fable"].map((id) => ({ id, label: id, efforts, defaultEffort: "high" }));
    }
    const caps: AgentCaps = { models, defaultModel: process.env.ANTHROPIC_MODEL || "opus" };
    this.capsCache = { at: Date.now(), caps };
    return caps;
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
    // native imported sessions ("claude:<uuid>") resume the underlying real claude session
    const prev = this.sessions.get(sessionId) || (sessionId.startsWith("claude:") ? sessionId.slice("claude:".length) : undefined);
    const args = ["-p", text, "--output-format", "json", "--permission-mode", "bypassPermissions"];
    if (opts?.model) args.push("--model", opts.model);
    if (opts?.effort) args.push("--effort", opts.effort === "ultracode" ? "xhigh" : opts.effort); // ultracode -> xhigh
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

  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> {
    const args = ["-p", text, "--output-format", "json", "--permission-mode", "bypassPermissions"];
    if (opts?.model) args.push("--model", opts.model);
    if (opts?.effort) args.push("--effort", opts.effort === "ultracode" ? "xhigh" : opts.effort);
    const raw = await run(this.bin, args, homedir(), "", false); // stateless: no --resume, no this.sessions write
    const json = JSON.parse(raw);
    if (json.is_error) throw new Error(json.result || "claude error");
    return { text: json.result ?? "" };
  }
}

/** Native OpenAI Codex, headless (`codex exec`). Requires `codex login`. */
export class CodexAdapter implements AgentAdapter {
  readonly name = "codex";
  private started = new Set<string>();
  private capsCache?: { at: number; caps: AgentCaps };

  async capabilities(): Promise<AgentCaps> {
    if (this.capsCache && Date.now() - this.capsCache.at < 3_600_000) return this.capsCache.caps;
    const mapModels = (arr: any[]): ModelInfo[] =>
      (arr || [])
        .filter((m) => m.visibility === "list")
        .map((m) => ({ id: m.slug, label: m.display_name, efforts: (m.supported_reasoning_levels || []).map((e: any) => e.effort), defaultEffort: m.default_reasoning_level }));
    let models: ModelInfo[] = [];
    try {
      const out = await run("codex", ["debug", "models"], homedir(), "", true);
      models = mapModels(JSON.parse(out.slice(out.indexOf("{"))).models);
    } catch {
      try {
        const cache = JSON.parse(readFileSync(join(homedir(), ".codex", "models_cache.json"), "utf8"));
        models = mapModels(cache.models);
      } catch {
        const eff = ["low", "medium", "high", "xhigh"];
        models = [
          { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", efforts: [...eff, "max"], defaultEffort: "medium" },
          { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", efforts: [...eff, "max", "ultra"], defaultEffort: "medium" },
          { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", efforts: [...eff, "max"], defaultEffort: "medium" },
        ];
      }
    }
    const caps: AgentCaps = { models, defaultModel: models[0]?.id };
    this.capsCache = { at: Date.now(), caps };
    return caps;
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

  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> {
    const args = ["exec", "--cd", homedir(), "--dangerously-bypass-approvals-and-sandbox"];
    if (opts?.model) args.push("-m", opts.model);
    if (opts?.effort) args.push("-c", `model_reasoning_effort=${opts.effort}`);
    const out = await run("codex", args, homedir(), text, true); // stateless: no this.started
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
