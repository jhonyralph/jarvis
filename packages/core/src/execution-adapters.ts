import type {
  ExecutionAdapterProfile,
  ExecutionCapabilities,
  ExecutionCertification,
  ExecutionState,
  ExecutionTier,
  ProviderExecutionEvent,
  UsageRecord,
} from "@jarvis/protocol";

export const EXECUTION_ADAPTER_IDS = [
  "claude-code",
  "codex",
  "gemini",
  "cursor",
  "copilot",
  "opencode",
  "cline",
  "qwen",
  "continue",
  "kiro",
  "antigravity",
  "aider",
] as const;

export type ExecutionAdapterId = typeof EXECUTION_ADAPTER_IDS[number];

export interface CertifiedExecutionAdapterProfile extends ExecutionAdapterProfile {
  id: ExecutionAdapterId;
  label: string;
  /** Highest tier intended after an authenticated canary; never used as the current tier. */
  targetTier: ExecutionTier;
}

const cap = (overrides: Partial<ExecutionCapabilities>): ExecutionCapabilities => Object.freeze({
  source: "none",
  observe: "terminal_only",
  transcript: "none",
  tools: false,
  cancel: "none",
  steer: "none",
  retry: false,
  resume: false,
  input: "none",
  files: "none",
  usage: "none",
  asynchronous: false,
  dependencies: false,
  isolatedWorkspace: "unknown",
  ...overrides,
});

const profile = (
  id: ExecutionAdapterId,
  label: string,
  tier: ExecutionTier,
  targetTier: ExecutionTier,
  certification: ExecutionCertification,
  capabilities: ExecutionCapabilities,
  acquisitionSurface: string,
  reason: string,
): CertifiedExecutionAdapterProfile => Object.freeze({
  id,
  label,
  tier,
  targetTier,
  certification,
  capabilities,
  acquisitionSurface,
  reason,
});

/**
 * Truthful baseline for the execution-tree collectors implemented from fixtures.
 *
 * `targetTier` is planning metadata. Product behavior must use `tier`, `certification` and the
 * individual capability vector; a target never enables a control. Versions/hashes are attached by
 * the canary/certification store, not hardcoded here.
 */
