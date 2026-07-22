import { createHash } from "node:crypto";
import type { ManagedExecutionPlan, ManagedExecutionTask } from "./execution-orchestrator.js";
import type { ManagedExecutionPolicyInput } from "./execution-policy.js";

export const COUNCIL_MODES = ["auto", "quick", "technical", "critical", "deep"] as const;
export type CouncilMode = typeof COUNCIL_MODES[number];
export type ConcreteCouncilMode = Exclude<CouncilMode, "auto">;

export interface CouncilAgentCandidate {
  name: string;
  models?: Array<{ id: string; efforts?: string[]; defaultEffort?: string; selectable?: boolean }>;
  defaultModel?: string | null;
}

export interface CouncilBuildInput {
  runnerId: string;
  sessionId: string;
  topic: string;
  cwd: string;
  mode: ConcreteCouncilMode;
  agents: CouncilAgentCandidate[];
  preferredAgent?: string;
  model?: string;
  effort?: string;
  rootExecutionId?: string;
}

export interface CouncilBuildResult {
  title: string;
  mode: ConcreteCouncilMode;
  rootExecutionId: string;
  finalTaskId: string;
  plan: ManagedExecutionPlan;
  policy: ManagedExecutionPolicyInput;
}

interface CouncilRole {
  id: string;
  title: string;
  lens: string;
  dependsOn?: string[];
}

const READ_ONLY_MANAGED_AGENTS = new Set(["claude-code", "codex", "mock"]);
const FINAL_TASK_ID = "sintese";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 32);

function safeId(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "papel";
}

function rolesFor(mode: ConcreteCouncilMode): CouncilRole[] {
  if (mode === "quick") return [
    { id: "analise", title: "Analise", lens: "Responda diretamente, expondo a melhor linha de raciocinio e os criterios que mais importam." },
    { id: "critica", title: "Critica", lens: "Procure pontos cegos, riscos, suposicoes fracas e contraexemplos." },
    { id: FINAL_TASK_ID, title: "Sintese do Conselho", lens: "Sintetize a melhor decisao. Preserve dissensos relevantes; nao force consenso.", dependsOn: ["analise", "critica"] },
  ];
  if (mode === "technical") return [
    { id: "arquitetura", title: "Arquitetura", lens: "Avalie desenho tecnico, acoplamento, integracao, superficie de mudanca e manutencao." },
    { id: "implementacao", title: "Implementacao", lens: "Avalie caminho pratico de implementacao, ordem de entrega, testes e riscos de regressao." },
    { id: "seguranca", title: "Seguranca", lens: "Avalie seguranca, permissao, privacidade, isolamento, abuso e falhas de politica." },
    { id: "produto", title: "Produto", lens: "Avalie experiencia, clareza para o usuario, estados esperados e custo cognitivo." },
    { id: FINAL_TASK_ID, title: "Sintese tecnica", lens: "Una as leituras tecnicas em uma recomendacao executavel, com dissensos e proximos passos.", dependsOn: ["arquitetura", "implementacao", "seguranca", "produto"] },
  ];
  if (mode === "critical") return [
    { id: "defensor", title: "Defensor", lens: "Defenda a proposta mais promissora com argumentos fortes, pre-condicoes e beneficios reais." },
    { id: "opositor", title: "Opositor", lens: "Ataque a proposta: procure falhas, alternativas melhores, custos ocultos e cenarios de fracasso." },
    { id: "verificador", title: "Verificador", lens: "Separe fatos, inferencias e preferencias. Aponte o que precisa de prova antes da decisao." },
    { id: FINAL_TASK_ID, title: "Veredito critico", lens: "Decida com base no confronto. Informe confianca, divergencias e condicoes que mudariam a decisao.", dependsOn: ["defensor", "opositor", "verificador"] },
  ];
  return [
    { id: "logica", title: "Logica", lens: "Cheque consistencia, validade dos passos e possiveis contradicoes." },
    { id: "estrategia", title: "Estrategia", lens: "Avalie sequenciamento, trade-offs, movimentos futuros e reversibilidade." },
    { id: "principios", title: "Primeiros principios", lens: "Remova pressupostos. Reformule o problema a partir de fundamentos verificaveis." },
    { id: "sistemas", title: "Sistemas", lens: "Avalie interacoes, efeitos colaterais, ciclos de feedback e comportamento sob escala." },
    { id: "confronto", title: "Confronto", lens: "Leia as perspectivas anteriores e destaque convergencias, conflitos e informacoes ausentes.", dependsOn: ["logica", "estrategia", "principios", "sistemas"] },
    { id: FINAL_TASK_ID, title: "Sintese profunda", lens: "Produza a decisao final do Conselho, preservando dissenso, confianca, riscos e plano de acao.", dependsOn: ["logica", "estrategia", "principios", "sistemas", "confronto"] },
  ];
}

