import {
  addManagedBudgetAmounts,
  createManagedExecutionPolicy,
  evaluateManagedSpawn,
  subtractManagedBudgetAmounts,
  type ManagedBudgetAmount,
  type ManagedExecutionPolicy,
  type ManagedExecutionPolicyInput,
  type ManagedWorkspaceAccess,
} from "./execution-policy.js";

export type ManagedTaskState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ManagedDependencyPolicy = "all_succeeded" | "all_terminal";

export interface ManagedExecutionTask {
  id: string;
  title: string;
  prompt: string;
  agent: string;
  cwd: string;
  model?: string;
  effort?: string;
  parentExecutionId?: string;
  dependsOn?: string[];
  depth: number;
  write?: boolean;
  dependencyPolicy?: ManagedDependencyPolicy;
  reservation?: ManagedBudgetAmount;
}

export interface ManagedExecutionPlan {
  rootExecutionId: string;
  /** Fixed by the caller. The managed scheduler never chooses or changes machines. */
  runnerId: string;
  tasks: ManagedExecutionTask[];
}

export interface ManagedTaskUsage extends ManagedBudgetAmount {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface ManagedTaskOutcome {
  state?: "succeeded" | "failed" | "cancelled";
  summary?: string;
  error?: string;
  usage?: ManagedTaskUsage;
}

export interface ManagedExecutionContext {
  rootExecutionId: string;
  runnerId: string;
  workspaceAccess: ManagedWorkspaceAccess;
  signal: AbortSignal;
}

/** Adapter/workspace wiring implements this boundary; the scheduler itself is provider-neutral. */
export interface ManagedExecutionExecutor {
  execute(task: Readonly<ManagedExecutionTask>, context: ManagedExecutionContext): Promise<ManagedTaskOutcome>;
}

export interface ManagedTaskRecord {
  task: Readonly<ManagedExecutionTask>;
  state: ManagedTaskState;
  workspaceAccess: ManagedWorkspaceAccess;
  startedAt?: number;
  endedAt?: number;
  summary?: string;
  error?: string;
  errorCode?: string;
  usage?: ManagedTaskUsage;
}

export interface ManagedExecutionReport {
  rootExecutionId: string;
  runnerId: string;
  state: "succeeded" | "failed" | "cancelled";
  tasks: ManagedTaskRecord[];
  usage: ManagedBudgetAmount;
  startedAt: number;
  endedAt: number;
}

export interface ManagedExecutionSchedulerOptions {
  policy?: ManagedExecutionPolicy | ManagedExecutionPolicyInput;
  signal?: AbortSignal;
  onTransition?: (record: Readonly<ManagedTaskRecord>) => void;
  now?: () => number;
}

export type ManagedPlanErrorCode =
  | "EMPTY_PLAN"
  | "INVALID_ID"
  | "INVALID_TASK"
  | "INVALID_PARENT"
  | "DUPLICATE_TASK"
  | "MISSING_DEPENDENCY"
  | "SELF_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "INVALID_DEPTH"
  | "TASK_LIMIT";

export class ManagedExecutionPlanError extends Error {
  constructor(readonly code: ManagedPlanErrorCode, message: string) {
    super(message);
    this.name = "ManagedExecutionPlanError";
  }
}

const safeId = (value: string): boolean =>
  typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);

function normalizePolicy(policy?: ManagedExecutionPolicy | ManagedExecutionPolicyInput): ManagedExecutionPolicy {
  return createManagedExecutionPolicy(policy ? {
    maxConcurrency: policy.maxConcurrency,
    maxDepth: policy.maxDepth,
    maxTasks: policy.maxTasks,
    budget: policy.budget,
  } : undefined);
}

