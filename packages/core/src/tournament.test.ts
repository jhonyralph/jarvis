import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTournamentPlan,
  formatTournamentFinalMessage,
  parseJudgeScores,
  selectTournamentWinner,
  tournamentCandidateResults,
} from "./tournament.js";
import { managedChildExecutionId } from "./managed-execution.js";

const competitors = [
  { agent: "claude-code", model: "sonnet" },
  { agent: "codex", model: "gpt", effort: "high" },
  { agent: "gemini" },
];

test("tournament fans the same task to every candidate and adds a judge dependent on all", () => {
  const out = buildTournamentPlan({
    runnerId: "local", sessionId: "s1", cwd: "C:\\repo", task: "Otimizar a query", competitors,
  });
  assert.equal(out.candidateTaskIds.length, 3);
  assert.equal(out.judgeTaskId, "juiz");
  assert.equal(out.plan.tasks.length, 4);
  const judge = out.plan.tasks.find((task) => task.id === "juiz")!;
  assert.deepEqual(judge.dependsOn, ["candidato-1", "candidato-2", "candidato-3"]);
  assert.equal(judge.dependencyPolicy, "all_terminal");
  assert.equal(judge.write, false);
  // Candidates default to isolated write and all share the exact same prompt.
  const candidatePrompts = new Set(out.plan.tasks.filter((task) => task.id.startsWith("candidato-")).map((task) => task.prompt));
  assert.equal(candidatePrompts.size, 1);
  assert.equal(out.plan.tasks[0].write, true);
  assert.equal(out.plan.tasks[1].model, "gpt");
  assert.equal(out.plan.tasks[1].effort, "high");
});

test("tournament honors read-only mode and defaults the judge to the first competitor", () => {
  const out = buildTournamentPlan({
    runnerId: "r1", sessionId: "s1", cwd: "/repo", task: "Propor plano", competitors, write: false,
  });
  assert.equal(out.plan.tasks[0].write, false);
  assert.equal(out.plan.tasks.find((task) => task.id === "juiz")?.agent, "claude-code");
  assert.match(out.plan.tasks[0].prompt, /somente leitura/);
});

test("review mode is read-only and formats a coverage summary without a winner", () => {
  const out = buildTournamentPlan({
    runnerId: "r1", sessionId: "s1", cwd: "/repo", task: "Revisar PR", competitors, mode: "review", write: true,
  });
  assert.equal(out.plan.tasks[0].write, false);
  assert.match(out.title, /Revisao paralela/);
  const text = formatTournamentFinalMessage({
    rootExecutionId: "tournament:review",
    mode: "review",
    outcome: { winnerId: "candidato-1", reason: "ignored", ranked: [{ id: "candidato-1", eligible: true, state: "succeeded" }] },
    summary: "Achados consolidados",
  });
  assert.match(text, /Revisao paralela/);
  assert.doesNotMatch(text, /vencedor/);
});

test("tournament rejects empty tasks and fewer than two candidates", () => {
  assert.throws(() => buildTournamentPlan({ runnerId: "r", sessionId: "s", cwd: "/r", task: " ", competitors }), /tarefa/);
  assert.throws(() => buildTournamentPlan({ runnerId: "r", sessionId: "s", cwd: "/r", task: "x", competitors: [{ agent: "codex" }] }), /2 candidatos/);
});

test("parseJudgeScores extracts clamped scores and a declared winner, ignoring noise", () => {
  const verdict = parseJudgeScores([
    "Analise geral...",
    "PONTUACAO candidato-1: 82",
    "PONTUACAO candidato-2: 150",
    "linha irrelevante",
    "PONTUACAO candidato-3: -4",
    "VENCEDOR: candidato-1",
  ].join("\n"));
  assert.deepEqual(verdict.scores, [
    { id: "candidato-1", score: 82 },
    { id: "candidato-2", score: 100 },
    { id: "candidato-3", score: 0 },
  ]);
  assert.equal(verdict.declaredWinnerId, "candidato-1");
});

test("parseJudgeScores keeps the first score per id and tolerates missing winner", () => {
  const verdict = parseJudgeScores("PONTUACAO a: 10\nPONTUACAO a: 90");
  assert.deepEqual(verdict.scores, [{ id: "a", score: 10 }]);
  assert.equal(verdict.declaredWinnerId, undefined);
});