export const EXECUTION_ADAPTER_PROFILES: Readonly<Record<ExecutionAdapterId, CertifiedExecutionAdapterProfile>> = Object.freeze({
  "claude-code": profile("claude-code", "Claude Code", "E3", "E5", "partial", cap({
    source: "native_stream", observe: "live", transcript: "published_only", tools: true,
    cancel: "root", files: "full", usage: "subtree", asynchronous: true,
    dependencies: true, isolatedWorkspace: "shared_cwd",
  }), "stream-json + sidechains/transcript", "lifecycle observável; controles por filho e reconciliação completa ainda exigem canary"),
  codex: profile("codex", "Codex", "E3", "E5", "partial", cap({
    source: "native_transcript", observe: "snapshot", transcript: "published_only", tools: true,
    cancel: "root", files: "full", usage: "self", asynchronous: true,
    dependencies: true, isolatedWorkspace: "unknown",
  }), "exec JSON + child rollouts", "rollouts-filhos são observáveis; controle e reconciliação headless multi-agent ainda não foram certificados"),
  gemini: profile("gemini", "Google Gemini CLI", "E3", "E3", "fixture_only", cap({
    source: "native_stream", observe: "live", transcript: "published_only", tools: true,
    cancel: "root", files: "metadata", usage: "self", asynchronous: true,
    maxDepth: 1, isolatedWorkspace: "shared_cwd",
  }), "stream-json + subagents nomeados", "fixture documentada; falta probe autenticado da versão instalada"),
  cursor: profile("cursor", "Cursor Agent", "E2", "E4", "fixture_only", cap({
    source: "native_stream", observe: "live", transcript: "published_only", tools: true,
    cancel: "root", files: "metadata", asynchronous: true,
    isolatedWorkspace: "shared_cwd",
  }), "CLI local stream-json", "lifecycle local mapeado por fixture; superfícies local e cloud precisam de certificações separadas"),
  copilot: profile("copilot", "GitHub Copilot CLI", "E2", "E5", "fixture_only", cap({
    source: "native_stream", observe: "live", transcript: "published_only", tools: true,
    cancel: "root", files: "metadata", usage: "self",
    asynchronous: true, dependencies: true, isolatedWorkspace: "shared_cwd",
  }), "CLI JSONL; SDK é superfície separada", "lifecycle derivado de fixture pública; controles SDK não são anunciados pelo adapter CLI"),
  opencode: profile("opencode", "OpenCode", "E3", "E5", "fixture_only", cap({
    source: "native_stream", observe: "live", transcript: "published_only", tools: true, cancel: "root",
    files: "metadata", usage: "self",
    asynchronous: true, dependencies: true, isolatedWorkspace: "shared_cwd",
  }), "run --format json; server/SDK é superfície futura", "o adapter atual não conecta os controles da API; anuncia apenas cancelamento do processo raiz"),
  cline: profile("cline", "Cline", "E3", "E5", "fixture_only", cap({
    source: "native_stream", observe: "live", transcript: "published_only", tools: true, cancel: "root",
    files: "metadata", usage: "self", asynchronous: true,
    dependencies: true, isolatedWorkspace: "unknown",
  }), "CLI --json; SDK é superfície futura", "Agent Teams e use_subagents têm semânticas distintas; o adapter CLI não anuncia controles SDK"),
  qwen: profile("qwen", "Qwen Code", "E3", "E5", "fixture_only", cap({
    source: "native_stream", observe: "live", transcript: "published_only", tools: true,
    cancel: "root", files: "metadata", usage: "self", asynchronous: true,
    dependencies: true, isolatedWorkspace: "shared_cwd",
  }), "stream-json + hooks/OTel/transcript", "fontes exigem deduplicação; falta probe autenticado e teste de reconciliação"),
  continue: profile("continue", "Continue CLI", "E1", "E5", "unverified", cap({
    source: "jarvis_managed", observe: "terminal_only", transcript: "summary_only", cancel: "root",
    files: "metadata", asynchronous: true, dependencies: true,
    isolatedWorkspace: "jarvis_worktree",
  }), "fallback Jarvis-managed", "nenhuma superfície nativa de filhos foi comprovada; usar somente o fallback gerenciado"),
  kiro: profile("kiro", "Kiro CLI", "E2", "E5", "fixture_only", cap({
    source: "native_api", observe: "snapshot", transcript: "published_only", tools: true,
    cancel: "root", files: "metadata", asynchronous: true,
    dependencies: true, isolatedWorkspace: "shared_cwd",
  }), "ACP JSON-RPC", "ACP precisa substituir o adapter final-only; /spawn isolado não prova delegated agent"),
  antigravity: profile("antigravity", "Google Antigravity", "E0", "E5", "unavailable", cap({
    reason: "não existe execução headless estruturada verificável no adapter atual",
  }), "nenhuma", "não anunciar execução branded nem raspar PTY/TUI sem contrato público verificável"),
  aider: profile("aider", "Aider", "E1", "E3", "unverified", cap({
    source: "jarvis_managed", observe: "terminal_only", transcript: "summary_only", cancel: "root",
    files: "full", asynchronous: true, dependencies: true,
    isolatedWorkspace: "jarvis_worktree",
  }), "fallback Jarvis-managed + --no-auto-commits", "sem lifecycle nativo de filhos; escrita deve permanecer isolada em worktree"),
});

export interface ExecutionCertificationObservation {
  adapterVersion?: string;
  providerVersion?: string;
  certificationHash?: string;
}

/** Compare a runtime/canary tuple with the tuple that produced the certification. */
export function isExecutionCertificationStale(
  certified: Pick<ExecutionAdapterProfile, "adapterVersion" | "providerVersion" | "certificationHash">,
  observed: ExecutionCertificationObservation,
): boolean {
  return (["adapterVersion", "providerVersion", "certificationHash"] as const)
    .some((key) => certified[key] !== undefined && observed[key] !== undefined && certified[key] !== observed[key]);
}

