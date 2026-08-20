/** F1 — o parser PROPÕE um fluxo a partir da prosa da skill; o humano confirma. Os casos abaixo usam
 *  as três convenções que realmente convivem no framework do usuário. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkflowFromSkill, normalizeWorkflowDefinition, workflowToFile, workflowFromFile, workflowPath, dedupeWorkflowsById } from "./workflow.js";

const EVIDENCE_STYLE = `---
name: evidence-driven-delivery
description: Fluxo de entrega com evidência.
---

# Evidence-Driven Delivery

## The mindset (why this works)
Texto solto que não é passo.

## The pipeline

### 0 — Pick up & scope
Leia o ticket e delimite o escopo.

### 1 — Diagnose
Reproduza contra o sistema vivo.

### 4 — Evidence (before **and** after)
Capture screenshot antes e depois.

### 10 — Reviewers, tags, state
Feche o ciclo.
`;

const PHASE_GATE_STYLE = `---
name: discovery-breakdown
---
## Phase 0 — Context
Leia o repo antes de perguntar.

## Phase 1 — Deep discovery
Perguntas de eliminação.

## GATE_APPROACH (hard stop) ⛔
Pare e obtenha aprovação humana.

## Phase 3 — Breakdown
Fatias verticais finas.
`;

const CHECKLIST_ONLY = `---
name: linear-task-pattern
---
# Padrão
Sem numeração aqui.

## Checklist
- [ ] Abrir a task com contexto
- [ ] Anexar evidência do resultado
- [ ] Fechar com resumo
`;

test("títulos numerados viram passos, na ordem, ignorando seções que não são passo", () => {
  const wf = parseWorkflowFromSkill(EVIDENCE_STYLE, { path: "skills/evidence-driven-delivery/SKILL.md" });
  assert.equal(wf.id, "evidence-driven-delivery");
  assert.equal(wf.source.kind, "skill");
  assert.deepEqual(wf.steps.map((s) => s.title), [
    "0 — Pick up & scope", "1 — Diagnose", "4 — Evidence (before **and** after)", "10 — Reviewers, tags, state",
  ], "só os títulos numerados; 'The mindset' e 'The pipeline' ficam de fora");
  assert.deepEqual(wf.steps.map((s) => s.order), [0, 1, 2, 3]);
  assert.equal(wf.steps[0].hint, "Leia o ticket e delimite o escopo.", "guarda a 1ª linha do corpo para revisão");
  assert.equal(wf.steps[2].requiresEvidence, true, "o passo de evidência é marcado como tal");
  assert.ok(!wf.steps[0].requiresEvidence, "um passo comum não vira exigência de evidência");
});

test("fases + GATE viram passos, e o gate é identificado como ponto de conferência", () => {
  const wf = parseWorkflowFromSkill(PHASE_GATE_STYLE, { path: "skills/discovery-breakdown/SKILL.md" });
  assert.deepEqual(wf.steps.map((s) => s.kind), ["step", "step", "gate", "step"]);
  assert.match(wf.steps[2].title, /GATE_APPROACH/);
  assert.deepEqual(wf.steps.map((s) => s.id), ["phase-0-context", "phase-1-deep-discovery", "gate-approach-hard-stop", "phase-3-breakdown"]);
});

test("sem numeração, cai para os checkboxes do Checklist", () => {
  const wf = parseWorkflowFromSkill(CHECKLIST_ONLY);
  assert.deepEqual(wf.steps.map((s) => s.title), ["Abrir a task com contexto", "Anexar evidência do resultado", "Fechar com resumo"]);
  assert.equal(wf.steps[1].requiresEvidence, true);
});

test("quando não há estrutura confiável, devolve zero passos em vez de inventar", () => {
  const wf = parseWorkflowFromSkill("# Só prosa\n\nUm parágrafo qualquer.\n\n## Quando usar\nOutro parágrafo.\n");
  assert.equal(wf.steps.length, 0, "nada de passo imaginário — o cliente oferece montar na mão");
});

test("não confunde markdown dentro de bloco de código com título/checkbox", () => {
  const wf = parseWorkflowFromSkill(["---", "name: x", "---", "```md", "### 1 — não é passo", "- [ ] nem isso", "```", "### 1 — Passo real", "corpo", "### 2 — Outro", "corpo"].join("\n"));
  assert.deepEqual(wf.steps.map((s) => s.title), ["1 — Passo real", "2 — Outro"]);
});

test("normalize saneia a edição humana: ordem recalculada, ids únicos, título vazio some", () => {
  const def = normalizeWorkflowDefinition({
    id: "Meu Fluxo!", name: "Meu Fluxo",
    steps: [
      { title: "Passo A", kind: "gate" },
      { title: "   " },                       // descartado
      { title: "Passo A" },                   // id colide → sufixo
      { title: "Passo B", requiresEvidence: true, hint: "x".repeat(400) },
    ],
  });
  assert.equal(def.id, "meu-fluxo");
  assert.deepEqual(def.steps.map((s) => s.id), ["passo-a", "passo-a-2", "passo-b"]);
  assert.deepEqual(def.steps.map((s) => s.order), [0, 1, 2]);
  assert.equal(def.steps[0].kind, "gate");
  assert.equal(def.steps[2].requiresEvidence, true);
  assert.equal(def.steps[2].hint!.length, 200, "hint é limitado");
});

test("autoStart: o fluxo declara no PRÓPRIO arquivo que é o padrão", () => {
  const comAuto = workflowFromFile('{"id":"p","name":"P","autoStart":true,"steps":[{"title":"1 — a"}]}');
  assert.equal(comAuto!.autoStart, true, "viaja junto com o fluxo para todas as máquinas");

  // Ausente, false, ou qualquer valor que não seja o booleano `true` → não é padrão. E o campo nem
  // aparece: um `autoStart: false` explícito não diz nada que a ausência já não diga.
  for (const raw of ['{"id":"p","name":"P","steps":[{"title":"1 — a"}]}',
                     '{"id":"p","name":"P","autoStart":false,"steps":[{"title":"1 — a"}]}',
                     '{"id":"p","name":"P","autoStart":"sim","steps":[{"title":"1 — a"}]}',
                     '{"id":"p","name":"P","autoStart":1,"steps":[{"title":"1 — a"}]}']) {
    const d = workflowFromFile(raw)!;
    assert.equal(d.autoStart, undefined, raw);
    assert.equal("autoStart" in d, false, "campo nem existe quando não é padrão");
  }

  // e sobrevive à ida e volta para o disco, que é o que faz a publicação levar a decisão junto
  const back = workflowFromFile(workflowToFile(comAuto!).content);
  assert.equal(back!.autoStart, true);
});

test("ida e volta para arquivo do framework", () => {
  const wf = parseWorkflowFromSkill(PHASE_GATE_STYLE, { path: "skills/discovery-breakdown/SKILL.md" });
  const file = workflowToFile(wf);
  assert.equal(file.path, "flows/discovery-breakdown.json");
  assert.equal(workflowPath("Discovery Breakdown"), "flows/discovery-breakdown.json");
  const back = workflowFromFile(file.content);
  assert.deepEqual(back, wf);
  assert.equal(workflowFromFile("{lixo"), null, "conteúdo inválido não derruba nada");
  assert.equal(workflowFromFile('{"id":"x","steps":[]}'), null, "fluxo sem passos não conta");
});

// O painel mostrava "Pipeline de engenharia (F1–F14)" três vezes: `flows/x.json`, `.json.bak` e
// `.json.bak.bak` viravam três definições do MESMO fluxo. O resíduo saiu do manifesto, mas id é
// identidade — a lista não pode depender disso para não repetir.
test("dedupeWorkflowsById: o mesmo id aparece uma vez, e vence o primeiro lido", () => {
  const defs = [
    { id: "pipeline", name: "Pipeline", path: "flows/pipeline.json" },
    { id: "pipeline", name: "Pipeline", path: "flows/pipeline.json.bak" },
    { id: "hotfix", name: "Hotfix", path: "flows/hotfix.json" },
    { id: "pipeline", name: "Pipeline", path: "flows/pipeline.json.bak.bak" },
  ];

  const out = dedupeWorkflowsById(defs);

  assert.deepEqual(out.map((d) => d.path), ["flows/pipeline.json", "flows/hotfix.json"]);
});
