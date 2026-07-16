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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { editCounts } from "./native.js";

/** For a file tool_use, extract the real path + (for edits) +/- line counts, live. */
function fileToolStat(name: string, input: any): { path?: string; adds?: number; dels?: number } {
  try {
    if (name === "Read" || name === "Edit" || name === "Write" || name === "MultiEdit") {
      const path = input?.file_path;
      if (name === "Edit") return { path, ...editCounts(input?.old_string || "", input?.new_string || "") };
      if (name === "Write") return { path, adds: input?.content ? String(input.content).split("\n").length : 0, dels: 0 };
      if (name === "MultiEdit" && Array.isArray(input?.edits)) {
        let adds = 0, dels = 0;
        for (const e of input.edits) { const c = editCounts(e?.old_string || "", e?.new_string || ""); adds += c.adds; dels += c.dels; }
        return { path, adds, dels };
      }
      return { path };
    }
    if (name === "NotebookEdit") return { path: input?.notebook_path };
  } catch { /* ignore */ }
  return {};
}

// one-shot prompts (search / summary / digest / voice-intent) run in this dir so their
// throwaway `claude -p` sessions land somewhere the native-session import excludes —
// otherwise every digest/summary/warmup shows up as a "ping"/"Painel de status" session.
const ONESHOT_CWD = join(homedir(), ".jarvis", "oneshot");
try { mkdirSync(ONESHOT_CWD, { recursive: true }); } catch { /* ignore */ }

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
  context?: number; // max input tokens (context window) — for the usage gauge
}

/** One usage window (a % used + when it resets). */
export interface UsageWindow { pct: number; resetsAt?: string; }
/** Account-level plan usage, if the agent exposes it (Claude: /api/oauth/usage). */
export interface AgentUsage {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  extra?: Array<{ label: string } & UsageWindow>;
}

export interface AgentCaps {
  models: ModelInfo[];
  defaultModel?: string;
}

export interface SendOpts {
  model?: string;
  effort?: string;
}

/** Live activity while an agent works (for the streaming UI). */
export interface StreamEvent {
  kind: "text" | "tool" | "thinking";
  text?: string; // for kind:"text" — a chunk of the reply
  name?: string; // for kind:"tool" — the tool name (Bash, Edit, Read…)
  summary?: string; // for kind:"tool" — a human one-liner (e.g. "Editando foo.ts")
}
export type OnEvent = (ev: StreamEvent) => void;

