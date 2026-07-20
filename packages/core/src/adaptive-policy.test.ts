import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adaptiveAutonomyPreset,
  applyAdaptiveAutonomyPreset,
  defaultAdaptivePolicy,
  defaultAdaptivePolicyDocument,
  createAdaptiveApprovalRequest,
  decideAdaptiveRun,
  decideMemoryWrite,
  explainAdaptivePolicy,
  loadAdaptivePolicyDocument,
  mergeAdaptiveManagedPolicy,
  normalizeAdaptivePolicyDocument,
  removeAdaptivePolicyScope,
  resolveAdaptivePolicy,
  saveAdaptivePolicyDocument,
  upsertAdaptivePolicyScope,
  type AdaptivePolicy,
} from "./adaptive-policy.js";

function policy(over: Partial<AdaptivePolicy>): AdaptivePolicy {
  return { ...defaultAdaptivePolicy(1), id: "p", label: "P", ...over, memory: { ...defaultAdaptivePolicy(1).memory, ...(over.memory || {}) }, autonomy: { ...defaultAdaptivePolicy(1).autonomy, ...(over.autonomy || {}) }, budget: { ...defaultAdaptivePolicy(1).budget, ...(over.budget || {}) }, write: { ...defaultAdaptivePolicy(1).write, ...(over.write || {}) } };
}

test("default policy is conservative and asks on unknown estimates", () => {
  const doc = defaultAdaptivePolicyDocument(1);
  const resolved = resolveAdaptivePolicy(doc, { cwd: "C:/unknown" });
  assert.equal(resolved.policy.memory.writeTarget, "jarvis_only");
  assert.equal(resolved.policy.write.allowRepoWrites, false);
  assert.equal(resolved.policy.budget.unknownEstimate, "ask");
  assert.deepEqual(resolved.chain.map((x) => x.scope), ["global"]);
});

test("monorepo subscope with the longest cwd match wins over project", () => {
  const doc = normalizeAdaptivePolicyDocument({
    global: policy({ id: "global", scope: "global", label: "Global" }),
    projects: [
      policy({ id: "repo", scope: "project", label: "Repo", projectRoot: "C:/repo/jarvis", autonomy: { mode: "assisted" } as any }),
      policy({ id: "core", scope: "subscope", label: "Core", cwdPattern: "C:/repo/jarvis/packages/core", autonomy: { mode: "manual" } as any }),
    ],
  }, 1);
  const resolved = resolveAdaptivePolicy(doc, { cwd: "c:\\repo\\jarvis\\packages\\core\\src" });
  assert.deepEqual(resolved.chain.map((x) => x.id), ["global", "repo", "core"]);
  assert.equal(resolved.policy.autonomy.mode, "manual");
});

test("more specific policies cannot relax repo writes or approval strictness", () => {
  const doc = normalizeAdaptivePolicyDocument({
    global: policy({ id: "global", scope: "global", label: "Global", write: { allowRepoWrites: false, requireDiffPreview: true }, autonomy: { requireApprovalAboveRisk: "medium" } as any }),
    projects: [policy({ id: "repo", scope: "project", label: "Repo", projectRoot: "/repo", write: { allowRepoWrites: true, requireDiffPreview: false }, autonomy: { requireApprovalAboveRisk: "high" } as any })],
  }, 1);
  const resolved = resolveAdaptivePolicy(doc, { cwd: "/repo/app" });
  assert.equal(resolved.policy.write.allowRepoWrites, false);
  assert.equal(resolved.policy.write.requireDiffPreview, true);
  assert.equal(resolved.policy.autonomy.requireApprovalAboveRisk, "medium");
});

test("session and task overrides are applied after project scopes", () => {
  const doc = normalizeAdaptivePolicyDocument({
    global: policy({ id: "global", scope: "global", label: "Global", budget: { unknownEstimate: "allow" } as any }),
    projects: [policy({ id: "repo", scope: "project", label: "Repo", projectRoot: "/repo", budget: { unknownEstimate: "ask" } as any })],
    sessions: [policy({ id: "session", scope: "session", label: "Session", sessionId: "s1", budget: { maxTokens: 1000, unknownEstimate: "ask" } })],
    tasks: [policy({ id: "task", scope: "task", label: "Task", taskId: "t1", budget: { maxTokens: 500, unknownEstimate: "reject" } as any })],
  }, 1);
  const resolved = resolveAdaptivePolicy(doc, { cwd: "/repo/app", sessionId: "s1", taskId: "t1" });
  assert.deepEqual(resolved.chain.map((x) => x.scope), ["global", "project", "session", "task"]);
  assert.equal(resolved.policy.budget.maxTokens, 500);
  assert.equal(resolved.policy.budget.unknownEstimate, "reject");
});

