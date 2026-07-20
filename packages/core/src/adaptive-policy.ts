import { readJson, writeJsonAtomic } from "./persist.js";

export type PolicyScope = "global" | "project" | "subscope" | "session" | "task";
export type MemoryWriteTarget = "jarvis_only" | "repo_allowed" | "repo_required" | "disabled";
export type AutonomyMode = "manual" | "assisted" | "controlled_autonomy";
export type AdaptiveUnknownEstimatePolicy = "ask" | "allow" | "reject";
export type RiskLevel = "low" | "medium" | "high";
export type RepoMemoryFile = "AGENTS.md" | "CLAUDE.md" | "GEMINI.md";

export interface AdaptivePolicy {
  schemaVersion: 1;
  id: string;
  scope: PolicyScope;
  label: string;
  projectRoot?: string;
  cwdPattern?: string;
  sessionId?: string;
  taskId?: string;
  memory: {
    writeTarget: MemoryWriteTarget;
    namespaces: string[];
    allowPersonalContext: boolean;
    allowProjectContext: boolean;
    repoFiles?: RepoMemoryFile[];
  };
  autonomy: {
    mode: AutonomyMode;
    allowQueueAutoplay: boolean;
    allowBackgroundTurns: boolean;
    requireApprovalAboveRisk: RiskLevel;
  };
  budget: {
    maxCostUsd?: number;
    maxTokens?: number;
    unknownEstimate: AdaptiveUnknownEstimatePolicy;
  };
  write: {
    allowRepoWrites: boolean;
    requireDiffPreview: boolean;
  };
  updatedAt: number;
}

export interface AdaptivePolicyDocument {
  schemaVersion: 1;
  global: AdaptivePolicy;
  projects: AdaptivePolicy[];
  sessions: AdaptivePolicy[];
  tasks: AdaptivePolicy[];
}

export interface ResolvePolicyInput {
  cwd?: string;
  sessionId?: string;
  taskId?: string;
  agent?: string;
}

export interface ResolvedAdaptivePolicy {
  policy: AdaptivePolicy;
  chain: Array<{ id: string; scope: PolicyScope; label: string }>;
  warnings: string[];
}

export type MemoryWriteAction = "reject" | "jarvis" | "repo";

export interface MemoryWriteDecision {
  action: MemoryWriteAction;
  reason: string;
}

export type AdaptiveRunAction = "allow" | "ask" | "reject";

export interface AdaptiveRunRequest {
  risk?: RiskLevel;
  estimatedCostUsd?: number;
  estimatedTokens?: number;
  queueAutoplay?: boolean;
  background?: boolean;
}

export interface AdaptiveRunDecision {
  action: AdaptiveRunAction;
  reason: string;
}

const SCOPES = new Set<PolicyScope>(["global", "project", "subscope", "session", "task"]);
const WRITE_TARGETS = new Set<MemoryWriteTarget>(["jarvis_only", "repo_allowed", "repo_required", "disabled"]);
const AUTONOMY = new Set<AutonomyMode>(["manual", "assisted", "controlled_autonomy"]);
const UNKNOWN = new Set<AdaptiveUnknownEstimatePolicy>(["ask", "allow", "reject"]);
const RISKS = new Set<RiskLevel>(["low", "medium", "high"]);
const REPO_FILES = new Set<RepoMemoryFile>(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);

const writeRank: Record<MemoryWriteTarget, number> = { disabled: 0, jarvis_only: 1, repo_allowed: 2, repo_required: 3 };
const autonomyRank: Record<AutonomyMode, number> = { manual: 0, assisted: 1, controlled_autonomy: 2 };
const riskRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
const unknownRank: Record<AdaptiveUnknownEstimatePolicy, number> = { reject: 0, ask: 1, allow: 2 };

export function defaultAdaptivePolicy(now = Date.now()): AdaptivePolicy {
  return {
    schemaVersion: 1,
    id: "global",
    scope: "global",
    label: "Global",
    memory: {
      writeTarget: "jarvis_only",
      namespaces: ["project", "session", "task"],
      allowPersonalContext: false,
      allowProjectContext: true,
      repoFiles: ["AGENTS.md"],
    },
    autonomy: {
      mode: "assisted",
      allowQueueAutoplay: false,
      allowBackgroundTurns: false,
      requireApprovalAboveRisk: "medium",
    },
    budget: { unknownEstimate: "ask" },
    write: { allowRepoWrites: false, requireDiffPreview: true },
    updatedAt: now,
  };
}

