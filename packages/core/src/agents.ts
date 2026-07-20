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
import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { toolFileStat } from "./native.js";
import { writeJsonAtomic } from "./persist.js";
import {
  LIMITED_CAPABILITIES,
  descriptorProblems,
  type AgentCapabilities,
  type AgentDescriptor,
  type AgentEvent,
  type EventSequencer,
  type CostKind,
  type ModelDescriptor,
  type ModelSource,
  type PermissionMode,
  type ProviderExecutionEvent,
  type SupportLevel,
} from "./agent-contract.js";
import { codexChildRollouts } from "./codex-executions.js";
import { EXECUTION_ADAPTER_PROFILES, EXECUTION_ADAPTER_IDS, mapProviderExecutionFixture, type ExecutionAdapterId } from "./execution-adapters.js";

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
    contextWindowTokens?: number;
    costKind?: CostKind;
    source?: string;
    model?: string;
    effort?: string;
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
  selectable?: boolean;
  source?: ModelSource;
}

/** One usage window (a % used + when it resets). */
export interface UsageWindow { pct: number; resetsAt?: string; }
/** Account-level plan usage, if the agent exposes it (Claude: /api/oauth/usage). */
export interface AgentUsage {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  extra?: Array<{ label: string } & UsageWindow>;
  label?: string;
  source?: string;
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
  /** Provider-neutral continuity for CLIs without a safely addressable native session. The current
   * user message is not included; adapters prepend this bounded history only when they declare
   * `sessionContinuity: jarvis_history`. */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Stable Jarvis turn id used by the canonical event envelope; never forwarded to a provider. */
  turnId?: string;
  /** Fail-closed execution boundary used only by Jarvis-managed child workflows. Adapters must
   * reject this option unless they can enforce the requested workspace policy for this invocation. */
  managed?: { workspaceAccess: "read_only" | "isolated_write"; preventCommits: true };
}

type ManagedInvocation = NonNullable<SendOpts["managed"]>;

/**
 * Provider argv that enforces a Jarvis-managed child boundary. This is deliberately pure so the
 * exact security contract is testable without spawning a billable CLI. Unknown/uncertified agents
 * fail closed; the internal mock is available only when its caller explicitly enables the fixture.
 */
