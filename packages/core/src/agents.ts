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
import { spawn, type ChildProcess } from "node:child_process";
import { platform, homedir, tmpdir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { toolFileStat } from "./native.js";
import { writeJsonAtomic } from "./persist.js";
import {
  LIMITED_CAPABILITIES,
  descriptorProblems,
  type AgentCapabilities,
  type AgentDescriptor,
  type CostKind,
  type ModelDescriptor,
  type ModelSource,
  type PermissionMode,
  type SupportLevel,
} from "./agent-contract.js";

/** Effective unattended execution policy. The historical default is full access; operators can
 * opt into each provider's own sandbox/approval behavior without changing adapter code. */
export function agentPermissionMode(value = process.env.JARVIS_AGENT_PERMISSION_MODE): PermissionMode {
  return value === "provider-default" || value === "provider_default" ? "provider_default" : "full_access";
}
const fullAccess = (): boolean => agentPermissionMode() === "full_access";
const effectiveCaps = (caps: AgentCapabilities): AgentCapabilities => ({ ...caps, permissionMode: agentPermissionMode() });
const claudeInputContext = (u: any): number | undefined => {
  if (!u) return undefined;
  const n = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  return n || undefined;
};

/** For a file tool_use, extract the real path, +/- counts and this edit's diff rows, live. */
function fileToolStat(name: string, input: any): { path?: string; adds?: number; dels?: number; rows?: unknown[] } {
  try { return toolFileStat(name, input); } catch { return {}; }
}

// one-shot prompts (search / summary / digest / voice-intent) run in this dir so their
// throwaway `claude -p` sessions land somewhere the native-session import excludes —
// otherwise every digest/summary/warmup shows up as a "ping"/"Painel de status" session.
const ONESHOT_CWD = join(homedir(), ".jarvis", "oneshot");
try { mkdirSync(ONESHOT_CWD, { recursive: true }); } catch { /* ignore */ }

export interface AgentReply {
  text: string;
  usage?: {
    costUsd?: number;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    contextTokens?: number;
    costKind?: CostKind;
    source?: string;
    model?: string;
  };
}

/** A model + the effort levels IT supports (efforts can differ per model). */
export interface ModelInfo {
  id: string;
  label?: string;
  efforts: string[];
  defaultEffort?: string;
  context?: number; // max input tokens (context window) — for the usage gauge
  effortsVerified?: boolean;
  contextVerified?: boolean;
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
  autoModel?: boolean;
}

export interface SendOpts {
  model?: string;
  effort?: string;
  /** Abort the underlying agent process (user hit "parar"). Rejects the send with ABORTED. */
  signal?: AbortSignal;
}

/** Reject stale/foreign picker values before spawning a potentially billable CLI turn. */
export function validateModelSelection(caps: AgentCaps, opts?: SendOpts): void {
  if (!opts?.model || !caps.models.length) return;
  const model = caps.models.find((m) => m.id === opts.model);
  if (!model) throw new Error(`modelo '${opts.model}' não existe no catálogo atual deste agente`);
  if (opts.effort && model.efforts.length && !model.efforts.includes(opts.effort)) throw new Error(`esforço '${opts.effort}' não é suportado por ${opts.model}`);
}

/** Thrown when a run is cancelled via its AbortSignal — distinct from a real failure, so the
 *  caller can treat it as "cancelled by the user" (no error toast, no error notification). */
export const ABORTED = "__aborted__";

/** model/effort are identifiers the user picks from the agent's OWN catalog — pass them to the CLI
 *  only if they look like one. Cheap allowlist: keeps a malformed or hostile value out of the argv
 *  (defence in depth — with shell:false there is no shell to inject, but a junk value still errors). */
const safeIdent = (v?: string): string | undefined =>
  (typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : undefined);

/** Kill a spawned process AND its children. On Windows a shell:true spawn wraps the real CLI in
 *  cmd.exe, and killing only the wrapper orphans the agent (it keeps running, and keeps costing) —
 *  taskkill /T takes the whole tree. Elsewhere a plain kill is enough. */
function killTree(p: { pid?: number; kill: (s?: NodeJS.Signals) => boolean }): void {
  try {
    if (platform() === "win32" && p.pid) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true });
    else p.kill("SIGTERM");
  } catch { /* already gone */ }
}
/** Wire an AbortSignal to a child: kill the tree on abort, and clean up the listener on close.
 *  Returns a fn that reports whether the run ended because it was aborted. */
function wireAbort(p: { pid?: number; kill: (s?: NodeJS.Signals) => boolean }, signal?: AbortSignal): () => boolean {
  if (!signal) return () => false;
  if (signal.aborted) { killTree(p); return () => true; }
  const onAbort = () => killTree(p);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => { signal.removeEventListener("abort", onAbort); return signal.aborted; };
}

/** Live activity while an agent works (for the streaming UI). */
export interface StreamEvent {
  kind: "text" | "tool" | "thinking";
  text?: string; // for kind:"text" — a chunk of the reply
  name?: string; // for kind:"tool" — the tool name (Bash, Edit, Read…)
  summary?: string; // for kind:"tool" — a human one-liner (e.g. "Editando foo.ts")
  detail?: string; // for kind:"tool" — the FULL command/args (untruncated), shown when the row is expanded
  toolId?: string; parentId?: string; // sub-agent linkage (Task/Agent → its nested tools)
  path?: string; adds?: number; dels?: number; rows?: any[]; // file tools: touched path + diff
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
  /** Versioned support/capability snapshot. Legacy adapters without it are always limited. */
  descriptor?(): Promise<AgentDescriptor>;
}

