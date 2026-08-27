/**
 * Acompanhamento de um fluxo em andamento (F2–F7).
 *
 * Decisões que este módulo materializa (vindas da descoberta):
 *  - a unidade acompanhada é a TAREFA, com referência AGNÓSTICA de rastreador (Linear, GitHub, Jira,
 *    outro ou nenhum) — nada aqui conhece um provedor específico;
 *  - a IA conduz, mas quem marca pode ser você, a IA ou um sinal local — por isso todo passo guarda
 *    QUEM marcou e quando (auditoria);
 *  - gates apenas SINALIZAM: nunca existe transição proibida por gate;
 *  - pular fases é permitido, e o que foi pulado fica registrado como `skipped` (não como feito) —
 *    é isso que permite auditar depois "o que realmente foi executado".
 *
 * Puro: só estado → estado. A persistência (journal) e os efeitos vivem no store/Hub.
 */
import type { WorkflowDefinition } from "./workflow.js";

export type RunStepState = "pending" | "done" | "skipped";
export type MarkedBy = "user" | "ai" | "signal";
export type RunStatus = "active" | "done" | "abandoned";

export interface RunEvidence {
  kind: "link" | "text";
  value: string;
  at: number;
  by: MarkedBy;
}

export interface RunStep {
  id: string;
  title: string;
  kind: "step" | "gate";
  requiresEvidence?: boolean;
  /** copiado da definição no início do run: é o que o passo espera de você, mostrado no composer. */
  hint?: string;
  state: RunStepState;
  at?: number;
  by?: MarkedBy;
  evidence?: RunEvidence[];
}

/** Referência de tarefa deliberadamente genérica: `tracker` é texto livre (linear, github, jira, …). */
export interface TaskRef {
  tracker: string;
  key: string;
  url?: string;
  title?: string;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  workflowName: string;
  task: TaskRef;
  steps: RunStep[];
  /** passo em foco; undefined quando tudo terminou. */
  currentStepId?: string;
  status: RunStatus;
  /** sessões que participaram — o mesmo fluxo pode atravessar sessões e máquinas. */
  sessions: string[];
  createdAt: number;
  updatedAt: number;
}

export function normalizeTaskRef(input: unknown): TaskRef {
  const raw = (input ?? {}) as Partial<TaskRef>;
  const clean = (v: unknown, cap = 200): string => String(v ?? "").trim().slice(0, cap);
  return {
    tracker: clean(raw.tracker, 40).toLowerCase(),
    key: clean(raw.key, 120),
    url: clean(raw.url, 500) || undefined,
    title: clean(raw.title, 300) || undefined,
  };
}

/** Rótulo humano da tarefa, sem assumir provedor. */
export function taskLabel(task: TaskRef): string {
  const base = task.key || task.title || "(sem tarefa)";
  return task.tracker ? `${task.tracker}: ${base}` : base;
}

/**
 * `startAtStepId` é o ponto de ENTRADA: você escolhe "TDD" e o acompanhamento nasce ali.
 *
 * Os passos anteriores continuam `pending` — de propósito. Entrar no meio não é "pular" o começo, é só
 * não estar nele; marcar `skipped` aqui mentiria no relatório do que foi executado. `skipped` fica
 * reservado ao gesto explícito de pular (jumpToStep), que é onde ele significa alguma coisa.
 */
