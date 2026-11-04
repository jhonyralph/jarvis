import type { ExecutionNode } from "@jarvis/protocol";
import type { ConversationReceipt } from "./conversationLedger.js";

export interface ConversationTask {
  id: string;
  runnerId: string;
  sessionId: string;
  title: string;
  state: string;
  updatedAt: number;
  summary?: string;
  origin: string;
  turnId?: string;
  needsInput: boolean;
  canCancel: boolean;
  voiceId?: string;
}
export const taskStateLabel: Record<string, string> = {
  queued: "na fila", accepted: "pedido registrado", running: "em andamento", waiting_input: "aguardando você",
  succeeded: "concluído", failed: "falhou", cancelled: "cancelado", orphaned: "interrompido",
  interrupted: "interrompido", unknown: "estado não confirmado", handled: "respondido", dispatched: "encaminhado", transcription_failed: "fala preservada; precisa de nova transcrição",
};
export function taskFromExecution(node: ExecutionNode): ConversationTask {
  return { id: node.executionId, runnerId: node.runnerId, sessionId: node.sessionId, title: node.title,
    state: node.state, updatedAt: node.endedAt || node.startedAt || node.queuedAt,
    summary: node.summary || node.currentStep, origin: node.cwd || node.sessionId, turnId: node.rootTurnId,
    needsInput: node.state === "waiting_input", canCancel: ["running", "waiting_input", "queued"].includes(node.state) && node.capabilities.cancel !== "none" };
}
export function receiptTask(row: ConversationReceipt): ConversationTask {
  return { id: row.id, runnerId: row.runnerId, sessionId: row.sessionId, title: row.text.slice(0, 160) || "Pedido de voz",
    state: row.status, updatedAt: row.updatedAt, summary: row.reply || row.error, origin: row.originSessionId,
    turnId: `vr${row.id.slice(0, 60)}`, needsInput: row.status === "interrupted", canCancel: false };
}
export function mergeConversationTasks(executions: ConversationTask[], receipts: ConversationReceipt[]): ConversationTask[] {
  const turnIds = new Set(executions.map((t) => t.turnId));
  return [...executions, ...receipts.map(receiptTask).filter((t) => !turnIds.has(t.turnId))].sort((a, b) => b.updatedAt - a.updatedAt);
}
const normalized = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[?!.,]+$/g, "").trim();
export type ConversationIntent = { kind: "status" | "result"; query: string } | { kind: "correct" | "task" | "chat"; text: string }
  | { kind: "stop" | "end" | "cancel" | "briefing" };
export function conversationIntent(text: string): ConversationIntent {
  const n = normalized(text).replace(/^(?:hey )?jarvis[, ]+/, "");
  if (/^(pare de falar|parar audio|pare o audio|silencio)$/.test(n)) return { kind: "stop" };
  if (/^((?:encerre|encerrar|encerr(a|e)) (a )?conversa|fim da conversa|tchau|ate mais)$/.test(n)) return { kind: "end" };
  if (/^(cancele|cancelar) (esta |essa |a )?tarefa$/.test(n)) return { kind: "cancel" };
  if (/^(voltei|o que mudou|resumo ao voltar|resumo das tarefas|minhas tarefas)$/.test(n)) return { kind: "briefing" };
  const status = /^(?:status|andamento|como (?:esta|vai)|como estao)(?: (?:da|do|das|dos))?\s*(.*)$/.exec(n);
  if (status) return { kind: "status", query: status[1].replace(/^(?:tarefa|trabalho)\s*/, "") };
  const result = /^(?:resultado|mostre (?:o )?resultado|leia (?:o )?resultado)(?: (?:da|do))?\s*(.*)$/.exec(n);
  if (result) return { kind: "result", query: result[1] };
  if (/^(correcao|corrija|ajuste o pedido|quis dizer|na verdade)\b/.test(n)) return { kind: "correct", text };
  if (/^(?:(?:por favor|pode|quero que voce|preciso que voce)\s+)*(?:execute|executar|implemente|implementar|investigue|investigar|crie|criar|corrigir|analise|analisar|pesquise|pesquisar|faca|fazer|novo trabalho|nova tarefa)\b/.test(n)) return { kind: "task", text };
  return { kind: "chat", text };
}
export function selectConversationTask(tasks: ConversationTask[], query: string, focus?: { runnerId: string; sessionId: string; turnId?: string }): ConversationTask | undefined {
  if (!query && focus) return tasks.find((t) => t.runnerId === focus.runnerId && t.sessionId === focus.sessionId && (!focus.turnId || t.turnId === focus.turnId));
  if (!query) return tasks.length === 1 ? tasks[0] : undefined;
  const q = normalized(query), matches = tasks.filter((t) => normalized(t.title + " " + t.origin).includes(q));
  const sessions = new Set(matches.map((t) => `${t.runnerId}\0${t.sessionId}`));
  return sessions.size === 1 ? matches[0] : undefined;
}
export function conversationBriefing(tasks: ConversationTask[], seen: Record<string, number>): string {
  const changed = tasks.filter((t) => t.updatedAt > (seen[t.id] || 0) && ["succeeded", "failed", "waiting_input", "orphaned", "interrupted", "transcription_failed"].includes(t.state));
  if (!changed.length) return "Nenhum resultado ou decisão nova desde sua última revisão.";
  return `${changed.length} atualização(ões): ${changed.slice(0, 3).map((t) => `${t.title.slice(0, 65)}: ${taskStateLabel[t.state] || t.state}`).join("; ")}.${changed.length > 3 ? " As demais estão em Tarefas e resultados." : ""}`;
}

/** Injectable coordinator: status/corrections do not await a long-running executor. */
export async function coordinateConversation(text: string, deps: {
  tasks: ConversationTask[];
  focus?: { runnerId: string; sessionId: string; turnId?: string };
  seen: Record<string, number>;
  stop(end: boolean): void;
  cancel(task: ConversationTask): Promise<string>;
  correct(task: ConversationTask, text: string): Promise<string>;
  task(text: string): Promise<string>;
  chat(text: string): Promise<string>;
}): Promise<string> {
  const intent = conversationIntent(text);
  if (intent.kind === "stop" || intent.kind === "end") { deps.stop(intent.kind === "end"); return intent.kind === "stop" ? "Parei a fala. As tarefas continuam." : "Conversa encerrada. As tarefas continuam em Tarefas e resultados."; }
  if (intent.kind === "briefing") return conversationBriefing(deps.tasks, deps.seen);
  if (intent.kind === "task") return deps.task(intent.text);
  if (intent.kind === "chat") return deps.chat(intent.text);
  const task = selectConversationTask(deps.tasks, "query" in intent ? intent.query : "", deps.focus);
  if (!task) return "Selecione a tarefa em Tarefas e resultados ou diga o nome do projeto. Não consegui identificar um único destino.";
  if (intent.kind === "cancel") return deps.cancel(task);
  if (intent.kind === "correct") return deps.correct(task, intent.text);
  return `${task.title}: ${taskStateLabel[task.state] || task.state}.${task.summary ? " " + task.summary : " O histórico da tarefa contém os detalhes disponíveis."}`;
}
