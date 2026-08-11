/** F2–F7: o acompanhamento em si. Gates só sinalizam, pular fica registrado como `skipped`, e quem
 *  marcou (você, a IA ou um sinal) fica gravado para auditoria. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRun, markStep, advanceRun, jumpToStep, attachEvidence, linkSession, summarizeRun,
  isSkipAhead, stepsSkippedBy, parseStepDirectives, resolveStepRef, applyStepDirectives,
  buildWorkflowSteering, normalizeTaskRef, taskLabel,
} from "./workflow-run.js";
import type { WorkflowDefinition } from "./workflow.js";

const DEF: WorkflowDefinition = {
  schemaVersion: 1, id: "entrega", name: "Entrega com evidência",
  source: { kind: "skill", path: "skills/entrega/SKILL.md" },
  steps: [
    { id: "escopo", title: "0 — Escopo", order: 0, kind: "step" },
    { id: "diagnose", title: "1 — Diagnosticar", order: 1, kind: "step" },
    { id: "evidencia", title: "2 — Evidência", order: 2, kind: "step", requiresEvidence: true },
    { id: "gate-review", title: "GATE — revisão", order: 3, kind: "gate" },
    { id: "pr", title: "3 — Abrir PR", order: 4, kind: "step" },
  ],
};
const TASK = { tracker: "linear", key: "PRI-824", url: "https://linear.app/x" };
const mk = (sessionId?: string) => createRun(DEF, TASK, { runId: "run-1", now: 1000, sessionId });

test("a referência de tarefa é agnóstica de rastreador", () => {
  assert.deepEqual(normalizeTaskRef({ tracker: " GitHub ", key: " #42 " }), { tracker: "github", key: "#42", url: undefined, title: undefined });
  assert.equal(taskLabel({ tracker: "jira", key: "ABC-1" }), "jira: ABC-1");
  assert.equal(taskLabel({ tracker: "", key: "solto" }), "solto", "sem rastreador continua funcionando");
});

test("run nasce no primeiro passo e o resumo reflete o avanço", () => {
  let run = mk("sess-a");
  assert.equal(run.currentStepId, "escopo");
  assert.equal(run.status, "active");
  assert.equal(summarizeRun(run).percent, 0);

  run = advanceRun(run, { by: "user", now: 2000 });
  assert.equal(run.steps[0].state, "done");
  assert.equal(run.steps[0].by, "user", "guarda QUEM marcou");
  assert.equal(run.currentStepId, "diagnose");
  assert.equal(summarizeRun(run).done, 1);
});

test("gate não bloqueia — é apenas ponto de conferência", () => {
  let run = mk();
  for (const id of ["escopo", "diagnose", "evidencia"]) run = markStep(run, id, "done", { by: "user", now: 3000 });
  assert.equal(run.currentStepId, "gate-review", "o gate entra como passo normal do caminho");
  run = advanceRun(run, { by: "ai", now: 3100 });
  assert.equal(run.steps[3].state, "done");
  assert.equal(run.currentStepId, "pr", "seguiu adiante sem exigir aprovação");
});

test("pular fases registra o que foi pulado (não vira 'feito')", () => {
  const run = mk();
  assert.equal(isSkipAhead(run, "pr"), true, "a UI usa isso para pedir confirmação");
  assert.equal(isSkipAhead(run, "escopo"), false, "ir para o próximo natural não é pulo");
  assert.deepEqual(stepsSkippedBy(run, "pr").map((s) => s.id), ["escopo", "diagnose", "evidencia", "gate-review"]);

  const jumped = jumpToStep(run, "pr", { by: "user", now: 4000 });
  assert.deepEqual(jumped.steps.map((s) => s.state), ["skipped", "skipped", "skipped", "skipped", "pending"]);
  assert.equal(jumped.currentStepId, "pr");
  const s = summarizeRun(jumped);
  assert.equal(s.done, 0, "pulado NÃO conta como executado — é isso que permite auditar depois");
  assert.equal(s.skipped, 4);
});

test("evidência: exigida sinaliza quando falta, e anexar resolve", () => {
  let run = mk();
  run = markStep(run, "evidencia", "done", { by: "user", now: 5000 });
  assert.deepEqual(summarizeRun(run).missingEvidence, ["evidencia"], "sinaliza, mas não impede");

  run = attachEvidence(run, "evidencia", { kind: "link", value: "https://exemplo/print.png" }, { by: "user", now: 5100 });
  assert.equal(run.steps[2].evidence!.length, 1);
  assert.equal(run.steps[2].evidence![0].by, "user");
  assert.deepEqual(summarizeRun(run).missingEvidence, []);

  // marcar já anexando também funciona
  const direto = markStep(mk(), "evidencia", "done", { by: "ai", now: 5200, evidence: { kind: "text", value: "log do teste" } });
  assert.deepEqual(summarizeRun(direto).missingEvidence, []);
});

test("desmarcar volta o passo para pendente e limpa a autoria", () => {
  let run = advanceRun(mk(), { by: "user", now: 6000 });
  run = markStep(run, "escopo", "pending", { by: "user", now: 6100 });
  assert.equal(run.steps[0].state, "pending");
  assert.equal(run.steps[0].by, undefined);
  assert.equal(run.currentStepId, "escopo");
});

test("o run atravessa sessões (mesma tarefa, outra sessão/máquina)", () => {
  let run = mk("sess-a");
  run = linkSession(run, "sess-b", 7000);
  run = linkSession(run, "sess-a", 7100);
  assert.deepEqual(run.sessions, ["sess-a", "sess-b"], "sem duplicar");
});

test("concluir tudo fecha o run; reabrir um passo o reativa", () => {
  let run = mk();
  for (const s of DEF.steps) run = markStep(run, s.id, "done", { by: "user", now: 8000 });
  assert.equal(run.status, "done");
  assert.equal(run.currentStepId, undefined);
  assert.equal(summarizeRun(run).percent, 100);

  run = markStep(run, "pr", "pending", { by: "user", now: 8100 });
  assert.equal(run.status, "active", "reabriu");
  assert.equal(run.currentStepId, "pr");
});

test("F4 — diretivas da IA: formatos aceitos e referências resolvidas", () => {
  const d = parseStepDirectives([
    "Terminei o diagnóstico.",
    "jarvis-step: done 2",
    "> jarvis-step: skip gate-review",
    "JARVIS-STEP: feito Evidência",
    "jarvis-step: current 5",
    "texto solto jarvis-step: done 1 no meio da linha (não vale)",
  ].join("\n"));
  assert.deepEqual(d, [
    { action: "done", ref: "2" },
    { action: "skip", ref: "gate-review" },
    { action: "done", ref: "Evidência" },
    { action: "current", ref: "5" },
  ]);

  const run = mk();
  assert.equal(resolveStepRef(run, "2")!.id, "diagnose", "número é posição 1-based");
  assert.equal(resolveStepRef(run, "gate-review")!.id, "gate-review", "id exato");
  assert.equal(resolveStepRef(run, "evidencia")!.id, "evidencia");
  assert.equal(resolveStepRef(run, "Diagnosticar")!.id, "diagnose", "casa por trecho do título");
  assert.equal(resolveStepRef(run, "inexistente"), undefined);
});

test("F4 — aplicar diretivas marca com autoria 'ai' e ignora referência inválida", () => {
  const run = mk();
  const { run: out, applied } = applyStepDirectives(run, [
    { action: "done", ref: "1" },
    { action: "done", ref: "não existe" },
    { action: "skip", ref: "diagnose" },
  ], 9000);
  assert.deepEqual(applied.map((a) => a.stepId), ["escopo", "diagnose"]);
  assert.equal(out.steps[0].state, "done");
  assert.equal(out.steps[0].by, "ai");
  assert.equal(out.steps[1].state, "skipped");
  assert.equal(out.currentStepId, "evidencia");
});

test("F4 — a instrução do turno mostra onde está e como declarar avanço", () => {
  const run = advanceRun(mk(), { by: "user", now: 10_000 });
  const steer = buildWorkflowSteering(run);
  assert.match(steer, /Entrega com evidência/);
  assert.match(steer, /linear: PRI-824/);
  assert.match(steer, /Passo atual: 1 — Diagnosticar/);
  assert.match(steer, /jarvis-step: done/);
  assert.match(steer, /\[x\] 0 — Escopo/, "mostra o que já foi feito");
  assert.match(steer, /gate: só conferência/);
  assert.match(steer, /pede evidência/);
});

/* ── store durável ───────────────────────────────────────────────────────────────────────────── */
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowRunStore } from "./workflow-run-store.js";

