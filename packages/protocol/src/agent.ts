/** Canonical, provider-independent agent contract (schema v1). */

export const AGENT_EVENT_SCHEMA_VERSION = 1 as const;

export type SupportLevel = "complete" | "limited" | "unverified" | "unauthenticated" | "not_installed";
export type StreamGranularity = "delta" | "block" | "final_only" | "none";
export type CostKind = "billed" | "estimated_api_equivalent" | "subscription_included" | "tokens_only" | "unavailable";
export type ModelSource = "cli" | "api" | "config" | "cache" | "fallback";
export type ModelVisibility = "public" | "preview" | "hidden" | "deprecated" | "unavailable";
export type ModelCatalogKind = "runtime" | "configured" | "provider_dynamic" | "none";
export type ModelControl = "per_turn" | "configuration_only" | "provider_default" | "none";
export type SessionContinuity = "native_id" | "jarvis_history" | "cwd_global" | "none";
export type ToolLifecycle = "full" | "start_only" | "unobservable" | "none";
export type Modality = "text" | "image" | "audio" | "file";
export type PermissionMode = "provider_default" | "full_access";

export interface AgentCapabilities {
  permissionMode: PermissionMode;
  stream: StreamGranularity;
  tools: boolean;
  toolLifecycle: ToolLifecycle;
  thinking: boolean;
  plans: boolean;
  subagents: boolean;
  nativeSessions: boolean;
  nativeResume: boolean;
  sessionContinuity: SessionContinuity;
  files: boolean;
  diffs: boolean;
  usage: boolean;
  cost: CostKind;
  attachments: Modality[];
  commands: boolean;
  skills: boolean;
  mcp: boolean;
  oneShot: boolean;
  remote: boolean;
  modelCatalog: ModelCatalogKind;
  modelControl: ModelControl;
}

export interface ModelDescriptor {
  id: string;
  label: string;
  source: ModelSource;
  visibility: ModelVisibility;
  contextTokens?: number;
  efforts: string[];
  effortsVerified?: boolean;
  contextVerified?: boolean;
  defaultEffort?: string;
  isProviderDefault?: boolean;
  /** False when a model is informational/configuration-only and cannot be selected per turn. */
  selectable?: boolean;
  modalities: Modality[];
  deprecated?: boolean;
  discoveredAt: number;
}

export interface AgentDescriptor {
  id: string;
  label: string;
  support: SupportLevel;
  reason?: string;
  cli: { command: string; version?: string };
  capabilities: AgentCapabilities;
  models: ModelDescriptor[];
  defaultModel?: string;
  discoveredAt: number;
}

export interface UsageRecord {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  contextTokens?: number;
  costUsd?: number;
  costKind: CostKind;
  source: string;
  model?: string;
}

export interface ToolEvent {
  callId: string;
  name: string;
  summary: string;
  detail?: string;
  status: "started" | "completed" | "failed";
  parentId?: string;
  path?: string;
  adds?: number;
  dels?: number;
  rows?: Array<{ t: " " | "+" | "-" | "@"; s: string }>;
  durationMs?: number;
  error?: string;
}

export interface PlanEvent {
  title?: string;
  items: Array<{ id: string; text: string; status: "pending" | "in_progress" | "completed" }>;
}

export type AgentEventKind = "accepted" | "started" | "text_delta" | "text_block" | "thinking" | "tool_started" | "tool_completed" | "tool_failed" | "plan" | "usage" | "completed" | "failed" | "cancelled";

export interface AgentEvent {
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  turnId: string;
  eventId: string;
  seq: number;
  at: number;
  kind: AgentEventKind;
  text?: string;
  tool?: ToolEvent;
  plan?: PlanEvent;
  usage?: UsageRecord;
  providerEvent?: string;
  errorCode?: string;
}

export interface EventSequencer {
  next(kind: AgentEventKind, data?: Omit<AgentEvent, "schemaVersion" | "turnId" | "eventId" | "seq" | "at" | "kind">): AgentEvent;
  readonly terminal: boolean;
}