/** Return a copy downgraded to stale; baseline constants are never mutated. */
export function executionProfileForObservation<T extends ExecutionAdapterProfile>(
  certified: T,
  observed: ExecutionCertificationObservation,
): T {
  if (certified.certification === "unavailable" || certified.certification === "unverified"
    || !isExecutionCertificationStale(certified, observed)) return { ...certified, capabilities: { ...certified.capabilities } };
  const changed = (["adapterVersion", "providerVersion", "certificationHash"] as const)
    .filter((key) => certified[key] !== undefined && observed[key] !== undefined && certified[key] !== observed[key]);
  return {
    ...certified,
    capabilities: { ...certified.capabilities },
    certification: "stale",
    reason: `${certified.reason ? `${certified.reason}; ` : ""}certificação desatualizada: ${changed.join(", ")}`,
  };
}

const TIER_RANK: Record<ExecutionTier, number> = { E0: 0, E1: 1, E2: 2, E3: 3, E4: 4, E5: 5 };

/** Defensive catalog validation used by tests/reporting. */
export function executionAdapterProfileProblems(value: CertifiedExecutionAdapterProfile): string[] {
  const out: string[] = [];
  const capabilities = value.capabilities;
  if (!EXECUTION_ADAPTER_IDS.includes(value.id)) out.push("invalid adapter id");
  if (!value.label.trim()) out.push("missing label");
  if (TIER_RANK[value.targetTier] < TIER_RANK[value.tier]) out.push("target tier below current tier");
  if (value.tier === "E0" && capabilities.source !== "none") out.push("E0 must not advertise an acquisition source");
  if (value.tier !== "E0" && capabilities.source === "none") out.push("non-E0 requires an acquisition source");
  if (TIER_RANK[value.tier] >= 2 && !capabilities.asynchronous) out.push("E2+ requires asynchronous lifecycle");
  if (TIER_RANK[value.tier] >= 3 && (capabilities.observe === "terminal_only" || capabilities.transcript === "none")) out.push("E3+ requires observable transcript");
  if (TIER_RANK[value.tier] >= 4 && capabilities.cancel === "none" && capabilities.steer === "none"
    && !capabilities.retry && capabilities.input === "none") out.push("E4+ requires a verified control");
  if (TIER_RANK[value.tier] >= 5 && !capabilities.resume) out.push("E5 requires recovery/resume");
  return out;
}

type Json = Record<string, unknown>;

export interface ProviderFixtureContext {
  providerId?: string;
  parentProviderId?: string;
  depth?: number;
}

export type ProviderExecutionFixtureMapper = (value: unknown, context?: ProviderFixtureContext) => ProviderExecutionEvent[];

const object = (value: unknown): Json | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
const text = (...values: unknown[]): string | undefined => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
};
const finite = (...values: unknown[]): number | undefined => {
  for (const value of values) { const n = typeof value === "number" ? value : Number(value); if (Number.isFinite(n)) return n; }
  return undefined;
};
const providerId = (value: Json, context?: ProviderFixtureContext): string | undefined => text(
  value.providerId, value.provider_id, value.agentId, value.agent_id, value.taskId, value.task_id,
  value.sessionId, value.session_id, value.sessionID, value.id, context?.providerId,
);
const parentProviderId = (value: Json, context?: ProviderFixtureContext): string | undefined => text(
  value.parentProviderId, value.parent_provider_id, value.parentAgentId, value.parent_agent_id,
  value.parentTaskId, value.parent_task_id, value.parentSessionId, value.parent_session_id,
  value.parentID, value.parent_id, context?.parentProviderId,
);
const typeOf = (value: Json): string => text(value.type, value.event, value.name, value.method) || "";

const canonicalState = (value: unknown): ExecutionState | undefined => {
  const state = String(value || "").toLowerCase().replace(/[. -]+/g, "_");
  if (/^(created|pending|queued|idle)$/.test(state)) return "queued";
  if (/^(start|started|running|in_progress|active)$/.test(state)) return "running";
  if (/^(waiting|waiting_input|approval_required|input_required|blocked)$/.test(state)) return "waiting_input";
  if (/^(complete|completed|succeeded|success|done|finished)$/.test(state)) return "succeeded";
  if (/^(fail|failed|failure|error)$/.test(state)) return "failed";
  if (/^(cancel|cancelled|canceled|aborted|interrupted)$/.test(state)) return "cancelled";
  if (/^(orphaned|disconnected)$/.test(state)) return "orphaned";
  if (state === "unknown") return "unknown";
  return undefined;
};