export interface AgentAdapter {
  readonly name: string;
  capabilities(): Promise<AgentCaps>;
  available(): Promise<boolean>;
  send(sessionId: string, text: string, cwd: string, opts?: SendOpts, onEvent?: OnEvent): Promise<AgentReply>;
  /** Stateless one-off prompt (no session, no context) — used by cross-session search. */
  oneShot?(text: string, opts?: SendOpts): Promise<AgentReply>;
  /** The underlying native session id (e.g. the real claude session), if bound. */
  nativeSessionId?(sessionId: string): string | undefined;
  /** Forget a session's native binding (on delete), so a reused id won't resume it. */
  forgetSession?(sessionId: string): void;
  /** Account plan usage (5h / weekly windows), if the agent exposes it. */
  usage?(): Promise<AgentUsage | null>;
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
  // jarvis sessionId -> real claude session_id. Persisted so a UI-created session keeps
  // resuming the SAME underlying claude session across Hub restarts (no orphans; and it
  // shows up under `claude --resume`).
  private sessionsFile = join(homedir(), ".jarvis", "claude-sessions.json");
  private sessions = this.loadSessions();
  private loadSessions(): Map<string, string> {
    try { return new Map(Object.entries(JSON.parse(readFileSync(this.sessionsFile, "utf8")))); } catch { return new Map(); }
  }
  private saveSessions(): void {
    try { mkdirSync(join(homedir(), ".jarvis"), { recursive: true }); writeFileSync(this.sessionsFile, JSON.stringify(Object.fromEntries(this.sessions))); } catch { /* ignore */ }
  }
  nativeSessionId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId);
  }
  forgetSession(sessionId: string): void {
    if (this.sessions.delete(sessionId)) this.saveSessions();
  }
  private usageCache?: { at: number; data: AgentUsage | null };
  /** Plan usage (5h / weekly windows) from the Claude OAuth usage endpoint. Cached ~30s. */
  async usage(): Promise<AgentUsage | null> {
    if (this.usageCache && Date.now() - this.usageCache.at < 30_000) return this.usageCache.data;
    let data: AgentUsage | null = null;
    try {
      const token = JSON.parse(readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8"))?.claudeAiOauth?.accessToken;
      if (!token) throw new Error("no token");
      const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: { authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20" },
      });
      const j: any = await res.json();
      const win = (w: any): UsageWindow | undefined => (w && typeof w.utilization === "number") ? { pct: Math.round(w.utilization), resetsAt: w.resets_at } : undefined;
      data = { fiveHour: win(j.five_hour), sevenDay: win(j.seven_day) };
      const extra: Array<{ label: string } & UsageWindow> = [];
      for (const [k, label] of [["seven_day_opus", "Semanal · Opus"], ["seven_day_sonnet", "Semanal · Sonnet"]] as const) { const w = win(j[k]); if (w) extra.push({ label, ...w }); }
      if (extra.length) data.extra = extra;
    } catch { data = null; }
    this.usageCache = { at: Date.now(), data };
    return data;
  }
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
      models = (json?.data || []).map((m: any) => ({ id: m.id, label: m.display_name, efforts, defaultEffort: "high", context: m.max_input_tokens }));
      // family aliases up front (opus/sonnet/haiku/fable resolve to the newest of each);
      // give each alias the largest context window seen in its family.
      const famCtx = (fam: string) => { const c = models.filter((m) => m.id.includes(fam)).map((m) => m.context || 0); return c.length ? Math.max(...c) : undefined; };
      models = [
        ...["opus", "sonnet", "haiku", "fable"].map((id) => ({ id, label: id, efforts, defaultEffort: "high", context: famCtx(id) })),
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
      // MUST run in ONESHOT_CWD (not homedir): every probe leaves a persistent `claude -p`
      // session file, and only the oneshot cwd is excluded from the native-session list —
      // otherwise the availability probe litters the sidebar with one "ok" session per run.
      const out = await run(this.bin, ["-p", "ok", "--output-format", "json"], ONESHOT_CWD, "", false);
      return !JSON.parse(out).is_error;
    } catch {
      return false;
    }
  }

  async send(sessionId: string, text: string, cwd: string, opts?: SendOpts, onEvent?: OnEvent): Promise<AgentReply> {
    // native imported sessions ("claude:<uuid>") resume the underlying real claude session
    const prev = this.sessions.get(sessionId) || (sessionId.startsWith("claude:") ? sessionId.slice("claude:".length) : undefined);
    const fmt = onEvent ? ["--output-format", "stream-json", "--verbose"] : ["--output-format", "json"];
    const args = ["-p", text, ...fmt, "--permission-mode", "bypassPermissions"];
    if (opts?.model) args.push("--model", opts.model);
    if (opts?.effort) args.push("--effort", opts.effort === "ultracode" ? "xhigh" : opts.effort); // ultracode -> xhigh
    if (prev) args.unshift("--resume", prev);

    if (onEvent) {
      // streaming: emit tool/text activity live; accumulate the final reply + usage.
      let finalText = "";
      let sessionOut = "";
      let streamError = "";
      let usage: AgentReply["usage"];
      await runStream(this.bin, args, cwd, (line) => {
        let o: any;
        try { o = JSON.parse(line); } catch { return; }
        if (o.type === "system" && o.subtype === "init" && o.session_id) sessionOut = o.session_id;
        else if (o.type === "assistant") {
          // Sub-agent (Task) turns carry a top-level parent_tool_use_id; their text is the
          // sub-agent's own reasoning, NOT the parent answer — surface it but don't accumulate it.
          const parentId = o.parent_tool_use_id || undefined;
          for (const b of o.message?.content || []) {
            if (b.type === "text" && b.text) { if (!parentId) finalText += b.text; onEvent({ kind: "text", text: b.text, parentId }); }
            else if (b.type === "tool_use") { const st = fileToolStat(b.name, b.input); onEvent({ kind: "tool", name: b.name, summary: toolSummary(b.name, b.input), toolId: b.id, parentId, path: st.path, adds: st.adds, dels: st.dels }); }
            else if (b.type === "thinking") onEvent({ kind: "thinking", parentId });
          }
        } else if (o.type === "result") {
          if (o.session_id) sessionOut = o.session_id;
          if (o.result && !finalText) finalText = o.result;
          if (o.is_error) streamError = o.result || "claude error";
          usage = { costUsd: o.total_cost_usd, inputTokens: o.usage?.input_tokens, outputTokens: o.usage?.output_tokens };
        }
      });
      if (streamError) throw new Error(streamError);
      if (sessionOut) { this.sessions.set(sessionId, sessionOut); this.saveSessions(); }
      return { text: finalText, usage };
    }

    const raw = await run(this.bin, args, cwd, "", false);
    const json = JSON.parse(raw);
    if (json.is_error) throw new Error(json.result || "claude error");
    if (json.session_id) { this.sessions.set(sessionId, json.session_id); this.saveSessions(); }
    return {
      text: json.result ?? "",
      usage: { costUsd: json.total_cost_usd, inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens },
    };
  }

  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> {
    const args = ["-p", text, "--output-format", "json", "--permission-mode", "bypassPermissions"];
    if (opts?.model) args.push("--model", opts.model);
    if (opts?.effort) args.push("--effort", opts.effort === "ultracode" ? "xhigh" : opts.effort);
    const raw = await run(this.bin, args, ONESHOT_CWD, "", false); // stateless + isolated cwd (excluded from native list)
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
    // run in ONESHOT_CWD (excluded from the native list) so throwaway prompts don't litter the sidebar
    const args = ["exec", "--cd", ONESHOT_CWD, "--dangerously-bypass-approvals-and-sandbox"];
    if (opts?.model) args.push("-m", opts.model);
    if (opts?.effort) args.push("-c", `model_reasoning_effort=${opts.effort}`);
    const out = await run("codex", args, ONESHOT_CWD, text, true); // stateless: no this.started
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

/** Like run(), but calls onLine for each complete stdout line as it arrives (NDJSON stream). */
function runStream(cmd: string, args: string[], cwd: string, onLine: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true, shell: false });
    let out = "";
    let buf = "";
    let err = "";
    p.stdout.on("data", (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        out += line + "\n";
        if (line.trim()) onLine(line);
      }
    });
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.stdin.end();
    p.on("close", (code) => {
      if (buf.trim()) onLine(buf);
      if (code === 0 || out.trim()) resolve(out);
      else reject(new Error(err.trim() || `${cmd} exited with ${code}`));
    });
  });
}

/** Human one-liner for a tool_use (shown as a collapsible activity block). */
function toolSummary(name: string, input: any): string {
  const base = (p: string) => (p || "").split(/[\\/]/).pop() || p;
  try {
    switch (name) {
      case "Bash": return "Bash: " + String(input?.command || "").replace(/\s+/g, " ").slice(0, 90);
      case "Read": return "Lendo " + base(input?.file_path);
      case "Edit": case "Write": case "NotebookEdit": return "Editando " + base(input?.file_path);
      case "Grep": return "Buscando /" + String(input?.pattern || "").slice(0, 40) + "/";
      case "Glob": return "Listando " + String(input?.pattern || "");
      case "Task": case "Agent": return "Subagente: " + String(input?.description || input?.subagent_type || "").slice(0, 60);
      case "WebFetch": return "Abrindo " + String(input?.url || "").slice(0, 60);
      case "WebSearch": return "Pesquisando: " + String(input?.query || "").slice(0, 60);
      default: { const s = JSON.stringify(input || {}); return name + (s && s !== "{}" ? " " + s.slice(0, 60) : ""); }
    }
  } catch { return name; }
}