test("selectTournamentWinner promotes the highest score among succeeded candidates", () => {
  const outcome = selectTournamentWinner([
    { id: "candidato-1", state: "succeeded", score: 70 },
    { id: "candidato-2", state: "succeeded", score: 90 },
    { id: "candidato-3", state: "failed", score: 99 },
  ]);
  assert.equal(outcome.winnerId, "candidato-2");
  assert.equal(outcome.ranked.find((entry) => entry.id === "candidato-3")?.eligible, false);
});

test("selectTournamentWinner breaks ties by cost, then tokens, then order", () => {
  const byCost = selectTournamentWinner([
    { id: "a", state: "succeeded", score: 80, costUsd: 0.5 },
    { id: "b", state: "succeeded", score: 80, costUsd: 0.2 },
  ]);
  assert.equal(byCost.winnerId, "b");
  const byTokens = selectTournamentWinner([
    { id: "a", state: "succeeded", score: 80, costUsd: 0.2, tokens: 900 },
    { id: "b", state: "succeeded", score: 80, costUsd: 0.2, tokens: 500 },
  ]);
  assert.equal(byTokens.winnerId, "b");
  const byOrder = selectTournamentWinner([
    { id: "a", state: "succeeded", score: 80 },
    { id: "b", state: "succeeded", score: 80 },
  ]);
  assert.equal(byOrder.winnerId, "a");
});

test("selectTournamentWinner honors a declared winner only when eligible", () => {
  const eligible = selectTournamentWinner(
    [{ id: "a", state: "succeeded", score: 60 }, { id: "b", state: "succeeded", score: 95 }],
    { declaredWinnerId: "a" },
  );
  assert.equal(eligible.winnerId, "a");
  assert.match(eligible.reason, /declarado pelo juiz e elegivel/);

  const fallback = selectTournamentWinner(
    [{ id: "a", state: "failed", score: 99 }, { id: "b", state: "succeeded", score: 40 }],
    { declaredWinnerId: "a" },
  );
  assert.equal(fallback.winnerId, "b");
  assert.match(fallback.reason, /nao concluiu com sucesso/);
});

test("selectTournamentWinner returns no winner when nothing succeeded", () => {
  const outcome = selectTournamentWinner([
    { id: "a", state: "failed" },
    { id: "b", state: "cancelled" },
  ]);
  assert.equal(outcome.winnerId, undefined);
  assert.match(outcome.reason, /nenhum candidato/);
});

test("formatTournamentFinalMessage renders winner, work id and ranking", () => {
  const outcome = selectTournamentWinner([
    { id: "candidato-1", state: "succeeded", score: 88 },
    { id: "candidato-2", state: "failed" },
  ]);
  const text = formatTournamentFinalMessage({ rootExecutionId: "tournament:1", outcome, summary: "Boa solucao" });
  assert.match(text, /vencedor: `candidato-1`/);
  assert.match(text, /`tournament:1`/);
  assert.match(text, /candidato-1.*\(vencedor\).*88/);
  assert.match(text, /Boa solucao/);
});

test("tournamentCandidateResults lê estado/custo/tokens por candidato — o MESMO cálculo no Hub e no Runner", () => {
  // Vive no core justamente porque as duas máquinas precisam do mesmo resultado: o Hub quando a
  // Revisão roda local, o Runner quando roda nele. Se divergir, o vencedor muda com a máquina.
  const root = "root-1";
  const nodes = new Map<string, any>([
    [managedChildExecutionId(root, "c1"), { node: { state: "succeeded", metrics: { self: { inputTokens: 10, outputTokens: 5, costUsd: 0.02 } } } }],
    [managedChildExecutionId(root, "c2"), { node: { state: "failed", metrics: { self: {} } } }],
  ]);
  const source = { findNode: (id: string) => nodes.get(id) };

  const results = tournamentCandidateResults(source, root, ["c1", "c2", "c3"], new Map([["c1", 9]]));

  assert.deepEqual(results.map((r) => r.id), ["c1", "c2", "c3"], "a ordem dos candidatos é preservada");
  assert.equal(results[0].state, "succeeded");
  assert.equal(results[0].tokens, 15, "entrada + saída");
  assert.equal(results[0].costUsd, 0.02);
  assert.equal(results[0].score, 9);
  assert.equal(results[1].state, "failed");
  assert.equal(results[1].tokens, undefined, "zero tokens vira ausente, não 0 — é o que o formatador espera");
  // Candidato sem nó ainda não começou. Tem que virar "queued", e não um buraco que quebre a seleção.
  assert.equal(results[2].state, "queued");
  assert.equal(results[2].score, undefined);
  assert.equal(selectTournamentWinner(results).winnerId, "c1", "só o que teve sucesso concorre");
});