export function createRun(def: WorkflowDefinition, task: TaskRef, opts: { runId: string; now: number; sessionId?: string; startAtStepId?: string }): WorkflowRun {
  const steps: RunStep[] = def.steps.map((s) => ({
    id: s.id, title: s.title, kind: s.kind, requiresEvidence: s.requiresEvidence, hint: s.hint, state: "pending" as RunStepState,
  }));
  const entry = opts.startAtStepId && steps.some((s) => s.id === opts.startAtStepId) ? opts.startAtStepId : steps[0]?.id;
  return {
    runId: opts.runId,
    workflowId: def.id,
    workflowName: def.name,
    task: normalizeTaskRef(task),
    steps,
    currentStepId: entry,
    status: steps.length ? "active" : "done",
    sessions: opts.sessionId ? [opts.sessionId] : [],
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

const clone = (run: WorkflowRun): WorkflowRun => ({ ...run, steps: run.steps.map((s) => ({ ...s, evidence: s.evidence ? [...s.evidence] : undefined })), sessions: [...run.sessions] });

/** Primeiro passo ainda pendente (a "próxima fase natural"). */
export function nextPendingStep(run: WorkflowRun): RunStep | undefined {
  return run.steps.find((s) => s.state === "pending");
}

/** Um passo está "à frente" do atual? Usado pela UI para pedir confirmação ao PULAR fases. */
export function isSkipAhead(run: WorkflowRun, stepId: string): boolean {
  const target = run.steps.findIndex((s) => s.id === stepId);
  if (target < 0) return false;
  const next = nextPendingStep(run);
  if (!next) return false;
  const nextIdx = run.steps.findIndex((s) => s.id === next.id);
  return target > nextIdx;
}

/** Passos que seriam PULADOS ao ir direto para `stepId` (ficam registrados como `skipped`). */
export function stepsSkippedBy(run: WorkflowRun, stepId: string): RunStep[] {
  const target = run.steps.findIndex((s) => s.id === stepId);
  if (target < 0) return [];
  return run.steps.slice(0, target).filter((s) => s.state === "pending");
}

/**
 * O foco SOBREVIVE a marcações em outros passos. Antes daqui o current era sempre "o primeiro
 * pendente", o que funciona num fluxo caminhado em linha reta mas destrói a escolha de quem entrou
 * direto no meio: focar "TDD" e marcar qualquer outro passo jogava o foco de volta para o passo 1.
 * Regra: mantém o foco enquanto ele ainda estiver pendente; só então cai para o próximo pendente.
 */
function refreshStatus(run: WorkflowRun): void {
  const next = nextPendingStep(run);
  const cur = run.steps.find((s) => s.id === run.currentStepId);
  run.currentStepId = cur && cur.state === "pending" ? cur.id : next?.id;
  if (!next && run.status === "active") run.status = "done";
  if (next && run.status === "done") run.status = "active";
}

/**
 * Move só o FOCO para um passo, sem mudar o estado de ninguém — é o que o seletor do composer usa.
 * Diferente de `jumpToStep`, que é o gesto de PULAR e por isso registra os anteriores como `skipped`.
 */
export function focusStep(run: WorkflowRun, stepId: string, opts: { now: number }): WorkflowRun {
  const out = clone(run);
  const target = out.steps.find((s) => s.id === stepId);
  if (!target) return out;
  out.currentStepId = stepId;
  if (out.status === "done") out.status = "active";
  out.updatedAt = opts.now;
  return out;
}

export interface MarkOptions {
  by: MarkedBy;
  now: number;
  /** evidência anexada no mesmo ato (opcional). */
  evidence?: Omit<RunEvidence, "at" | "by">;
}

/** Marca um passo como feito/pendente/pulado. Nunca bloqueia: gates só sinalizam. */
export function markStep(run: WorkflowRun, stepId: string, state: RunStepState, opts: MarkOptions): WorkflowRun {
  const out = clone(run);
  const step = out.steps.find((s) => s.id === stepId);
  if (!step) return out;
  step.state = state;
  if (state === "pending") { delete step.at; delete step.by; }
  else { step.at = opts.now; step.by = opts.by; }
  if (opts.evidence?.value) {
    step.evidence = [...(step.evidence || []), { kind: opts.evidence.kind, value: String(opts.evidence.value).slice(0, 2000), at: opts.now, by: opts.by }];
  }
  out.updatedAt = opts.now;
  refreshStatus(out);
  return out;
}

/** Conclui o passo atual e caminha para o próximo pendente. */
export function advanceRun(run: WorkflowRun, opts: MarkOptions): WorkflowRun {
  const current = run.currentStepId || nextPendingStep(run)?.id;
  if (!current) return clone(run);
  return markStep(run, current, "done", opts);
}

/**
 * Vai direto para `stepId`. Tudo que ficou pendente antes vira `skipped` — registrado, não escondido.
 * A confirmação de "você está pulando fases" é da UI (isSkipAhead/stepsSkippedBy); aqui só aplicamos,
 * porque o mesmo caminho serve ao bypass pedido pela IA no chat, que apenas acompanha.
 */
export function jumpToStep(run: WorkflowRun, stepId: string, opts: MarkOptions): WorkflowRun {
  let out = clone(run);
  if (!out.steps.some((s) => s.id === stepId)) return out;
  for (const skipped of stepsSkippedBy(out, stepId)) out = markStep(out, skipped.id, "skipped", opts);
  const target = out.steps.find((s) => s.id === stepId);
  if (target && target.state !== "pending") { target.state = "pending"; delete target.at; delete target.by; }
  out.updatedAt = opts.now;
  refreshStatus(out);
  out.currentStepId = stepId;
  if (out.status === "done") out.status = "active";
  return out;
}

export function attachEvidence(run: WorkflowRun, stepId: string, evidence: Omit<RunEvidence, "at" | "by">, opts: { by: MarkedBy; now: number }): WorkflowRun {
  const out = clone(run);
  const step = out.steps.find((s) => s.id === stepId);
  if (!step || !String(evidence.value || "").trim()) return out;
  step.evidence = [...(step.evidence || []), { kind: evidence.kind, value: String(evidence.value).slice(0, 2000), at: opts.now, by: opts.by }];
  out.updatedAt = opts.now;
  return out;
}

/**
 * Trocar a TAREFA de um acompanhamento em andamento.
 *
 * Existe porque a alternativa era a interface mentir: a gaveta oferecia "trocar" a tarefa e, com fluxo
 * ativo, tudo que ela fazia era guardar a escolha para o PRÓXIMO fluxo — a tela dizia "armada", o run
 * seguia com a tarefa antiga (ou sem nenhuma) e o turno da IA continuava falando da errada.
 *
 * Não toca em passos nem em evidência: a tarefa é O QUE se está fazendo; os passos são ONDE se está.
 * Trocar de assunto não desfaz o caminho andado — e apagar evidência aqui seria perda silenciosa.
 */
export function setRunTask(run: WorkflowRun, task: TaskRef, opts: { now: number }): WorkflowRun {
  return { ...clone(run), task: normalizeTaskRef(task), updatedAt: opts.now };
}

export function linkSession(run: WorkflowRun, sessionId: string, now: number): WorkflowRun {
  if (!sessionId || run.sessions.includes(sessionId)) return run;
  const out = clone(run);
  out.sessions.push(sessionId);
  out.updatedAt = now;
  return out;
}

export interface RunSummary {
  total: number;
  done: number;
  skipped: number;
  pending: number;
  /** passos concluídos que EXIGIAM evidência e não têm nenhuma — sinalizado, nunca bloqueante. */
  missingEvidence: string[];
  current?: { id: string; title: string; kind: "step" | "gate" };
  percent: number;
}

export function summarizeRun(run: WorkflowRun): RunSummary {
  const total = run.steps.length;
  const done = run.steps.filter((s) => s.state === "done").length;
  const skipped = run.steps.filter((s) => s.state === "skipped").length;
  const missingEvidence = run.steps.filter((s) => s.state === "done" && s.requiresEvidence && !(s.evidence && s.evidence.length)).map((s) => s.id);
  const cur = run.steps.find((s) => s.id === run.currentStepId);
  return {
    total, done, skipped, pending: total - done - skipped,
    missingEvidence,
    current: cur ? { id: cur.id, title: cur.title, kind: cur.kind } : undefined,
    percent: total ? Math.round(((done + skipped) / total) * 100) : 100,
  };
}

/* ── F4: a IA conduz ───────────────────────────────────────────────────────────────────────────────
 * A IA declara o avanço IN-BAND, no mesmo espírito do bloco ```jarvis-run``` que já funciona: uma
 * linha curta e inequívoca. Formatos aceitos (tolerantes a maiúsculas/acentos):
 *   jarvis-step: done 3           · jarvis-step: feito 3
 *   jarvis-step: done pick-up     · jarvis-step: skip 2       · jarvis-step: current 4
 * Números referem-se à POSIÇÃO (1-based) na lista; texto casa pelo id/título. */
export interface StepDirective { action: "done" | "skip" | "current"; ref: string }

export function parseStepDirectives(text: string, opts: { max?: number } = {}): StepDirective[] {
  const max = Math.max(1, opts.max ?? 10);
  const out: StepDirective[] = [];
  const re = /^[ \t>*-]*jarvis-step\s*:\s*(done|feito|conclu[íi]do|skip|pular|pulado|current|atual)\s+(.+?)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ""))) && out.length < max) {
    const verb = m[1].toLowerCase();
    const action: StepDirective["action"] = /^(skip|pular|pulado)$/.test(verb) ? "skip" : /^(current|atual)$/.test(verb) ? "current" : "done";
    out.push({ action, ref: m[2].trim().slice(0, 120) });
  }
  return out;
}