const TERMINAL = new Set<AgentEventKind>(["completed", "failed", "cancelled"]);

export function createEventSequencer(turnId: string, now: () => number = Date.now): EventSequencer {
  if (!turnId.trim()) throw new Error("turnId is required");
  let seq = 0;
  let terminal = false;
  return {
    get terminal() { return terminal; },
    next(kind, data = {}) {
      if (terminal) throw new Error("turn already terminated");
      const n = ++seq;
      const event: AgentEvent = { schemaVersion: AGENT_EVENT_SCHEMA_VERSION, turnId, eventId: `${turnId}:${n}`, seq: n, at: now(), kind, ...data };
      if (TERMINAL.has(kind)) terminal = true;
      return event;
    },
  };
}

export function descriptorProblems(d: AgentDescriptor): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(d.id)) out.push("invalid agent id");
  if (!d.label.trim()) out.push("missing label");
  if (!d.cli.command.trim()) out.push("missing command");
  const ids = new Set<string>();
  for (const m of d.models) {
    if (!m.id.trim()) out.push("model with empty id");
    if (ids.has(m.id)) out.push(`duplicate model: ${m.id}`);
    ids.add(m.id);
    if (m.contextTokens !== undefined && (!Number.isFinite(m.contextTokens) || m.contextTokens <= 0)) out.push(`invalid context: ${m.id}`);
    if (m.defaultEffort && !m.efforts.includes(m.defaultEffort)) out.push(`default effort not supported: ${m.id}/${m.defaultEffort}`);
    if (m.selectable === false && m.isProviderDefault) out.push(`non-selectable model cannot be provider default: ${m.id}`);
  }
  if (d.defaultModel && !ids.has(d.defaultModel)) out.push(`unknown default model: ${d.defaultModel}`);
  if (d.capabilities.nativeResume && d.capabilities.sessionContinuity !== "native_id") out.push("native resume requires native_id continuity");
  if (!d.capabilities.tools && d.capabilities.toolLifecycle !== "none") out.push("tool lifecycle requires tools");
  if (d.capabilities.tools && d.capabilities.toolLifecycle === "none") out.push("tools require a declared lifecycle");
  if (d.support === "complete") {
    if (d.capabilities.stream === "none" || d.capabilities.stream === "final_only") out.push("complete agent requires live stream");
    if (!d.capabilities.remote) out.push("complete agent requires remote support");
    if (!d.cli.version) out.push("complete agent requires verified CLI version");
  }
  return out;
}

export function modelSupports(d: AgentDescriptor, modelId?: string, effort?: string): { ok: true } | { ok: false; code: "INVALID_MODEL" | "INVALID_EFFORT"; message: string } {
  if (!modelId) return { ok: true };
  if (d.capabilities.modelControl !== "per_turn") return { ok: false, code: "INVALID_MODEL", message: `${d.label} não permite selecionar modelo por turno` };
  const model = d.models.find((m) => m.id === modelId && m.selectable !== false && m.visibility !== "unavailable" && !m.deprecated);
  if (!model) return { ok: false, code: "INVALID_MODEL", message: `modelo não disponível para ${d.label}: ${modelId}` };
  if (effort && !model.efforts.includes(effort)) return { ok: false, code: "INVALID_EFFORT", message: `esforço '${effort}' não suportado por ${modelId}` };
  return { ok: true };
}

export const LIMITED_CAPABILITIES: AgentCapabilities = Object.freeze<AgentCapabilities>({
  permissionMode: "full_access", stream: "final_only", tools: false, toolLifecycle: "none", thinking: false, plans: false, subagents: false,
  nativeSessions: false, nativeResume: false, sessionContinuity: "none", files: false, diffs: false, usage: false, cost: "unavailable",
  attachments: ["text", "file"], commands: false, skills: false, mcp: false, oneShot: true, remote: true, modelCatalog: "none", modelControl: "none",
});