export class AgentRegistry {
  private byName = new Map<string, AgentAdapter>();
  constructor(private defaultName: string) {}
  register(a: AgentAdapter): this {
    this.byName.set(a.name, a);
    return this;
  }
  get(name?: string): AgentAdapter {
    const selected = name || this.defaultName;
    const a = this.byName.get(selected);
    if (!a) throw new Error(`agente não registrado: '${selected}'`);
    return a;
  }
  has(name: string): boolean { return this.byName.has(name); }
  names(): string[] {
    return [...this.byName.keys()];
  }
  /** Agent used for cross-session search reasoning (JARVIS_SEARCH_AGENT, else claude-code, else default). */
  searchAgent(): AgentAdapter {
    const pref = process.env.JARVIS_SEARCH_AGENT;
    if (pref && this.byName.has(pref)) return this.byName.get(pref)!;
    return this.byName.get("claude-code") || this.get();
  }
  /** Backward-compatible UI catalog enriched with the canonical descriptor. */
  async describe(): Promise<Array<{ name: string } & AgentCaps & Partial<Pick<AgentDescriptor, "label" | "support" | "reason" | "cli" | "capabilities" | "discoveredAt">>>> {
    return Promise.all([...this.byName.values()].map(async (a) => {
      const caps = await a.capabilities();
      if (!a.descriptor) return { name: a.name, ...caps, support: "limited" as const, reason: "adapter sem descriptor canônico" };
      const d = await a.descriptor();
      const problems = descriptorProblems(d);
      return { name: a.name, ...caps, label: d.label, support: problems.length ? "limited" as const : d.support, reason: problems.length ? `descriptor inválido: ${problems.join("; ")}` : d.reason, cli: d.cli, capabilities: d.capabilities, discoveredAt: d.discoveredAt };
    }));
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
    return process.env.JARVIS_ENABLE_MOCK === "1" || process.env.NODE_ENV === "test";
  }
  async send(_sid: string, text: string, _cwd?: string, _opts?: SendOpts, onEvent?: OnEvent): Promise<AgentReply> {
    const reply = `Recebi: "${text}". (agente mock — Hub/chat/voz OK.)`;
    onEvent?.({ kind: "thinking" });
    onEvent?.({ kind: "tool", name: "FixtureTool", summary: "Validando fluxo de progresso", toolId: "mock-tool-1" });
    onEvent?.({ kind: "text", text: reply });
    return { text: reply, usage: { inputTokens: 1, outputTokens: 1, costKind: "tokens_only", source: "mock fixture" } };
  }
  async oneShot(): Promise<AgentReply> {
    return { text: '{"answer":"(busca mock — defina JARVIS_SEARCH_AGENT=claude-code para busca real)","matches":[],"action":null}' };
  }
  async descriptor(): Promise<AgentDescriptor> {
    return makeDescriptor({ id: this.name, label: "Mock (testes)", command: "internal", support: "limited", reason: "adapter interno de testes; não é uma IA de produção", capabilities: { ...LIMITED_CAPABILITIES, stream: "delta", tools: true, thinking: true, usage: true, remote: true }, caps: await this.capabilities() });
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
    try { writeJsonAtomic(this.sessionsFile, Object.fromEntries(this.sessions)); } catch { /* ignore */ }
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
      models = (json?.data || []).map((m: any) => ({ id: m.id, label: m.display_name, efforts, defaultEffort: "high", context: m.max_input_tokens, effortsVerified: false, contextVerified: Number.isFinite(m.max_input_tokens) }));
      // family aliases up front (opus/sonnet/haiku/fable resolve to the newest of each);
      // give each alias the largest context window seen in its family.
      const famCtx = (fam: string) => { const c = models.filter((m) => m.id.includes(fam)).map((m) => m.context || 0); return c.length ? Math.max(...c) : undefined; };
      models = [
        ...["opus", "sonnet", "haiku", "fable"].map((id) => ({ id, label: id, efforts, defaultEffort: "high", context: famCtx(id), effortsVerified: false, contextVerified: !!famCtx(id) })),
        ...models,
      ];
      if (models.length <= 4) throw new Error("empty models");
    } catch {
      models = ["opus", "sonnet", "haiku", "fable"].map((id) => ({ id, label: id, efforts, defaultEffort: "high", effortsVerified: false, contextVerified: false }));
    }
    const caps: AgentCaps = { models, defaultModel: process.env.ANTHROPIC_MODEL || "opus" };
    this.capsCache = { at: Date.now(), caps };
    return caps;
  }

  async available(): Promise<boolean> {
    try {
      const r = await runRaw(this.bin, ["--version"], homedir(), "");
      const token = JSON.parse(readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8"))?.claudeAiOauth?.accessToken;
      return r.code === 0 && !!token;
    } catch {
      return false;
    }
  }

  async descriptor(): Promise<AgentDescriptor> {
    const caps = await this.capabilities();
    const version = await cliVersion(this.bin);
    const installed = !!version;
    let authenticated = false;
    try { authenticated = !!JSON.parse(readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8"))?.claudeAiOauth?.accessToken; } catch { /* no credentials */ }
    const support: SupportLevel = !installed ? "not_installed" : !authenticated ? "unauthenticated" : "complete";
    return makeDescriptor({
      id: this.name, label: "Claude Code", command: this.bin, version, support,
      reason: support === "not_installed" ? "CLI claude não encontrado" : support === "unauthenticated" ? "execute claude login nesta máquina" : undefined,
      capabilities: {
        permissionMode: agentPermissionMode(), stream: "delta", tools: true, thinking: true, plans: false, subagents: true,
        nativeSessions: true, nativeResume: true, files: true, diffs: true, usage: true,
        cost: "estimated_api_equivalent", attachments: ["text", "file", "image"],
        commands: true, skills: true, mcp: true, oneShot: true, remote: true,
      },
      caps, source: "api",
    });
  }

  async send(sessionId: string, text: string, cwd: string, opts?: SendOpts, onEvent?: OnEvent): Promise<AgentReply> {
    validateModelSelection(await this.capabilities(), opts);
    // native imported sessions ("claude:<uuid>") resume the underlying real claude session
    const prev = this.sessions.get(sessionId) || (sessionId.startsWith("claude:") ? sessionId.slice("claude:".length) : undefined);
    const fmt = onEvent ? ["--output-format", "stream-json", "--verbose"] : ["--output-format", "json"];
    // The prompt goes over STDIN, not as a "-p <value>" argv value — confirmed by direct testing:
    // text starting with "-" (a dash-led sentence, or the "--- arquivo anexado:" attachment marker)
    // gets misread as a CLI flag when passed inline (`-p "-verbose x"` silently printed the CLI's
    // version and never ran the prompt). A "--" terminator (`-p -- "-verbose x"`) dodges THAT crash
    // but breaks --output-format stream-json the moment the turn uses any tool — verified directly:
    // it silently falls back to plain markdown output, which agents.ts's JSON.parse(line) then
    // silently discards, so every tool-using turn would come back empty. Stdin has neither problem,
    // and as a bonus removes the CLI's own "no stdin data received in 3s" wait on every turn.
    const args = ["-p", ...fmt];
    if (fullAccess()) args.push("--permission-mode", "bypassPermissions");
    const model = safeIdent(opts?.model), effort = safeIdent(opts?.effort);
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort === "ultracode" ? "xhigh" : effort); // ultracode -> xhigh
    if (prev) args.unshift("--resume", prev);

    // input_tokens sozinho é só o delta NÃO-cacheado (poucas centenas mesmo com a janela quase
    // cheia). O medidor de contexto precisa da SOMA: fresh + cache_creation + cache_read — senão
    // marca ~0% quando a sessão está de fato ~95% cheia.
    const inputContext = (u: any): number | undefined => {
      if (!u) return undefined;
      const n = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      return n || undefined;
    };

    if (onEvent) {
      // streaming: emit tool/text activity live; accumulate the final reply + usage.
      let finalText = "";
      let sessionOut = "";
      let streamError = "";
      let usage: AgentReply["usage"];
      let lastMsgUsage: any;
      await runStream(this.bin, args, cwd, text, (line) => {
        let o: any;
        try { o = JSON.parse(line); } catch { return; }
        if (o.type === "system" && o.subtype === "init" && o.session_id) sessionOut = o.session_id;
        else if (o.type === "assistant") {
          // Sub-agent (Task) turns carry a top-level parent_tool_use_id; their text is the
          // sub-agent's own reasoning, NOT the parent answer — surface it but don't accumulate it.
          const parentId = o.parent_tool_use_id || undefined;
          // idem para o contexto: só o thread principal conta para a janela (sub-agente é outro contexto).
          if (!parentId && o.message?.usage) lastMsgUsage = o.message.usage;
          for (const b of o.message?.content || []) {
            if (b.type === "text" && b.text) { if (!parentId) finalText += b.text; onEvent({ kind: "text", text: b.text, parentId }); }
            else if (b.type === "tool_use") { const st = fileToolStat(b.name, b.input); onEvent({ kind: "tool", name: b.name, summary: toolSummary(b.name, b.input), detail: toolDetail(b.name, b.input), toolId: b.id, parentId, path: st.path, adds: st.adds, dels: st.dels, rows: st.rows as any }); }
            else if (b.type === "thinking") onEvent({ kind: "thinking", parentId });
          }
        } else if (o.type === "result") {
          if (o.session_id) sessionOut = o.session_id;
          if (o.result && !finalText) finalText = o.result;
          if (o.is_error) streamError = o.result || "claude error";
          usage = { costUsd: o.total_cost_usd, inputTokens: inputContext(lastMsgUsage) ?? inputContext(o.usage), contextTokens: inputContext(lastMsgUsage) ?? inputContext(o.usage), outputTokens: o.usage?.output_tokens ?? lastMsgUsage?.output_tokens, costKind: "estimated_api_equivalent", source: "Claude Code result.total_cost_usd", model: opts?.model };
        }
      }, opts?.signal);
      if (streamError) throw new Error(streamError);
      if (sessionOut) { this.sessions.set(sessionId, sessionOut); this.saveSessions(); }
      return { text: finalText, usage };
    }

    const raw = await run(this.bin, args, cwd, text, opts?.signal);
    const json = JSON.parse(raw);
    if (json.is_error) throw new Error(json.result || "claude error");
    if (json.session_id) { this.sessions.set(sessionId, json.session_id); this.saveSessions(); }
    return {
      text: json.result ?? "",
      usage: { costUsd: json.total_cost_usd, inputTokens: inputContext(json.usage), contextTokens: inputContext(json.usage), outputTokens: json.usage?.output_tokens, costKind: "estimated_api_equivalent", source: "Claude Code result.total_cost_usd", model: opts?.model },
    };
  }

  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> {
    validateModelSelection(await this.capabilities(), opts);
    const args = ["-p", "--output-format", "json"]; // prompt via stdin — see send()
    if (fullAccess()) args.push("--permission-mode", "bypassPermissions");
    if (opts?.model) args.push("--model", opts.model);
    if (opts?.effort) args.push("--effort", opts.effort === "ultracode" ? "xhigh" : opts.effort);
    const raw = await run(this.bin, args, ONESHOT_CWD, text); // stateless + isolated cwd (excluded from native list)
    const json = JSON.parse(raw);
    if (json.is_error) throw new Error(json.result || "claude error");
    return { text: json.result ?? "", usage: { costUsd: json.total_cost_usd, inputTokens: claudeInputContext(json.usage), contextTokens: claudeInputContext(json.usage), outputTokens: json.usage?.output_tokens, costKind: "estimated_api_equivalent", source: "Claude Code result.total_cost_usd", model: opts?.model } };
  }
}

/** Codex reports TOKENS, never a price — so estimate a cost from configurable per-1M rates and the
 *  "custo" column works for Codex exactly like Claude (both render as ~$, i.e. approximate). Override
 *  the rates for your plan via env (JARVIS_CODEX_PRICE_IN/_CACHED/_OUT, USD per 1M tokens); the
 *  defaults are GPT-5-class ballpark figures, NOT a quoted OpenAI price. `input_tokens` already
 *  includes the cached prefix — it's the FULL turn input, which is exactly the context-window figure
 *  the usage gauge needs (same role as Claude's fresh+cache_creation+cache_read sum). */
export function codexUsage(u: any): AgentReply["usage"] | undefined {
  if (!u) return undefined;
  const input = u.input_tokens || 0, cached = u.cached_input_tokens || 0, output = u.output_tokens || 0;
  if (!input && !output) return undefined;
  const envNum = (v: string | undefined, d: number): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  const pIn = envNum(process.env.JARVIS_CODEX_PRICE_IN, 1.25);            // USD / 1M non-cached input
  const pCached = envNum(process.env.JARVIS_CODEX_PRICE_CACHED, pIn / 10); // cached input bills cheaper
  const pOut = envNum(process.env.JARVIS_CODEX_PRICE_OUT, 10);            // USD / 1M output (incl. reasoning)
  const costUsd = (Math.max(0, input - cached) * pIn + cached * pCached + output * pOut) / 1e6;
  const pricing = process.env.JARVIS_CODEX_PRICING_VERSION || "jarvis-ballpark-v1";
  return { costUsd, inputTokens: input || undefined, cachedInputTokens: cached || undefined, contextTokens: input || undefined, outputTokens: output || undefined, costKind: "estimated_api_equivalent", source: `codex exec --json tokens × JARVIS_CODEX_PRICE_* (${pricing})` };
}

/** Map ONE codex `--json` item to the StreamEvents Jarvis renders (SAME vocabulary Claude emits, so
 *  the live flow is identical) plus, for an agent_message, the assistant text to accumulate. Pure +
 *  exported so the mapping is unit-tested without spawning codex. `isCompleted` = the item came from
 *  `item.completed` (vs `item.started`); reasoning/agent_message only surface once completed, tool
 *  actions surface on first sighting (the caller dedupes started+completed by item id). Unknown item
 *  types return no events (forward-compatible with future codex item kinds). */
export function codexItemToEvents(it: any, isCompleted: boolean): { events: StreamEvent[]; text?: string } {
  const type = it?.type; if (!type) return { events: [] };
  if (type === "agent_message") {
    if (!isCompleted) return { events: [] };
    const txt = String(it.text ?? "").trim();
    return txt ? { events: [{ kind: "text", text: txt }], text: txt } : { events: [] };
  }
  if (type === "reasoning") return isCompleted ? { events: [{ kind: "thinking" }] } : { events: [] };
  if (type === "command_execution") {
    const cmd = String(it.command ?? "");
    return { events: [{ kind: "tool", name: "Bash", summary: "Bash: " + cmd.replace(/\s+/g, " ").slice(0, 90), detail: cmd.length > 90 ? cmd : undefined }] };
  }
  if (type === "file_change" || type === "patch" || type === "apply_patch") {
    const changes = Array.isArray(it.changes) ? it.changes : Array.isArray(it.files) ? it.files : (it.path ? [{ path: it.path, kind: it.kind }] : []);
    if (!changes.length) return { events: [{ kind: "tool", name: "Edit", summary: "Editando arquivos" }] };
    return { events: changes.map((ch: any): StreamEvent => {
      const p = String(ch?.path ?? ch?.file ?? "");
      const write = /add|create|new/i.test(String(ch?.kind ?? ch?.type ?? ""));
      return { kind: "tool", name: write ? "Write" : "Edit", summary: (write ? "Criando " : "Editando ") + (p.split(/[\\/]/).pop() || p || "arquivo"), path: p || undefined };
    }) };
  }
  if (type === "mcp_tool_call" || type === "custom_tool_call" || type === "tool_call" || type === "function_call") {
    const tn = String(it.name ?? it.tool ?? it.tool_name ?? "ferramenta");
    return { events: [{ kind: "tool", name: tn, summary: "Ferramenta: " + tn.slice(0, 60) }] };
  }
  if (type === "web_search") return { events: [{ kind: "tool", name: "WebSearch", summary: "Pesquisando: " + String(it.query ?? "").slice(0, 60) }] };
  return { events: [] }; // unknown item type — ignore
}

/** The user's own default model from ~/.codex/config.toml (`model = "…"`), if set. Only the TOP-LEVEL
 *  key counts — a `model` under a `[profile.x]`/`[projects.y]` table belongs to that table, not the
 *  default. Pass `tomlText` in tests; reads the real config when omitted. */
export function codexConfigModel(tomlText?: string): string | undefined {
  try {
    const text = tomlText ?? readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
    const topLevel = text.split(/^\s*\[/m)[0]; // everything before the first [table]
    return /^\s*model\s*=\s*"([^"]+)"/m.exec(topLevel)?.[1];
  } catch { return undefined; }
}