test("corrupt policy file falls back to safe defaults and can be saved atomically", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-policy-"));
  const f = join(d, "policies.json");
  try {
    writeFileSync(f, "{bad", "utf8");
    const loaded = loadAdaptivePolicyDocument(f, 1);
    assert.equal(loaded.global.id, "global");
    loaded.global.label = "Edited";
    saveAdaptivePolicyDocument(f, loaded);
    assert.equal(loadAdaptivePolicyDocument(f, 1).global.label, "Edited");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("memory write decision follows target, repo availability and preview policy", () => {
  assert.deepEqual(decideMemoryWrite(policy({ memory: { writeTarget: "disabled" } as any })), { action: "reject", reason: "memory_disabled" });
  assert.deepEqual(decideMemoryWrite(policy({ memory: { writeTarget: "jarvis_only" } as any })), { action: "jarvis", reason: "jarvis_only" });
  assert.deepEqual(decideMemoryWrite(policy({ memory: { writeTarget: "repo_allowed" } as any })), { action: "jarvis", reason: "repo_unavailable_fallback" });
  assert.deepEqual(decideMemoryWrite(policy({ memory: { writeTarget: "repo_required" } as any })), { action: "reject", reason: "repo_required_unavailable" });
  assert.deepEqual(decideMemoryWrite(policy({ memory: { writeTarget: "repo_allowed" } as any, write: { allowRepoWrites: true, requireDiffPreview: false } as any }), { repoAvailable: true }), { action: "repo", reason: "repo_allowed" });
  assert.deepEqual(decideMemoryWrite(policy({ memory: { writeTarget: "repo_required" } as any, write: { allowRepoWrites: true, requireDiffPreview: true } as any }), { repoAvailable: true }), { action: "reject", reason: "repo_preview_required" });
});

test("adaptive run decision gates risk, unknown estimates, budgets and autonomy", () => {
  assert.deepEqual(decideAdaptiveRun(policy({ autonomy: { requireApprovalAboveRisk: "medium" } as any }), { risk: "high" }), { action: "ask", reason: "risk_requires_approval" });
  assert.deepEqual(decideAdaptiveRun(policy({ budget: { maxCostUsd: 1, unknownEstimate: "ask" } as any }), {}), { action: "ask", reason: "cost_estimate_unknown" });
  assert.deepEqual(decideAdaptiveRun(policy({ budget: { maxTokens: 1000, unknownEstimate: "reject" } as any }), {}), { action: "reject", reason: "tokens_estimate_required" });
  assert.deepEqual(decideAdaptiveRun(policy({ budget: { maxTokens: 1000, unknownEstimate: "allow" } as any }), {}), { action: "allow", reason: "policy_allows" });
  assert.deepEqual(decideAdaptiveRun(policy({ budget: { maxCostUsd: 1, unknownEstimate: "allow" } as any }), { estimatedCostUsd: 2 }), { action: "reject", reason: "cost_budget_exceeded" });
  assert.deepEqual(decideAdaptiveRun(policy({ autonomy: { allowQueueAutoplay: false } as any }), { queueAutoplay: true }), { action: "reject", reason: "queue_autoplay_disabled" });
  assert.deepEqual(decideAdaptiveRun(policy({ autonomy: { allowBackgroundTurns: false } as any }), { background: true }), { action: "reject", reason: "background_turns_disabled" });
});

test("adaptive managed policy merge keeps the strictest budget", () => {
  const adaptive = policy({ budget: { maxCostUsd: 2, maxTokens: 1000, unknownEstimate: "ask" } });
  assert.deepEqual(mergeAdaptiveManagedPolicy(undefined, adaptive), {
    budget: { maxCostUsd: 2, maxTokens: 1000, unknownEstimate: "reject" },
  });

  assert.deepEqual(mergeAdaptiveManagedPolicy({
    maxConcurrency: 4,
    budget: { maxCostUsd: 1, maxTokens: 2000, unknownEstimate: "allow" },
  }, adaptive), {
    maxConcurrency: 4,
    budget: { maxCostUsd: 1, maxTokens: 1000, unknownEstimate: "reject" },
  });

  assert.deepEqual(mergeAdaptiveManagedPolicy({
    budget: { maxCostUsd: 4, deadlineAt: 123, unknownEstimate: "reject" },
  }, policy({ budget: { unknownEstimate: "allow" } as any })), {
    budget: { maxCostUsd: 4, deadlineAt: 123, unknownEstimate: "reject" },
  });
});

test("adaptive approval request is normalized and starts pending", () => {
  assert.deepEqual(createAdaptiveApprovalRequest({
    id: "ap-1",
    action: "routine_background",
    title: "Rotina diária",
    reason: "background_turns_disabled",
    policy: policy({ id: "project", label: "Project" }),
    sessionId: "routine-1",
    now: 10,
    ttlMs: 90,
  }), {
    schemaVersion: 1,
    id: "ap-1",
    action: "routine_background",
    title: "Rotina diária",
    reason: "background_turns_disabled",
    policyId: "project",
    sessionId: "routine-1",
    createdAt: 10,
    expiresAt: 100,
    status: "pending",
  });
});

test("adaptive policy explanation reports effective control states", () => {
  const resolved = resolveAdaptivePolicy(normalizeAdaptivePolicyDocument({
    global: policy({
      id: "global",
      scope: "global",
      label: "Global",
      memory: { writeTarget: "repo_allowed" } as any,
      write: { allowRepoWrites: true, requireDiffPreview: true },
      autonomy: { allowQueueAutoplay: false, allowBackgroundTurns: true, requireApprovalAboveRisk: "medium" } as any,
      budget: { maxTokens: 1000, unknownEstimate: "ask" } as any,
    }),
  }, 1));
  const controls = Object.fromEntries(explainAdaptivePolicy(resolved).controls.map((c) => [c.key, c]));
  assert.equal(controls.memory_write.state, "allow");
  assert.equal(controls.repo_writes.state, "ask");
  assert.deepEqual([controls.queue_autoplay.state, controls.queue_autoplay.reason], ["reject", "queue_autoplay_disabled"]);
  assert.equal(controls.background_turns.state, "allow");
  assert.deepEqual([controls.high_risk.state, controls.high_risk.reason], ["ask", "risk_requires_approval"]);
  assert.deepEqual([controls.budget_unknown.state, controls.budget_unknown.reason], ["ask", "tokens_estimate_unknown"]);
});

test("adaptive policy scope upsert replaces project keys and removes scoped overrides", () => {
  let doc = defaultAdaptivePolicyDocument(1);
  doc = upsertAdaptivePolicyScope(doc, {
    scope: "project",
    id: "repo",
    label: "Repo",
    projectRoot: "C:/Work/Jarvis",
    autonomy: { allowQueueAutoplay: true } as any,
  }, 10);
  doc = upsertAdaptivePolicyScope(doc, {
    scope: "project",
    id: "repo-renamed",
    label: "Repo renomeado",
    projectRoot: "c:\\work\\jarvis\\",
    memory: { writeTarget: "disabled" } as any,
  }, 20);
  assert.equal(doc.projects.length, 1);
  assert.equal(doc.projects[0].id, "repo-renamed");
  assert.equal(resolveAdaptivePolicy(doc, { cwd: "C:/Work/Jarvis/apps/hub" }).policy.memory.writeTarget, "disabled");

  doc = upsertAdaptivePolicyScope(doc, { scope: "session", id: "s-policy", label: "Sessão", sessionId: "s1", budget: { maxTokens: 500 } as any }, 30);
  assert.equal(resolveAdaptivePolicy(doc, { cwd: "C:/Work/Jarvis", sessionId: "s1" }).policy.budget.maxTokens, 500);
  doc = removeAdaptivePolicyScope(doc, "session", "s-policy", 40);
  assert.equal(resolveAdaptivePolicy(doc, { cwd: "C:/Work/Jarvis", sessionId: "s1" }).policy.budget.maxTokens, undefined);
});

test("adaptive autonomy presets map modes to coherent controls", () => {
  assert.deepEqual(adaptiveAutonomyPreset("manual"), { mode: "manual", allowQueueAutoplay: false, allowBackgroundTurns: false, requireApprovalAboveRisk: "low" });
  assert.deepEqual(adaptiveAutonomyPreset("assisted"), { mode: "assisted", allowQueueAutoplay: false, allowBackgroundTurns: false, requireApprovalAboveRisk: "medium" });
  assert.deepEqual(adaptiveAutonomyPreset("controlled_autonomy"), { mode: "controlled_autonomy", allowQueueAutoplay: true, allowBackgroundTurns: true, requireApprovalAboveRisk: "high" });

  const applied = applyAdaptiveAutonomyPreset(policy({ autonomy: { mode: "manual", allowQueueAutoplay: false } as any }), "controlled_autonomy");
  assert.equal(applied.autonomy.mode, "controlled_autonomy");
  assert.equal(applied.autonomy.allowQueueAutoplay, true);
  assert.equal(applied.autonomy.allowBackgroundTurns, true);
});