export function defaultAdaptivePolicyDocument(now = Date.now()): AdaptivePolicyDocument {
  return { schemaVersion: 1, global: defaultAdaptivePolicy(now), projects: [], sessions: [], tasks: [] };
}

function stringValue(value: unknown, fallback: string, max = 300): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function optionalString(value: unknown, max = 1_000): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? value as T : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

function uniqStrings(value: unknown, fallback: string[], allowed?: Set<string>): string[] {
  const rows = Array.isArray(value) ? value : fallback;
  const out: string[] = [];
  for (const raw of rows) {
    if (typeof raw !== "string") continue;
    const item = raw.trim();
    if (!item || item.length > 80 || (allowed && !allowed.has(item))) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out.length ? out : fallback.slice();
}

export function normalizePathKey(value: unknown): string {
  if (typeof value !== "string") return "";
  let s = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/g, "");
  return s.toLowerCase();
}

function pathContains(parent: string, child: string): boolean {
  const p = normalizePathKey(parent), c = normalizePathKey(child);
  return !!p && !!c && (c === p || c.startsWith(p + "/"));
}

function normalizePolicy(raw: unknown, fallback: AdaptivePolicy, forcedScope?: PolicyScope): AdaptivePolicy {
  const v = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const scope = forcedScope || enumValue(v.scope, SCOPES, fallback.scope);
  const memory = v.memory && typeof v.memory === "object" ? v.memory as Record<string, unknown> : {};
  const autonomy = v.autonomy && typeof v.autonomy === "object" ? v.autonomy as Record<string, unknown> : {};
  const budget = v.budget && typeof v.budget === "object" ? v.budget as Record<string, unknown> : {};
  const write = v.write && typeof v.write === "object" ? v.write as Record<string, unknown> : {};
  return {
    schemaVersion: 1,
    id: stringValue(v.id, fallback.id),
    scope,
    label: stringValue(v.label, fallback.label),
    projectRoot: optionalString(v.projectRoot),
    cwdPattern: optionalString(v.cwdPattern),
    sessionId: optionalString(v.sessionId, 200),
    taskId: optionalString(v.taskId, 200),
    memory: {
      writeTarget: enumValue(memory.writeTarget, WRITE_TARGETS, fallback.memory.writeTarget),
      namespaces: uniqStrings(memory.namespaces, fallback.memory.namespaces),
      allowPersonalContext: boolValue(memory.allowPersonalContext, fallback.memory.allowPersonalContext),
      allowProjectContext: boolValue(memory.allowProjectContext, fallback.memory.allowProjectContext),
      repoFiles: uniqStrings(memory.repoFiles, fallback.memory.repoFiles || ["AGENTS.md"], REPO_FILES) as RepoMemoryFile[],
    },
    autonomy: {
      mode: enumValue(autonomy.mode, AUTONOMY, fallback.autonomy.mode),
      allowQueueAutoplay: boolValue(autonomy.allowQueueAutoplay, fallback.autonomy.allowQueueAutoplay),
      allowBackgroundTurns: boolValue(autonomy.allowBackgroundTurns, fallback.autonomy.allowBackgroundTurns),
      requireApprovalAboveRisk: enumValue(autonomy.requireApprovalAboveRisk, RISKS, fallback.autonomy.requireApprovalAboveRisk),
    },
    budget: {
      maxCostUsd: positiveNumber(budget.maxCostUsd),
      maxTokens: positiveInteger(budget.maxTokens),
      unknownEstimate: enumValue(budget.unknownEstimate, UNKNOWN, fallback.budget.unknownEstimate),
    },
    write: {
      allowRepoWrites: boolValue(write.allowRepoWrites, fallback.write.allowRepoWrites),
      requireDiffPreview: boolValue(write.requireDiffPreview, fallback.write.requireDiffPreview),
    },
    updatedAt: positiveInteger(v.updatedAt) || Date.now(),
  };
}