/** Native OpenAI Codex, headless (`codex exec`). Requires `codex login`. */
export class CodexAdapter implements AgentAdapter {
  readonly name = "codex";
  private started = new Set<string>();
  private capsCache?: { at: number; caps: AgentCaps };
  // jarvis sessionId -> real codex thread_id. Persisted (same pattern as ClaudeCodeAdapter) so a
  // Jarvis session actually RESUMES the same codex thread on the next turn — before this, every
  // turn ran a stateless fresh `exec` with no continuity, and each one left its own untracked
  // native rollout file on disk that `allSessions()` could never dedupe (no id was ever reported
  // back to Jarvis), showing up as a phantom duplicate session in the list.
  private sessionsFile = join(homedir(), ".jarvis", "codex-sessions.json");
  private sessions = this.loadSessions();
  private loadSessions(): Map<string, string> {
    try { return new Map(Object.entries(JSON.parse(readFileSync(this.sessionsFile, "utf8")))); } catch { return new Map(); }
  }
  private saveSessions(): void {
    try { writeJsonAtomic(this.sessionsFile, Object.fromEntries(this.sessions)); } catch { /* ignore */ }
  }
  nativeSessionId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId);
  }
  forgetSession(sessionId: string): void {
    if (this.sessions.delete(sessionId)) this.saveSessions();
  }

  async capabilities(): Promise<AgentCaps> {
    if (this.capsCache && Date.now() - this.capsCache.at < 3_600_000) return this.capsCache.caps;
    const mapModels = (arr: any[]): ModelInfo[] =>
      (arr || [])
        .filter((m) => m.visibility === "list")
        .map((m) => ({ id: m.slug, label: m.display_name, efforts: (m.supported_reasoning_levels || []).map((e: any) => e.effort), defaultEffort: m.default_reasoning_level, context: m.context_window || m.max_context_window, effortsVerified: true, contextVerified: !!(m.context_window || m.max_context_window) }));
    let models: ModelInfo[] = [];
    try {
      const out = await run("codex", ["debug", "models"], homedir(), "");
      models = mapModels(JSON.parse(out.slice(out.indexOf("{"))).models);
    } catch {
      try {
        const cache = JSON.parse(readFileSync(join(homedir(), ".codex", "models_cache.json"), "utf8"));
        models = mapModels(cache.models);
      } catch {
        // Pinned mirror of the live catalog (verified via `codex debug models`, jul/2026): the 5
        // visibility:list models, with their real per-model efforts, default efforts and context.
        const eff = ["low", "medium", "high", "xhigh"];
        models = [
          { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", efforts: [...eff, "max", "ultra"], defaultEffort: "low", context: 272000, effortsVerified: true, contextVerified: true },
          { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", efforts: [...eff, "max", "ultra"], defaultEffort: "medium", context: 272000, effortsVerified: true, contextVerified: true },
          { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", efforts: [...eff, "max"], defaultEffort: "medium", context: 272000, effortsVerified: true, contextVerified: true },
          { id: "gpt-5.5", label: "GPT-5.5", efforts: eff, defaultEffort: "medium", context: 272000, effortsVerified: true, contextVerified: true },
          { id: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark", efforts: eff, defaultEffort: "high", context: 128000, effortsVerified: true, contextVerified: true },
        ];
      }
    }
    // The UI always resolves a concrete model and passes `-m` — so THIS default is what actually
    // runs. Honor the user's own `model = "…"` in ~/.codex/config.toml when it names a known model
    // (same choice codex itself would make); otherwise the catalog's priority order (models[0]).
    const cfgModel = codexConfigModel();
    const defaultModel = (cfgModel && models.find((m) => m.id === cfgModel)) ? cfgModel : undefined;
    const caps: AgentCaps = { models, defaultModel, autoModel: !defaultModel };
    this.capsCache = { at: Date.now(), caps };
    return caps;
  }

  async available(): Promise<boolean> {
    try {
      // Measured (codex-cli 0.144.4): `login status` exits 0 with an EMPTY stdout and prints
      // "Logged in using ChatGPT" to stderr. Read both, and trust the exit code for success.
      const r = await runRaw("codex", ["login", "status"], homedir(), "");
      return r.code === 0 && /logged in|authenticated|active/i.test(r.stdout + r.stderr);
    } catch {
      return false; // binary not installed / not on PATH
    }
  }

  async descriptor(): Promise<AgentDescriptor> {
    const caps = await this.capabilities();
    const version = await cliVersion("codex");
    const authenticated = version ? await this.available() : false;
    const support: SupportLevel = !version ? "not_installed" : !authenticated ? "unauthenticated" : "limited";
    return makeDescriptor({
      id: this.name, label: "OpenAI Codex", command: "codex", version, support,
      reason: support === "not_installed" ? "CLI codex não encontrado" : support === "unauthenticated" ? "execute codex login nesta máquina" : "stream e modelos funcionam, mas todos os tipos de evento ainda precisam de certificação real por versão do CLI",
      capabilities: {
        permissionMode: agentPermissionMode(), stream: "block", tools: true, thinking: true, plans: false, subagents: false,
        nativeSessions: true, nativeResume: true, files: true, diffs: true, usage: true,
        cost: "estimated_api_equivalent", attachments: ["text", "file", "image"],
        commands: true, skills: true, mcp: true, oneShot: true, remote: true,
      },
      caps, source: "cli",
    });
  }

  async send(sessionId: string, text: string, cwd: string, opts?: SendOpts, onEvent?: OnEvent): Promise<AgentReply> {
    validateModelSelection(await this.capabilities(), opts);
    // Resume the bound thread if we have one — continuity, and dedupe (see nativeSessionId above).
    // `resume` has no --cd of its own: it continues in the thread's original cwd. Confirmed
    // directly: `codex exec resume <id> --json` correctly recalls prior turns in the same thread.
    const prev = this.sessions.get(sessionId) || (sessionId.startsWith("codex:") ? sessionId.slice("codex:".length) : undefined);
    const args = prev ? ["exec", "resume", prev, "--json"] : ["exec", "--cd", cwd, "--json"];
    if (fullAccess()) args.push("--dangerously-bypass-approvals-and-sandbox");
    const model = safeIdent(opts?.model), effort = safeIdent(opts?.effort);
    if (model) args.push("-m", model);
    if (effort) args.push("-c", `model_reasoning_effort=${effort}`);

    // `codex exec --json` is NDJSON with the SAME lifecycle Claude streams, just different names:
    //   thread.started{thread_id} · turn.started · item.started/item.completed{item:{type,…}} · turn.completed{usage}
    // Mapping every activity item to the same StreamEvents Claude emits is what makes the live flow
    // identical for both agents (reasoning→pensando, command_execution→Bash, file_change→Edit, …).
    let threadId: string | undefined;
    const finalParts: string[] = [];   // agent_message texts, in order (preâmbulo + resposta final)
    let usage: AgentReply["usage"];
    let streamError = "";
    const seen = new Set<string>();     // item ids already surfaced — item.started + item.completed = ONE row

    const emitItem = (it: any, isCompleted: boolean): void => {
      const id = String(it?.id ?? "");
      const isAgentMsg = it?.type === "agent_message";
      if (!isAgentMsg && id && seen.has(id)) return;     // tool-ish item already surfaced (started + completed = one row)
      const { events, text } = codexItemToEvents(it, isCompleted);
      if (!events.length) return;
      if (!isAgentMsg && id) seen.add(id);               // agent_message may legitimately repeat (preâmbulo + resposta)
      if (text) finalParts.push(text);
      for (const e of events) onEvent?.(e);
    };

    const handleLine = (line: string): void => {
      let o: any; try { o = JSON.parse(line); } catch { return; }
      switch (o.type) {
        case "thread.started": if (o.thread_id) threadId = o.thread_id; break;
        case "turn.completed": if (o.usage) usage = { ...codexUsage(o.usage), model: opts?.model }; break;
        case "turn.failed": case "error": streamError = o.error?.message || o.message || streamError; break;
        case "item.started": emitItem(o.item, false); break;
        case "item.completed": emitItem(o.item, true); break;
      }
    };

    // Streaming when the caller wants live activity; plain capture-then-parse for internal one-offs.
    // Either way the SAME handleLine parses the SAME NDJSON — so thread id, final text and usage come
    // out identically; onEvent is simply absent (a no-op) on the non-streaming path.
    const out = onEvent
      ? await runStream("codex", args, cwd, text, handleLine, opts?.signal)
      : await run("codex", args, cwd, text, opts?.signal);
    if (!onEvent) for (const line of out.split("\n")) { const t = line.trim(); if (t) handleLine(t); }

    this.started.add(sessionId);
    if (streamError && !finalParts.length) throw new Error(streamError);
    if (threadId && threadId !== prev) { this.sessions.set(sessionId, threadId); this.saveSessions(); }
    return { text: finalParts.join("\n\n").trim() || out.trim(), usage };
  }

  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> {
    validateModelSelection(await this.capabilities(), opts);
    // run in ONESHOT_CWD (excluded from the native list) so throwaway prompts don't litter the sidebar
    const args = ["exec", "--cd", ONESHOT_CWD, "--json"];
    if (fullAccess()) args.push("--dangerously-bypass-approvals-and-sandbox");
    const model = safeIdent(opts?.model), effort = safeIdent(opts?.effort);
    if (model) args.push("-m", model);
    if (effort) args.push("-c", `model_reasoning_effort=${effort}`);
    const out = await run("codex", args, ONESHOT_CWD, text); // stateless: no this.started
    const textParts: string[] = []; let usage: AgentReply["usage"];
    for (const line of out.split(/\r?\n/)) {
      let o: any; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === "item.completed" && o.item?.type === "agent_message" && o.item.text) textParts.push(String(o.item.text));
      if (o.type === "turn.completed" && o.usage) usage = { ...codexUsage(o.usage), model: opts?.model };
      if (o.type === "turn.failed" || o.type === "error") throw new Error(o.error?.message || o.message || "codex error");
    }
    return { text: textParts.join("\n\n").trim(), usage };
  }
}

// ---------------------------------------------------------------------------

export interface StructuredCliEvent {
  events?: StreamEvent[];
  text?: string;
  finalText?: string;
  sessionId?: string;
  usage?: AgentReply["usage"];
  error?: string;
}

function textOf(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => typeof part === "string" ? part : (part?.type === "text" ? part.text : part?.text) || "").join("");
  return typeof value?.text === "string" ? value.text : "";
}

function tokenUsage(value: any, source: string, costKind: CostKind = "tokens_only"): AgentReply["usage"] | undefined {
  const u = value?.usage || value?.stats || value;
  if (!u || typeof u !== "object") return undefined;
  const input = Number(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokens ?? u.input ?? 0) || 0;
  const cached = Number(u.cached_input_tokens ?? u.cachedInputTokens ?? 0) || 0;
  const output = Number(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.completionTokens ?? u.output ?? 0) || 0;
  if (!input && !output && u.cost == null && u.cost_usd == null) return undefined;
  const rawCost = Number(u.cost_usd ?? u.costUsd ?? u.cost);
  const costUsd = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : undefined;
  const resolvedKind: CostKind = costUsd == null ? "tokens_only" : (costKind === "tokens_only" ? "estimated_api_equivalent" : costKind);
  return { inputTokens: input || undefined, cachedInputTokens: cached || undefined, contextTokens: input || undefined, outputTokens: output || undefined, costUsd, costKind: resolvedKind, source };
}

function toolEvent(name: string, args: any, id?: string): StreamEvent {
  const normalized = /shell|command|terminal|exec|bash/i.test(name) ? "Bash" : name;
  return { kind: "tool", name: normalized, summary: toolSummary(normalized, args), detail: toolDetail(normalized, args), toolId: id };
}

/** Pure provider parsers. Unknown fields/types are ignored, never promoted to invented progress. */
export function parseGeminiCliEvent(o: any): StructuredCliEvent {
  if (o?.type === "init") return { sessionId: o.session_id || o.sessionId };
  if (o?.type === "message" && (o.role === "assistant" || o.message?.role === "assistant")) return { text: textOf(o.content ?? o.message?.content ?? o.message) };
  if (o?.type === "tool_use") { const name = String(o.tool_name || o.name || "Tool"); return { events: [toolEvent(name, o.parameters || o.args || o.input, o.tool_id || o.id)] }; }
  if (o?.type === "error") return { error: String(o.error?.message || o.message || o.error || "Gemini CLI error") };
  if (o?.type === "result") return { finalText: String(o.response ?? o.result ?? ""), usage: tokenUsage(o.stats || o.usage, "gemini stream-json") };
  return {};
}

export function parseCursorCliEvent(o: any): StructuredCliEvent {
  if (o?.type === "system" && o.subtype === "init") return { sessionId: o.session_id };
  if (o?.type === "assistant") return { text: textOf(o.message?.content ?? o.content) };
  if (o?.type === "tool_call" && o.subtype === "started") {
    const body = o.tool_call || {}; const key = Object.keys(body)[0] || "Tool"; const call = body[key] || {};
    return { events: [toolEvent(key.replace(/ToolCall$/i, ""), call.args || call, o.call_id)] };
  }
  if (o?.type === "result") return { sessionId: o.session_id, finalText: String(o.result || ""), error: o.is_error ? String(o.result || "Cursor Agent error") : undefined };
  return {};
}

export function parseClineCliEvent(o: any): StructuredCliEvent {
  const events: StreamEvent[] = [];
  if (typeof o?.reasoning === "string" && o.reasoning) events.push({ kind: "thinking" });
  if (o?.type === "ask") events.push({ kind: "tool", name: "InputRequired", summary: String(o.text || o.ask || "Cline requer interação").slice(0, 100) });
  if (o?.type === "say" && o.say && o.say !== "text" && o.say !== "completion_result") events.push(toolEvent(String(o.say), { text: o.text }));
  const isText = o?.type === "say" && (!o.say || o.say === "text" || o.say === "completion_result");
  return { events, text: isText ? String(o.text || "") : undefined, sessionId: o.session_id || o.taskId, usage: tokenUsage(o.usage, "cline --json") };
}

export function parseQwenCliEvent(o: any): StructuredCliEvent {
  if (o?.type === "system" && /session_start|init/.test(String(o.subtype))) return { sessionId: o.session_id || o.uuid };
  if (o?.type === "assistant" || (o?.type === "message" && o.message?.role === "assistant")) {
    const message = o.message || o;
    const events: StreamEvent[] = [];
    for (const part of (Array.isArray(message.content) ? message.content : [])) if (part?.type === "tool_use") events.push(toolEvent(String(part.name || "Tool"), part.input, part.id));
    return { events, text: textOf(message.content), usage: tokenUsage(message.usage, "qwen stream-json") };
  }
  if (o?.type === "result") return { sessionId: o.session_id, finalText: String(o.result || ""), error: o.is_error ? String(o.result || "Qwen Code error") : undefined, usage: tokenUsage(o.usage, "qwen stream-json") };
  return {};
}

export function parseGenericJsonlEvent(o: any, source: string, billedCost = false): StructuredCliEvent {
  const sessionId = o?.session_id || o?.sessionID || o?.sessionId;
  if (o?.type === "assistant" || o?.role === "assistant" || o?.type === "text") return { sessionId, text: textOf(o.message?.content ?? o.content ?? o.text ?? o.message), usage: tokenUsage(o.usage, source, billedCost ? "billed" : "tokens_only") };
  if (/tool|command|step/.test(String(o?.type || "")) && !/result|output|completed/.test(String(o?.subtype || o?.type || ""))) {
    return { sessionId, events: [toolEvent(String(o.name || o.tool || o.part?.tool || "Tool"), o.args || o.input || o.part?.state?.input || {}, o.call_id || o.id)] };
  }
  if (o?.type === "result" || o?.type === "done" || o?.type === "task_complete") return { sessionId, finalText: String(o.result || o.text || o.message || ""), error: o.is_error ? String(o.error || o.result || "agent error") : undefined, usage: tokenUsage(o.usage || o.stats, source, billedCost ? "billed" : "tokens_only") };
  if (o?.type === "error") return { sessionId, error: String(o.error?.message || o.message || o.error || "agent error") };
  return { sessionId };
}

interface StructuredCliSpec {
  id: string; label: string; command: string;
  parser(o: any): StructuredCliEvent;
  args(text: string, cwd: string, nativeId: string | undefined, opts?: SendOpts): string[];
  capabilities: AgentCapabilities;
  source: string;
}

class StructuredCliAdapter implements AgentAdapter {
  readonly name: string;
  private readonly sessionsFile: string;
  private sessions: Map<string, string>;
  constructor(private readonly spec: StructuredCliSpec) {
    this.name = spec.id;
    this.sessionsFile = join(homedir(), ".jarvis", `${spec.id}-sessions.json`);
    try { this.sessions = new Map(Object.entries(JSON.parse(readFileSync(this.sessionsFile, "utf8")))); } catch { this.sessions = new Map(); }
  }
  private saveSessions(): void { try { writeJsonAtomic(this.sessionsFile, Object.fromEntries(this.sessions)); } catch { /* ignore */ } }
  nativeSessionId(sessionId: string): string | undefined { return this.sessions.get(sessionId); }
  forgetSession(sessionId: string): void { if (this.sessions.delete(sessionId)) this.saveSessions(); }
  async capabilities(): Promise<AgentCaps> { return { models: [], autoModel: true }; }
  async available(): Promise<boolean> { return !!(await cliVersion(this.spec.command)); }
  async descriptor(): Promise<AgentDescriptor> {
    const version = await cliVersion(this.spec.command);
    return makeDescriptor({
      id: this.name, label: this.spec.label, command: this.spec.command, version,
      support: version ? "unverified" : "not_installed",
      reason: version ? "adapter implementado pela documentação oficial; falta probe real autenticado nesta versão" : `CLI ${this.spec.command} não encontrado`,
      capabilities: effectiveCaps(this.spec.capabilities), caps: await this.capabilities(), source: "cli",
    });
  }
  async send(sessionId: string, text: string, cwd: string, opts?: SendOpts, onEvent?: OnEvent): Promise<AgentReply> {
    validateModelSelection(await this.capabilities(), opts);
    const previous = this.sessions.get(sessionId);
    const args = this.spec.args(text, cwd, previous, opts);
    const parts: string[] = [];
    let snapshot = "", finalText = "", nativeId = previous, usage: AgentReply["usage"], failure = "";
    const handle = (line: string): void => {
      let parsed: any; try { parsed = JSON.parse(line); } catch { return; }
      const item = this.spec.parser(parsed);
      if (item.sessionId) nativeId = item.sessionId;
      if (item.usage) usage = item.usage;
      if (item.error) failure = item.error;
      for (const event of item.events || []) onEvent?.(event);
      if (item.text) {
        // Some CLIs publish growing snapshots (`partial:true`), others true deltas. Emit only the
        // unseen suffix when it is a snapshot; otherwise preserve the provider's delta verbatim.
        const chunk = item.text.startsWith(snapshot) ? item.text.slice(snapshot.length) : item.text;
        snapshot = item.text.startsWith(snapshot) ? item.text : snapshot + item.text;
        if (chunk) { parts.push(chunk); onEvent?.({ kind: "text", text: chunk }); }
      }
      if (item.finalText) finalText = item.finalText;
    };
    const out = onEvent
      ? await runStream(this.spec.command, args, cwd, "", handle, opts?.signal)
      : await run(this.spec.command, args, cwd, "", opts?.signal);
    if (!onEvent) for (const line of out.split(/\r?\n/)) if (line.trim()) handle(line);
    if (failure && !finalText && !parts.length) throw new Error(failure);
    if (!sessionId.startsWith("__oneshot_") && nativeId && nativeId !== previous) { this.sessions.set(sessionId, nativeId); this.saveSessions(); }
    if (usage && !usage.model) usage.model = opts?.model;
    return { text: (finalText || parts.join("") || out).trim(), usage };
  }
  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> { return this.send(`__oneshot_${randomUUID()}`, text, ONESHOT_CWD, opts); }
}

const structuredCaps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
  ...LIMITED_CAPABILITIES, permissionMode: agentPermissionMode(), stream: "delta", tools: true, nativeSessions: true, nativeResume: true,
  files: true, attachments: ["text", "file", "image"], oneShot: true, remote: true, ...over,
});

