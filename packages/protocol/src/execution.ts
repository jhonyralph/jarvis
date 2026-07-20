import type { AgentEvent, CostKind, ToolEvent, UsageRecord } from "./agent.js";

export const EXECUTION_SCHEMA_VERSION = 1 as const;

export const EXECUTION_STATES = ["queued", "running", "waiting_input", "succeeded", "failed", "cancelled", "orphaned", "unknown"] as const;
export type ExecutionState = typeof EXECUTION_STATES[number];
export type ExecutionKind = "turn" | "workflow" | "phase" | "agent" | "process";
export type ExecutionOrigin = "native" | "jarvis_managed";
export type ExecutionCertification = "verified" | "partial" | "fixture_only" | "stale" | "unverified" | "unavailable";
export type ExecutionTier = "E0" | "E1" | "E2" | "E3" | "E4" | "E5";
export type TranscriptLevel = "none" | "summary_only" | "published_only" | "full";

export interface ExecutionCapabilities {
  source: "native_stream" | "native_hook" | "native_transcript" | "native_sdk" | "native_api" | "jarvis_managed" | "none";
  observe: "live" | "snapshot" | "terminal_only";
  transcript: TranscriptLevel;
  tools: boolean;
  cancel: "none" | "node" | "subtree" | "root";
  steer: "none" | "queued" | "running";
  retry: boolean;
  resume: boolean;
  input: "none" | "approval" | "question" | "both";
  files: "none" | "metadata" | "full";
  usage: "none" | "self" | "subtree";
  asynchronous: boolean;
  dependencies: boolean;
  maxDepth?: number;
  isolatedWorkspace: "native_worktree" | "jarvis_worktree" | "shared_cwd" | "read_only" | "unknown";
  reason?: string;
}

export const NO_EXECUTION_CAPABILITIES: ExecutionCapabilities = Object.freeze({
  source: "none", observe: "terminal_only", transcript: "none", tools: false, cancel: "none",
  steer: "none", retry: false, resume: false, input: "none", files: "none", usage: "none",
  asynchronous: false, dependencies: false, isolatedWorkspace: "unknown",
  reason: "o fornecedor não publica um lifecycle de execuções",
});

export interface ExecutionAdapterProfile {
  tier: ExecutionTier;
  certification: ExecutionCertification;
  capabilities: ExecutionCapabilities;
  acquisitionSurface?: string;
  adapterVersion?: string;
  providerVersion?: string;
  certifiedAt?: number;
  certificationHash?: string;
  reason?: string;
}

export interface ExecutionMetricSet {
  toolCalls?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costKind?: CostKind;
}

export interface ExecutionMetrics {
  self: ExecutionMetricSet;
  subtree?: ExecutionMetricSet;
}

export interface ExecutionArtifact {
  artifactId: string;
  executionId: string;
  kind: "file" | "diff" | "log" | "report";
  name: string;
  relativePath?: string;
  mime?: string;
  size?: number;
  sha256?: string;
  adds?: number;
  dels?: number;
  redacted?: boolean;
}

export interface ExecutionNode {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  journalId: string;
  executionId: string;
  rootExecutionId: string;
  rootTurnId: string;
  sessionId: string;
  runnerId: string;
  parentExecutionId?: string;
  providerExecutionId?: string;
  retryOf?: string;
  dependsOn: string[];
  depth: number;
  kind: ExecutionKind;
  origin: ExecutionOrigin;
  certification: ExecutionCertification;
  state: ExecutionState;
  title: string;
  role?: string;
  prompt?: string;
  summary?: string;
  currentStep?: string;
  agent?: string;
  model?: string;
  effort?: string;
  acquisitionSurface?: string;
  adapterVersion?: string;
  providerVersion?: string;
  cwd?: string;
  worktree?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  archivedAt?: number;
  capabilities: ExecutionCapabilities;
  metrics: ExecutionMetrics;
  truncated?: boolean;
}

export interface ExecutionEventBase {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  journalId: string;
  eventId: string;
  executionId: string;
  rootExecutionId: string;
  rootTurnId: string;
  seq: number;
  at: number;
  providerAt?: number;
}