export function normalizeAdaptivePolicyDocument(raw: unknown, now = Date.now()): AdaptivePolicyDocument {
  const base = defaultAdaptivePolicyDocument(now);
  const v = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const global = normalizePolicy(v.global, base.global, "global");
  const normalizeList = (value: unknown, forced: PolicyScope[]): AdaptivePolicy[] => {
    const rows = Array.isArray(value) ? value : [];
    return rows.map((row, index) => {
      const fallback = { ...global, id: `${forced[0]}-${index + 1}`, scope: forced[0], label: `${forced[0]} ${index + 1}` };
      const p = normalizePolicy(row, fallback);
      return forced.includes(p.scope) ? p : { ...p, scope: forced[0] };
    });
  };
  return {
    schemaVersion: 1,
    global,
    projects: normalizeList(v.projects, ["project", "subscope"]),
    sessions: normalizeList(v.sessions, ["session"]),
    tasks: normalizeList(v.tasks, ["task"]),
  };
}

function stricterEnum<T extends string>(a: T, b: T, rank: Record<T, number>): T {
  return rank[b] < rank[a] ? b : a;
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function mergeRestrictive(base: AdaptivePolicy, next: AdaptivePolicy): AdaptivePolicy {
  return {
    ...base,
    id: next.id,
    scope: next.scope,
    label: next.label,
    projectRoot: next.projectRoot ?? base.projectRoot,
    cwdPattern: next.cwdPattern ?? base.cwdPattern,
    sessionId: next.sessionId ?? base.sessionId,
    taskId: next.taskId ?? base.taskId,
    updatedAt: Math.max(base.updatedAt, next.updatedAt),
    memory: {
      writeTarget: stricterEnum(base.memory.writeTarget, next.memory.writeTarget, writeRank),
      namespaces: [...new Set([...base.memory.namespaces, ...next.memory.namespaces])],
      allowPersonalContext: base.memory.allowPersonalContext && next.memory.allowPersonalContext,
      allowProjectContext: base.memory.allowProjectContext && next.memory.allowProjectContext,
      repoFiles: [...new Set([...(base.memory.repoFiles || []), ...(next.memory.repoFiles || [])])],
    },
    autonomy: {
      mode: stricterEnum(base.autonomy.mode, next.autonomy.mode, autonomyRank),
      allowQueueAutoplay: base.autonomy.allowQueueAutoplay && next.autonomy.allowQueueAutoplay,
      allowBackgroundTurns: base.autonomy.allowBackgroundTurns && next.autonomy.allowBackgroundTurns,
      requireApprovalAboveRisk: stricterEnum(base.autonomy.requireApprovalAboveRisk, next.autonomy.requireApprovalAboveRisk, riskRank),
    },
    budget: {
      maxCostUsd: minDefined(base.budget.maxCostUsd, next.budget.maxCostUsd),
      maxTokens: minDefined(base.budget.maxTokens, next.budget.maxTokens),
      unknownEstimate: stricterEnum(base.budget.unknownEstimate, next.budget.unknownEstimate, unknownRank),
    },
    write: {
      allowRepoWrites: base.write.allowRepoWrites && next.write.allowRepoWrites,
      requireDiffPreview: base.write.requireDiffPreview || next.write.requireDiffPreview,
    },
  };
}

function matchProject(policy: AdaptivePolicy, cwd: string): boolean {
  if (policy.scope === "project") return pathContains(policy.projectRoot || policy.cwdPattern || "", cwd);
  if (policy.scope === "subscope") return pathContains(policy.cwdPattern || policy.projectRoot || "", cwd);
  return false;
}

function matchScore(policy: AdaptivePolicy): number {
  return normalizePathKey(policy.cwdPattern || policy.projectRoot || "").length;
}

export function resolveAdaptivePolicy(doc: AdaptivePolicyDocument, input: ResolvePolicyInput = {}): ResolvedAdaptivePolicy {
  const warnings: string[] = [];
  const cwd = input.cwd || "";
  const chain: ResolvedAdaptivePolicy["chain"] = [{ id: doc.global.id, scope: "global", label: doc.global.label }];
  let policy = doc.global;
  const projectMatches = cwd ? doc.projects.filter((p) => matchProject(p, cwd)).sort((a, b) => matchScore(a) - matchScore(b)) : [];
  for (const p of projectMatches) { policy = mergeRestrictive(policy, p); chain.push({ id: p.id, scope: p.scope, label: p.label }); }
  if (input.sessionId) {
    for (const p of doc.sessions.filter((s) => s.sessionId === input.sessionId)) {
      policy = mergeRestrictive(policy, p); chain.push({ id: p.id, scope: p.scope, label: p.label });
    }
  }
  if (input.taskId) {
    for (const p of doc.tasks.filter((t) => t.taskId === input.taskId)) {
      policy = mergeRestrictive(policy, p); chain.push({ id: p.id, scope: p.scope, label: p.label });
    }
  }
  const scores = projectMatches.map(matchScore);
  if (new Set(scores).size !== scores.length) warnings.push("há políticas de projeto/subescopo com a mesma especificidade; revise cwdPattern/projectRoot");
  return { policy, chain, warnings };
}

export function decideMemoryWrite(policy: AdaptivePolicy, input: { repoAvailable?: boolean } = {}): MemoryWriteDecision {
  const target = policy.memory.writeTarget;
  if (target === "disabled") return { action: "reject", reason: "memory_disabled" };
  if (target === "jarvis_only") return { action: "jarvis", reason: "jarvis_only" };
  if (!input.repoAvailable) {
    if (target === "repo_required") return { action: "reject", reason: "repo_required_unavailable" };
    return { action: "jarvis", reason: "repo_unavailable_fallback" };
  }
  if (!policy.write.allowRepoWrites) {
    if (target === "repo_required") return { action: "reject", reason: "repo_required_but_writes_blocked" };
    return { action: "jarvis", reason: "repo_writes_blocked_fallback" };
  }
  if (policy.write.requireDiffPreview) {
    if (target === "repo_required") return { action: "reject", reason: "repo_preview_required" };
    return { action: "jarvis", reason: "repo_preview_required_fallback" };
  }
  return { action: "repo", reason: target };
}

function unknownBudgetDecision(policy: AdaptivePolicy, kind: "cost" | "tokens"): AdaptiveRunDecision | undefined {
  if (policy.budget.unknownEstimate === "allow") return undefined;
  if (policy.budget.unknownEstimate === "reject") return { action: "reject", reason: `${kind}_estimate_required` };
  return { action: "ask", reason: `${kind}_estimate_unknown` };
}

export function decideAdaptiveRun(policy: AdaptivePolicy, request: AdaptiveRunRequest = {}): AdaptiveRunDecision {
  if (request.queueAutoplay && !policy.autonomy.allowQueueAutoplay) return { action: "reject", reason: "queue_autoplay_disabled" };
  if (request.background && !policy.autonomy.allowBackgroundTurns) return { action: "reject", reason: "background_turns_disabled" };

  if (policy.budget.maxCostUsd !== undefined) {
    if (request.estimatedCostUsd === undefined) {
      const d = unknownBudgetDecision(policy, "cost");
      if (d) return d;
    } else if (request.estimatedCostUsd > policy.budget.maxCostUsd) {
      return { action: "reject", reason: "cost_budget_exceeded" };
    }
  }
  if (policy.budget.maxTokens !== undefined) {
    if (request.estimatedTokens === undefined) {
      const d = unknownBudgetDecision(policy, "tokens");
      if (d) return d;
    } else if (request.estimatedTokens > policy.budget.maxTokens) {
      return { action: "reject", reason: "token_budget_exceeded" };
    }
  }

  const risk = request.risk || "low";
  if (riskRank[risk] > riskRank[policy.autonomy.requireApprovalAboveRisk]) {
    return { action: "ask", reason: "risk_requires_approval" };
  }
  return { action: "allow", reason: "policy_allows" };
}

export function loadAdaptivePolicyDocument(file: string, now = Date.now()): AdaptivePolicyDocument {
  return normalizeAdaptivePolicyDocument(readJson<unknown>(file, undefined), now);
}

export function saveAdaptivePolicyDocument(file: string, doc: AdaptivePolicyDocument): void {
  writeJsonAtomic(file, normalizeAdaptivePolicyDocument(doc), { pretty: true });
}