export class GeminiCliAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "gemini", label: "Google Gemini CLI", command: "gemini", parser: parseGeminiCliEvent, source: "gemini stream-json", capabilities: structuredCaps({ usage: true, mcp: true, commands: true, skills: true }), args: (text, _cwd, sid, opts) => {
    const a = ["--output-format", "stream-json"]; if (fullAccess()) a.push("--yolo");
    if (sid) a.push("--resume", sid); if (opts?.model) a.push("--model", opts.model); a.push("--prompt", text); return a;
  } }); }
}
export class CursorAgentAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "cursor", label: "Cursor Agent", command: "cursor-agent", parser: parseCursorCliEvent, source: "cursor stream-json", capabilities: structuredCaps({ thinking: false, usage: false }), args: (_text, _cwd, sid, opts) => {
    const a = ["--print", "--output-format", "stream-json"]; if (fullAccess()) a.push("--force");
    if (sid) a.push("--resume", sid); if (opts?.model) a.push("--model", opts.model); a.push(_text); return a;
  } }); }
}
export class CopilotCliAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "copilot", label: "GitHub Copilot CLI", command: "copilot", parser: (o) => parseGenericJsonlEvent(o, "copilot JSONL"), source: "copilot JSONL", capabilities: structuredCaps({ usage: true, mcp: true, skills: true }), args: (text, cwd, sid, opts) => {
    const a = ["--prompt", text, "--output-format=json", "--stream=on", "--no-ask-user", "-C", cwd]; if (fullAccess()) a.push("--yolo");
    if (sid) a.push(`--resume=${sid}`); if (opts?.model) a.push(`--model=${opts.model}`); if (opts?.effort) a.push(`--effort=${opts.effort}`); return a;
  } }); }
}
export class OpenCodeAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "opencode", label: "OpenCode", command: "opencode", parser: (o) => parseGenericJsonlEvent(o, "opencode run --format json"), source: "opencode JSON", capabilities: structuredCaps({ usage: true, cost: "estimated_api_equivalent", mcp: true, commands: true, skills: true }), args: (text, _cwd, sid, opts) => {
    const a = ["run", "--format", "json"]; if (fullAccess()) a.push("--auto"); if (sid) a.push("--session", sid); if (opts?.model) a.push("--model", opts.model); if (opts?.effort) a.push("--variant", opts.effort); a.push(text); return a;
  } }); }
  override async capabilities(): Promise<AgentCaps> {
    try {
      const out = await run("opencode", ["models"], homedir(), "");
      const models = out.split(/\r?\n/).map((id) => id.trim()).filter((id) => /^[^\s/]+\/[^\s]+$/.test(id)).map((id) => ({ id, label: id, efforts: [] }));
      return { models, autoModel: true };
    } catch { return { models: [], autoModel: true }; }
  }
}
export class ClineCliAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "cline", label: "Cline CLI", command: "cline", parser: parseClineCliEvent, source: "cline --json", capabilities: structuredCaps({ thinking: true, usage: false, mcp: true, skills: true }), args: (text, cwd, sid, opts) => {
    const a = ["--json", "--auto-approve", fullAccess() ? "true" : "false", "--cwd", cwd]; if (sid) a.push("--id", sid); if (opts?.model) a.push("--model", opts.model); if (opts?.effort) a.push("--thinking", opts.effort); a.push(text); return a;
  } }); }
}
export class QwenCodeAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "qwen", label: "Qwen Code", command: "qwen", parser: parseQwenCliEvent, source: "qwen stream-json", capabilities: structuredCaps({ thinking: true, usage: true, plans: true, subagents: true, mcp: true, skills: true }), args: (text, _cwd, sid, opts) => {
    const a = ["--output-format", "stream-json", "--include-partial-messages", "--approval-mode", fullAccess() ? "yolo" : "default"];
    if (sid) a.push("--resume", sid); if (opts?.model) a.push("--model", opts.model); a.push("--prompt", text); return a;
  } }); }
}