/** Resolve a referência da IA (posição 1-based, id ou trecho do título) para um passo do run. */
export function resolveStepRef(run: WorkflowRun, ref: string): RunStep | undefined {
  const raw = String(ref || "").trim();
  if (!raw) return undefined;
  const asNum = /^#?(\d{1,3})$/.exec(raw);
  if (asNum) {
    const idx = Number(asNum[1]) - 1;
    if (idx >= 0 && idx < run.steps.length) return run.steps[idx];
  }
  const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const key = norm(raw);
  return run.steps.find((s) => norm(s.id) === key)
    || run.steps.find((s) => norm(s.title) === key)
    || run.steps.find((s) => norm(s.title).includes(key) || norm(s.id).includes(key));
}

/** Aplica as diretivas que a IA emitiu. Devolve o run novo e o que mudou (para registrar/mostrar). */
export function applyStepDirectives(run: WorkflowRun, directives: StepDirective[], now: number): { run: WorkflowRun; applied: Array<{ action: StepDirective["action"]; stepId: string; title: string }> } {
  let out = run;
  const applied: Array<{ action: StepDirective["action"]; stepId: string; title: string }> = [];
  for (const d of directives) {
    const step = resolveStepRef(out, d.ref);
    if (!step) continue;
    if (d.action === "done") out = markStep(out, step.id, "done", { by: "ai", now });
    else if (d.action === "skip") out = markStep(out, step.id, "skipped", { by: "ai", now });
    // `current` MOVE O FOCO — e só. Antes caía em jumpToStep, que marcava tudo que ficou para trás como
    // `skipped`: a própria instrução do steering diz "para pular use skip / para mudar o foco use
    // current", então pular como efeito colateral de mudar o foco contrariava o que a IA foi mandada
    // fazer, e enchia o relatório de passos "pulados" que ninguém pulou.
    else out = focusStep(out, step.id, { now });
    applied.push({ action: d.action, stepId: step.id, title: step.title });
  }
  return { run: out, applied };
}

