/**
 * Provider-neutral policy for Jarvis-managed child executions.
 *
 * This module is intentionally pure: the Hub/Runner can evaluate the exact same limits before
 * provisioning a workspace or starting a billable agent process.  A denied decision is explicit
 * and typed; callers must never silently weaken a read-only or isolated-write requirement.
 */

export const DEFAULT_MANAGED_EXECUTION_LIMITS = Object.freeze({
  maxConcurrency: 6,
  maxDepth: 3,
  maxTasks: 100,
});

export type ManagedWorkspaceAccess = "read_only" | "isolated_write";
export type UnknownEstimatePolicy = "allow" | "reject";

export interface ManagedBudgetAmount {
  costUsd?: number;
  tokens?: number;
}

export interface ManagedExecutionBudget {
  maxCostUsd?: number;
  maxTokens?: number;
  deadlineAt?: number;
  /** A hard budget cannot be guaranteed when the next task has no reservation estimate. */
  unknownEstimate?: UnknownEstimatePolicy;
}

export interface ManagedExecutionPolicyInput {
  maxConcurrency?: number;
  maxDepth?: number;
  maxTasks?: number;
  budget?: ManagedExecutionBudget;
}

export interface ManagedExecutionPolicy {
  maxConcurrency: number;
  maxDepth: number;
  maxTasks: number;
  budget: Readonly<ManagedExecutionBudget>;
}

export interface ManagedTaskPolicyInput {
  depth: number;
  write?: boolean;
  reservation?: ManagedBudgetAmount;
}

export interface ManagedPolicyRuntime {
  now: number;
  running: number;
  dispatched: number;
  consumed: ManagedBudgetAmount;
  reserved: ManagedBudgetAmount;
}

export type ManagedPolicyDenialCode =
  | "DEPTH_LIMIT"
  | "CONCURRENCY_LIMIT"
  | "TASK_LIMIT"
  | "DEADLINE_EXCEEDED"
  | "COST_BUDGET_EXCEEDED"
  | "TOKEN_BUDGET_EXCEEDED"
  | "COST_ESTIMATE_REQUIRED"
  | "TOKEN_ESTIMATE_REQUIRED";

export type ManagedPolicyDecision =
  | { allowed: true; workspaceAccess: ManagedWorkspaceAccess }
  | {
      allowed: false;
      workspaceAccess: ManagedWorkspaceAccess;
      code: ManagedPolicyDenialCode;
      reason: string;
      /** Transient denials should stay queued and be re-evaluated. */
      retryable: boolean;
    };

export class ManagedExecutionPolicyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedExecutionPolicyConfigError";
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ManagedExecutionPolicyConfigError(`${name} deve ser um inteiro positivo`);
  }
  return value;
}

function optionalNonNegative(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new ManagedExecutionPolicyConfigError(`${name} deve ser finito e não negativo`);
  }
  return value;
}

export function createManagedExecutionPolicy(input: ManagedExecutionPolicyInput = {}): ManagedExecutionPolicy {
  const maxConcurrency = positiveInteger(input.maxConcurrency, DEFAULT_MANAGED_EXECUTION_LIMITS.maxConcurrency, "maxConcurrency");
  const maxDepth = positiveInteger(input.maxDepth, DEFAULT_MANAGED_EXECUTION_LIMITS.maxDepth, "maxDepth");
  const maxTasks = positiveInteger(input.maxTasks, DEFAULT_MANAGED_EXECUTION_LIMITS.maxTasks, "maxTasks");
  const maxCostUsd = optionalNonNegative(input.budget?.maxCostUsd, "budget.maxCostUsd");
  const maxTokens = optionalNonNegative(input.budget?.maxTokens, "budget.maxTokens");
  const deadlineAt = optionalNonNegative(input.budget?.deadlineAt, "budget.deadlineAt");
  const unknownEstimate = input.budget?.unknownEstimate ?? "reject";
  if (unknownEstimate !== "allow" && unknownEstimate !== "reject") {
    throw new ManagedExecutionPolicyConfigError("budget.unknownEstimate deve ser 'allow' ou 'reject'");
  }
  return Object.freeze({
    maxConcurrency,
    maxDepth,
    maxTasks,
    budget: Object.freeze({ maxCostUsd, maxTokens, deadlineAt, unknownEstimate }),
  });
}