/** Extract a useful terminal response from final-only JSON without exposing the envelope in chat. */
export function finalOnlyText(output: string): string {
  const raw = output.trim(); if (!raw) return "";
  const pick = (value: any): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) { for (const item of [...value].reverse()) { const found = pick(item); if (found) return found; } return ""; }
    if (!value || typeof value !== "object") return "";
    for (const key of ["response", "result", "answer", "text", "content", "message", "output"]) { const found = pick(value[key]); if (found) return found; }
    return "";
  };
  try { return pick(JSON.parse(raw)).trim() || raw; } catch { return raw; }
}

/** Detectable but intentionally final-only: these CLIs do not expose a verified live tool stream. */
class LimitedFinalCliAdapter implements AgentAdapter {
  constructor(readonly name: string, private label: string, private command: string, private args: (text: string, opts?: SendOpts) => string[]) {}
  async capabilities(): Promise<AgentCaps> { return { models: [], autoModel: true }; }
  async available(): Promise<boolean> { return !!(await cliVersion(this.command)); }
  async send(_sessionId: string, text: string, cwd: string, opts?: SendOpts): Promise<AgentReply> { validateModelSelection(await this.capabilities(), opts); return { text: finalOnlyText(await run(this.command, this.args(text, opts), cwd, "", opts?.signal)) }; }
  async descriptor(): Promise<AgentDescriptor> { const version = await cliVersion(this.command); return makeDescriptor({ id: this.name, label: this.label, command: this.command, version, support: version ? "limited" : "not_installed", reason: version ? "CLI só tem saída final verificada; sem stream estruturado de ferramentas" : `CLI ${this.command} não encontrado`, capabilities: { ...LIMITED_CAPABILITIES, oneShot: true, remote: true }, caps: await this.capabilities() }); }
}
export class ContinueCliAdapter extends LimitedFinalCliAdapter { constructor() { super("continue", "Continue CLI", "cn", (text) => { const a = ["-p", text, "--format", "json"]; if (fullAccess()) a.push("--allow", "*"); return a; }); } }
export class KiroCliAdapter extends LimitedFinalCliAdapter {
  constructor() { super("kiro", "Kiro CLI", "kiro-cli", (text, opts) => { const a = ["chat", "--no-interactive"]; if (fullAccess()) a.push("--trust-all-tools"); if (opts?.effort) a.push("--effort", opts.effort); a.push(text); return a; }); }
  override async capabilities(): Promise<AgentCaps> {
    try {
      const raw = await run("kiro-cli", ["chat", "--list-models", "--format", "json"], homedir(), "");
      const parsed = JSON.parse(raw); const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.models) ? parsed.models : [];
      const models = items.map((x: any) => typeof x === "string" ? { id: x, label: x, efforts: [] } : {
        id: String(x.id || x.modelId || x.name || ""), label: String(x.label || x.displayName || x.name || x.id || ""),
        efforts: Array.isArray(x.efforts || x.supportedEfforts) ? [...(x.efforts || x.supportedEfforts)] : [], effortsVerified: false,
      }).filter((x: ModelInfo) => !!x.id);
      return { models, autoModel: true };
    } catch { return { models: [], autoModel: true }; }
  }
}
export class AntigravityCliAdapter extends LimitedFinalCliAdapter {
  constructor() { super("antigravity", "Google Antigravity CLI", "agy", (text) => [text]); }
  override async available(): Promise<boolean> { return false; }
  override async send(): Promise<AgentReply> { throw new Error("Antigravity CLI não expõe um modo headless estruturado verificável; use o TUI agy diretamente"); }
  override async descriptor(): Promise<AgentDescriptor> { const version = await cliVersion("agy"); return makeDescriptor({ id: this.name, label: "Google Antigravity CLI", command: "agy", version, support: version ? "limited" : "not_installed", reason: version ? "TUI instalado, mas sem modo headless público verificável; execução pelo Jarvis desativada" : "CLI agy não encontrado", capabilities: { ...LIMITED_CAPABILITIES, oneShot: false, remote: false }, caps: await this.capabilities() }); }
}