export type ExecutionEvent = ExecutionEventBase & (
  | { kind: "node_created"; node: ExecutionNode }
  | { kind: "state_changed"; from: ExecutionState; to: ExecutionState; reason?: string }
  | { kind: "message"; role: "assistant" | "system"; text: string; published: true }
  | { kind: "thinking"; text?: string; published: true }
  | { kind: "agent_event"; event: AgentEvent }
  | { kind: "tool"; tool: ToolEvent }
  | { kind: "usage"; usage: UsageRecord; measure: "delta" | "cumulative"; scope: "self" | "subtree" }
  | { kind: "input_requested"; inputId: string; inputKind: "approval" | "question"; summary: string; choices?: string[]; expiresAt?: number }
  | { kind: "input_resolved"; inputId: string; state: "answered" | "approved" | "rejected" | "expired"; answer?: string }
  | { kind: "artifact"; artifact: ExecutionArtifact }
  | { kind: "archived"; archived: boolean }
  | { kind: "dependency"; dependsOn: string[] }
  | { kind: "summary"; text: string }
  | { kind: "truncated"; dropped: number; reason: string }
  | { kind: "diagnostic"; level: "info" | "warning" | "error"; code: string; message: string }
);
export type ExecutionEventInput = ExecutionEvent extends infer E
  ? E extends ExecutionEventBase ? Omit<E, keyof ExecutionEventBase> : never
  : never;

export interface ExecutionSnapshot {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  journalId: string;
  rootExecutionId: string;
  rootTurnId: string;
  lastSeq: number;
  generatedAt: number;
  nodes: ExecutionNode[];
  artifacts: ExecutionArtifact[];
  pendingInputs: Array<{ executionId: string; inputId: string; inputKind: "approval" | "question"; summary: string; choices?: string[]; expiresAt?: number }>;
  truncated: boolean;
  connection?: "online" | "offline" | "reconciling" | "desynced";
}

export interface ExecutionManifestEntry {
  rootExecutionId: string;
  journalId: string;
  lastSeq: number;
  updatedAt: number;
  sessionId?: string;
}

export type ProviderExecutionEvent =
  | { kind: "execution_spawn"; providerId: string; parentProviderId?: string; node: { title: string; role?: string; kind?: ExecutionKind; depth?: number; prompt?: string; startedAt?: number; capabilities?: Partial<ExecutionCapabilities> } }
  | { kind: "execution_state"; providerId: string; state: ExecutionState; summary?: string; at?: number }
  | { kind: "execution_activity"; providerId: string; event: { kind: "text" | "tool" | "thinking" | "plan"; text?: string; name?: string; summary?: string; detail?: string; toolId?: string; parentId?: string; path?: string; adds?: number; dels?: number; rows?: unknown[]; status?: "started" | "completed" | "failed"; error?: string; providerEvent?: string } }
  | { kind: "execution_usage"; providerId: string; usage: UsageRecord; measure?: "delta" | "cumulative"; scope?: "self" | "subtree" };

export type ExecutionControlAction = "cancel" | "cancel_subtree" | "steer" | "retry";

export interface ManagedExecutionTaskWire {
  id: string; title: string; prompt: string; agent: string; cwd: string; model?: string; effort?: string;
  parentExecutionId?: string; dependsOn?: string[]; depth: number; write?: boolean;
  dependencyPolicy?: "all_succeeded" | "all_terminal"; reservation?: { costUsd?: number; tokens?: number };
}
export interface ManagedExecutionPlanWire { rootExecutionId: string; runnerId: string; tasks: ManagedExecutionTaskWire[]; }
export interface ManagedExecutionPolicyWire {
  maxConcurrency?: number; maxDepth?: number; maxTasks?: number;
  budget?: { maxCostUsd?: number; maxTokens?: number; deadlineAt?: number; unknownEstimate?: "allow" | "reject" };
}