export function selectCouncilAgents(candidates: CouncilAgentCandidate[], preferredAgent?: string): CouncilAgentCandidate[] {
  const usable = candidates.filter((agent) => READ_ONLY_MANAGED_AGENTS.has(agent.name));
  const preferred = usable.find((agent) => agent.name === preferredAgent);
  return [...(preferred ? [preferred] : []), ...usable.filter((agent) => agent.name !== preferred?.name)];
}

function optionFor(agent: CouncilAgentCandidate, requestedModel?: string, requestedEffort?: string): { model?: string; effort?: string } {
  const selectable = (agent.models || []).filter((model) => model.selectable !== false);
  const model = selectable.find((item) => item.id === requestedModel) || selectable.find((item) => item.id === agent.defaultModel) || selectable[0];
  const efforts = model?.efforts || [];
  const effort = requestedEffort && efforts.includes(requestedEffort) ? requestedEffort : model?.defaultEffort || efforts[0];
  return { model: model?.id, effort };
}

function taskPrompt(input: CouncilBuildInput, role: CouncilRole): string {
  return [
    `Tema do Conselho:\n${input.topic}`,
    "",
    `Seu papel: ${role.title}.`,
    role.lens,
    "",
    "Regras:",
    "- Trabalhe de forma independente dentro do seu papel.",
    "- Seja concreto; se algo for incerto, marque como incerteza.",
    "- Nao edite arquivos. Esta tarefa e somente leitura.",
    "- Termine com um resumo curto em Markdown.",
    role.id === FINAL_TASK_ID
      ? "- Formato final: Veredito, consenso, dissensos, riscos, proximo passo."
      : "- Formato: tese, argumentos, riscos/pontos cegos, recomendacao do papel.",
  ].join("\n");
}

export function buildCouncilPlan(input: CouncilBuildInput): CouncilBuildResult {
  const topic = input.topic.trim();
  if (!topic) throw new Error("tema do Conselho vazio");
  if (!input.runnerId.trim()) throw new Error("runnerId do Conselho vazio");
  if (!input.cwd.trim()) throw new Error("cwd do Conselho vazio");
  const selected = selectCouncilAgents(input.agents, input.preferredAgent);
  if (!selected.length) throw new Error("nenhum agente com sandbox read-only gerenciado disponivel para Conselho");

  const roles = rolesFor(input.mode);
  const rootExecutionId = input.rootExecutionId || `council:${hash(`${input.runnerId}\0${input.sessionId}\0${topic}\0${Date.now()}`)}`;
  const title = `Conselho: ${topic.split(/\r?\n/)[0].slice(0, 120)}`;
  const tasks: ManagedExecutionTask[] = roles.map((role, index) => {
    const agent = selected[index % selected.length];
    const opts = optionFor(agent, input.model, input.effort);
    return {
      id: safeId(role.id), title: role.title, prompt: taskPrompt(input, role), agent: agent.name,
      cwd: input.cwd, depth: 1, write: false,
      dependsOn: role.dependsOn?.map(safeId),
      dependencyPolicy: role.id === FINAL_TASK_ID || role.dependsOn?.length ? "all_terminal" : undefined,
      model: opts.model, effort: opts.effort,
    };
  });
  return {
    title, mode: input.mode, rootExecutionId, finalTaskId: safeId(FINAL_TASK_ID),
    plan: { rootExecutionId, runnerId: input.runnerId, tasks },
    policy: { maxConcurrency: input.mode === "deep" ? 4 : Math.min(4, Math.max(2, selected.length)), maxDepth: 2, maxTasks: tasks.length },
  };
}

export function formatCouncilRequestMessage(topic: string, mode: ConcreteCouncilMode): string {
  return `Conselho (${mode}):\n\n${topic.trim()}`;
}

export function formatCouncilFinalMessage(input: {
  mode: ConcreteCouncilMode;
  rootExecutionId: string;
  summary?: string;
  failed?: boolean;
}): string {
  const body = input.summary?.trim() || "O Conselho terminou sem publicar uma sintese final.";
  return [`**Sintese do Conselho**`, "", `Modo: \`${input.mode}\``, `Trabalho: \`${input.rootExecutionId}\``, "", body,
    input.failed ? "\nObservacao: uma ou mais tarefas terminaram com falha/cancelamento; confira os dissensos em Trabalhos." : ""].join("\n");
}