// ---------------------------------------------------------------------------

/**
 * Aider (https://aider.chat) — a pluggable, final-only agent running one headless message per turn.
 * It remains explicitly LIMITED; the structured adapters above are the template for live parity.
 *
 * WRITTEN TO SPEC — VERIFY ON FIRST RUN (it was authored without a local `aider` to test against):
 *  - Requires `aider` on PATH and a model key in the env / ~/.aider.conf.yml (aider picks the provider).
 *  - Runs inside a git repo (aider expects one); a non-repo cwd may make it warn/refuse.
 *  - CONTINUITY is per-CWD via aider's own chat history (`--restore-chat-history`), NOT per Jarvis
 *    session — two sessions sharing a folder share context. (Claude/Codex bind a native session id;
 *    aider has no equivalent per-invocation handle, so this is the honest v1 approximation.)
 *  - No streaming/tool events yet (final text only).
 *  - capabilities() returns NO models on purpose — aider spans many providers and inventing an id
 *    catalog would be a guess; pass opts.model to pick one, else aider uses its configured default.
 * Flags used: --message (one-shot), --yes-always (auto-confirm), --no-stream + --no-pretty (clean
 * stdout capture), --restore-chat-history (continuity), --model (optional). Adjust here if a flag
 * name differs in your aider version.
 */