export type ExecutionClientToHub =
  | { t: "executions_list"; requestId?: string; scope: "all" | "session"; sessionId?: string; rootExecutionId?: string; runnerId?: string; states?: ExecutionState[]; cursor?: string; limit?: number }
  | { t: "execution_open"; executionId: string; cursor?: string; limit?: number }
  | { t: "execution_control"; requestId: string; executionId: string; action: ExecutionControlAction; message?: string }
  | { t: "execution_input"; requestId: string; executionId: string; inputId: string; decision: "approve" | "reject" | "answer"; answer?: string }
  | { t: "execution_archive"; requestId: string; executionId: string; archived: boolean }
  | { t: "execution_delegate"; requestId: string; title?: string; plan: ManagedExecutionPlanWire; policy?: ManagedExecutionPolicyWire };

export type ExecutionHubToClient =
  | { t: "executions_snapshot"; requestId?: string; scope: "all" | "session"; nodes: ExecutionNode[]; nextCursor?: string; generatedAt: number }
  | { t: "execution_delta"; runnerId: string; event: ExecutionEvent }
  | { t: "execution_transcript"; executionId: string; node: ExecutionNode; events: ExecutionEvent[]; nextCursor?: string; truncated: boolean }
  | { t: "execution_control_result"; requestId: string; executionId: string; ok: boolean; affectedIds: string[]; unsupportedIds: string[]; error?: string }
  | { t: "execution_input_result" | "execution_archive_result"; requestId: string; executionId: string; ok: boolean; error?: string }
  | { t: "execution_connection"; runnerId: string; state: "online" | "offline" | "reconciling" | "desynced"; at: number }
  | { t: "execution_error"; code: string; message: string; executionId?: string }
  | { t: "execution_delegate_result"; requestId: string; ok: boolean; rootExecutionId?: string; error?: string };

export type ExecutionRunnerToHub =
  | { t: "execution_event"; sessionId: string; event: ExecutionEvent }
  | { t: "execution_usage_record"; rootExecutionId: string; sessionId: string; agent: string; usage: UsageRecord }
  | { t: "execution_manifest"; reqId: string; entries: ExecutionManifestEntry[] }
  | { t: "execution_events"; reqId: string; rootExecutionId: string; journalId: string; events: ExecutionEvent[]; nextSeq?: number }
  | { t: "execution_control_result"; requestId: string; executionId: string; ok: boolean; affectedIds: string[]; unsupportedIds: string[]; error?: string }
  | { t: "execution_delegate_result"; requestId: string; ok: boolean; rootExecutionId?: string; error?: string };

export type ExecutionHubToRunner =
  | { t: "execution_manifest_request"; reqId: string }
  | { t: "execution_read"; reqId: string; rootExecutionId: string; afterSeq: number; limit?: number }
  | { t: "execution_control"; requestId: string; executionId: string; action: ExecutionControlAction; message?: string }
  | { t: "execution_delegate"; requestId: string; title?: string; plan: ManagedExecutionPlanWire; policy?: ManagedExecutionPolicyWire };

const ID = /^[^\x00-\x1f\x7f]{1,200}$/;
export const isExecutionId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
export const isExecutionState = (value: unknown): value is ExecutionState => typeof value === "string" && (EXECUTION_STATES as readonly string[]).includes(value);

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : undefined;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const optionalFinite = (value: unknown): boolean => value === undefined || finite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const optionalString = (value: unknown): boolean => value === undefined || typeof value === "string";
const oneOf = (value: unknown, options: readonly string[]): boolean => typeof value === "string" && options.includes(value);
const COST_KINDS = new Set<CostKind>(["billed", "estimated_api_equivalent", "subscription_included", "tokens_only", "unavailable"]);

function isUsageRecord(value: unknown): value is UsageRecord {
  const usage = record(value); if (!usage || typeof usage.source !== "string" || !COST_KINDS.has(usage.costKind as CostKind)) return false;
  return ["inputTokens", "cachedInputTokens", "outputTokens", "contextTokens", "contextWindowTokens", "costUsd"]
    .every((key) => optionalFinite(usage[key]));
}