function spawn(value: Json, context?: ProviderFixtureContext, overrides: Partial<Extract<ProviderExecutionEvent, { kind: "execution_spawn" }>["node"]> = {}): ProviderExecutionEvent[] {
  const id = providerId(value, context); if (!id) return [];
  const title = text(overrides.title, value.title, value.description, value.nickname, value.role, value.agent, "Subagente")!;
  return [{ kind: "execution_spawn", providerId: id, parentProviderId: parentProviderId(value, context), node: {
    title, kind: "agent", depth: finite(value.depth, context?.depth), role: text(overrides.role, value.role, value.agent_type, value.agentType),
    prompt: text(overrides.prompt, value.prompt, value.task), startedAt: finite(overrides.startedAt, value.startedAt, value.started_at), ...overrides,
  } }];
}

function state(value: Json, context?: ProviderFixtureContext, explicit?: unknown): ProviderExecutionEvent[] {
  const id = providerId(value, context), next = canonicalState(explicit ?? value.state ?? value.status);
  if (!id || !next) return [];
  return [{ kind: "execution_state", providerId: id, state: next, summary: text(value.summary, value.error, value.message), at: finite(value.at, value.timestamp) }];
}

function activity(value: Json, context?: ProviderFixtureContext): ProviderExecutionEvent[] {
  const id = providerId(value, context); if (!id) return [];
  const activityKind = String(value.activityKind ?? value.activity_kind ?? value.kind ?? "text");
  if (!/^(text|tool|thinking|plan)$/.test(activityKind)) return [];
  const activityState = canonicalState(value.status);
  const publishedText = typeof value.text === "string" && value.text.trim()
    ? value.text
    : typeof value.content === "string" && value.content.trim() ? value.content : undefined;
  return [{ kind: "execution_activity", providerId: id, event: {
    kind: activityKind as "text" | "tool" | "thinking" | "plan",
    text: publishedText, name: text(value.tool, value.tool_name), summary: text(value.summary),
    detail: text(value.detail), toolId: text(value.toolId, value.tool_id, value.callId, value.call_id),
    parentId: text(value.parentId, value.parent_id), path: text(value.path, value.file_path),
    adds: finite(value.adds, value.additions), dels: finite(value.dels, value.deletions),
    status: activityKind === "tool" ? (activityState === "failed" ? "failed" : activityState === "succeeded" ? "completed" : "started") : undefined,
    error: text(value.error), providerEvent: text(value.providerEvent, value.provider_event, typeOf(value)),
  } }];
}

function usage(value: Json, source: string, context?: ProviderFixtureContext): ProviderExecutionEvent[] {
  const id = providerId(value, context), raw = object(value.usage) || object(value.tokens) || value;
  if (!id || !raw) return [];
  const inputTokens = finite(raw.inputTokens, raw.input_tokens, raw.prompt_tokens);
  const cachedInputTokens = finite(raw.cachedInputTokens, raw.cached_input_tokens, raw.cached_tokens);
  const outputTokens = finite(raw.outputTokens, raw.output_tokens, raw.completion_tokens);
  const costUsd = finite(raw.costUsd, raw.cost_usd);
  if (inputTokens === undefined && outputTokens === undefined && costUsd === undefined) return [];
  const record: UsageRecord = { inputTokens, cachedInputTokens, outputTokens, costUsd,
    costKind: costUsd === undefined ? "tokens_only" : "estimated_api_equivalent", source };
  return [{ kind: "execution_usage", providerId: id, usage: record,
    measure: value.measure === "delta" ? "delta" : "cumulative", scope: value.scope === "subtree" ? "subtree" : "self" }];
}