test("store: sobrevive a restart, acha por sessão e por tarefa", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-runs-"));
  try {
    const s1 = new WorkflowRunStore({ dir });
    let run = createRun(DEF, TASK, { runId: "r1", now: 1, sessionId: "sess-a" });
    s1.put(run);
    run = advanceRun(run, { by: "user", now: 2 });
    s1.put(run);

    // outro processo (restart do Hub) relê o journal
    const s2 = new WorkflowRunStore({ dir });
    const back = s2.get("r1")!;
    assert.equal(back.steps[0].state, "done", "o progresso sobreviveu");
    assert.equal(s2.forSession("sess-a")!.runId, "r1");
    assert.equal(s2.forTask("linear", "PRI-824")!.runId, "r1");
    assert.equal(s2.forTask("github", "PRI-824"), undefined, "tarefa é (tracker, chave)");
    assert.equal(s2.active().length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("store: linha corrompida no fim não derruba o estado anterior", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-runs2-"));
  try {
    const s = new WorkflowRunStore({ dir });
    s.put(createRun(DEF, TASK, { runId: "r1", now: 1, sessionId: "sess-a" }));
    appendFileSync(join(dir, "workflow-runs.jsonl"), '{"k":"put","at":9,"run":{lixo\n');

    const reloaded = new WorkflowRunStore({ dir });
    assert.ok(reloaded.get("r1"), "o prefixo bom continua valendo");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("store: compactação preserva ativos e descarta encerrados antigos", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-runs3-"));
  try {
    const s = new WorkflowRunStore({ dir, retainClosedMs: 10, now: () => 1_000_000 });
    s.put(createRun(DEF, TASK, { runId: "vivo", now: 1_000_000, sessionId: "a" }));
    const velho = { ...createRun(DEF, { tracker: "jira", key: "OLD-1" }, { runId: "velho", now: 1, sessionId: "b" }), status: "done" as const, updatedAt: 1 };
    s.put(velho);
    s.compact();

    const reloaded = new WorkflowRunStore({ dir });
    assert.ok(reloaded.get("vivo"), "ativo permanece");
    assert.equal(reloaded.get("velho"), undefined, "encerrado antigo sai");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