export class AiderAdapter implements AgentAdapter {
  readonly name = "aider";
  async capabilities(): Promise<AgentCaps> {
    return { models: [] };
  }
  async available(): Promise<boolean> {
    try { const r = await runRaw("aider", ["--version"], homedir(), ""); return r.code === 0; }
    catch { return false; }
  }
  async send(_sessionId: string, text: string, cwd: string, opts?: SendOpts): Promise<AgentReply> {
    validateModelSelection(await this.capabilities(), opts);
    // The chat message goes via --message-file, not --message <text>: the text is user input, and on
    // the old shell:true path a message with `;`/`&`/`$()` ran as a shell command. A temp file keeps
    // it entirely off the command line (belt-and-braces with spawnCli's shell:false).
    const mf = tempTextFile("jarvis_aider", text);
    try {
      const args = ["--message-file", mf.path, "--no-stream", "--no-pretty", "--restore-chat-history"]; if (fullAccess()) args.push("--yes-always");
      const model = safeIdent(opts?.model); if (model) args.push("--model", model);
      const out = await run("aider", args, cwd, "", opts?.signal);
      return { text: out.trim() };
    } finally { mf.cleanup(); }
  }
  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> {
    // stateless throwaway (no history restore, no commits) in the excluded oneshot dir
    const mf = tempTextFile("jarvis_aider", text);
    try {
      const args = ["--message-file", mf.path, "--no-stream", "--no-pretty", "--no-auto-commits"]; if (fullAccess()) args.push("--yes-always");
      const model = safeIdent(opts?.model); if (model) args.push("--model", model);
      const out = await run("aider", args, ONESHOT_CWD, "");
      return { text: out.trim() };
    } finally { mf.cleanup(); }
  }
  async descriptor(): Promise<AgentDescriptor> {
    const version = await cliVersion("aider");
    return makeDescriptor({
      id: this.name, label: "Aider", command: "aider", version,
      support: version ? "limited" : "not_installed",
      reason: version ? "sem stream estruturado, sessão isolada e usage verificados" : "CLI aider não encontrado",
      capabilities: { ...LIMITED_CAPABILITIES }, caps: await this.capabilities(), source: "config",
    });
  }
}