const explicitLifecycle = (value: Json): "spawn" | "state" | "activity" | "usage" | undefined => {
  const type = typeOf(value).toLowerCase().replace(/[.:-]+/g, "_");
  if (/(?:subagent|child|agent|task|session)_(?:spawn|spawned|create|created|start|started)$/.test(type)) return "spawn";
  if (/(?:subagent|child|agent|task|session)_(?:state|status|complete|completed|fail|failed|cancel|cancelled|canceled|abort|aborted)$/.test(type)) return "state";
  if (/(?:subagent|child|agent|task|session)_(?:activity|message|tool|thinking|plan)$/.test(type)) return "activity";
  if (/(?:subagent|child|agent|task|session)_(?:usage|tokens)$/.test(type)) return "usage";
  return undefined;
};

function mapExplicit(value: unknown, source: string, context?: ProviderFixtureContext): ProviderExecutionEvent[] {
  const row = object(value); if (!row) return [];
  const lifecycle = explicitLifecycle(row);
  if (lifecycle === "spawn") return [...spawn(row, context), ...state(row, context, "running")];
  if (lifecycle === "state") return state(row, context, row.state ?? row.status ?? typeOf(row).split(/[.:-]/).at(-1));
  if (lifecycle === "activity") return activity(row, context);
  if (lifecycle === "usage") return usage(row, source, context);
  return [];
}

export const mapClaudeExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => {
  const row = object(value); if (!row) return [];
  const message = object(row.message); const content = Array.isArray(message?.content) ? message.content : Array.isArray(row.content) ? row.content : [];
  const parent = text(row.parent_tool_use_id, context?.parentProviderId);
  const out: ProviderExecutionEvent[] = [];
  for (const rawPart of content) {
    const part = object(rawPart); if (!part) continue;
    if (part.type === "tool_use" && /^(Task|Agent)$/i.test(String(part.name || ""))) {
      const input = object(part.input) || {};
      out.push(...spawn({ ...input, id: part.id, parentProviderId: parent }, context, {
        title: text(input.description, input.subagent_type, part.name, "Subagente Claude")!,
        role: text(input.subagent_type), prompt: text(input.prompt), kind: "agent",
      }), ...state({ id: part.id }, context, "running"));
    } else if (part.type === "tool_result" && part.tool_use_id) {
      out.push(...state({ id: part.tool_use_id, summary: typeof part.content === "string" ? part.content : undefined }, context, part.is_error ? "failed" : "succeeded"));
    } else if (parent && part.type === "text" && typeof part.text === "string") {
      out.push(...activity({ providerId: parent, kind: "text", text: part.text, providerEvent: "claude.sidechain.text" }, context));
    } else if (parent && part.type === "tool_use") {
      out.push(...activity({ providerId: parent, kind: "tool", tool: part.name, toolId: part.id,
        summary: text(object(part.input)?.description, part.name), status: "started", providerEvent: "claude.sidechain.tool_use" }, context));
    }
  }
  return out;
};

export const mapCodexExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => {
  const row = object(value); if (!row) return [];
  const payload = object(row.payload) || row;
  if (row.type === "session_meta" && payload.thread_source === "subagent") {
    const source = object(payload.source), subagent = object(source?.subagent), threadSpawn = object(subagent?.thread_spawn) || {};
    const agentPath = text(payload.agent_path);
    return spawn({ ...threadSpawn, id: payload.id, parentProviderId: payload.parent_thread_id,
      title: agentPath?.split(/[\\/]/).filter(Boolean).at(-1) || text(payload.agent_nickname, threadSpawn.agent_role, "Subagente Codex") }, context);
  }
  const id = text(payload.thread_id, payload.agent_id, context?.providerId); if (!id) return [];
  if (payload.type === "task_started") return state({ ...payload, id }, context, "running");
  if (payload.type === "task_complete") return state({ ...payload, id, summary: payload.last_agent_message }, context, "succeeded");
  if (payload.type === "turn_aborted") return state({ ...payload, id }, context, /cancel|interrupt/i.test(String(payload.reason || "")) ? "cancelled" : "failed");
  if (payload.type === "token_count") return usage({ ...payload, id, usage: object(object(payload.info)?.last_token_usage) }, "codex child rollout", context);
  return mapExplicit({ ...payload, providerId: id }, "codex child rollout", context);
};

