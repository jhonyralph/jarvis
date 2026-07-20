import type {
  ManagedExecutionPolicyInput,
  ManagedExecutionTask,
} from "@jarvis/core";

export const DELEGATE_AGENT_IDS = [
  "claude-code", "codex", "gemini", "cursor", "copilot", "opencode",
  "cline", "qwen", "continue", "kiro", "antigravity", "aider",
] as const;

export interface NormalizedDelegateRequest {
  machine: string;
  rootExecutionId?: string;
  title?: string;
  tasks: ManagedExecutionTask[];
  policy?: ManagedExecutionPolicyInput;
  mode: "wait" | "background";
  waitTimeoutMs: number;
}

export class DelegateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegateInputError";
  }
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DelegateInputError(`${label} deve ser um objeto`);
  return value as Record<string, unknown>;
};

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  const foreign = Object.keys(value).filter((key) => !allowed.includes(key));
  if (foreign.length) throw new DelegateInputError(`${label} contém campos desconhecidos: ${foreign.join(", ")}`);
};

const text = (value: unknown, label: string, max: number, required = true, multiline = false): string | undefined => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new DelegateInputError(`${label} deve ser texto não vazio`);
  const normalized = value.trim();
  const controls = multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/;
  if (normalized.length > max || controls.test(normalized)) throw new DelegateInputError(`${label} é inválido ou excede ${max} caracteres`);
  return normalized;
};

const positiveInt = (value: unknown, label: string, max: number, required = false): number | undefined => {
  if (value === undefined && !required) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw new DelegateInputError(`${label} deve ser inteiro entre 1 e ${max}`);
  return Number(value);
};

const nonNegative = (value: unknown, label: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new DelegateInputError(`${label} deve ser finito e não negativo`);
  return value;
};

function stringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new DelegateInputError(`${label} deve ser uma lista`);
  const out = value.map((item, index) => text(item, `${label}[${index}]`, 200)!);
  if (new Set(out).size !== out.length) throw new DelegateInputError(`${label} não pode conter itens repetidos`);
  return out;
}

function normalizeTask(value: unknown, index: number): ManagedExecutionTask {
  const task = object(value, `tasks[${index}]`);
  onlyKeys(task, ["id", "title", "prompt", "agent", "cwd", "model", "effort", "parentExecutionId", "dependsOn", "depth", "write", "dependencyPolicy", "reservation"], `tasks[${index}]`);
  const dependencyPolicy = task.dependencyPolicy;
  if (dependencyPolicy !== undefined && dependencyPolicy !== "all_succeeded" && dependencyPolicy !== "all_terminal") {
    throw new DelegateInputError(`tasks[${index}].dependencyPolicy deve ser all_succeeded ou all_terminal`);
  }
  if (task.write !== undefined && typeof task.write !== "boolean") throw new DelegateInputError(`tasks[${index}].write deve ser booleano`);
  const reservationInput = task.reservation === undefined ? undefined : object(task.reservation, `tasks[${index}].reservation`);
  if (reservationInput) onlyKeys(reservationInput, ["costUsd", "tokens"], `tasks[${index}].reservation`);
  const reservationCost = reservationInput ? nonNegative(reservationInput.costUsd, `tasks[${index}].reservation.costUsd`) : undefined;
  const reservationTokens = reservationInput ? nonNegative(reservationInput.tokens, `tasks[${index}].reservation.tokens`) : undefined;
  const reservation = reservationInput ? {
    ...(reservationCost !== undefined ? { costUsd: reservationCost } : {}),
    ...(reservationTokens !== undefined ? { tokens: reservationTokens } : {}),
  } : undefined;
  return {
    id: text(task.id, `tasks[${index}].id`, 200)!,
    title: text(task.title, `tasks[${index}].title`, 200)!,
    prompt: text(task.prompt, `tasks[${index}].prompt`, 100_000, true, true)!,
    agent: text(task.agent, `tasks[${index}].agent`, 64)!,
    cwd: text(task.cwd, `tasks[${index}].cwd`, 4_096)!,
    model: text(task.model, `tasks[${index}].model`, 160, false),
    effort: text(task.effort, `tasks[${index}].effort`, 64, false),
    parentExecutionId: text(task.parentExecutionId, `tasks[${index}].parentExecutionId`, 200, false),
    dependsOn: stringList(task.dependsOn, `tasks[${index}].dependsOn`),
    depth: positiveInt(task.depth, `tasks[${index}].depth`, 32, true)!,
    write: task.write === undefined ? undefined : task.write === true,
    dependencyPolicy: dependencyPolicy as ManagedExecutionTask["dependencyPolicy"],
    reservation,
  };
}

function normalizePolicy(value: unknown): ManagedExecutionPolicyInput | undefined {
  if (value === undefined) return undefined;
  const policy = object(value, "policy");
  onlyKeys(policy, ["maxConcurrency", "maxDepth", "maxTasks", "budget"], "policy");
  const budgetInput = policy.budget === undefined ? undefined : object(policy.budget, "policy.budget");
  if (budgetInput) onlyKeys(budgetInput, ["maxCostUsd", "maxTokens", "deadlineAt", "unknownEstimate"], "policy.budget");
  const unknownEstimate = budgetInput?.unknownEstimate;
  if (unknownEstimate !== undefined && unknownEstimate !== "allow" && unknownEstimate !== "reject") {
    throw new DelegateInputError("policy.budget.unknownEstimate deve ser allow ou reject");
  }
  return {
    maxConcurrency: positiveInt(policy.maxConcurrency, "policy.maxConcurrency", 64),
    maxDepth: positiveInt(policy.maxDepth, "policy.maxDepth", 32),
    maxTasks: positiveInt(policy.maxTasks, "policy.maxTasks", 1_000),
    budget: budgetInput ? {
      maxCostUsd: nonNegative(budgetInput.maxCostUsd, "policy.budget.maxCostUsd"),
      maxTokens: nonNegative(budgetInput.maxTokens, "policy.budget.maxTokens"),
      deadlineAt: nonNegative(budgetInput.deadlineAt, "policy.budget.deadlineAt"),
      unknownEstimate: unknownEstimate as "allow" | "reject" | undefined,
    } : undefined,
  };
}