function isToolEvent(value: unknown): value is ToolEvent {
  const tool = record(value); if (!tool) return false;
  return isExecutionId(tool.callId) && typeof tool.name === "string" && typeof tool.summary === "string"
    && (tool.status === "started" || tool.status === "completed" || tool.status === "failed")
    && optionalFinite(tool.adds) && optionalFinite(tool.dels) && optionalFinite(tool.durationMs);
}

function isAgentEventValue(value: unknown): value is AgentEvent {
  const event = record(value); if (!event || event.schemaVersion !== 1 || !isExecutionId(event.turnId)
    || !isExecutionId(event.eventId) || !Number.isSafeInteger(event.seq) || Number(event.seq) < 1 || !finite(event.at)) return false;
  const kinds = new Set(["accepted", "started", "text_delta", "text_block", "thinking", "tool_started", "tool_completed", "tool_failed", "plan", "usage", "completed", "failed", "cancelled"]);
  if (typeof event.kind !== "string" || !kinds.has(event.kind)) return false;
  if (event.kind === "usage") return isUsageRecord(event.usage);
  if (event.kind.startsWith("tool_")) return isToolEvent(event.tool);
  if (event.kind === "text_delta" || event.kind === "text_block" || event.kind === "thinking" || event.kind === "completed" || event.kind === "failed") return optionalString(event.text);
  if (event.kind === "plan") {
    const plan = record(event.plan);
    return !!plan && optionalString(plan.title) && Array.isArray(plan.items) && plan.items.every((item) => {
      const row = record(item);
      return !!row && typeof row.id === "string" && typeof row.text === "string" && oneOf(row.status, ["pending", "in_progress", "completed"]);
    });
  }
  return true;
}

function isMetricSet(value: unknown): boolean {
  const metric = record(value); if (!metric) return false;
  return ["toolCalls", "inputTokens", "cachedInputTokens", "outputTokens", "costUsd"].every((key) => optionalFinite(metric[key]))
    && (metric.costKind === undefined || COST_KINDS.has(metric.costKind as CostKind));
}

function isExecutionCapabilitiesValue(value: unknown): value is ExecutionCapabilities {
  const caps = record(value); if (!caps) return false;
  return oneOf(caps.source, ["native_stream", "native_hook", "native_transcript", "native_sdk", "native_api", "jarvis_managed", "none"])
    && oneOf(caps.observe, ["live", "snapshot", "terminal_only"])
    && oneOf(caps.transcript, ["none", "summary_only", "published_only", "full"])
    && ["tools", "retry", "resume", "asynchronous", "dependencies"].every((key) => typeof caps[key] === "boolean")
    && oneOf(caps.cancel, ["none", "node", "subtree", "root"])
    && oneOf(caps.steer, ["none", "queued", "running"])
    && oneOf(caps.input, ["none", "approval", "question", "both"])
    && oneOf(caps.files, ["none", "metadata", "full"])
    && oneOf(caps.usage, ["none", "self", "subtree"])
    && oneOf(caps.isolatedWorkspace, ["native_worktree", "jarvis_worktree", "shared_cwd", "read_only", "unknown"])
    && (caps.maxDepth === undefined || (Number.isSafeInteger(caps.maxDepth) && Number(caps.maxDepth) >= 0))
    && optionalString(caps.reason);
}

function isExecutionNodeValue(value: unknown): value is ExecutionNode {
  const node = record(value), caps = record(node?.capabilities), metrics = record(node?.metrics);
  if (!node || node.schemaVersion !== EXECUTION_SCHEMA_VERSION || !caps || !metrics || !strings(node.dependsOn)) return false;
  if (!["turn", "workflow", "phase", "agent", "process"].includes(String(node.kind))) return false;
  if (node.origin !== "native" && node.origin !== "jarvis_managed") return false;
  if (!["verified", "partial", "fixture_only", "stale", "unverified", "unavailable"].includes(String(node.certification))) return false;
  if (!isExecutionCapabilitiesValue(caps) || !isMetricSet(metrics.self) || (metrics.subtree !== undefined && !isMetricSet(metrics.subtree))) return false;
  if (["parentExecutionId", "providerExecutionId", "retryOf"].some((key) => node[key] !== undefined && !isExecutionId(node[key]))) return false;
  if (["role", "prompt", "summary", "currentStep", "agent", "model", "effort", "acquisitionSurface", "adapterVersion", "providerVersion", "cwd", "worktree"].some((key) => !optionalString(node[key]))) return false;
  if (["queuedAt", "startedAt", "endedAt", "archivedAt"].some((key) => !optionalFinite(node[key]))) return false;
  return executionNodeProblems(node as unknown as ExecutionNode).length === 0;
}