export function managedAdapterSecurityArgs(agent: string, managed: ManagedInvocation, allowTestMock = false): string[] {
  if (!managed || managed.preventCommits !== true || (managed.workspaceAccess !== "read_only" && managed.workspaceAccess !== "isolated_write")) {
    throw new Error(`política de execução gerenciada inválida para ${agent}`);
  }
  if (agent === "claude-code") {
    const tools = managed.workspaceAccess === "read_only"
      ? "Read,Glob,Grep,WebFetch,WebSearch"
      : "Read,Glob,Grep,Edit,Write,NotebookEdit,WebFetch,WebSearch";
    // Safe mode removes hooks/MCP/plugins; neither allowlist admits Bash, Task or Agent.
    return ["--safe-mode", "--permission-mode", "dontAsk", "--tools", tools];
  }
  if (agent === "codex") {
    if (managed.workspaceAccess !== "read_only") throw new Error("Codex gerenciado com escrita ainda não possui bloqueio de commit certificável");
    return ["--sandbox", "read-only"];
  }
  if (agent === "aider") {
    if (managed.workspaceAccess !== "isolated_write") throw new Error("Aider gerenciado não possui modo somente leitura certificado");
    return ["--no-auto-commits"];
  }
  if (agent === "mock" && allowTestMock && managed.workspaceAccess === "read_only") return [];
  throw new Error(`o adapter ${agent} ainda não possui sandbox gerenciado certificado`);
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

/** Provider/model slugs commonly contain `/`, `:` or `@`. They are argv entries (shell:false), but
 * control characters and option-looking values are still rejected to prevent accidental flag
 * injection or malformed billable requests when a provider has no enumerable catalog. */
export function safeProviderValue(v?: string): string | undefined {
  return typeof v === "string" && !v.startsWith("-") && /^[A-Za-z0-9._:/@+-]{1,160}$/.test(v) ? v : undefined;
}

/** Complete Aider argv composition, kept pure to prove a managed invocation never inherits the
 * global unattended `--yes-always` switch. */
export function buildAiderInvocationArgs(messageFile: string, opts?: SendOpts, unattendedFullAccess = fullAccess()): string[] {
  const args = ["--message-file", messageFile, "--no-stream", "--no-pretty"];
  if (opts?.managed) args.push(...managedAdapterSecurityArgs("aider", opts.managed));
  else if (unattendedFullAccess) args.push("--yes-always");
  const model = safeProviderValue(opts?.model); if (model) args.push("--model", model);
  return args;
}

/** Bounded, session-isolated continuity for CLIs that have no addressable native resume id. */
export function withManagedHistory(text: string, history?: SendOpts["history"], maxChars = Number(process.env.JARVIS_MANAGED_CONTEXT_CHARS || 16_000)): string {
  if (!history?.length) return text;
  const cap = Number.isFinite(maxChars) && maxChars >= 1_000 ? Math.floor(maxChars) : 16_000;
  const rows = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text.trim()}`);
  const selected: string[] = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (used + row.length + 2 > cap) break;
    selected.unshift(row); used += row.length + 2;
  }
  if (!selected.length) return text;
  return `Contexto anterior desta conversa Jarvis (não repita respostas já dadas):\n${selected.join("\n\n")}\n\nMensagem atual do usuário:\n${text}`;
}

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
  kind: "text" | "tool" | "thinking" | "plan";
  text?: string; // for kind:"text" — a chunk of the reply
  name?: string; // for kind:"tool" — the tool name (Bash, Edit, Read…)
  summary?: string; // for kind:"tool" — a human one-liner (e.g. "Editando foo.ts")
  detail?: string; // for kind:"tool" — the FULL command/args (untruncated), shown when the row is expanded
  toolId?: string; parentId?: string; // sub-agent linkage (Task/Agent → its nested tools)
  path?: string; adds?: number; dels?: number; rows?: any[]; // file tools: touched path + diff
  status?: "started" | "completed" | "failed";
  error?: string;
  providerEvent?: string;
}
export type ProviderProgressEvent = StreamEvent | ProviderExecutionEvent;
export type OnEvent = (ev: ProviderProgressEvent) => void;
export function isProviderExecutionEvent(ev: ProviderProgressEvent): ev is ProviderExecutionEvent { return ev.kind.startsWith("execution_"); }

export interface AgentEventBridge {
  accepted(): AgentEvent;
  started(): AgentEvent;
  provider(ev: StreamEvent): AgentEvent;
  usage(usage: NonNullable<AgentReply["usage"]>): AgentEvent;
  completed(text: string): AgentEvent;
  failed(message: string, errorCode?: string): AgentEvent;
  cancelled(): AgentEvent;
}

/** Single provider-progress → canonical-event boundary used by both Hub and Runner. */
export function createAgentEventBridge(turnId: string, sequencer: EventSequencer): AgentEventBridge {
  let anonymousTool = 0;
  const tool = (ev: StreamEvent) => ({
    callId: ev.toolId || `${turnId}:tool:${++anonymousTool}`,
    name: ev.name || "Tool",
    summary: ev.summary || ev.name || "Ferramenta",
    detail: ev.detail,
    status: ev.status || "started" as const,
    parentId: ev.parentId, path: ev.path, adds: ev.adds, dels: ev.dels, rows: ev.rows, error: ev.error,
  });
  return {
    accepted: () => sequencer.next("accepted"),
    started: () => sequencer.next("started"),
    provider: (ev) => {
      if (ev.kind === "text") return sequencer.next("text_delta", { text: ev.text || "", providerEvent: ev.providerEvent, parentId: ev.parentId });
      if (ev.kind === "thinking") return sequencer.next("thinking", { text: ev.text, providerEvent: ev.providerEvent, parentId: ev.parentId });
      if (ev.kind === "plan") return sequencer.next("plan", { text: ev.text, providerEvent: ev.providerEvent, parentId: ev.parentId });
      const t = tool(ev), kind = t.status === "failed" ? "tool_failed" : t.status === "completed" ? "tool_completed" : "tool_started";
      return sequencer.next(kind, { tool: t, providerEvent: ev.providerEvent, parentId: ev.parentId });
    },
    usage: (usage) => sequencer.next("usage", { usage: { ...usage, costKind: usage.costKind || "unavailable", source: usage.source || "provider did not identify usage source" } }),
    completed: (text) => sequencer.next("completed", { text }),
    failed: (message, errorCode) => sequencer.next("failed", { text: message, errorCode }),
    cancelled: () => sequencer.next("cancelled"),
  };
}

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
  async describe(): Promise<Array<{ name: string; modelControl?: AgentCapabilities["modelControl"] } & AgentCaps & Partial<Pick<AgentDescriptor, "label" | "support" | "reason" | "cli" | "capabilities" | "execution" | "discoveredAt">>>> {
    return Promise.all([...this.byName.values()].map(async (a) => {
      const caps = await a.capabilities();
      if (!a.descriptor) return { name: a.name, ...caps, support: "limited" as const, reason: "adapter sem descriptor canônico" };
      const d = await a.descriptor();
      const problems = descriptorProblems(d);
      return { name: a.name, ...caps, modelControl: d.capabilities.modelControl, label: d.label, support: problems.length ? "limited" as const : d.support, reason: problems.length ? `descriptor inválido: ${problems.join("; ")}` : d.reason, cli: d.cli, capabilities: d.capabilities, execution: d.execution, discoveredAt: d.discoveredAt };
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
  async send(_sid: string, text: string, _cwd?: string, opts?: SendOpts, onEvent?: OnEvent): Promise<AgentReply> {
    if (opts?.managed) managedAdapterSecurityArgs(this.name, opts.managed, process.env.JARVIS_ENABLE_MOCK === "1");
    const reply = `Recebi: "${text}". (agente mock — Hub/chat/voz OK.)`;
    if (text.includes("[fixture:child]")) {
      onEvent?.({ kind: "execution_spawn", providerId: "mock-child-1", node: { title: "Subprocesso fixture", role: "auditor", kind: "agent" } });
      onEvent?.({ kind: "execution_activity", providerId: "mock-child-1", event: { kind: "thinking", text: "Analisando fixture", providerEvent: "mock.child.thinking" } });
      onEvent?.({ kind: "execution_activity", providerId: "mock-child-1", event: { kind: "tool", name: "Read", summary: "Lendo fixture", toolId: "mock-child-tool-1", status: "completed", providerEvent: "mock.child.tool" } });
      onEvent?.({ kind: "execution_activity", providerId: "mock-child-1", event: { kind: "text", text: "Resultado publicado do subprocesso", providerEvent: "mock.child.text" } });
      onEvent?.({ kind: "execution_state", providerId: "mock-child-1", state: "succeeded", summary: "Fixture concluída" });
    }
    onEvent?.({ kind: "thinking" });
    onEvent?.({ kind: "tool", name: "FixtureTool", summary: "Validando fluxo de progresso", toolId: "mock-tool-1" });
    onEvent?.({ kind: "text", text: reply });
    return { text: reply, usage: { inputTokens: 1, outputTokens: 1, costKind: "tokens_only", source: "mock fixture" } };
  }
  async oneShot(): Promise<AgentReply> {
    return { text: '{"answer":"(busca mock — defina JARVIS_SEARCH_AGENT=claude-code para busca real)","matches":[],"action":null}' };
  }
  async descriptor(): Promise<AgentDescriptor> {
    return makeDescriptor({ id: this.name, label: "Mock (testes)", command: "internal", support: "limited", reason: "adapter interno de testes; não é uma IA de produção", capabilities: { ...LIMITED_CAPABILITIES, stream: "delta", tools: true, thinking: true, usage: true, remote: true, toolLifecycle: "full", sessionContinuity: "jarvis_history" }, caps: await this.capabilities() });
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
        modelCatalog: "runtime", modelControl: "per_turn", sessionContinuity: "native_id", toolLifecycle: "start_only",
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
    if (opts?.managed) args.push(...managedAdapterSecurityArgs(this.name, opts.managed));
    else if (fullAccess()) args.push("--permission-mode", "bypassPermissions");
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
      const taskIds = new Set<string>();
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
            else if (b.type === "tool_use") {
              const st = fileToolStat(b.name, b.input);
              if (!parentId && b.id && (b.name === "Task" || b.name === "Agent")) {
                taskIds.add(b.id);
                onEvent({ kind: "execution_spawn", providerId: b.id, node: { title: String(b.input?.description || b.input?.subagent_type || "Subagente Claude").slice(0, 200), role: b.input?.subagent_type, prompt: b.input?.prompt, kind: "agent" } });
              }
              onEvent({ kind: "tool", name: b.name, summary: toolSummary(b.name, b.input), detail: toolDetail(b.name, b.input), toolId: b.id, parentId, path: st.path, adds: st.adds, dels: st.dels, rows: st.rows as any });
            }
            else if (b.type === "thinking") onEvent({ kind: "thinking", parentId });
          }
        } else if (o.type === "user") {
          for (const b of o.message?.content || []) if (b?.type === "tool_result" && taskIds.has(String(b.tool_use_id || ""))) {
            const failed = !!b.is_error;
            onEvent({ kind: "execution_state", providerId: String(b.tool_use_id), state: failed ? "failed" : "succeeded", summary: failed ? String(b.content || "subagente falhou") : undefined });
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
export function codexUsage(u: any, previous?: any, telemetry?: CodexTelemetry): AgentReply["usage"] | undefined {
  if (!u) return undefined;
  const input = Math.max(0, (u.input_tokens || 0) - (previous?.input_tokens || 0));
  const cached = Math.max(0, (u.cached_input_tokens || 0) - (previous?.cached_input_tokens || 0));
  const output = Math.max(0, (u.output_tokens || 0) - (previous?.output_tokens || 0));
  if (!input && !output) return undefined;
  const envNum = (v: string | undefined, d: number): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  const pIn = envNum(process.env.JARVIS_CODEX_PRICE_IN, 1.25);            // USD / 1M non-cached input
  const pCached = envNum(process.env.JARVIS_CODEX_PRICE_CACHED, pIn / 10); // cached input bills cheaper
  const pOut = envNum(process.env.JARVIS_CODEX_PRICE_OUT, 10);            // USD / 1M output (incl. reasoning)
  const costUsd = (Math.max(0, input - cached) * pIn + cached * pCached + output * pOut) / 1e6;
  const pricing = process.env.JARVIS_CODEX_PRICING_VERSION || "jarvis-ballpark-v1";
  const currentInput = telemetry?.last?.input_tokens || input || undefined;
  return { costUsd, inputTokens: input || undefined, cachedInputTokens: cached || undefined, contextTokens: currentInput, contextWindowTokens: telemetry?.contextWindow, outputTokens: output || undefined, costKind: "estimated_api_equivalent", source: `codex exec --json token delta × JARVIS_CODEX_PRICE_* (${pricing})`, model: telemetry?.model };
}

export interface CodexTelemetry {
  total?: any;
  last?: any;
  contextWindow?: number;
  model?: string;
  rateLimits?: any;
}

/** Extract the latest effective model, context and rate-limit snapshot from a Codex rollout. */
export function codexTelemetryFromLines(lines: string[]): CodexTelemetry | undefined {
  const out: CodexTelemetry = {};
  for (const line of lines) {
    let row: any; try { row = JSON.parse(line); } catch { continue; }
    if (row?.type === "turn_context" && row.payload?.model) out.model = String(row.payload.model);
    const p = row?.type === "event_msg" ? row.payload : undefined;
    if (p?.type === "token_count" && p.info) {
      out.total = p.info.total_token_usage || out.total;
      out.last = p.info.last_token_usage || out.last;
      out.contextWindow = Number(p.info.model_context_window) || out.contextWindow;
      out.rateLimits = p.rate_limits || out.rateLimits;
    }
  }
  return out.total || out.model || out.rateLimits ? out : undefined;
}

function codexRolloutFiles(dir = join(homedir(), ".codex", "sessions")): string[] {
  const found: string[] = [];
  const walk = (d: string): void => { let entries: any[] = []; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of entries) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jsonl$/i.test(e.name)) found.push(p); } };
  walk(dir); return found.sort((a, b) => { try { return statSync(b).mtimeMs - statSync(a).mtimeMs; } catch { return 0; } });
}

function codexThreadFile(threadId?: string): string | undefined {
  const files = codexRolloutFiles(); return threadId ? files.find((p) => p.includes(threadId)) : files[0];
}

function codexThreadTelemetry(threadId?: string): CodexTelemetry | undefined {
  const file = codexThreadFile(threadId);
  if (!file) return undefined;
  try { return codexTelemetryFromLines(readFileSync(file, "utf8").split(/\r?\n/)); } catch { return undefined; }
}

/** Authoritative file metadata emitted to the native rollout after apply_patch. */
export function codexPatchEventsFromLines(lines: string[], sinceMs?: number): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of lines) {
    let row: any; try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(String(row?.timestamp || ""));
    if (sinceMs && Number.isFinite(at) && at < sinceMs) continue;
    const p = row?.type === "event_msg" && row.payload?.type === "patch_apply_end" ? row.payload : undefined;
    if (!p?.changes || typeof p.changes !== "object") continue;
    for (const [path, change] of Object.entries(p.changes) as Array<[string, any]>) {
      const raw = String(change?.unified_diff || "");
      const rows = raw.split(/\r?\n/).filter(Boolean).map((s): { t: " " | "+" | "-" | "@"; s: string } => ({ t: s.startsWith("@@") ? "@" : s.startsWith("+") && !s.startsWith("+++") ? "+" : s.startsWith("-") && !s.startsWith("---") ? "-" : " ", s }));
      const adds = rows.filter((r) => r.t === "+").length, dels = rows.filter((r) => r.t === "-").length;
      const write = change?.type === "add";
      events.push({ kind: "tool", name: write ? "Write" : "Edit", summary: `${write ? "Criando" : "Editando"} ${path.split(/[\\/]/).pop() || path}`, toolId: `${p.call_id || "patch"}:${path}`, status: p.success === false ? "failed" : "completed", error: p.success === false ? String(p.stderr || "patch falhou") : undefined, path, adds, dels, rows: rows.length <= 300 ? rows : undefined, providerEvent: "patch_apply_end" });
    }
  }
  return events;
}

/** Codex exposes file inspection/search/listing as `command_execution`, usually wrapped in
 * PowerShell. Preserve the real command in `detail`, but translate commands with unambiguous
 * semantics to Jarvis' provider-neutral Read/Grep/Glob vocabulary. This is classification of an
 * observed command, never an invented tool call. */
export function codexCommandActivity(command: string): Pick<StreamEvent, "name" | "summary" | "detail" | "path"> {
  const cmd = String(command || "").trim();
  const flat = cmd.replace(/\s+/g, " ");
  const quotedArg = '(?:"([^"]+)"|\'([^\']+)\'|([^\\s;|]+))';
  const directRead = new RegExp(`\\bGet-Content\\b(?:\\s+-Raw)?\\s+(?:-(?:LiteralPath|Path)\\s+)?${quotedArg}`, "i").exec(cmd)
    || new RegExp(`\\b(?:cat|type)\\s+${quotedArg}`, "i").exec(cmd);
  const candidate = directRead ? String(directRead[1] || directRead[2] || directRead[3] || "").replace(/^["']|["']$/g, "") : "";
  const path = candidate && !candidate.startsWith("$") && !candidate.startsWith("-") ? candidate : undefined;
  const base = path ? path.split(/[\\/]/).pop() || path : "arquivo(s)";
  if (/\bGet-Content\b/i.test(cmd) || /(?:^|[;&|]\s*|-[Cc]ommand\s+["']?)\s*(?:cat|type)\s+/i.test(cmd))
    return { name: "Read", summary: `Lendo ${base}`, detail: cmd || undefined, path };
  if (/\b(?:rg|Select-String)\b/i.test(cmd))
    return { name: "Grep", summary: "Buscando no projeto", detail: cmd || undefined };
  if (/\bGet-ChildItem\b/i.test(cmd) || /(?:^|[;&|]\s*|-[Cc]ommand\s+["']?)\s*(?:ls|dir|find)\b/i.test(cmd))
    return { name: "Glob", summary: "Listando arquivos", detail: cmd || undefined };
  return { name: "Bash", summary: "Bash: " + flat.slice(0, 90), detail: cmd.length > 90 ? cmd : undefined };
}

/** Read only bytes appended since `offset`; avoids rereading a potentially large rollout every
 * polling tick. A truncated/replaced file safely restarts from byte zero. */
function codexRolloutAppend(path: string, offset: number): { data: Buffer; offset: number; reset: boolean } {
  let fd: number | undefined;
  try {
    const size = statSync(path).size;
    const reset = size < offset, start = reset ? 0 : offset;
    if (size <= start) return { data: Buffer.alloc(0), offset: size, reset };
    const buf = Buffer.allocUnsafe(size - start);
    fd = openSync(path, "r");
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, start + read);
      if (!n) break;
      read += n;
    }
    return { data: buf.subarray(0, read), offset: start + read, reset };
  } catch { return { data: Buffer.alloc(0), offset, reset: false }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* best-effort telemetry */ } }
}

export function codexPlanUsage(t?: CodexTelemetry): AgentUsage | null {
  const rl = t?.rateLimits; if (!rl) return null;
  const windows: Array<{ label: string; pct: number; minutes?: number; resetsAt?: string }> = [];
  for (const [label, value] of [["Principal", rl.primary], ["Secundário", rl.secondary]] as const) if (value && Number.isFinite(Number(value.used_percent))) windows.push({ label, pct: Number(value.used_percent), minutes: Number(value.window_minutes) || undefined, resetsAt: value.resets_at ? new Date(Number(value.resets_at) * 1000).toISOString() : undefined });
  const result: AgentUsage = { label: rl.plan_type ? `Codex · ${rl.plan_type}` : "Codex", source: "Codex rollout token_count.rate_limits", extra: [] };
  for (const w of windows) { const target = { pct: w.pct, resetsAt: w.resetsAt }; if (w.minutes === 300) result.fiveHour = target; else if (w.minutes === 10080) result.sevenDay = target; else result.extra!.push({ label: `${w.label}${w.minutes ? ` · ${w.minutes} min` : ""}`, ...target }); }
  if (!result.extra?.length) delete result.extra;
  return result;
}

/** Map ONE codex `--json` item to the StreamEvents Jarvis renders (SAME vocabulary Claude emits, so
 *  the live flow is identical) plus, for an agent_message, the assistant text to accumulate. Pure +
 *  exported so the mapping is unit-tested without spawning codex. `isCompleted` = the item came from
 *  `item.completed` (vs `item.started`); reasoning/agent_message only surface once completed, tool
 *  actions surface on first sighting (the caller dedupes started+completed by item id). Unknown item
 *  types return no events (forward-compatible with future codex item kinds). */
export function codexItemToEvents(it: any, isCompleted: boolean): { events: StreamEvent[]; text?: string } {
  const type = it?.type; if (!type) return { events: [] };
  const failed = isCompleted && (it?.status === "failed" || Number(it?.exit_code) > 0 || !!it?.error);
  const status: StreamEvent["status"] = isCompleted ? (failed ? "failed" : "completed") : "started";
  if (type === "agent_message") {
    if (!isCompleted) return { events: [] };
    const txt = String(it.text ?? "").trim();
    return txt ? { events: [{ kind: "text", text: txt }], text: txt } : { events: [] };
  }
  if (type === "reasoning") return isCompleted ? { events: [{ kind: "thinking" }] } : { events: [] };
  if (type === "command_execution") {
    const cmd = String(it.command ?? "");
    const activity = codexCommandActivity(cmd);
    return { events: [{ kind: "tool", ...activity, toolId: it.id, status, error: failed ? String(it?.error?.message || it?.error || it?.aggregated_output || "comando falhou") : undefined }] };
  }
  if (type === "file_change" || type === "patch" || type === "apply_patch") {
    const changes = Array.isArray(it.changes) ? it.changes : Array.isArray(it.files) ? it.files : (it.path ? [{ path: it.path, kind: it.kind, unified_diff: it.unified_diff, diff: it.diff, rows: it.rows }] : []);
    // Codex's stdout item commonly omits the unified diff. In that case wait for the authoritative
    // patch_apply_end from the rollout instead of rendering a duplicate row without +/- metadata.
    if (!changes.length || !changes.some((ch: any) => ch?.unified_diff || ch?.diff || ch?.rows)) return { events: [] };
    return { events: changes.map((ch: any): StreamEvent => {
      const p = String(ch?.path ?? ch?.file ?? "");
      const write = /add|create|new/i.test(String(ch?.kind ?? ch?.type ?? ""));
      return { kind: "tool", name: write ? "Write" : "Edit", summary: (write ? "Criando " : "Editando ") + (p.split(/[\\/]/).pop() || p || "arquivo"), path: p || undefined, toolId: `${it.id || type}:${p}`, status, error: failed ? String(it?.error || "edição falhou") : undefined };
    }) };
  }
  if (type === "mcp_tool_call" || type === "custom_tool_call" || type === "tool_call" || type === "function_call") {
    const tn = String(it.name ?? it.tool ?? it.tool_name ?? "ferramenta");
    return { events: [{ kind: "tool", name: tn, summary: "Ferramenta: " + tn.slice(0, 60), toolId: it.id, status, error: failed ? String(it?.error || "ferramenta falhou") : undefined }] };
  }
  if (type === "web_search") return { events: [{ kind: "tool", name: "WebSearch", summary: "Pesquisando: " + String(it.query ?? "").slice(0, 60), toolId: it.id, status, error: failed ? String(it?.error || "pesquisa falhou") : undefined }] };
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

  async usage(): Promise<AgentUsage | null> { return codexPlanUsage(codexThreadTelemetry()); }

  async descriptor(): Promise<AgentDescriptor> {
    const caps = await this.capabilities();
    const version = await cliVersion("codex");
    const authenticated = version ? await this.available() : false;
    const support: SupportLevel = !version ? "not_installed" : !authenticated ? "unauthenticated" : "limited";
    return makeDescriptor({
      id: this.name, label: "OpenAI Codex", command: "codex", version, support,
      reason: support === "not_installed" ? "CLI codex não encontrado" : support === "unauthenticated" ? "execute codex login nesta máquina" : "stream e modelos funcionam, mas todos os tipos de evento ainda precisam de certificação real por versão do CLI",
      capabilities: {
        permissionMode: agentPermissionMode(), stream: "delta", tools: true, thinking: true, plans: false, subagents: true,
        nativeSessions: true, nativeResume: true, files: true, diffs: true, usage: true,
        cost: "estimated_api_equivalent", attachments: ["text", "file", "image"],
        commands: true, skills: true, mcp: true, oneShot: true, remote: true,
        modelCatalog: "runtime", modelControl: "per_turn", sessionContinuity: "native_id", toolLifecycle: "full",
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
    if (opts?.managed) args.push(...managedAdapterSecurityArgs(this.name, opts.managed));
    else if (fullAccess()) args.push("--dangerously-bypass-approvals-and-sandbox");
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
    let rawUsage: any;
    const beforeTelemetry = prev ? codexThreadTelemetry(prev) : undefined;
    const beforeRollout = prev ? codexThreadFile(prev) : undefined;
    let streamError = "";
    const seen = new Map<string, string>(); // allow started -> completed/failed; reject duplicate frames
    const childSeen = new Map<string, { activities: number; state: string; usage: string }>();
    const scanStartedAt = Date.now() - 5_000;
    let patchFile = beforeRollout;
    let patchOffset = beforeRollout ? (() => { try { return statSync(beforeRollout).size; } catch { return 0; } })() : 0;
    let patchCarry = "";
    let patchDecoder = new StringDecoder("utf8");
    const patchSeen = new Set<string>();
    const emitPatches = (flush = false): void => {
      if (!onEvent || !(threadId || prev)) return;
      const candidate = patchFile || codexThreadFile(threadId || prev);
      if (!candidate) return;
      if (!patchFile) { patchFile = candidate; patchOffset = 0; patchCarry = ""; patchDecoder = new StringDecoder("utf8"); }
      const appended = codexRolloutAppend(candidate, patchOffset); patchOffset = appended.offset;
      if (appended.reset) { patchCarry = ""; patchDecoder = new StringDecoder("utf8"); }
      const combined = patchCarry + patchDecoder.write(appended.data) + (flush ? patchDecoder.end() : "");
      const lines = combined.split(/\r?\n/);
      patchCarry = flush ? "" : (lines.pop() || "");
      for (const ev of codexPatchEventsFromLines(lines, scanStartedAt)) {
        const key = String(ev.toolId || `${ev.path}:${ev.adds || 0}:${ev.dels || 0}`);
        if (patchSeen.has(key)) continue;
        patchSeen.add(key); onEvent(ev);
      }
    };
    const emitChildren = (): void => {
      if (!onEvent || !(threadId || prev)) return;
      for (const child of codexChildRollouts(threadId || prev!, { sinceMs: scanStartedAt })) {
        const before = childSeen.get(child.id);
        if (!before) onEvent({ kind: "execution_spawn", providerId: child.id, node: { title: child.title, role: child.role || child.nickname, depth: child.depth, startedAt: child.startedAt, kind: "agent" } });
        for (let i = before?.activities || 0; i < child.activities.length; i++) onEvent({ kind: "execution_activity", providerId: child.id, event: { ...child.activities[i], providerEvent: `snapshot:${i}` } });
        const usageKey = JSON.stringify(child.usage || null);
        if (child.usage && usageKey !== before?.usage) onEvent({ kind: "execution_usage", providerId: child.id, usage: { ...child.usage, costKind: child.usage.costKind || "tokens_only", source: child.usage.source || "Codex child rollout" }, measure: "cumulative", scope: "self" });
        if (child.state !== "running" && child.state !== before?.state) onEvent({ kind: "execution_state", providerId: child.id, state: child.state, summary: child.summary, at: child.endedAt });
        childSeen.set(child.id, { activities: child.activities.length, state: child.state, usage: usageKey });
      }
    };
    let activityTimer: ReturnType<typeof setInterval> | undefined;
    const emitActivity = (): void => { emitChildren(); emitPatches(); };
    const startActivityPolling = (): void => {
      if (!onEvent || activityTimer || !(threadId || prev)) return;
      emitActivity(); activityTimer = setInterval(emitActivity, 750); activityTimer.unref?.();
    };

    const emitItem = (it: any, isCompleted: boolean): void => {
      const id = String(it?.id ?? "");
      const isAgentMsg = it?.type === "agent_message";
      const { events, text } = codexItemToEvents(it, isCompleted);
      if (!events.length) return;
      if (text) finalParts.push(text);
      for (const e of events) {
        const key = String(e.toolId || id || `${it?.type}:${e.path || e.name || ""}`);
        const phase = String(e.status || (isCompleted ? "completed" : "started"));
        if (!isAgentMsg && key && seen.get(key) === phase) continue;
        if (!isAgentMsg && key) seen.set(key, phase);
        onEvent?.(e);
      }
    };

    const handleLine = (line: string): void => {
      let o: any; try { o = JSON.parse(line); } catch { return; }
      switch (o.type) {
        case "thread.started": if (o.thread_id) { threadId = o.thread_id; startActivityPolling(); } break;
        case "turn.completed": if (o.usage) rawUsage = o.usage; break;
        case "turn.failed": case "error": streamError = o.error?.message || o.message || streamError; break;
        case "item.started": emitItem(o.item, false); break;
        case "item.completed": emitItem(o.item, true); break;
      }
    };

    // Streaming when the caller wants live activity; plain capture-then-parse for internal one-offs.
    // Either way the SAME handleLine parses the SAME NDJSON — so thread id, final text and usage come
    // out identically; onEvent is simply absent (a no-op) on the non-streaming path.
    if (prev) startActivityPolling();
    let out = "";
    try {
      out = onEvent
        ? await runStream("codex", args, cwd, text, handleLine, opts?.signal)
        : await run("codex", args, cwd, text, opts?.signal);
    } finally {
      if (activityTimer) clearInterval(activityTimer);
      emitChildren();
      emitPatches(true);
    }
    if (!onEvent) for (const line of out.split("\n")) { const t = line.trim(); if (t) handleLine(t); }

    const afterTelemetry = codexThreadTelemetry(threadId || prev);
    if (rawUsage) usage = codexUsage(rawUsage, beforeTelemetry?.total, afterTelemetry);
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
  textMode?: "delta" | "snapshot";
  providerEvent?: string;
}

function textOf(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => typeof part === "string" ? part : (part?.type === "text" ? part.text : part?.text) || "").join("");
  return typeof value?.text === "string" ? value.text : "";
}

function tokenUsage(value: any, source: string, costKind: CostKind = "tokens_only"): AgentReply["usage"] | undefined {
  const u = value?.usage || value?.stats || value;
  if (!u || typeof u !== "object") return undefined;
  let input = Number(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokens ?? u.input ?? 0) || 0;
  let cached = Number(u.cached_input_tokens ?? u.cachedInputTokens ?? u.cached_tokens ?? 0) || 0;
  let output = Number(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.completionTokens ?? u.output ?? 0) || 0;
  if (!input && !output) {
    const nested = Array.isArray(u.models) ? u.models : (u.models && typeof u.models === "object" ? Object.values(u.models) : []);
    for (const item of nested) {
      const child = tokenUsage(item, source, costKind);
      input += child?.inputTokens || 0; cached += child?.cachedInputTokens || 0; output += child?.outputTokens || 0;
    }
  }
  if (!input && !output && u.cost == null && u.cost_usd == null) return undefined;
  const rawCost = Number(u.cost_usd ?? u.costUsd ?? u.cost);
  const costUsd = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : undefined;
  const resolvedKind: CostKind = costUsd == null ? "tokens_only" : (costKind === "tokens_only" ? "estimated_api_equivalent" : costKind);
  return { inputTokens: input || undefined, cachedInputTokens: cached || undefined, contextTokens: input || undefined, outputTokens: output || undefined, costUsd, costKind: resolvedKind, source };
}

/** Collapse provider-specific tool spellings into the vocabulary understood identically by chat,
 * history and the Files menu. Unknown names remain visible instead of being guessed. */
export function normalizeToolName(name: string): string {
  const raw = String(name || "Tool").replace(/ToolCall$/i, "");
  const key = raw.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const aliases: Record<string, string> = {
    read: "Read", readfile: "Read", viewfile: "Read", getfile: "Read",
    write: "Write", writefile: "Write", createfile: "Write",
    edit: "Edit", editfile: "Edit", replace: "Edit", replaceinfile: "Edit", updatefile: "Edit", applypatch: "Edit", patch: "Edit",
    multiedit: "MultiEdit", notebookedit: "NotebookEdit",
    grep: "Grep", searchfiles: "Grep", findinfiles: "Grep",
    glob: "Glob", listfiles: "Glob", findfiles: "Glob",
    shell: "Bash", command: "Bash", executecommand: "Bash", runcommand: "Bash", terminal: "Bash", exec: "Bash", bash: "Bash",
    websearch: "WebSearch", searchweb: "WebSearch", webfetch: "WebFetch", fetchurl: "WebFetch",
    task: "Task", agent: "Agent", subagent: "Agent",
  };
  return aliases[key] || raw || "Tool";
}

function toolEvent(name: string, args: any, id?: string, status: StreamEvent["status"] = "started", error?: string, providerEvent?: string): StreamEvent {
  const normalized = normalizeToolName(name);
  const rawArgs = args && typeof args === "object" ? { ...args } : (normalized === "Bash" ? { command: String(args || "") } : {});
  const explicitPath = String(rawArgs.file_path || rawArgs.path || rawArgs.filename || rawArgs.file || rawArgs.notebook_path || "") || undefined;
  const normalizedArgs = explicitPath && !rawArgs.file_path ? { ...rawArgs, file_path: explicitPath } : rawArgs;
  if (normalized === "Bash" && !normalizedArgs.command && normalizedArgs.cmd) normalizedArgs.command = normalizedArgs.cmd;
  if (normalized === "Grep" && !normalizedArgs.pattern) normalizedArgs.pattern = normalizedArgs.query || normalizedArgs.regex;
  if (normalized === "Glob" && !normalizedArgs.pattern) normalizedArgs.pattern = normalizedArgs.glob || explicitPath;
  const stat = fileToolStat(normalized, normalizedArgs);
  const explicitAdds = Number(normalizedArgs?.adds ?? normalizedArgs?.additions), explicitDels = Number(normalizedArgs?.dels ?? normalizedArgs?.deletions);
  return { kind: "tool", name: normalized, summary: toolSummary(normalized, normalizedArgs), detail: toolDetail(normalized, normalizedArgs), toolId: id, status, error, providerEvent,
    path: explicitPath || stat.path,
    adds: Number.isFinite(explicitAdds) ? explicitAdds : stat.adds,
    dels: Number.isFinite(explicitDels) ? explicitDels : stat.dels,
    rows: Array.isArray(args?.rows) ? args.rows : stat.rows as any };
}

/** Pure provider parsers. Unknown fields/types are ignored, never promoted to invented progress. */
export function parseGeminiCliEvent(o: any): StructuredCliEvent {
  if (o?.type === "init") return { sessionId: o.session_id || o.sessionId, providerEvent: "init" };
  if (o?.type === "message" && (o.role === "assistant" || o.message?.role === "assistant")) return { text: textOf(o.content ?? o.message?.content ?? o.message), textMode: o.partial ? "snapshot" : "delta", providerEvent: "message" };
  if (o?.type === "tool_use") { const name = String(o.tool_name || o.name || "Tool"); return { events: [toolEvent(name, o.parameters || o.args || o.input, o.tool_id || o.id, "started", undefined, "tool_use")], providerEvent: "tool_use" }; }
  if (o?.type === "tool_result") {
    const name = String(o.tool_name || o.name || "Tool"), error = o.error ? String(o.error?.message || o.error) : undefined;
    return { events: [toolEvent(name, o.parameters || o.args || o.input || {}, o.tool_id || o.id, error ? "failed" : "completed", error, "tool_result")], providerEvent: "tool_result" };
  }
  if (o?.type === "error") return { error: String(o.error?.message || o.message || o.error || "Gemini CLI error") };
  if (o?.type === "result") return { finalText: String(o.response ?? o.result ?? ""), usage: tokenUsage(o.stats || o.usage, "gemini stream-json"), providerEvent: "result" };
  return {};
}

export function parseCursorCliEvent(o: any): StructuredCliEvent {
  if (o?.type === "system" && o.subtype === "init") return { sessionId: o.session_id };
  if (o?.type === "assistant") return { text: textOf(o.message?.content ?? o.content) };
  if (o?.type === "tool_call" && o.subtype === "started") {
    const body = o.tool_call || {}; const key = Object.keys(body)[0] || "Tool"; const call = body[key] || {};
    return { events: [toolEvent(key.replace(/ToolCall$/i, ""), call.args || call, o.call_id, "started", undefined, "tool_call.started")], providerEvent: "tool_call.started" };
  }
  if (o?.type === "tool_call" && o.subtype === "completed") {
    const body = o.tool_call || {}; const key = Object.keys(body)[0] || "Tool"; const call = body[key] || {};
    const failed = call.result?.error || call.error; const error = failed ? String(failed?.message || failed) : undefined;
    return { events: [toolEvent(key.replace(/ToolCall$/i, ""), call.args || call, o.call_id, error ? "failed" : "completed", error, "tool_call.completed")], providerEvent: "tool_call.completed" };
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
  return { events, text: isText ? String(o.text || "") : undefined, textMode: o.partial ? "snapshot" : "delta", sessionId: o.session_id || o.taskId, usage: tokenUsage(o.usage, "cline --json"), providerEvent: `${o?.type || "unknown"}${o?.say ? "." + o.say : ""}` };
}

export function parseQwenCliEvent(o: any): StructuredCliEvent {
  const pe = o?.event;
  if (pe?.type === "content_block_delta") {
    const delta = pe.delta || pe.content_block || {};
    if (delta.type === "text_delta" || typeof delta.text === "string") return { text: String(delta.text || ""), textMode: "delta", providerEvent: "content_block_delta" };
    if (delta.type === "thinking_delta") return { events: [{ kind: "thinking", providerEvent: "content_block_delta" }], providerEvent: "content_block_delta" };
  }
  if (pe?.type === "content_block_start" && pe.content_block?.type === "tool_use") {
    const b = pe.content_block; return { events: [toolEvent(String(b.name || "Tool"), b.input, b.id, "started", undefined, "content_block_start")], providerEvent: "content_block_start" };
  }
  if (pe?.type === "content_block_stop" && (pe.content_block?.type === "tool_use" || pe.tool_use_id)) {
    const b = pe.content_block || {}; return { events: [toolEvent(String(b.name || "Tool"), b.input, b.id || pe.tool_use_id, "completed", undefined, "content_block_stop")], providerEvent: "content_block_stop" };
  }
  if (o?.type === "system" && /session_start|init/.test(String(o.subtype))) return { sessionId: o.session_id || o.uuid };
  if (o?.type === "assistant" || (o?.type === "message" && o.message?.role === "assistant")) {
    const message = o.message || o;
    const events: StreamEvent[] = [];
    for (const part of (Array.isArray(message.content) ? message.content : [])) if (part?.type === "tool_use") events.push(toolEvent(String(part.name || "Tool"), part.input, part.id));
    return { events, text: textOf(message.content), textMode: o.partial ? "snapshot" : "delta", usage: tokenUsage(message.usage, "qwen stream-json"), providerEvent: "assistant" };
  }
  if (o?.type === "result") return { sessionId: o.session_id, finalText: String(o.result || ""), error: o.is_error ? String(o.result || "Qwen Code error") : undefined, usage: tokenUsage(o.usage, "qwen stream-json") };
  return {};
}

export function parseGenericJsonlEvent(o: any, source: string, billedCost = false): StructuredCliEvent {
  const sessionId = o?.session_id || o?.sessionID || o?.sessionId;
  const type = String(o?.type || ""), subtype = String(o?.subtype || o?.status || o?.part?.state?.status || "");
  if (type === "assistant" || o?.role === "assistant" || type === "text" || /assistant.*(delta|message)/i.test(type)) return { sessionId, text: textOf(o.message?.content ?? o.content ?? o.text ?? o.message ?? o.data?.content ?? o.part?.text), textMode: o.partial ? "snapshot" : "delta", usage: tokenUsage(o.usage, source, billedCost ? "billed" : "tokens_only"), providerEvent: type };
  if (/tool|command/i.test(type)) {
    const state = /fail|error/i.test(subtype) ? "failed" : /complete|success|done|result|output/i.test(subtype || type) ? "completed" : "started";
    const err = state === "failed" ? String(o.error?.message || o.error || o.part?.state?.error || "tool failed") : undefined;
    const name = String(o.name || o.tool || o.part?.tool || (/command/i.test(type) ? "Bash" : "Tool"));
    const fallback = { ...(o.command != null ? { command: o.command } : {}), ...(o.path != null ? { path: o.path } : {}) };
    return { sessionId, events: [toolEvent(name, o.args || o.input || o.part?.state?.input || fallback, o.call_id || o.callId || o.part?.callID || o.id, state, err, `${type}${subtype ? "." + subtype : ""}`)], providerEvent: type };
  }
  if (type === "result" || type === "done" || type === "task_complete" || /step[_-]?finish/i.test(type)) return { sessionId, finalText: String(o.result || o.text || o.message || ""), error: o.is_error ? String(o.error || o.result || "agent error") : undefined, usage: tokenUsage(o.usage || o.stats || o.part, source, billedCost ? "billed" : "tokens_only"), providerEvent: type };
  if (type === "error") return { sessionId, error: String(o.error?.message || o.message || o.error || "agent error"), providerEvent: type };
  return { sessionId };
}

export function parseCopilotCliEvent(o: any): StructuredCliEvent {
  return parseGenericJsonlEvent(o, "copilot --output-format=json");
}

export function parseOpenCodeCliEvent(o: any): StructuredCliEvent {
  const part = o?.part;
  if (o?.type === "text" && part?.type === "text") return { sessionId: o.sessionID || part.sessionID, text: String(part.text || ""), textMode: "delta", providerEvent: "text" };
  if (o?.type === "tool_use" && part?.type === "tool") {
    const status = /fail|error/i.test(String(part.state?.status)) ? "failed" : /complete|success|done/i.test(String(part.state?.status)) ? "completed" : "started";
    const error = status === "failed" ? String(part.state?.error || "tool failed") : undefined;
    return { sessionId: o.sessionID || part.sessionID, events: [toolEvent(String(part.tool || "Tool"), part.state?.input || {}, part.callID || part.id, status, error, `tool_use.${part.state?.status || "started"}`)], providerEvent: "tool_use" };
  }
  if (o?.type === "step_finish" || part?.type === "step-finish") return { sessionId: o.sessionID || part?.sessionID, usage: tokenUsage(part || o, "opencode run --format json"), providerEvent: "step_finish" };
  return parseGenericJsonlEvent(o, "opencode run --format json");
}

/** GitHub documents `copilot help` as the account-aware source of model strings. Keep parsing
 * deliberately narrow: only values in the --model option block and known provider-style slugs. */
export function parseCopilotHelpModels(help: string): ModelInfo[] {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((line) => /--model(?:=|\s)/.test(line));
  if (start < 0) return [];
  const block: string[] = [];
  for (let i = start; i < Math.min(lines.length, start + 14); i++) {
    if (i > start && /^\s{0,3}--[a-z]/i.test(lines[i])) break;
    block.push(lines[i]);
  }
  const found = block.join(" ").match(/\b(?:auto|gpt-[a-z0-9._-]+|claude-[a-z0-9._-]+|gemini-[a-z0-9._-]+|mai-[a-z0-9._-]+|raptor-[a-z0-9._-]+|kimi-[a-z0-9._-]+)\b/gi) || [];
  return [...new Set(found.map((id) => id.toLowerCase()))].map((id) => ({ id, label: id, efforts: [], effortsVerified: false, source: "cli" as const }));
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
    if (opts?.managed) managedAdapterSecurityArgs(this.name, opts.managed);
    validateModelSelection(await this.capabilities(), opts);
    const nativeContinuity = this.spec.capabilities.sessionContinuity === "native_id";
    const previous = nativeContinuity ? this.sessions.get(sessionId) : undefined;
    const effectiveText = this.spec.capabilities.sessionContinuity === "jarvis_history" ? withManagedHistory(text, opts?.history) : text;
    const args = this.spec.args(effectiveText, cwd, previous, opts);
    const parts: string[] = [];
    let snapshot = "", finalText = "", nativeId = previous, usage: AgentReply["usage"], failure = "";
    const handle = (line: string): void => {
      let parsed: any; try { parsed = JSON.parse(line); } catch { return; }
      if ((EXECUTION_ADAPTER_IDS as readonly string[]).includes(this.spec.id)) {
        for (const event of mapProviderExecutionFixture(this.spec.id as ExecutionAdapterId, parsed)) onEvent?.(event);
      }
      const item = this.spec.parser(parsed);
      if (item.sessionId) nativeId = item.sessionId;
      if (item.usage) usage = item.usage;
      if (item.error) failure = item.error;
      for (const event of item.events || []) onEvent?.(event);
      if (item.text) {
        // Snapshot/delta is provider-declared. Guessing from prefix equality corrupts legitimate
        // deltas that happen to start like the accumulated text.
        const chunk = item.textMode === "snapshot"
          ? (item.text.startsWith(snapshot) ? item.text.slice(snapshot.length) : item.text)
          : item.text;
        snapshot = item.textMode === "snapshot" ? item.text : snapshot + item.text;
        if (chunk) { parts.push(chunk); onEvent?.({ kind: "text", text: chunk, providerEvent: item.providerEvent }); }
      }
      if (item.finalText) finalText = item.finalText;
    };
    const out = onEvent
      ? await runStream(this.spec.command, args, cwd, "", handle, opts?.signal)
      : await run(this.spec.command, args, cwd, "", opts?.signal);
    if (!onEvent) for (const line of out.split(/\r?\n/)) if (line.trim()) handle(line);
    if (failure && !finalText && !parts.length) throw new Error(failure);
    if (nativeContinuity && !sessionId.startsWith("__oneshot_") && nativeId && nativeId !== previous) { this.sessions.set(sessionId, nativeId); this.saveSessions(); }
    if (usage && !usage.model) usage.model = opts?.model;
    return { text: (finalText || parts.join("") || out).trim(), usage };
  }
  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> { return this.send(`__oneshot_${randomUUID()}`, text, ONESHOT_CWD, opts); }
}

const structuredCaps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
  ...LIMITED_CAPABILITIES, permissionMode: agentPermissionMode(), stream: "delta", tools: true, nativeSessions: true, nativeResume: true,
  files: true, attachments: ["text", "file", "image"], oneShot: true, remote: true,
  modelCatalog: "provider_dynamic", modelControl: "per_turn", sessionContinuity: "native_id", toolLifecycle: "start_only", ...over,
});

export function buildGeminiArgs(text: string, _cwd: string, sid?: string, opts?: SendOpts): string[] { const a = ["--output-format", "stream-json"]; if (fullAccess()) a.push("--yolo"); if (sid) a.push("--resume", sid); const model = safeProviderValue(opts?.model); if (model) a.push("--model", model); a.push("--prompt", text); return a; }
export function buildCursorArgs(text: string, _cwd: string, sid?: string, opts?: SendOpts): string[] { const a = ["--print", "--output-format", "stream-json"]; if (fullAccess()) a.push("--force"); if (sid) a.push("--resume", sid); const model = safeProviderValue(opts?.model); if (model) a.push("--model", model); a.push(text); return a; }
export function buildCopilotArgs(text: string, cwd: string, sid?: string, opts?: SendOpts): string[] { const a = ["--prompt", text, "--output-format=json", "--stream=on", "--no-ask-user", "-C", cwd]; if (fullAccess()) a.push("--yolo"); if (sid) a.push(`--resume=${sid}`); const model = safeProviderValue(opts?.model), effort = safeIdent(opts?.effort); if (model) a.push(`--model=${model}`); if (effort) a.push(`--effort=${effort}`); return a; }
export function buildOpenCodeArgs(text: string, _cwd: string, sid?: string, opts?: SendOpts): string[] { const a = ["run", "--format", "json"]; if (fullAccess()) a.push("--auto"); if (sid) a.push("--session", sid); const model = safeProviderValue(opts?.model), effort = safeProviderValue(opts?.effort); if (model) a.push("--model", model); if (effort) a.push("--variant", effort); a.push(text); return a; }
export function buildClineArgs(text: string, cwd: string, _sid?: string, opts?: SendOpts): string[] { const a = ["--json", "--auto-approve", fullAccess() ? "true" : "false", "--cwd", cwd]; const model = safeProviderValue(opts?.model), effort = safeIdent(opts?.effort); if (model) a.push("--model", model); if (effort) a.push("--thinking", effort); a.push(text); return a; }
export function buildQwenArgs(text: string, _cwd: string, sid?: string, opts?: SendOpts): string[] { const a = ["--output-format", "stream-json", "--include-partial-messages", "--approval-mode", fullAccess() ? "yolo" : "default"]; if (sid) a.push("--resume", sid); const model = safeProviderValue(opts?.model); if (model) a.push("--model", model); a.push("--prompt", text); return a; }
export function buildContinueArgs(text: string, opts?: SendOpts): string[] { const a = ["-p", text, "--format", "json"]; if (fullAccess()) a.push("--auto"); const model = safeProviderValue(opts?.model); if (model) a.push("--model", model); return a; }
export function buildKiroArgs(text: string, opts?: SendOpts): string[] { const a = ["chat", "--no-interactive"]; if (fullAccess()) a.push("--trust-all-tools"); const effort = safeIdent(opts?.effort); if (effort) a.push("--effort", effort); a.push(text); return a; }

export class GeminiCliAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "gemini", label: "Google Gemini CLI", command: "gemini", parser: parseGeminiCliEvent, source: "gemini stream-json", capabilities: structuredCaps({ usage: true, mcp: true, commands: true, skills: true, toolLifecycle: "full" }), args: buildGeminiArgs }); }
}
export class CursorAgentAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "cursor", label: "Cursor Agent", command: "cursor-agent", parser: parseCursorCliEvent, source: "cursor stream-json", capabilities: structuredCaps({ thinking: false, usage: false, toolLifecycle: "full" }), args: buildCursorArgs }); }
}
export class CopilotCliAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "copilot", label: "GitHub Copilot CLI", command: "copilot", parser: parseCopilotCliEvent, source: "copilot JSONL", capabilities: structuredCaps({ usage: true, mcp: true, skills: true, modelCatalog: "runtime" }), args: buildCopilotArgs }); }
  override async capabilities(): Promise<AgentCaps> {
    try {
      const out = await run("copilot", ["help"], homedir(), "");
      const models = parseCopilotHelpModels(out);
      return { models, defaultModel: models.find((m) => m.id === process.env.COPILOT_MODEL)?.id, autoModel: true };
    } catch { return { models: [], autoModel: true }; }
  }
}
export class OpenCodeAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "opencode", label: "OpenCode", command: "opencode", parser: parseOpenCodeCliEvent, source: "opencode JSON", capabilities: structuredCaps({ usage: true, cost: "estimated_api_equivalent", mcp: true, commands: true, skills: true, modelCatalog: "runtime", toolLifecycle: "full" }), args: buildOpenCodeArgs }); }
  override async capabilities(): Promise<AgentCaps> {
    try {
      const out = await run("opencode", ["models"], homedir(), "");
      const models = out.split(/\r?\n/).map((id) => id.trim()).filter((id) => /^[^\s/]+\/[^\s]+$/.test(id)).map((id) => ({ id, label: id, efforts: [] }));
      return { models, autoModel: true };
    } catch { return { models: [], autoModel: true }; }
  }
}
export class ClineCliAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "cline", label: "Cline CLI", command: "cline", parser: parseClineCliEvent, source: "cline --json", capabilities: structuredCaps({ thinking: true, usage: false, mcp: true, skills: true, nativeSessions: false, nativeResume: false, sessionContinuity: "jarvis_history", modelCatalog: "configured" }), args: buildClineArgs }); }
}
export class QwenCodeAdapter extends StructuredCliAdapter {
  constructor() { super({ id: "qwen", label: "Qwen Code", command: "qwen", parser: parseQwenCliEvent, source: "qwen stream-json", capabilities: structuredCaps({ thinking: true, usage: true, plans: true, subagents: true, mcp: true, skills: true, toolLifecycle: "full", modelCatalog: "configured" }), args: buildQwenArgs }); }
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
  constructor(readonly name: string, private label: string, private command: string, private args: (text: string, opts?: SendOpts) => string[], protected declaredCapabilities: AgentCapabilities) {}
  async capabilities(): Promise<AgentCaps> { return { models: [], autoModel: true }; }
  async available(): Promise<boolean> { return !!(await cliVersion(this.command)); }
  async send(_sessionId: string, text: string, cwd: string, opts?: SendOpts): Promise<AgentReply> {
    if (opts?.managed) managedAdapterSecurityArgs(this.name, opts.managed);
    if (opts?.model && this.declaredCapabilities.modelControl !== "per_turn") throw new Error(`o agente ${this.name} não permite selecionar modelo por turno; configure o modelo na própria CLI`);
    validateModelSelection(await this.capabilities(), opts);
    const prompt = this.declaredCapabilities.sessionContinuity === "jarvis_history" ? withManagedHistory(text, opts?.history) : text;
    return { text: finalOnlyText(await run(this.command, this.args(prompt, opts), cwd, "", opts?.signal)) };
  }
  async descriptor(): Promise<AgentDescriptor> { const version = await cliVersion(this.command); return makeDescriptor({ id: this.name, label: this.label, command: this.command, version, support: version ? "limited" : "not_installed", reason: version ? "execução headless disponível, mas o fornecedor não expõe lifecycle estruturado de ferramentas" : `CLI ${this.command} não encontrado`, capabilities: this.declaredCapabilities, caps: await this.capabilities() }); }
}
const finalToolCaps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
  ...LIMITED_CAPABILITIES, permissionMode: agentPermissionMode(), tools: true, files: true, oneShot: true, remote: true,
  modelCatalog: "configured", modelControl: "per_turn", sessionContinuity: "jarvis_history", toolLifecycle: "unobservable", ...over,
});
export class ContinueCliAdapter extends LimitedFinalCliAdapter {
  constructor() { super("continue", "Continue CLI", "cn", buildContinueArgs, finalToolCaps({ mcp: true, skills: true, commands: true })); }
}
export class KiroCliAdapter extends LimitedFinalCliAdapter {
  constructor() { super("kiro", "Kiro CLI", "kiro-cli", buildKiroArgs, finalToolCaps({ modelCatalog: "runtime", modelControl: "configuration_only", mcp: true, skills: true, commands: true })); }
  override async capabilities(): Promise<AgentCaps> {
    try {
      const raw = await run("kiro-cli", ["chat", "--list-models", "--format", "json"], homedir(), "");
      const parsed = JSON.parse(raw); const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.models) ? parsed.models : [];
      const models = items.map((x: any): ModelInfo => typeof x === "string" ? { id: x, label: x, efforts: [], selectable: false, source: "cli" } : {
        id: String(x.id || x.modelId || x.name || ""), label: String(x.label || x.displayName || x.name || x.id || ""),
        efforts: Array.isArray(x.efforts || x.supportedEfforts) ? [...(x.efforts || x.supportedEfforts)] : [], effortsVerified: false,
        selectable: false, source: "cli" as const,
      }).filter((x: ModelInfo) => !!x.id);
      return { models, autoModel: true };
    } catch { return { models: [], autoModel: true }; }
  }
}
export class AntigravityCliAdapter extends LimitedFinalCliAdapter {
  constructor() { super("antigravity", "Google Antigravity CLI", "agy", (text) => [text], { ...LIMITED_CAPABILITIES, tools: true, files: true, diffs: true, plans: true, subagents: false, mcp: true, skills: true, commands: true, oneShot: false, remote: false, modelCatalog: "none", modelControl: "none", sessionContinuity: "none", toolLifecycle: "unobservable" }); }
  override async available(): Promise<boolean> { return false; }
  override async send(): Promise<AgentReply> { throw new Error("Antigravity CLI não expõe um modo headless estruturado verificável; use o TUI agy diretamente"); }
  override async descriptor(): Promise<AgentDescriptor> { const version = await cliVersion("agy"); return makeDescriptor({ id: this.name, label: "Google Antigravity CLI", command: "agy", version, support: version ? "limited" : "not_installed", reason: version ? "TUI e transcripts detectáveis, mas sem envio headless público; execução pelo Jarvis permanece desativada" : "CLI agy não encontrado", capabilities: this.declaredCapabilities, caps: await this.capabilities() }); }
}

// ---------------------------------------------------------------------------

/**
 * Aider (https://aider.chat) — a pluggable, final-only agent running one headless message per turn.
 * It remains explicitly LIMITED; the structured adapters above are the template for live parity.
 *
 * WRITTEN TO SPEC — VERIFY ON FIRST RUN (it was authored without a local `aider` to test against):
 *  - Requires `aider` on PATH and a model key in the env / ~/.aider.conf.yml (aider picks the provider).
 *  - Runs inside a git repo (aider expects one); a non-repo cwd may make it warn/refuse.
 *  - CONTINUITY is injected from the bounded Jarvis session history. We intentionally do NOT use
 *    aider's cwd-global `--restore-chat-history`, which would mix two Jarvis sessions in one repo.
 *  - No streaming/tool events yet (final text only).
 *  - The configured model (AIDER_MODEL or top-level ~/.aider.conf.yml `model:`) is discoverable;
 *    the full provider-spanning catalog remains dynamic and is never hardcoded.
 * Flags used: --message (one-shot), --yes-always (auto-confirm), --no-stream + --no-pretty (clean
 * stdout capture), --model (optional). Adjust here if a flag
 * name differs in your aider version.
 */
export class AiderAdapter implements AgentAdapter {
  readonly name = "aider";
  async capabilities(): Promise<AgentCaps> {
    const configured = aiderConfiguredModel();
    return { models: configured ? [{ id: configured, label: configured, efforts: [], source: "config" }] : [], defaultModel: configured, autoModel: !configured };
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
    const mf = tempTextFile("jarvis_aider", withManagedHistory(text, opts?.history));
    try {
      const args = buildAiderInvocationArgs(mf.path, opts);
      const out = await run("aider", args, cwd, "", opts?.signal);
      return { text: out.trim() };
    } finally { mf.cleanup(); }
  }
  async oneShot(text: string, opts?: SendOpts): Promise<AgentReply> {
    // stateless throwaway (no history restore, no commits) in the excluded oneshot dir
    const mf = tempTextFile("jarvis_aider", text);
    try {
      const args = ["--message-file", mf.path, "--no-stream", "--no-pretty", "--no-auto-commits"]; if (fullAccess()) args.push("--yes-always");
      const model = safeProviderValue(opts?.model); if (model) args.push("--model", model);
      const out = await run("aider", args, ONESHOT_CWD, "");
      return { text: out.trim() };
    } finally { mf.cleanup(); }
  }
  async descriptor(): Promise<AgentDescriptor> {
    const version = await cliVersion("aider");
    return makeDescriptor({
      id: this.name, label: "Aider", command: "aider", version,
      support: version ? "limited" : "not_installed",
      reason: version ? "continuidade isolada pelo Jarvis; saída final sem lifecycle estruturado ou usage verificável" : "CLI aider não encontrado",
      capabilities: finalToolCaps({ modelCatalog: "configured" }), caps: await this.capabilities(), source: "config",
    });
  }
}

export function aiderConfiguredModel(configText?: string): string | undefined {
  const envModel = safeProviderValue(process.env.AIDER_MODEL);
  if (envModel) return envModel;
  try {
    const text = configText ?? readFileSync(join(homedir(), ".aider.conf.yml"), "utf8");
    return safeProviderValue(/^\s*model\s*:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/m.exec(text)?.[1]);
  } catch { return undefined; }
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
    source: m.source || source,
    visibility: "public",
    contextTokens: m.context,
    efforts: [...m.efforts],
    defaultEffort: m.defaultEffort,
    effortsVerified: m.effortsVerified,
    contextVerified: m.contextVerified,
    selectable: m.selectable ?? opts.capabilities.modelControl === "per_turn",
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
    execution: (EXECUTION_ADAPTER_PROFILES as Partial<Record<string, import("./execution-adapters.js").CertifiedExecutionAdapterProfile>>)[opts.id],
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
      case "Read": return "Lendo " + (base(input?.file_path || input?.path) || "arquivo(s)");
      case "Write": return "Criando " + (base(input?.file_path || input?.path) || "arquivo");
      case "Edit": case "MultiEdit": case "NotebookEdit": return "Editando " + (base(input?.file_path || input?.path) || "arquivo");
      case "Grep": return "Buscando /" + String(input?.pattern || "").slice(0, 40) + "/";
      case "Glob": return "Listando " + String(input?.pattern || "");
      case "Task": case "Agent": return "Subagente: " + String(input?.description || input?.subagent_type || "").slice(0, 60);
      case "WebFetch": return "Abrindo " + String(input?.url || "").slice(0, 60);
      case "WebSearch": return "Pesquisando: " + String(input?.query || "").slice(0, 60);
      default: { const s = JSON.stringify(input || {}); return name + (s && s !== "{}" ? " " + s.slice(0, 60) : ""); }
    }
  } catch { return name; }
}