export function requiredManagedWorkspaceAccess(task: Pick<ManagedTaskPolicyInput, "write">): ManagedWorkspaceAccess {
  return task.write === true ? "isolated_write" : "read_only";
}

function amount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Evaluate one potential spawn. This function never mutates counters or reserves budget. */
export function evaluateManagedSpawn(
  policy: ManagedExecutionPolicy,
  task: ManagedTaskPolicyInput,
  runtime: ManagedPolicyRuntime,
): ManagedPolicyDecision {
  const workspaceAccess = requiredManagedWorkspaceAccess(task);
  if (!Number.isSafeInteger(task.depth) || task.depth < 1 || task.depth > policy.maxDepth) {
    return { allowed: false, workspaceAccess, code: "DEPTH_LIMIT", reason: `profundidade ${task.depth} excede o limite ${policy.maxDepth}`, retryable: false };
  }
  if (runtime.dispatched >= policy.maxTasks) {
    return { allowed: false, workspaceAccess, code: "TASK_LIMIT", reason: `limite de ${policy.maxTasks} tarefas atingido`, retryable: false };
  }
  if (runtime.running >= policy.maxConcurrency) {
    return { allowed: false, workspaceAccess, code: "CONCURRENCY_LIMIT", reason: `limite de ${policy.maxConcurrency} execuções simultâneas atingido`, retryable: true };
  }
  if (policy.budget.deadlineAt !== undefined && runtime.now >= policy.budget.deadlineAt) {
    return { allowed: false, workspaceAccess, code: "DEADLINE_EXCEEDED", reason: "prazo do workflow atingido", retryable: false };
  }

  const costReserved = amount(runtime.reserved.costUsd);
  const costConsumed = amount(runtime.consumed.costUsd);
  if (policy.budget.maxCostUsd !== undefined) {
    if (task.reservation?.costUsd === undefined && policy.budget.unknownEstimate === "reject") {
      return { allowed: false, workspaceAccess, code: "COST_ESTIMATE_REQUIRED", reason: "estimativa de custo obrigatória para respeitar o orçamento", retryable: false };
    }
    if (costConsumed + costReserved + amount(task.reservation?.costUsd) > policy.budget.maxCostUsd) {
      return { allowed: false, workspaceAccess, code: "COST_BUDGET_EXCEEDED", reason: "orçamento de custo seria excedido", retryable: false };
    }
  }

  const tokensReserved = amount(runtime.reserved.tokens);
  const tokensConsumed = amount(runtime.consumed.tokens);
  if (policy.budget.maxTokens !== undefined) {
    if (task.reservation?.tokens === undefined && policy.budget.unknownEstimate === "reject") {
      return { allowed: false, workspaceAccess, code: "TOKEN_ESTIMATE_REQUIRED", reason: "estimativa de tokens obrigatória para respeitar o orçamento", retryable: false };
    }
    if (tokensConsumed + tokensReserved + amount(task.reservation?.tokens) > policy.budget.maxTokens) {
      return { allowed: false, workspaceAccess, code: "TOKEN_BUDGET_EXCEEDED", reason: "orçamento de tokens seria excedido", retryable: false };
    }
  }

  return { allowed: true, workspaceAccess };
}

export function addManagedBudgetAmounts(a: ManagedBudgetAmount, b: ManagedBudgetAmount): ManagedBudgetAmount {
  return { costUsd: amount(a.costUsd) + amount(b.costUsd), tokens: amount(a.tokens) + amount(b.tokens) };
}

export function subtractManagedBudgetAmounts(a: ManagedBudgetAmount, b: ManagedBudgetAmount): ManagedBudgetAmount {
  return { costUsd: Math.max(0, amount(a.costUsd) - amount(b.costUsd)), tokens: Math.max(0, amount(a.tokens) - amount(b.tokens)) };
}