export const mapGeminiExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => {
  const row = object(value); if (!row) return [];
  if ((row.type === "tool_use" || row.type === "tool_result") && /(?:subagent|agent|task)/i.test(String(row.tool_name || row.name || ""))) {
    const id = text(row.tool_id, row.id); if (!id) return [];
    const input = object(row.parameters) || object(row.input) || {};
    return row.type === "tool_use"
      ? [...spawn({ ...input, id, parentProviderId: context?.parentProviderId }, context, { title: text(input.description, input.name, row.tool_name, "Subagente Gemini")! }), ...state({ id }, context, "running")]
      : state({ id, summary: row.result, error: row.error }, context, row.error ? "failed" : "succeeded");
  }
  return mapExplicit(row, "gemini subagent event", context);
};

export const mapCursorExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => {
  const row = object(value); if (!row) return [];
  const toolCall = object(row.tool_call);
  const nativeChildTool = toolCall && (Object.keys(toolCall).some((key) => /(?:subagent|agent|task)(?:ToolCall)?$/i.test(key))
    || /(?:subagent|agent|task)/i.test(String(toolCall.type || toolCall.name || "")));
  if (row.type === "tool_call" && nativeChildTool) {
    const id = text(row.call_id, row.id); if (!id) return [];
    return row.subtype === "started"
      ? [...spawn({ id, parentProviderId: context?.parentProviderId, title: "Subagente Cursor" }, context), ...state({ id }, context, "running")]
      : state({ id, error: row.error }, context, row.error ? "failed" : "succeeded");
  }
  return mapExplicit(row, "cursor agent event", context);
};

export const mapCopilotExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => mapExplicit(value, "copilot SDK lifecycle", context);

export const mapOpenCodeExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => {
  const row = object(value); if (!row) return [];
  const properties = object(row.properties) || object(row.data) || row;
  const session = object(properties.session) || object(properties.info) || properties;
  const child = text(session.parentID, session.parent_id, context?.parentProviderId);
  if (/session\.created/i.test(typeOf(row)) && child) {
    return [...spawn({ ...session, parentProviderId: child }, context), ...state(session, context)];
  }
  if (/session\.updated/i.test(typeOf(row)) && child) {
    return state(session, context);
  }
  return mapExplicit(session, "opencode server SSE", context);
};

export const mapClineExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => mapExplicit(value, "cline SDK Agent Teams", context);
export const mapQwenExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => mapExplicit(value, "qwen hooks/stream", context);

export const mapContinueExecutionFixture: ProviderExecutionFixtureMapper = () => [];

export const mapKiroExecutionFixture: ProviderExecutionFixtureMapper = (value, context) => {
  const row = object(value); if (!row) return [];
  const params = object(row.params); const update = object(params?.update) || object(params?.session) || params;
  if (!update) return [];
  return mapExplicit({ ...update, type: text(update.type, row.method) }, "kiro ACP", context);
};

export const mapAntigravityExecutionFixture: ProviderExecutionFixtureMapper = () => [];
export const mapAiderExecutionFixture: ProviderExecutionFixtureMapper = () => [];

export const EXECUTION_FIXTURE_MAPPERS: Readonly<Record<ExecutionAdapterId, ProviderExecutionFixtureMapper>> = Object.freeze({
  "claude-code": mapClaudeExecutionFixture,
  codex: mapCodexExecutionFixture,
  gemini: mapGeminiExecutionFixture,
  cursor: mapCursorExecutionFixture,
  copilot: mapCopilotExecutionFixture,
  opencode: mapOpenCodeExecutionFixture,
  cline: mapClineExecutionFixture,
  qwen: mapQwenExecutionFixture,
  continue: mapContinueExecutionFixture,
  kiro: mapKiroExecutionFixture,
  antigravity: mapAntigravityExecutionFixture,
  aider: mapAiderExecutionFixture,
});

export function mapProviderExecutionFixture(adapter: ExecutionAdapterId, value: unknown, context?: ProviderFixtureContext): ProviderExecutionEvent[] {
  return EXECUTION_FIXTURE_MAPPERS[adapter](value, context);
}
