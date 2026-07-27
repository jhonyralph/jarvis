import { createHash } from "node:crypto";
import type { ManagedExecutionPlan, ManagedExecutionTask, ManagedTaskState } from "./execution-orchestrator.js";
import type { ManagedExecutionPolicyInput } from "./execution-policy.js";

/**
 * Torneio: fan-out da MESMA tarefa para N candidatos, cada um na sua worktree isolada, seguido de
 * um juiz que pontua os resultados. A promoção automática do vencedor (`selectTournamentWinner`) é
 * a parte que o Jarvis adiciona sobre o padrão coordinator/worker do Orca, que deixa o merge do
 * vencedor para humano+git. Aqui a seleção é determinística e testável, sem efeitos colaterais.
 */

const JUDGE_TASK_ID = "juiz";

export interface TournamentCompetitor {
  agent: string;
  model?: string;
  effort?: string;
  /** Rótulo opcional para diferenciar candidatos do mesmo agente (ex.: modelos distintos). */
  label?: string;
}

export interface TournamentBuildInput {
  runnerId: string;
  sessionId: string;
  cwd: string;
  /** Tarefa compartilhada resolvida por todos os candidatos em paralelo. */
  task: string;
  competitors: TournamentCompetitor[];
  /** Quem pontua os resultados; por padrão o primeiro candidato (somente leitura). */
  judge?: TournamentCompetitor;
  /** Critérios de julgamento adicionais expostos ao juiz. */
  criteria?: string;
  /** Se true (default), cada candidato recebe worktree isolada para produzir um diff real. */
  write?: boolean;
  rootExecutionId?: string;
}

export interface TournamentBuildResult {
  title: string;
  rootExecutionId: string;
  judgeTaskId: string;
  candidateTaskIds: string[];
  plan: ManagedExecutionPlan;
  policy: ManagedExecutionPolicyInput;
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 32);

function candidateLabel(competitor: TournamentCompetitor, index: number): string {
  const parts = [competitor.label || competitor.agent];
  if (!competitor.label && competitor.model) parts.push(competitor.model);
  return `${index + 1}. ${parts.join(" · ")}`;
}

function candidatePrompt(input: TournamentBuildInput): string {
  const access = input.write === false
    ? "- Esta tarefa e somente leitura; nao edite arquivos, apenas proponha a solucao."
    : "- Trabalhe apenas na worktree isolada fornecida; nao faca merge/rebase/push.";
  return [
    `Tarefa do torneio:\n${input.task}`,
    "",
    "Voce e um dos candidatos competindo para resolver a mesma tarefa.",
    "Regras:",
    "- Trabalhe de forma independente; produza sua melhor solucao completa.",
    access,
    "- Termine com um resumo curto em Markdown do que fez e por que sua solucao e boa.",
  ].join("\n");
}

function judgePrompt(input: TournamentBuildInput, candidates: Array<{ id: string; label: string }>): string {
  const roster = candidates.map((candidate) => `- ${candidate.id}: ${candidate.label}`).join("\n");
  return [
    `Tarefa avaliada:\n${input.task}`,
    "",
    "Voce e o juiz do torneio. Os resultados dos candidatos estao nas dependencias acima.",
    "Candidatos:",
    roster,
    "",
    input.criteria ? `Criterios prioritarios:\n${input.criteria}\n` : "",
    "Regras:",
    "- Avalie cada candidato de forma justa; nao edite arquivos (somente leitura).",
    "- De uma pontuacao inteira de 0 a 100 a cada candidato.",
    "- Formato obrigatorio, uma linha por candidato: `PONTUACAO <id>: <0-100>`.",
    "- Depois, uma unica linha: `VENCEDOR: <id>`.",
    "- Encerre com uma justificativa curta em Markdown.",
  ].filter(Boolean).join("\n");
}

/** Monta o plano de torneio: N candidatos independentes + 1 juiz dependente de todos. */
export function buildTournamentPlan(input: TournamentBuildInput): TournamentBuildResult {
  const task = input.task.trim();
  if (!task) throw new Error("tarefa do torneio vazia");
  if (!input.runnerId.trim()) throw new Error("runnerId do torneio vazio");
  if (!input.cwd.trim()) throw new Error("cwd do torneio vazio");
  if (input.competitors.length < 2) throw new Error("torneio exige ao menos 2 candidatos");

  const write = input.write !== false;
  const rootExecutionId = input.rootExecutionId
    || `tournament:${hash(`${input.runnerId}\0${input.sessionId}\0${task}\0${Date.now()}`)}`;
  const title = `Torneio: ${task.split(/\r?\n/)[0].slice(0, 120)}`;

  const candidates = input.competitors.map((competitor, index) => ({
    id: `candidato-${index + 1}`,
    label: candidateLabel(competitor, index),
    competitor,
  }));
  const prompt = candidatePrompt(input);
  const candidateTasks: ManagedExecutionTask[] = candidates.map((candidate) => ({
    id: candidate.id, title: candidate.label, prompt, agent: candidate.competitor.agent,
    cwd: input.cwd, depth: 1, write,
    model: candidate.competitor.model, effort: candidate.competitor.effort,
  }));

  const judge = input.judge || input.competitors[0];
  const judgeTask: ManagedExecutionTask = {
    id: JUDGE_TASK_ID, title: "Juiz do torneio",
    prompt: judgePrompt(input, candidates.map(({ id, label }) => ({ id, label }))),
    agent: judge.agent, cwd: input.cwd, depth: 1, write: false,
    model: judge.model, effort: judge.effort,
    dependsOn: candidates.map((candidate) => candidate.id),
    dependencyPolicy: "all_terminal",
  };

  const tasks = [...candidateTasks, judgeTask];
  return {
    title, rootExecutionId, judgeTaskId: JUDGE_TASK_ID,
    candidateTaskIds: candidates.map((candidate) => candidate.id),
    plan: { rootExecutionId, runnerId: input.runnerId, tasks },
    policy: { maxConcurrency: Math.min(6, Math.max(2, input.competitors.length)), maxDepth: 2, maxTasks: tasks.length },
  };
}