// ---------------------------------------------------------------------------

/** Resolve a bare command to an absolute path via PATH (+ PATHEXT on Windows). Returns the name
 *  unchanged when nothing matches (spawn then surfaces a clear ENOENT) or when it's already a path.
 *  Cached per name. This is what lets us drop shell:true (below) without losing the shell's PATH
 *  lookup — the shell was only ever needed to FIND the binary, never to parse our arguments. */
const binCache = new Map<string, string>();

async function cliVersion(cmd: string): Promise<string | undefined> {
  try {
    const r = await runRaw(cmd, ["--version"], homedir(), "");
    if (r.code !== 0) return undefined;
    return (r.stdout || r.stderr).trim().split(/\r?\n/)[0]?.slice(0, 120) || "unknown";
  } catch { return undefined; }
}

function makeDescriptor(opts: {
  id: string;
  label: string;
  command: string;
  version?: string;
  support: SupportLevel;
  reason?: string;
  capabilities: AgentCapabilities;
  caps: AgentCaps;
  source?: ModelSource;
}): AgentDescriptor {
  const discoveredAt = Date.now();
  const source = opts.source || "fallback";
  const models: ModelDescriptor[] = opts.caps.models.map((m) => ({
    id: m.id,
    label: m.label || m.id,
    source,
    visibility: "public",
    contextTokens: m.context,
    efforts: [...m.efforts],
    defaultEffort: m.defaultEffort,
    effortsVerified: m.effortsVerified,
    contextVerified: m.contextVerified,
    modalities: opts.capabilities.attachments.includes("image") ? ["text", "image", "file"] : ["text", "file"],
    discoveredAt,
  }));
  return {
    id: opts.id,
    label: opts.label,
    support: opts.support,
    reason: opts.reason,
    cli: { command: opts.command, version: opts.version },
    capabilities: effectiveCaps(opts.capabilities),
    models,
    defaultModel: opts.caps.defaultModel,
    discoveredAt,
  };
}
function resolveBin(cmd: string): string {
  if (cmd.includes("/") || cmd.includes("\\")) return cmd; // already an explicit path
  const cached = binCache.get(cmd); if (cached) return cached;
  const win = platform() === "win32";
  const exts = win ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  const dirs = (process.env.PATH || "").split(win ? ";" : ":").filter(Boolean);
  for (const dir of dirs) for (const ext of exts) {
    const full = join(dir, cmd + ext);
    if (existsSync(full)) { binCache.set(cmd, full); return full; }
  }
  return cmd;
}
/**
 * Spawn a CLI with NO shell, EVER. The command's arguments (which include user-controlled text on
 * some adapters) are passed as a raw argv array, so shell metacharacters (`;`, `&`, `$()`, backticks,
 * quotes) are inert — this is the fix for the shell-injection that shell:true allowed. A Windows
 * .cmd/.bat shim isn't directly executable, so it's run through cmd.exe explicitly (cmd.exe is the
 * real executable we spawn; the script + args remain a quoted array, never a concatenated string).
 */
function spawnCli(cmd: string, args: string[], cwd: string): ChildProcess {
  const bin = resolveBin(cmd);
  if (platform() === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", bin, ...args], { cwd, windowsHide: true });
  }
  return spawn(bin, args, { cwd, windowsHide: true });
}
/** Write `text` to a throwaway temp file and hand back its path + a cleanup fn. Lets an adapter pass
 *  a prompt via `--message-file` instead of on the command line, so the text never becomes argv. */
function tempTextFile(prefix: string, text: string): { path: string; cleanup: () => void } {
  const path = join(tmpdir(), `${prefix}_${randomUUID()}.txt`);
  writeFileSync(path, text);
  return { path, cleanup: () => { try { unlinkSync(path); } catch { /* already gone */ } } };
}

export interface RunResult { code: number; stdout: string; stderr: string }
/**
 * Raw spawn: resolves with the outcome and lets the caller judge it. Rejects only when the
 * process could not run at all (missing binary), never for a non-zero exit.
 *
 * Use this when the two streams mean different things to you — e.g. `codex login status` exits 0
 * and prints its answer to STDERR, while `codex exec` prints the reply to STDOUT and a banner to
 * STDERR. A helper that collapses both into one string cannot serve both.
 */
function runRaw(cmd: string, args: string[], cwd: string, stdin: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawnCli(cmd, args, cwd);
    let out = "";
    let err = "";
    p.stdout!.on("data", (d) => (out += d.toString()));
    p.stderr!.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    if (stdin) p.stdin!.write(stdin);
    p.stdin!.end();
    p.on("close", (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
  });
}
/**
 * Success is the EXIT CODE — not whether anything reached stdout. The old rule ("resolve if
 * stdout is non-empty, otherwise reject") was wrong in both directions: it called a successful
 * command that reports on stderr a failure (which is why `codex login status` never registered
 * and codex therefore never showed as available, on any machine), and it called a failing command
 * that had printed to stdout a success. Returns stdout, because that is where a CLI puts its
 * output; callers that need stderr use runRaw and say so.
 */
function run(cmd: string, args: string[], cwd: string, stdin: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawnCli(cmd, args, cwd);
    const wasAborted = wireAbort(p, signal);
    let out = "";
    let err = "";
    p.stdout!.on("data", (d) => (out += d.toString()));
    p.stderr!.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    if (stdin) p.stdin!.write(stdin);
    p.stdin!.end();
    p.on("close", (code) => {
      if (wasAborted()) reject(new Error(ABORTED));
      else if (code === 0) resolve(out);
      else reject(new Error(err.trim() || out.trim() || `${cmd} exited with ${code}`));
    });
  });
}

/** Like run(), but calls onLine for each complete stdout line as it arrives (NDJSON stream). */
function runStream(cmd: string, args: string[], cwd: string, stdin: string, onLine: (line: string) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawnCli(cmd, args, cwd);
    const wasAborted = wireAbort(p, signal);
    let out = "";
    let buf = "";
    let err = "";
    p.stdout!.on("data", (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        out += line + "\n";
        if (line.trim()) onLine(line);
      }
    });
    p.stderr!.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    if (stdin) p.stdin!.write(stdin);
    p.stdin!.end();
    p.on("close", (code) => {
      if (wasAborted()) { reject(new Error(ABORTED)); return; }
      if (buf.trim()) onLine(buf);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || out.trim() || `${cmd} exited with ${code}`));
    });
  });
}

/** The FULL command/args behind a tool row (untruncated, newlines kept) — surfaced when the user
 *  expands the activity row. Returns undefined when the summary already shows everything. */
function toolDetail(name: string, input: any): string | undefined {
  let full = "";
  if (name === "Bash") full = String(input?.command || "");
  else if (name === "Task" || name === "Agent") full = String(input?.prompt || input?.description || "");
  else if (name === "Grep") full = String(input?.pattern || "");
  else if (name === "WebFetch") full = String(input?.url || "");
  else if (name === "WebSearch") full = String(input?.query || "");
  else { try { full = JSON.stringify(input ?? {}, null, 1); } catch { full = ""; } }
  full = full.trim();
  if (!full || full.length <= 90) return undefined; // o resumo já mostra tudo
  return full.length > 4000 ? full.slice(0, 4000) + "\n… (truncado)" : full;
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