/**
 * Instrução injetada no turno quando há fluxo ativo — curta, porque custa tokens em TODO turno.
 *
 * O passo em foco vem PRIMEIRO e com o seu `hint`: despejar a lista inteira e deixar a IA adivinhar
 * qual linha importa era caro e impreciso. Os demais passos continuam listados, em uma linha compacta,
 * porque sem eles a IA não sabe para onde pode mover o foco.
 */
export function buildWorkflowSteering(run: WorkflowRun): string {
  const s = summarizeRun(run);
  const cur = run.steps.find((st) => st.id === run.currentStepId);
  const mark = (st: RunStep): string => (st.state === "done" ? "x" : st.state === "skipped" ? "-" : " ");
  const list = run.steps.map((st, i) => `${i + 1}. [${mark(st)}] ${st.title}${st.kind === "gate" ? " (gate: só conferência)" : ""}${st.requiresEvidence ? " (pede evidência)" : ""}`).join("\n");
  return [
    `Fluxo de trabalho ativo: "${run.workflowName}" — tarefa ${taskLabel(run.task)}.`,
    `Passo em foco: ${s.current ? s.current.title : "(nenhum — fluxo concluído)"}.`,
    cur?.hint ? `O que este passo espera: ${cur.hint}` : "",
    "Passos do fluxo (os não marcados podem simplesmente ainda não ter sido alcançados):",
    list,
    "Ao concluir um passo, emita numa linha própria: `jarvis-step: done <número>`. Para pular: `jarvis-step: skip <número>`. Para mudar o foco: `jarvis-step: current <número>`.",
    "Gates são só conferência: sinalize e siga; nunca trave por causa deles. Passos que pedem evidência devem citar a evidência (link ou descrição) na resposta.",
  ].filter(Boolean).join("\n");
}
