import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { ABORTED, isProviderExecutionEvent, validateModelSelection, type AgentAdapter, type AgentCaps, type AgentRegistry, type AgentReply, type OnEvent, type StreamEvent } from "./agents.js";
import { ExecutionStore } from "./execution-store.js";
import { createManagedExecutionPolicy, type ManagedExecutionPolicyInput } from "./execution-policy.js";
import { runManagedExecutionPlan, validateManagedExecutionPlan, type ManagedExecutionPlan, type ManagedExecutionReport, type ManagedExecutionTask, type ManagedTaskRecord } from "./execution-orchestrator.js";
import { redactExecutionText } from "./execution-redact.js";
import { cumulativeUsageDelta } from "./execution-usage.js";
import { ManagedWorktreeManager, type ManagedReadOnlyEnforcement, type ManagedWorkspaceLease } from "./execution-worktree.js";
import {
  NO_EXECUTION_CAPABILITIES,
  type ExecutionAdapterProfile,
  type ExecutionCapabilities,
  type ExecutionEvent,
  type ExecutionNode,
  type ExecutionState,
  type ProviderExecutionEvent,
  type ToolEvent,
  type UsageRecord,
} from "@jarvis/protocol";

const TERMINAL = new Set<ExecutionState>(["succeeded", "failed", "cancelled"]);
const journalText = (value: string | undefined, max = 20_000): string | undefined => redactExecutionText(value)?.slice(0, max);

export interface ManagedHiddenSessionGateway {
  /** The implementation must use `idHint` as the exact id, be idempotent, and exclude it from ordinary chat/session listings. */
  create(input: { idHint: string; title: string; agent: string; cwd: string; rootExecutionId: string; executionId: string }): Promise<{ sessionId: string }>;
  append(sessionId: string, message: { role: "user" | "assistant" | "system"; text: string; at: number }): Promise<void> | void;
}

export type ManagedCommitPrevention = "provider_config" | "os_policy" | "command_wrapper";

export interface ManagedExecutionSecurity {
  /** Required for read-only work. A UI label or prompt instruction is not enforcement. */
  readOnlyEnforcement?: ManagedReadOnlyEnforcement;
  /** Must describe a real control that prevents the adapter/tools from creating commits. */
  commitPrevention: ManagedCommitPrevention;
}

export interface ManagedAdapterInvocation {
  adapter: AgentAdapter;
  sessionId: string;
  task: Readonly<ManagedExecutionTask>;
  prompt: string;
  cwd: string;
  lease: ManagedWorkspaceLease;
  security: ManagedExecutionSecurity;
  signal: AbortSignal;
  onEvent: OnEvent;
}

export interface ManagedExecutionServiceDependencies {
  runnerId: string;
  store: ExecutionStore;
  agents: AgentRegistry;
  worktrees: Pick<ManagedWorktreeManager, "prepare" | "release">;
  hiddenSessions: ManagedHiddenSessionGateway;
  /** Must return an actual enforcement declaration or throw. The service fails closed otherwise. */
  securityFor(task: Readonly<ManagedExecutionTask>, adapter: AgentAdapter): Promise<ManagedExecutionSecurity | undefined> | ManagedExecutionSecurity | undefined;
  /** The host can wrap the adapter in an OS/provider sandbox. Default calls adapter.send directly. */
  invoke?(input: ManagedAdapterInvocation): Promise<AgentReply>;
  validateMachine?(runnerId: string): Promise<boolean | void> | boolean | void;
  validateSelection?(input: { task: Readonly<ManagedExecutionTask>; adapter: AgentAdapter; caps: AgentCaps }): Promise<void> | void;
  onEvent?(event: ExecutionEvent): void;
  /** Receives normalized descendant deltas that are not already included in the provider parent. */
  onChildUsage?(input: { rootExecutionId: string; sessionId: string; agent: string; usage: UsageRecord }): void;
  now?: () => number;
}

export interface ManagedExecutionStartOptions {
  title?: string;
  rootTurnId?: string;
  signal?: AbortSignal;
  policy?: ManagedExecutionPolicyInput;
  /** Fires only after preflight, hidden-session binding and the durable running root succeed. */
  onAccepted?(rootExecutionId: string): void;
}