export function executionNodeProblems(node: ExecutionNode): string[] {
  const out: string[] = [];
  for (const [name, value] of [["journalId", node.journalId], ["executionId", node.executionId], ["rootExecutionId", node.rootExecutionId], ["rootTurnId", node.rootTurnId], ["sessionId", node.sessionId], ["runnerId", node.runnerId]] as const) if (!isExecutionId(value)) out.push(`invalid ${name}`);
  if (node.rootExecutionId === node.executionId && node.parentExecutionId) out.push("root node cannot have parentExecutionId");
  if (node.rootExecutionId !== node.executionId && !node.parentExecutionId) out.push("non-root node requires parentExecutionId");
  if (!Number.isSafeInteger(node.depth) || node.depth < 0) out.push("invalid depth");
  if (!node.title?.trim() || node.title.length > 200) out.push("invalid title");
  if (!isExecutionState(node.state)) out.push("invalid state");
  if (!node.dependsOn.every(isExecutionId) || new Set(node.dependsOn).size !== node.dependsOn.length || node.dependsOn.includes(node.executionId)) out.push("invalid dependencies");
  return out;
}

export function isExecutionEvent(value: unknown): value is ExecutionEvent {
  const event = record(value);
  if (!event || event.schemaVersion !== EXECUTION_SCHEMA_VERSION || !isExecutionId(event.journalId)) return false;
  if (!isExecutionId(event.eventId) || !isExecutionId(event.executionId) || !isExecutionId(event.rootExecutionId)
    || !isExecutionId(event.rootTurnId) || !Number.isSafeInteger(event.seq) || Number(event.seq) < 1 || !finite(event.at)) return false;
  switch (event.kind) {
    case "node_created": return isExecutionNodeValue(event.node);
    case "state_changed": return isExecutionState(event.from) && isExecutionState(event.to) && (event.reason === undefined || typeof event.reason === "string");
    case "message": return (event.role === "assistant" || event.role === "system") && typeof event.text === "string" && event.published === true;
    case "thinking": return (event.text === undefined || typeof event.text === "string") && event.published === true;
    case "agent_event": return isAgentEventValue(event.event);
    case "tool": return isToolEvent(event.tool);
    case "usage": return isUsageRecord(event.usage) && (event.measure === "delta" || event.measure === "cumulative") && (event.scope === "self" || event.scope === "subtree");
    case "input_requested": return isExecutionId(event.inputId) && (event.inputKind === "approval" || event.inputKind === "question")
      && typeof event.summary === "string" && (event.choices === undefined || strings(event.choices)) && optionalFinite(event.expiresAt);
    case "input_resolved": return isExecutionId(event.inputId) && ["answered", "approved", "rejected", "expired"].includes(String(event.state))
      && (event.answer === undefined || typeof event.answer === "string");
    case "artifact": {
      const artifact = record(event.artifact);
      return !!artifact && isExecutionId(artifact.artifactId) && artifact.executionId === event.executionId
        && ["file", "diff", "log", "report"].includes(String(artifact.kind)) && typeof artifact.name === "string"
        && optionalFinite(artifact.size) && optionalFinite(artifact.adds) && optionalFinite(artifact.dels);
    }
    case "archived": return typeof event.archived === "boolean";
    case "dependency": return strings(event.dependsOn);
    case "summary": return typeof event.text === "string";
    case "truncated": return Number.isSafeInteger(event.dropped) && Number(event.dropped) >= 0 && typeof event.reason === "string";
    case "diagnostic": return ["info", "warning", "error"].includes(String(event.level)) && typeof event.code === "string" && typeof event.message === "string";
    default: return false;
  }
}