export interface JudgeScore {
  id: string;
  score: number;
}

export interface JudgeVerdict {
  scores: JudgeScore[];
  /** Vencedor declarado pelo juiz, se presente e parseável. Nao e autoritativo por si so. */
  declaredWinnerId?: string;
}

/** Parser puro da saida do juiz. Ignora linhas malformadas em vez de falhar. */
export function parseJudgeScores(text: string | undefined): JudgeVerdict {
  const scores: JudgeScore[] = [];
  const seen = new Set<string>();
  let declaredWinnerId: string | undefined;
  for (const rawLine of (text || "").split(/\r?\n/)) {
    const scoreMatch = rawLine.match(/PONTUACAO\s+([A-Za-z0-9_-]+)\s*:\s*(-?\d+(?:\.\d+)?)/i);
    if (scoreMatch) {
      const id = scoreMatch[1];
      const value = Number(scoreMatch[2]);
      if (!seen.has(id) && Number.isFinite(value)) {
        seen.add(id);
        scores.push({ id, score: Math.max(0, Math.min(100, value)) });
      }
      continue;
    }
    const winnerMatch = rawLine.match(/VENCEDOR\s*:\s*([A-Za-z0-9_-]+)/i);
    if (winnerMatch && !declaredWinnerId) declaredWinnerId = winnerMatch[1];
  }
  return { scores, declaredWinnerId };
}

export interface TournamentCandidateResult {
  id: string;
  state: ManagedTaskState;
  score?: number;
  costUsd?: number;
  tokens?: number;
}

export interface TournamentRankEntry {
  id: string;
  eligible: boolean;
  state: ManagedTaskState;
  score?: number;
}

export interface TournamentOutcome {
  winnerId?: string;
  ranked: TournamentRankEntry[];
  reason: string;
}

/**
 * Seleção determinística do vencedor. Elegibilidade exige estado `succeeded`. Entre elegiveis,
 * ordena por pontuacao desc, empatando por menor custo, menor tokens e ordem original. Um vencedor
 * declarado pelo juiz so prevalece se for elegivel; caso contrario cai para o topo do ranking.
 */
export function selectTournamentWinner(
  candidates: TournamentCandidateResult[],
  options: { declaredWinnerId?: string } = {},
): TournamentOutcome {
  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
  const eligible = indexed.filter(({ candidate }) => candidate.state === "succeeded");

  const better = (a: typeof indexed[number], b: typeof indexed[number]): number => {
    const scoreA = a.candidate.score ?? -Infinity;
    const scoreB = b.candidate.score ?? -Infinity;
    if (scoreA !== scoreB) return scoreB - scoreA;
    const costA = a.candidate.costUsd ?? Infinity;
    const costB = b.candidate.costUsd ?? Infinity;
    if (costA !== costB) return costA - costB;
    const tokensA = a.candidate.tokens ?? Infinity;
    const tokensB = b.candidate.tokens ?? Infinity;
    if (tokensA !== tokensB) return tokensA - tokensB;
    return a.index - b.index;
  };
  const ordered = [...eligible].sort(better);

  const ranked: TournamentRankEntry[] = indexed.map(({ candidate }) => ({
    id: candidate.id, eligible: candidate.state === "succeeded", state: candidate.state, score: candidate.score,
  }));

  if (!ordered.length) return { winnerId: undefined, ranked, reason: "nenhum candidato concluiu com sucesso" };

  const declared = options.declaredWinnerId
    ? ordered.find(({ candidate }) => candidate.id === options.declaredWinnerId)
    : undefined;
  if (declared) return { winnerId: declared.candidate.id, ranked, reason: "vencedor declarado pelo juiz e elegivel" };
  const reason = options.declaredWinnerId
    ? "vencedor declarado pelo juiz nao concluiu com sucesso; promovido o topo do ranking"
    : "promovido o candidato de maior pontuacao entre os concluidos";
  return { winnerId: ordered[0].candidate.id, ranked, reason };
}

export function formatTournamentFinalMessage(input: {
  rootExecutionId: string;
  outcome: TournamentOutcome;
  summary?: string;
}): string {
  const { outcome } = input;
  const header = outcome.winnerId
    ? `**Torneio** — vencedor: \`${outcome.winnerId}\``
    : "**Torneio** — sem vencedor";
  const rankLines = outcome.ranked
    .map((entry) => `- \`${entry.id}\`${entry.id === outcome.winnerId ? " (vencedor)" : ""}: ${entry.state}${entry.score !== undefined ? ` · ${entry.score}` : ""}`)
    .join("\n");
  return [
    header,
    `Trabalho: \`${input.rootExecutionId}\``,
    outcome.reason,
    "",
    rankLines,
    input.summary?.trim() ? `\n${input.summary.trim()}` : "",
  ].filter(Boolean).join("\n");
}
