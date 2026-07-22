import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  EXECUTION_SCHEMA_VERSION,
  NO_EXECUTION_CAPABILITIES,
  type AgentEvent,
  type ExecutionAdapterProfile,
  type ExecutionCapabilities,
  type ExecutionEvent,
  type ExecutionNode,
  type ExecutionState,
  type ProviderExecutionEvent,
  type ToolEvent,
  type UsageRecord,
} from "@jarvis/protocol";
import { ExecutionStore } from "./execution-store.js";
import { redactExecutionText } from "./execution-redact.js";
import { cumulativeUsageDelta } from "./execution-usage.js";
import type { StreamEvent } from "./agents.js";

export interface ExecutionTurnMeta {
  runnerId: string;
  sessionId: string;
  turnId: string;
  agent: string;
  cwd: string;
  model?: string;
  effort?: string;
  title?: string;
  profile?: ExecutionAdapterProfile;
  startedAt?: number;
}

/** Result of projecting a provider-native lifecycle event into the durable execution graph.
 * `activity` is present only when the provider published a new, displayable child event. Snapshot
 * duplicates deliberately return no activity so callers can feed the chat without replaying rows. */
export interface ProviderExecutionProjection {
  executionId: string;
  activity?: StreamEvent;
}

const hashId = (prefix: string, value: string): string => `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
export const executionRootId = (runnerId: string, sessionId: string, turnId: string): string => hashId("exec", `${runnerId}\0${sessionId}\0${turnId}`);
export const executionChildId = (rootExecutionId: string, providerId: string): string => hashId("child", `${rootExecutionId}\0${providerId}`);

function capabilities(profile?: ExecutionAdapterProfile): ExecutionCapabilities {
  return { ...NO_EXECUTION_CAPABILITIES, ...(profile?.capabilities || {}), reason: profile?.capabilities.reason };
}

function relativeArtifact(cwd: string, path?: string): string | undefined {
  if (!path) return undefined;
  const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(resolve(cwd), absolute);
  if (!rel || rel === ".") return basename(absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.replace(/\\/g, "/");
}

function toolFromStream(ev: StreamEvent): ToolEvent {
  return { callId: ev.toolId || hashId("tool", JSON.stringify([ev.name, ev.summary, ev.detail, Date.now()])),
    name: ev.name || "Tool", summary: ev.summary || ev.name || "Ferramenta", detail: ev.detail,
    status: ev.status || "started", parentId: ev.parentId, path: ev.path, adds: ev.adds, dels: ev.dels,
    rows: ev.rows, error: ev.error };
}

function redactedAgentEvent(event: AgentEvent): AgentEvent {
  return { ...event, text: redactExecutionText(event.text),
    tool: event.tool ? { ...event.tool, summary: redactExecutionText(event.tool.summary) || "Ferramenta",
      detail: redactExecutionText(event.tool.detail), error: redactExecutionText(event.tool.error) } : undefined,
    plan: event.plan ? { ...event.plan, title: redactExecutionText(event.plan.title), items: event.plan.items.map((item) => ({ ...item, text: redactExecutionText(item.text) || "[REDACTED]" })) } : undefined };
}

/** Redact a provider-published child activity before it reaches either the journal or the chat. */
export function redactProviderExecutionActivity(event: Extract<ProviderExecutionEvent, { kind: "execution_activity" }>["event"], cwd?: string): StreamEvent {
  return { ...event, text: redactExecutionText(event.text), summary: redactExecutionText(event.summary),
    detail: redactExecutionText(event.detail), error: redactExecutionText(event.error),
    path: event.path ? (cwd ? relativeArtifact(cwd, event.path) : undefined) : undefined } as StreamEvent;
}

export class ExecutionTracker {
  readonly rootExecutionId: string;
  private providerIds = new Map<string, string>();
  private emittedActivities = new Map<string, number>();
  private providerUsage = new Map<string, UsageRecord>();
  constructor(private readonly store: ExecutionStore, readonly meta: ExecutionTurnMeta, private readonly onEvent?: (event: ExecutionEvent) => void,
    private readonly onChildUsage?: (usage: UsageRecord) => void) {
    this.rootExecutionId = executionRootId(meta.runnerId, meta.sessionId, meta.turnId);
    for (const node of store.snapshot(this.rootExecutionId)?.nodes || []) if (node.providerExecutionId) this.providerIds.set(node.providerExecutionId, node.executionId);
  }

  private emit(event: ExecutionEvent): ExecutionEvent { this.onEvent?.(event); return event; }
  private append(executionId: string, input: Parameters<ExecutionStore["append"]>[2]): ExecutionEvent { return this.emit(this.store.append(this.rootExecutionId, executionId, input)); }

  ensureRoot(at = this.meta.startedAt || Date.now()): ExecutionNode {
    const existing = this.store.findNode(this.rootExecutionId)?.node; if (existing) return existing;
    const profile = this.meta.profile;
    const node: Omit<ExecutionNode, "schemaVersion" | "journalId"> = {
      executionId: this.rootExecutionId, rootExecutionId: this.rootExecutionId, rootTurnId: this.meta.turnId,
      sessionId: this.meta.sessionId, runnerId: this.meta.runnerId, dependsOn: [], depth: 0, kind: "turn",
      origin: "jarvis_managed", certification: profile?.certification || "unverified", state: "queued",
      title: (redactExecutionText(this.meta.title) || `Turno · ${this.meta.agent}`).slice(0, 200), agent: this.meta.agent, model: this.meta.model,
      effort: this.meta.effort, cwd: this.meta.cwd, acquisitionSurface: profile?.acquisitionSurface,
      adapterVersion: profile?.adapterVersion, providerVersion: profile?.providerVersion, queuedAt: at,
      capabilities: capabilities(profile), metrics: { self: {} },
    };
    return (this.emit(this.store.create(node)) as Extract<ExecutionEvent, { kind: "node_created" }>).node;
  }

  private node(executionId: string): ExecutionNode | undefined { return this.store.findNode(executionId)?.node; }
  private transition(executionId: string, to: ExecutionState, reason?: string): void {
    const node = this.node(executionId); if (!node || node.state === to || ["succeeded", "failed", "cancelled"].includes(node.state)) return;
    this.append(executionId, { kind: "state_changed", from: node.state, to, reason });
  }

  private ensureChild(providerId: string, seed: { parentProviderId?: string; title?: string; role?: string; kind?: ExecutionNode["kind"]; depth?: number; prompt?: string; startedAt?: number; capabilities?: Partial<ExecutionCapabilities> } = {}): string {
    const known = this.providerIds.get(providerId); if (known) return known;
    this.ensureRoot();
    const executionId = executionChildId(this.rootExecutionId, providerId);
    const parentExecutionId = seed.parentProviderId ? (this.providerIds.get(seed.parentProviderId) || this.rootExecutionId) : this.rootExecutionId;
    const parent = this.node(parentExecutionId);
    const profile = this.meta.profile;
    const node: Omit<ExecutionNode, "schemaVersion" | "journalId"> = {
      executionId, rootExecutionId: this.rootExecutionId, rootTurnId: this.meta.turnId,
      sessionId: this.meta.sessionId, runnerId: this.meta.runnerId, parentExecutionId, providerExecutionId: providerId,
      dependsOn: [], depth: seed.depth ?? ((parent?.depth || 0) + 1), kind: seed.kind || "agent", origin: "native",
      certification: profile?.certification || "unverified", state: "running", title: (redactExecutionText(seed.title) || seed.role || "Subagente").slice(0, 200),
      role: seed.role, prompt: redactExecutionText(seed.prompt), agent: this.meta.agent, model: this.meta.model, effort: this.meta.effort,
      cwd: this.meta.cwd, acquisitionSurface: profile?.acquisitionSurface, adapterVersion: profile?.adapterVersion,
      providerVersion: profile?.providerVersion, queuedAt: seed.startedAt || Date.now(), startedAt: seed.startedAt || Date.now(),
      capabilities: { ...capabilities(profile), ...(seed.capabilities || {}) }, metrics: { self: {} },
    };
    this.providerIds.set(providerId, executionId); this.emit(this.store.appendNode(this.rootExecutionId, node)); return executionId;
  }

  private artifact(executionId: string, tool: ToolEvent): void {
    const path = relativeArtifact(this.meta.cwd, tool.path); if (!path) return;
    const artifactId = hashId("artifact", `${executionId}\0${path}`);
    this.append(executionId, { kind: "artifact", artifact: { artifactId, executionId,
      kind: tool.rows?.length ? "diff" : "file", name: basename(path), relativePath: path, adds: tool.adds, dels: tool.dels } });
  }

  handleAgentEvent(event: AgentEvent): void {
    const sourceEvent = event;
    if (sourceEvent.kind === "usage") sourceEvent.usageScope = this.meta.profile?.capabilities.usage === "subtree" ? "subtree" : "self";
    event = redactedAgentEvent(event);
    this.ensureRoot(event.at);
    if (event.kind === "accepted") {
      sourceEvent.executionId = this.rootExecutionId;
      this.append(this.rootExecutionId, { kind: "agent_event", event: { ...event, executionId: this.rootExecutionId } });
      return;
    }
    if (event.kind === "started") {
      sourceEvent.executionId = this.rootExecutionId;
      this.append(this.rootExecutionId, { kind: "agent_event", event: { ...event, executionId: this.rootExecutionId } });
      this.transition(this.rootExecutionId, "running");
      return;
    }
    const tool = event.tool;
    const isChildTool = !!tool && /^(Task|Agent|Subagent|spawn_agent)$/i.test(tool.name);
    if (isChildTool && tool) {
      const childId = this.ensureChild(tool.callId, { parentProviderId: tool.parentId, title: tool.summary, prompt: tool.detail });
      sourceEvent.executionId = childId;
      this.append(this.providerIds.get(tool.parentId || "") || this.rootExecutionId, { kind: "agent_event", event: { ...event, executionId: childId } });
      if (tool.status === "completed") this.transition(childId, "succeeded");
      if (tool.status === "failed") this.transition(childId, "failed", tool.error);
      return;
    }
    const providerParent = event.parentId || tool?.parentId;
    const executionId = providerParent ? this.ensureChild(providerParent) : this.rootExecutionId;
    sourceEvent.executionId = executionId;
    this.append(executionId, { kind: "agent_event", event: { ...event, executionId } });
    if (tool) this.artifact(executionId, tool);
    if (event.kind === "completed" || event.kind === "failed" || event.kind === "cancelled") {
      const target = event.kind === "completed" ? "succeeded" : event.kind === "failed" ? "failed" : "cancelled";
      this.transition(this.rootExecutionId, target, event.text);
      for (const node of this.store.snapshot(this.rootExecutionId)?.nodes || []) {
        if (node.executionId !== this.rootExecutionId && (node.state === "running" || node.state === "waiting_input")) {
          this.transition(node.executionId, "unknown", "o fornecedor encerrou o pai sem publicar o terminal deste filho");
          this.append(node.executionId, { kind: "diagnostic", level: "warning", code: "CHILD_TERMINAL_UNOBSERVED", message: "Estado terminal do filho não publicado pelo fornecedor" });
        }
      }
    }
  }

  handleProviderEvent(event: ProviderExecutionEvent): ProviderExecutionProjection {
    this.ensureRoot();
    if (event.kind === "execution_spawn") {
      return { executionId: this.ensureChild(event.providerId, { ...event.node, title: redactExecutionText(event.node.title) || "Subagente", prompt: redactExecutionText(event.node.prompt), parentProviderId: event.parentProviderId }) };
    }
    const executionId = this.ensureChild(event.providerId);
    if (event.kind === "execution_state") { const summary = redactExecutionText(event.summary); this.transition(executionId, event.state, summary); if (summary) this.append(executionId, { kind: "summary", text: summary }); return { executionId }; }
    if (event.kind === "execution_usage") {
      const measure = event.measure || "delta";
      this.append(executionId, { kind: "usage", usage: event.usage, measure, scope: event.scope || "self" });
      if (this.meta.profile?.capabilities.usage !== "subtree") {
        const delta = measure === "cumulative" ? cumulativeUsageDelta(event.usage, this.providerUsage.get(event.providerId)) : event.usage;
        if (measure === "cumulative") this.providerUsage.set(event.providerId, { ...event.usage });
        if (delta) { this.append(this.rootExecutionId, { kind: "usage", usage: delta, measure: "delta", scope: "subtree" }); this.onChildUsage?.(delta); }
      }
      return { executionId };
    }
    const stream = redactProviderExecutionActivity(event.event, this.meta.cwd);
    const count = this.emittedActivities.get(event.providerId) || 0;
    // Snapshot collectors may replay the entire published activity list. A stable prefix is ignored.
    if (stream.providerEvent?.startsWith("snapshot:")) {
      const index = Number(stream.providerEvent.slice("snapshot:".length)); if (Number.isFinite(index) && index < count) return { executionId };
      if (Number.isFinite(index)) this.emittedActivities.set(event.providerId, index + 1);
    }
    if (stream.kind === "text") this.append(executionId, { kind: "message", role: "assistant", text: stream.text || "", published: true });
    else if (stream.kind === "thinking") this.append(executionId, { kind: "thinking", text: stream.text, published: true });
    else if (stream.kind === "tool") { const tool = toolFromStream(stream); this.append(executionId, { kind: "tool", tool }); this.artifact(executionId, tool); }
    else if (stream.kind === "plan") this.append(executionId, { kind: "summary", text: stream.text || "Plano atualizado" });
    return { executionId, activity: stream };
  }
}