/** Runtime validation is deliberate: the minimal MCP core publishes JSON Schema but does not evaluate it. */
export function normalizeDelegateRequest(args: Record<string, unknown>): NormalizedDelegateRequest {
  onlyKeys(args, ["machine", "rootExecutionId", "title", "tasks", "policy", "mode", "waitTimeoutMs"], "entrada");
  const machine = text(args.machine, "machine", 200)!;
  const rootExecutionId = text(args.rootExecutionId, "rootExecutionId", 200, false);
  const mode = args.mode === undefined ? "wait" : args.mode;
  if (mode !== "wait" && mode !== "background") throw new DelegateInputError("mode deve ser wait ou background");
  const waitTimeoutMs = positiveInt(args.waitTimeoutMs, "waitTimeoutMs", 600_000) || 60_000;
  if (!Array.isArray(args.tasks) || args.tasks.length < 1 || args.tasks.length > 1_000) {
    throw new DelegateInputError("tasks deve ter entre 1 e 1000 tarefas");
  }
  const tasks = args.tasks.map(normalizeTask);
  const allowedAgents = new Set<string>(DELEGATE_AGENT_IDS);
  for (const task of tasks) if (!allowedAgents.has(task.agent)) throw new DelegateInputError(`adapter não suportado em jarvis_delegate: ${task.agent}`);
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new DelegateInputError("tasks contém IDs duplicados");
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) if (!ids.has(dependency)) throw new DelegateInputError(`${task.id} depende da tarefa ausente ${dependency}`);
    if (task.parentExecutionId && task.parentExecutionId !== rootExecutionId && !ids.has(task.parentExecutionId)) {
      throw new DelegateInputError(`${task.id} referencia pai ausente ${task.parentExecutionId}`);
    }
  }
  return {
    machine,
    rootExecutionId,
    title: text(args.title, "title", 200, false),
    tasks,
    policy: normalizePolicy(args.policy),
    mode,
    waitTimeoutMs,
  };
}

const reservationSchema = {
  type: "object", additionalProperties: false,
  properties: {
    costUsd: { type: "number", minimum: 0, description: "Reserva estimada de custo em USD." },
    tokens: { type: "number", minimum: 0, description: "Reserva estimada de tokens." },
  },
} as const;

export const JARVIS_DELEGATE_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    machine: { type: "string", minLength: 1, maxLength: 200, description: "ID fixo da máquina. O Jarvis nunca escolhe nem troca a máquina durante o workflow." },
    rootExecutionId: { type: "string", minLength: 1, maxLength: 200, description: "Semente estável opcional; o bridge a transforma em um ID canônico namespaced pela máquina. Se omitida, usa uma semente aleatória." },
    title: { type: "string", minLength: 1, maxLength: 200, description: "Título do workflow." },
    mode: { type: "string", enum: ["wait", "background"], default: "wait", description: "wait devolve o relatório terminal à IA; background devolve apenas o aceite e mantém o trabalho no painel." },
    waitTimeoutMs: { type: "integer", minimum: 1, maximum: 600000, default: 60000, description: "Tempo máximo aguardando o terminal no modo wait; o workflow continua no painel após timeout." },
    tasks: {
      type: "array", minItems: 1, maxItems: 1000,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 200 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          prompt: { type: "string", minLength: 1, maxLength: 100000 },
          agent: { type: "string", enum: [...DELEGATE_AGENT_IDS], description: "Adapter a usar; precisa estar disponível na máquina escolhida." },
          cwd: { type: "string", minLength: 1, maxLength: 4096 },
          model: { type: "string", minLength: 1, maxLength: 160 },
          effort: { type: "string", minLength: 1, maxLength: 64 },
          parentExecutionId: { type: "string", minLength: 1, maxLength: 200 },
          dependsOn: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 200 } },
          depth: { type: "integer", minimum: 1, maximum: 32 },
          write: { type: "boolean", default: false, description: "Se true, exige worktree isolada; false exige sandbox somente leitura real." },
          dependencyPolicy: { type: "string", enum: ["all_succeeded", "all_terminal"], default: "all_succeeded" },
          reservation: reservationSchema,
        },
        required: ["id", "title", "prompt", "agent", "cwd", "depth"],
      },
    },
    policy: {
      type: "object", additionalProperties: false,
      properties: {
        maxConcurrency: { type: "integer", minimum: 1, maximum: 64, default: 6 },
        maxDepth: { type: "integer", minimum: 1, maximum: 32, default: 3 },
        maxTasks: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
        budget: {
          type: "object", additionalProperties: false,
          properties: {
            maxCostUsd: { type: "number", minimum: 0 },
            maxTokens: { type: "number", minimum: 0 },
            deadlineAt: { type: "number", minimum: 0, description: "Prazo absoluto em epoch milliseconds." },
            unknownEstimate: { type: "string", enum: ["allow", "reject"], default: "reject" },
          },
        },
      },
    },
  },
  required: ["machine", "tasks"],
};