/** Validate the entire DAG before the first child is allowed to start. */
export function validateManagedExecutionPlan(plan: ManagedExecutionPlan, policy: ManagedExecutionPolicy): void {
  if (!safeId(plan.rootExecutionId) || !safeId(plan.runnerId)) {
    throw new ManagedExecutionPlanError("INVALID_ID", "rootExecutionId e runnerId devem ser IDs seguros");
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    throw new ManagedExecutionPlanError("EMPTY_PLAN", "o plano gerenciado precisa de pelo menos uma tarefa");
  }
  if (plan.tasks.length > policy.maxTasks) {
    throw new ManagedExecutionPlanError("TASK_LIMIT", `o plano possui ${plan.tasks.length} tarefas; limite ${policy.maxTasks}`);
  }

  const byId = new Map<string, ManagedExecutionTask>();
  for (const task of plan.tasks) {
    if (!safeId(task.id)) throw new ManagedExecutionPlanError("INVALID_ID", "task.id deve ter 1..200 caracteres sem controles");
    if (byId.has(task.id)) throw new ManagedExecutionPlanError("DUPLICATE_TASK", `tarefa duplicada: ${task.id}`);
    if (!task.title?.trim() || task.title.length > 200 || !task.prompt?.trim() || !task.agent?.trim() || !task.cwd?.trim()) {
      throw new ManagedExecutionPlanError("INVALID_TASK", `tarefa ${task.id} não possui título, prompt, agente e cwd válidos`);
    }
    if (task.dependencyPolicy !== undefined && task.dependencyPolicy !== "all_succeeded" && task.dependencyPolicy !== "all_terminal") {
      throw new ManagedExecutionPlanError("INVALID_TASK", `dependencyPolicy inválida em ${task.id}`);
    }
    for (const [label, value] of Object.entries(task.reservation ?? {})) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new ManagedExecutionPlanError("INVALID_TASK", `reserva ${label} inválida em ${task.id}`);
      }
    }
    if (!Number.isSafeInteger(task.depth) || task.depth < 1 || task.depth > policy.maxDepth) {
      throw new ManagedExecutionPlanError("INVALID_DEPTH", `profundidade inválida em ${task.id}`);
    }
    byId.set(task.id, task);
  }
  for (const task of plan.tasks) {
    const parent = task.parentExecutionId;
    if (parent === task.id) throw new ManagedExecutionPlanError("INVALID_PARENT", `${task.id} não pode ser seu próprio pai`);
    if (parent && parent !== plan.rootExecutionId && !byId.has(parent)) {
      throw new ManagedExecutionPlanError("INVALID_PARENT", `pai ${parent} de ${task.id} não pertence à raiz`);
    }
    const expectedDepth = parent && parent !== plan.rootExecutionId ? byId.get(parent)!.depth + 1 : 1;
    if (task.depth !== expectedDepth) {
      throw new ManagedExecutionPlanError("INVALID_DEPTH", `${task.id} deveria estar na profundidade ${expectedDepth}`);
    }
    const seen = new Set<string>();
    for (const dependency of task.dependsOn ?? []) {
      if (dependency === task.id) throw new ManagedExecutionPlanError("SELF_DEPENDENCY", `${task.id} depende de si mesma`);
      if (!byId.has(dependency)) throw new ManagedExecutionPlanError("MISSING_DEPENDENCY", `${task.id} depende da tarefa ausente ${dependency}`);
      if (seen.has(dependency)) throw new ManagedExecutionPlanError("DUPLICATE_TASK", `${task.id} repete a dependência ${dependency}`);
      seen.add(dependency);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ManagedExecutionPlanError("DEPENDENCY_CYCLE", `ciclo detectado em ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of plan.tasks) visit(task.id);
}

function cloneRecord(record: ManagedTaskRecord): ManagedTaskRecord {
  return { ...record, task: { ...record.task, dependsOn: [...(record.task.dependsOn ?? [])] }, usage: record.usage ? { ...record.usage } : undefined };
}

function usageBudget(usage?: ManagedTaskUsage): ManagedBudgetAmount {
  if (!usage) return {};
  const tokens = usage.tokens ?? Math.max(0, usage.inputTokens ?? 0) + Math.max(0, usage.outputTokens ?? 0);
  return { costUsd: usage.costUsd, tokens };
}

function terminal(state: ManagedTaskState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

/**
 * Execute a validated DAG with bounded concurrency and budget reservations.
 *
 * Ordering is stable (input order). A dependency failure fails its default `all_succeeded`
 * dependents without starting them. `all_terminal` is an explicit continuation policy.
 */
export async function runManagedExecutionPlan(
  plan: ManagedExecutionPlan,
  executor: ManagedExecutionExecutor,
  options: ManagedExecutionSchedulerOptions = {},
): Promise<ManagedExecutionReport> {
  const policy = normalizePolicy(options.policy);
  validateManagedExecutionPlan(plan, policy);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  let cancelledBy: "caller" | "deadline" | undefined;
  const onAbort = (): void => { cancelledBy = "caller"; controller.abort(); };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  let deadlineTimer: NodeJS.Timeout | undefined;
  if (policy.budget.deadlineAt !== undefined) {
    const armDeadline = (): void => {
      const remaining = policy.budget.deadlineAt! - now();
      if (remaining <= 0) { cancelledBy = "deadline"; controller.abort(); return; }
      // Node clamps larger delays to 1 ms. Re-arm instead, so a long budget cannot expire early.
      deadlineTimer = setTimeout(armDeadline, Math.min(remaining, 2_147_483_647));
      deadlineTimer.unref?.();
    };
    armDeadline();
  }

  const records = new Map<string, ManagedTaskRecord>();
  for (const task of plan.tasks) {
    records.set(task.id, {
      task: Object.freeze({ ...task, dependsOn: [...(task.dependsOn ?? [])] }),
      state: "queued",
      workspaceAccess: task.write === true ? "isolated_write" : "read_only",
    });
  }
  const emit = (record: ManagedTaskRecord): void => options.onTransition?.(cloneRecord(record));
  const setTerminal = (record: ManagedTaskRecord, state: "succeeded" | "failed" | "cancelled", patch: Partial<ManagedTaskRecord> = {}): void => {
    record.state = state;
    record.endedAt = now();
    Object.assign(record, patch);
    emit(record);
  };

  let dispatched = 0;
  let consumed: ManagedBudgetAmount = {};
  let reserved: ManagedBudgetAmount = {};
  const running = new Map<string, Promise<{ id: string; outcome?: ManagedTaskOutcome; error?: unknown }>>();

  const start = (record: ManagedTaskRecord): void => {
    record.state = "running";
    record.startedAt = now();
    dispatched++;
    reserved = addManagedBudgetAmounts(reserved, record.task.reservation ?? {});
    emit(record);
    const promise = Promise.resolve()
      .then(() => executor.execute(record.task, {
        rootExecutionId: plan.rootExecutionId,
        runnerId: plan.runnerId,
        workspaceAccess: record.workspaceAccess,
        signal: controller.signal,
      }))
      .then((outcome) => ({ id: record.task.id, outcome }), (error: unknown) => ({ id: record.task.id, error }));
    running.set(record.task.id, promise);
  };

  try {
    while ([...records.values()].some((record) => !terminal(record.state))) {
      if (controller.signal.aborted) {
        for (const record of records.values()) {
          if (record.state === "queued") setTerminal(record, "cancelled", {
            errorCode: cancelledBy === "deadline" ? "DEADLINE_EXCEEDED" : "CANCELLED",
            error: cancelledBy === "deadline" ? "prazo do workflow atingido" : "workflow cancelado",
          });
        }
      }

      // A failed/cancelled prerequisite blocks default dependents permanently.
      for (const record of records.values()) {
        if (record.state !== "queued" || record.task.dependencyPolicy === "all_terminal") continue;
        const dependencies = (record.task.dependsOn ?? []).map((id) => records.get(id)!);
        const blocker = dependencies.find((dependency) => dependency.state === "failed" || dependency.state === "cancelled");
        if (blocker) setTerminal(record, "failed", {
          errorCode: "DEPENDENCY_FAILED",
          error: `dependência ${blocker.task.id} terminou como ${blocker.state}`,
        });
      }

      if (!controller.signal.aborted) {
        for (const record of records.values()) {
          if (record.state !== "queued") continue;
          const dependencies = (record.task.dependsOn ?? []).map((id) => records.get(id)!);
          const ready = record.task.dependencyPolicy === "all_terminal"
            ? dependencies.every((dependency) => terminal(dependency.state))
            : dependencies.every((dependency) => dependency.state === "succeeded");
          if (!ready) continue;
          const decision = evaluateManagedSpawn(policy, record.task, {
            now: now(),
            running: running.size,
            dispatched,
            consumed,
            reserved,
          });
          if (decision.allowed) start(record);
          else if (!decision.retryable) setTerminal(record, decision.code === "DEADLINE_EXCEEDED" ? "cancelled" : "failed", { errorCode: decision.code, error: decision.reason });
        }
      }

      if (running.size === 0) {
        // Validation excludes cycles. Any unresolved node here is a defensive failure, not a hang.
        for (const record of records.values()) {
          if (record.state === "queued") setTerminal(record, "failed", { errorCode: "SCHEDULER_STALLED", error: "nenhuma tarefa elegível para execução" });
        }
        break;
      }

      const settled = await Promise.race(running.values());
      running.delete(settled.id);
      const record = records.get(settled.id)!;
      reserved = subtractManagedBudgetAmounts(reserved, record.task.reservation ?? {});
      if (settled.error !== undefined) {
        const aborted = controller.signal.aborted;
        setTerminal(record, aborted ? "cancelled" : "failed", {
          errorCode: aborted ? (cancelledBy === "deadline" ? "DEADLINE_EXCEEDED" : "CANCELLED") : "EXECUTOR_ERROR",
          error: aborted ? (cancelledBy === "deadline" ? "prazo do workflow atingido" : "workflow cancelado") : String((settled.error as { message?: unknown } | null)?.message ?? settled.error),
        });
        continue;
      }
      const outcome = settled.outcome ?? {};
      consumed = addManagedBudgetAmounts(consumed, usageBudget(outcome.usage));
      const state = outcome.state ?? "succeeded";
      if (state !== "succeeded" && state !== "failed" && state !== "cancelled") {
        setTerminal(record, "failed", { error: "executor retornou um estado terminal inválido", usage: outcome.usage, errorCode: "MALFORMED_OUTCOME" });
      } else {
        setTerminal(record, state, {
          summary: outcome.summary,
          error: outcome.error,
          usage: outcome.usage,
          errorCode: state === "failed" ? "EXECUTOR_FAILED" : state === "cancelled" ? "CANCELLED" : undefined,
        });
      }
    }
  } finally {
    // A durable transition hook may throw (for example, journal fsync failure). Stop children that
    // were already scheduled instead of leaving them billable and detached from their owner.
    if (running.size > 0 && !controller.signal.aborted) controller.abort();
    if (deadlineTimer) clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  const tasks = plan.tasks.map((task) => cloneRecord(records.get(task.id)!));
  const state: ManagedExecutionReport["state"] = tasks.some((task) => task.state === "failed")
    ? "failed"
    : tasks.some((task) => task.state === "cancelled") ? "cancelled" : "succeeded";
  return { rootExecutionId: plan.rootExecutionId, runnerId: plan.runnerId, state, tasks, usage: consumed, startedAt, endedAt: now() };
}