interface PreparedTask {
  task: ManagedExecutionTask;
  adapter: AgentAdapter;
  profile?: ExecutionAdapterProfile;
  security: ManagedExecutionSecurity;
  executionId: string;
}

const hashId = (prefix: string, value: string): string => `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
export const managedChildExecutionId = (rootExecutionId: string, taskId: string): string => hashId("managed", `${rootExecutionId}\0${taskId}`);
const managedProviderExecutionId = (rootExecutionId: string, taskId: string, providerId: string): string => hashId("native", `${rootExecutionId}\0${taskId}\0${providerId}`);

const MANAGED_ROOT_CAPABILITIES: ExecutionCapabilities = Object.freeze({
  source: "jarvis_managed", observe: "live", transcript: "published_only", tools: true, cancel: "root",
  steer: "none", retry: false, resume: false, input: "none", files: "metadata", usage: "subtree",
  asynchronous: true, dependencies: true, maxDepth: 32, isolatedWorkspace: "jarvis_worktree",
  reason: "workflow gerenciado e journalizado pelo Jarvis",
});

function capabilities(profile: ExecutionAdapterProfile | undefined, task: ManagedExecutionTask): ExecutionCapabilities {
  return {
    ...NO_EXECUTION_CAPABILITIES,
    ...(profile?.capabilities || {}),
    source: "jarvis_managed",
    asynchronous: true,
    dependencies: true,
    cancel: "root",
    steer: "none",
    retry: false,
    resume: false,
    input: "none",
    isolatedWorkspace: task.write ? "jarvis_worktree" : "read_only",
    reason: profile?.capabilities.reason || "execução gerenciada pelo Jarvis",
  };
}

function usageRecord(reply: AgentReply): UsageRecord | undefined {
  const usage = reply.usage;
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens,
    contextTokens: usage.contextTokens, contextWindowTokens: usage.contextWindowTokens, costUsd: usage.costUsd,
    costKind: usage.costKind || "unavailable", source: usage.source || "adapter não declarou a origem do uso",
    model: usage.model, effort: usage.effort,
  };
}

function relativeArtifact(cwd: string, path?: string): string | undefined {
  if (!path) return undefined;
  const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(resolve(cwd), absolute);
  if (!rel || rel === ".") return basename(absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.replace(/\\/g, "/");
}

function safeTool(event: StreamEvent, cwd: string): ToolEvent {
  const rows = Array.isArray(event.rows) ? event.rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const value = row as Record<string, unknown>;
    return typeof value.s === "string" ? { ...value, s: journalText(value.s, 10_000) || "" } : row;
  }) as ToolEvent["rows"] : undefined;
  return {
    callId: event.toolId || hashId("tool", JSON.stringify([event.name, event.summary, event.detail, Date.now()])),
    name: event.name || "Tool", summary: journalText(event.summary || event.name || "Ferramenta", 2_000) || "Ferramenta", detail: journalText(event.detail),
    status: event.status || "started", parentId: event.parentId, path: relativeArtifact(cwd, event.path), adds: event.adds, dels: event.dels,
    rows, error: journalText(event.error),
  };
}

function managedPrompt(task: ManagedExecutionTask, lease: ManagedWorkspaceLease): string {
  const access = lease.access === "isolated_write"
    ? "Você pode editar apenas a worktree isolada fornecida."
    : "Esta execução está sob sandbox real somente leitura; não tente modificar arquivos.";
  return `[Política de execução gerenciada do Jarvis]\n${access}\nNão crie commits, não faça merge/rebase/push e não altere outras worktrees. Publique um resumo objetivo ao terminar.\n\n${task.prompt}`;
}

/**
 * Safe local boundary for Jarvis-managed provider-neutral workflows.
 *
 * Hidden-session persistence and sandbox enforcement remain explicit injected boundaries
 * (`hiddenSessions` and `securityFor`) so Hub and Runner must provide real controls rather than
 * silently simulating isolation.
 */
export class ManagedExecutionService {
  private readonly now: () => number;
  constructor(private readonly deps: ManagedExecutionServiceDependencies) {
    if (!deps.runnerId.trim()) throw new Error("runnerId local é obrigatório");
    this.now = deps.now || Date.now;
  }

  private emit(event: ExecutionEvent): ExecutionEvent { this.deps.onEvent?.(event); return event; }
  private append(rootId: string, executionId: string, input: Parameters<ExecutionStore["append"]>[2]): ExecutionEvent {
    return this.emit(this.deps.store.append(rootId, executionId, input));
  }

  private transition(rootId: string, executionId: string, to: ExecutionState, reason?: string): void {
    const node = this.deps.store.findNode(executionId)?.node;
    if (!node || node.state === to || TERMINAL.has(node.state)) return;
    this.append(rootId, executionId, { kind: "state_changed", from: node.state, to, reason: journalText(reason) });
  }

  private async preflight(plan: ManagedExecutionPlan, policy?: ManagedExecutionPolicyInput): Promise<Map<string, PreparedTask>> {
    if (plan.runnerId !== this.deps.runnerId) throw new Error(`máquina fixa inválida: solicitado ${plan.runnerId}, serviço local ${this.deps.runnerId}`);
    const machine = await this.deps.validateMachine?.(plan.runnerId);
    if (machine === false) throw new Error(`máquina ${plan.runnerId} indisponível para execução gerenciada`);
    const normalizedPolicy = createManagedExecutionPolicy(policy);
    validateManagedExecutionPlan(plan, normalizedPolicy);
    if (this.deps.store.snapshot(plan.rootExecutionId)) throw new Error(`execução ${plan.rootExecutionId} já existe`);

    const prepared = new Map<string, PreparedTask>();
    const agentCache = new Map<string, { adapter: AgentAdapter; caps: AgentCaps; profile?: ExecutionAdapterProfile }>();
    for (const task of plan.tasks) {
      let cached = agentCache.get(task.agent);
      if (!cached) {
        const adapter = this.deps.agents.get(task.agent);
        if (!await adapter.available()) throw new Error(`agente ${task.agent} não está disponível na máquina ${plan.runnerId}`);
        const caps = await adapter.capabilities();
        const descriptor = await adapter.descriptor?.();
        cached = { adapter, caps, profile: descriptor?.execution };
        agentCache.set(task.agent, cached);
      }
      const { adapter, caps, profile } = cached;
      const validationModel = task.model || (task.effort ? caps.defaultModel : undefined);
      if (task.model && !caps.models.length && !this.deps.validateSelection) throw new Error(`catálogo indisponível: não é possível validar modelo '${task.model}' para ${task.agent}`);
      if (task.effort && !validationModel) throw new Error(`não é possível validar esforço '${task.effort}' sem modelo/default para ${task.agent}`);
      validateModelSelection(caps, { model: validationModel, effort: task.effort });
      await this.deps.validateSelection?.({ task, adapter, caps });
      const security = await this.deps.securityFor(task, adapter);
      if (!security?.commitPrevention) throw new Error(`execução gerenciada de ${task.agent} sem prevenção real de commits`);
      if (!task.write && !security.readOnlyEnforcement) throw new Error(`tarefa somente leitura ${task.id} sem sandbox real declarado`);
      prepared.set(task.id, { task, adapter, profile, security, executionId: managedChildExecutionId(plan.rootExecutionId, task.id) });
    }
    return prepared;
  }

  private createNodes(plan: ManagedExecutionPlan, prepared: Map<string, PreparedTask>, rootTurnId: string, sessionId: string, taskSessions: Map<string, string>, title?: string): void {
    const root: Omit<ExecutionNode, "schemaVersion" | "journalId"> = {
      executionId: plan.rootExecutionId, rootExecutionId: plan.rootExecutionId, rootTurnId, sessionId,
      runnerId: plan.runnerId, dependsOn: [], depth: 0, kind: "workflow", origin: "jarvis_managed",
      certification: "verified", state: "queued", title: journalText(title, 200) || "Workflow gerenciado", queuedAt: this.now(),
      capabilities: { ...MANAGED_ROOT_CAPABILITIES }, metrics: { self: {}, subtree: {} },
    };
    this.emit(this.deps.store.create(root));

    const pending = new Map(plan.tasks.map((task) => [task.id, task]));
    const created = new Set<string>();
    while (pending.size) {
      let progress = false;
      for (const [taskId, task] of pending) {
        const parentTaskId = task.parentExecutionId && task.parentExecutionId !== plan.rootExecutionId ? task.parentExecutionId : undefined;
        if (parentTaskId && !created.has(parentTaskId)) continue;
        if ((task.dependsOn || []).some((dependency) => !created.has(dependency))) continue;
        const item = prepared.get(taskId)!;
        const node: Omit<ExecutionNode, "schemaVersion" | "journalId"> = {
          executionId: item.executionId, rootExecutionId: plan.rootExecutionId, rootTurnId, sessionId: taskSessions.get(taskId)!,
          runnerId: plan.runnerId, parentExecutionId: parentTaskId ? prepared.get(parentTaskId)!.executionId : plan.rootExecutionId,
          dependsOn: (task.dependsOn || []).map((dependency) => prepared.get(dependency)!.executionId), depth: task.depth,
          kind: "agent", origin: "jarvis_managed", certification: item.profile?.certification || "unverified",
          state: "queued", title: journalText(task.title, 200) || "Tarefa", prompt: journalText(task.prompt), agent: task.agent, model: task.model,
          effort: task.effort, cwd: task.cwd, queuedAt: this.now(), capabilities: capabilities(item.profile, task), metrics: { self: {} },
        };
        this.emit(this.deps.store.appendNode(plan.rootExecutionId, node));
        pending.delete(taskId); created.add(taskId); progress = true;
      }
      if (!progress) throw new Error("não foi possível ordenar os nós do workflow validado");
    }
  }

  private providerSink(plan: ManagedExecutionPlan, item: PreparedTask, cwd: string): OnEvent {
    const providerIds = new Map<string, string>();
    const providerUsage = new Map<string, UsageRecord>();
    const ensureProvider = (providerId: string, seed?: Extract<ProviderExecutionEvent, { kind: "execution_spawn" }>): string => {
      const existing = providerIds.get(providerId); if (existing) return existing;
      const executionId = managedProviderExecutionId(plan.rootExecutionId, item.task.id, providerId);
      const parentId = seed?.parentProviderId ? (providerIds.get(seed.parentProviderId) || item.executionId) : item.executionId;
      const parent = this.deps.store.findNode(parentId)?.node;
      const node: Omit<ExecutionNode, "schemaVersion" | "journalId"> = {
        executionId, rootExecutionId: plan.rootExecutionId, rootTurnId: this.deps.store.snapshot(plan.rootExecutionId)!.rootTurnId,
        sessionId: this.deps.store.findNode(item.executionId)!.node.sessionId, runnerId: plan.runnerId,
        parentExecutionId: parentId, providerExecutionId: providerId, dependsOn: [], depth: seed?.node.depth ?? ((parent?.depth || item.task.depth) + 1),
        kind: seed?.node.kind || "agent", origin: "native", certification: item.profile?.certification || "unverified",
        state: "running", title: journalText(seed?.node.title || seed?.node.role, 200) || "Subprocesso", role: seed?.node.role,
        prompt: journalText(seed?.node.prompt), agent: item.task.agent, model: item.task.model, effort: item.task.effort,
        cwd, queuedAt: seed?.node.startedAt || this.now(), startedAt: seed?.node.startedAt || this.now(),
        capabilities: { ...capabilities(item.profile, item.task), ...(seed?.node.capabilities || {}) }, metrics: { self: {} },
      };
      providerIds.set(providerId, executionId); this.emit(this.deps.store.appendNode(plan.rootExecutionId, node)); return executionId;
    };
    const activity = (executionId: string, event: Exclude<Parameters<OnEvent>[0], ProviderExecutionEvent>): void => {
      if (event.kind === "text") this.append(plan.rootExecutionId, executionId, { kind: "message", role: "assistant", text: journalText(event.text) || "", published: true });
      else if (event.kind === "thinking") this.append(plan.rootExecutionId, executionId, { kind: "thinking", text: journalText(event.text), published: true });
      else if (event.kind === "plan") this.append(plan.rootExecutionId, executionId, { kind: "summary", text: journalText(event.text) || "Plano atualizado" });
      else {
        const tool = safeTool(event, cwd);
        this.append(plan.rootExecutionId, executionId, { kind: "tool", tool });
        if (tool.path) this.append(plan.rootExecutionId, executionId, { kind: "artifact", artifact: {
          artifactId: hashId("artifact", `${executionId}\0${tool.path}`), executionId,
          kind: tool.rows?.length ? "diff" : "file", name: basename(tool.path), relativePath: tool.path,
          adds: tool.adds, dels: tool.dels,
        } });
      }
    };
    return (event) => {
      if (!isProviderExecutionEvent(event)) { activity(item.executionId, event); return; }
      if (event.kind === "execution_spawn") { ensureProvider(event.providerId, event); return; }
      const executionId = ensureProvider(event.providerId);
      if (event.kind === "execution_state") {
        this.transition(plan.rootExecutionId, executionId, event.state, event.summary);
        if (event.summary) this.append(plan.rootExecutionId, executionId, { kind: "summary", text: journalText(event.summary)! });
      } else if (event.kind === "execution_usage") {
        this.append(plan.rootExecutionId, executionId, { kind: "usage", usage: event.usage, measure: event.measure || "delta", scope: event.scope || "self" });
        // A provider that labels the parent reply as `subtree` already includes descendants. For
        // self-only providers (notably Codex child rollouts), fold child usage into the workflow
        // aggregate. Snapshot collectors publish cumulative values, so convert them to deltas first.
        if (item.profile?.capabilities.usage !== "subtree") {
          const measure = event.measure || "delta";
          const delta = measure === "cumulative" ? cumulativeUsageDelta(event.usage, providerUsage.get(event.providerId)) : event.usage;
          if (measure === "cumulative") providerUsage.set(event.providerId, { ...event.usage });
          if (delta) {
            this.append(plan.rootExecutionId, plan.rootExecutionId, { kind: "usage", usage: delta, measure: "delta", scope: "subtree" });
            this.deps.onChildUsage?.({ rootExecutionId: plan.rootExecutionId, sessionId: this.deps.store.findNode(item.executionId)!.node.sessionId, agent: item.task.agent, usage: delta });
          }
        }
      } else activity(executionId, event.event);
    };
  }

  async run(plan: ManagedExecutionPlan, options: ManagedExecutionStartOptions = {}): Promise<ManagedExecutionReport> {
    const prepared = await this.preflight(plan, options.policy);
    const rootTurnId = options.rootTurnId || hashId("turn", plan.rootExecutionId);
    const rootSessionId = hashId("session", plan.rootExecutionId);
    const rootSession = await this.deps.hiddenSessions.create({
      idHint: rootSessionId, title: options.title || "Workflow gerenciado",
      agent: "jarvis-managed", cwd: plan.tasks[0].cwd, rootExecutionId: plan.rootExecutionId, executionId: plan.rootExecutionId,
    });
    if (rootSession.sessionId !== rootSessionId) throw new Error("gateway de sessão oculta não preservou o idHint do workflow");
    const taskSessions = new Map(plan.tasks.map((task) => [task.id, hashId("session", prepared.get(task.id)!.executionId)]));
    this.createNodes(plan, prepared, rootTurnId, rootSession.sessionId, taskSessions, options.title);
    this.transition(plan.rootExecutionId, plan.rootExecutionId, "running");
    options.onAccepted?.(plan.rootExecutionId);
    const leases = new Map<string, ManagedWorkspaceLease>();
    const reportedUsage = new Map<string, { usage: UsageRecord; scope: "self" | "subtree" }>();

    const transition = (record: Readonly<ManagedTaskRecord>): void => {
      const item = prepared.get(record.task.id)!;
      const target: ExecutionState = record.state;
      this.transition(plan.rootExecutionId, item.executionId, target, record.error || record.summary);
      if (record.summary) this.append(plan.rootExecutionId, item.executionId, { kind: "summary", text: journalText(record.summary)! });
      if (record.usage && TERMINAL.has(target)) {
        const reported = reportedUsage.get(record.task.id);
        const usage: UsageRecord = reported?.usage || {
          inputTokens: record.usage.inputTokens, cachedInputTokens: record.usage.cachedInputTokens,
          outputTokens: record.usage.outputTokens, costUsd: record.usage.costUsd,
          costKind: "unavailable", source: "managed scheduler outcome without provider usage metadata",
          model: record.task.model, effort: record.task.effort,
        };
        this.append(plan.rootExecutionId, item.executionId, { kind: "usage", usage, measure: "delta", scope: reported?.scope || "self" });
        this.append(plan.rootExecutionId, plan.rootExecutionId, { kind: "usage", usage, measure: "delta", scope: "subtree" });
      }
      if (TERMINAL.has(target)) {
        const snapshot = this.deps.store.snapshot(plan.rootExecutionId);
        const byId = new Map((snapshot?.nodes || []).map((node) => [node.executionId, node]));
        const descendsFromTask = (node: ExecutionNode): boolean => {
          let parent = node.parentExecutionId;
          while (parent) {
            if (parent === item.executionId) return true;
            parent = byId.get(parent)?.parentExecutionId;
          }
          return false;
        };
        for (const node of snapshot?.nodes || []) {
          if (node.origin !== "native" || !descendsFromTask(node) || (node.state !== "running" && node.state !== "waiting_input")) continue;
          this.transition(plan.rootExecutionId, node.executionId, "unknown", "o fornecedor encerrou a tarefa sem publicar o terminal deste subprocesso");
          this.append(plan.rootExecutionId, node.executionId, { kind: "diagnostic", level: "warning", code: "CHILD_TERMINAL_UNOBSERVED", message: "Estado terminal do subprocesso não publicado pelo fornecedor" });
        }
      }
      const lease = leases.get(record.task.id);
      if (lease && TERMINAL.has(target)) {
        try { this.deps.worktrees.release(lease, { executionTerminal: true }); leases.delete(record.task.id); }
        catch (error) { this.append(plan.rootExecutionId, item.executionId, { kind: "diagnostic", level: "error", code: "WORKTREE_CLEANUP_FAILED", message: journalText(String((error as Error)?.message || error)) || "Falha ao limpar worktree" }); }
      }
    };

    try {
      const report = await runManagedExecutionPlan(plan, {
        execute: async (task, context) => {
          const item = prepared.get(task.id)!;
          let lease: ManagedWorkspaceLease;
          try {
            lease = this.deps.worktrees.prepare({ executionId: item.executionId, cwd: task.cwd, write: task.write === true });
            leases.set(task.id, lease);
            if (context.workspaceAccess !== lease.access) throw new Error(`workspace preparado como ${lease.access}, esperado ${context.workspaceAccess}`);
            const sessionId = taskSessions.get(task.id)!;
            const hidden = await this.deps.hiddenSessions.create({
              idHint: sessionId, title: `[Trabalho] ${task.title}`, agent: task.agent,
              cwd: lease.cwd, rootExecutionId: plan.rootExecutionId, executionId: item.executionId,
            });
            if (hidden.sessionId !== sessionId) throw new Error(`gateway de sessão oculta não preservou o idHint para ${task.id}`);
            const prompt = managedPrompt(task, lease);
            await this.deps.hiddenSessions.append(sessionId, { role: "user", text: task.prompt, at: this.now() });
            const onEvent = this.providerSink(plan, item, lease.cwd);
            const reply = this.deps.invoke
              ? await this.deps.invoke({ adapter: item.adapter, sessionId, task, prompt, cwd: lease.cwd, lease, security: item.security, signal: context.signal, onEvent })
              : await item.adapter.send(sessionId, prompt, lease.cwd, { model: task.model, effort: task.effort, signal: context.signal }, onEvent);
            await this.deps.hiddenSessions.append(sessionId, { role: "assistant", text: reply.text, at: this.now() });
            const usage = usageRecord(reply);
            if (usage) reportedUsage.set(task.id, { usage, scope: item.profile?.capabilities.usage === "subtree" ? "subtree" : "self" });
            return { state: "succeeded" as const, summary: reply.text, usage: usage ? { ...usage, tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0) } : undefined };
          } catch (error) {
            const cancelled = context.signal.aborted || String((error as Error)?.message || error) === ABORTED;
            return { state: cancelled ? "cancelled" as const : "failed" as const, error: String((error as Error)?.message || error) };
          }
        },
      }, { policy: options.policy, signal: options.signal, onTransition: transition, now: this.now });
      this.transition(plan.rootExecutionId, plan.rootExecutionId, report.state, report.state === "succeeded" ? "Workflow concluído" : "Workflow encerrado com falhas");
      this.append(plan.rootExecutionId, plan.rootExecutionId, { kind: "summary", text: `Workflow ${report.state}: ${report.tasks.filter((task) => task.state === "succeeded").length}/${report.tasks.length} tarefas concluídas` });
      return report;
    } catch (error) {
      this.transition(plan.rootExecutionId, plan.rootExecutionId, options.signal?.aborted ? "cancelled" : "failed", String((error as Error)?.message || error));
      throw error;
    }
  }
}
