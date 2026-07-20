import { randomUUID } from "node:crypto";
import { redactExecutionText } from "@jarvis/core";
import { executionNodeProblems, type ExecutionNode, type ExecutionState } from "@jarvis/protocol";

const TERMINAL = new Set<ExecutionState>(["succeeded", "failed", "cancelled"]);
const PAGE_SIZE = 500;
const MAX_PAGES = 100;
const MAX_SUMMARY = 2_000;
const MAX_REPORT = 100_000;

export interface ExecutionSnapshotPage {
  nodes: ExecutionNode[];
  nextCursor?: string;
}

export interface ExecutionPageRequest {
  requestId: string;
  rootExecutionId: string;
  runnerId: string;
  cursor?: string;
  limit: number;
}

export type RequestExecutionPage = (request: ExecutionPageRequest) => Promise<unknown>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function rootTerminalState(message: unknown, rootExecutionId: string, runnerId?: string): ExecutionState | undefined {
  const frame = record(message), event = record(frame?.event);
  if (frame?.t !== "execution_delta" || (runnerId !== undefined && frame.runnerId !== runnerId) || event?.rootExecutionId !== rootExecutionId
    || event.executionId !== rootExecutionId || event.kind !== "state_changed"
    || typeof event.to !== "string" || !TERMINAL.has(event.to as ExecutionState)) return undefined;
  return event.to as ExecutionState;
}

export function isCorrelatedExecutionSnapshot(message: unknown, requestId: string, rootExecutionId: string, runnerId?: string): boolean {
  const frame = record(message);
  if (frame?.t !== "executions_snapshot" || frame.requestId !== requestId || !Array.isArray(frame.nodes)) return false;
  return frame.nodes.every((node) => {
    const candidate = record(node);
    if (candidate?.rootExecutionId !== rootExecutionId || (runnerId !== undefined && candidate.runnerId !== runnerId)) return false;
    try { return executionNodeProblems(node as ExecutionNode).length === 0; }
    catch { return false; }
  });
}

function parseSnapshotPage(value: unknown, requestId: string, rootExecutionId: string, runnerId: string): ExecutionSnapshotPage {
  if (!isCorrelatedExecutionSnapshot(value, requestId, rootExecutionId, runnerId)) throw new Error("snapshot de execução inválido ou não correlacionado");
  const frame = value as { nodes: ExecutionNode[]; nextCursor?: unknown };
  if (frame.nextCursor !== undefined && (typeof frame.nextCursor !== "string" || !frame.nextCursor.trim())) {
    throw new Error("cursor inválido no snapshot de execução");
  }
  return { nodes: frame.nodes, nextCursor: frame.nextCursor as string | undefined };
}

/** Reads one stable, root-filtered terminal tree. Every page has its own correlation id so
 * concurrent MCP calls and empty pages cannot consume each other's snapshot. */
export async function readExecutionTree(rootExecutionId: string, runnerId: string, requestPage: RequestExecutionPage): Promise<ExecutionNode[]> {
  const nodes = new Map<string, ExecutionNode>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const requestId = randomUUID();
    const page = parseSnapshotPage(await requestPage({ requestId, rootExecutionId, runnerId, cursor, limit: PAGE_SIZE }), requestId, rootExecutionId, runnerId);
    for (const node of page.nodes) nodes.set(node.executionId, node);
    if (!page.nextCursor) {
      if (!nodes.has(rootExecutionId)) throw new Error("snapshot não contém a raiz solicitada");
      return [...nodes.values()];
    }
    if (page.nextCursor === cursor || cursors.has(page.nextCursor)) throw new Error("paginação cíclica no snapshot de execução");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error(`snapshot excedeu o limite defensivo de ${MAX_PAGES * PAGE_SIZE} nós`);
}

const oneLine = (value: string | undefined, max: number): string => {
  const redacted = redactExecutionText(value)?.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim() || "";
  return redacted.slice(0, max);
};

export interface DelegateTerminalReportInput {
  acceptedText: string;
  rootExecutionId: string;
  state: ExecutionState;
  nodes?: ExecutionNode[];
  snapshotUnavailable?: boolean;
}

/** Bounded, secret-scrubbed response returned into the calling model's tool context. */
export function formatDelegateTerminalReport(input: DelegateTerminalReportInput): string {
  const children = (input.nodes || [])
    .filter((node) => node.rootExecutionId === input.rootExecutionId && node.executionId !== input.rootExecutionId && node.origin === "jarvis_managed")
    .sort((a, b) => a.queuedAt - b.queuedAt || a.executionId.localeCompare(b.executionId));
  const counts = new Map<string, number>();
  for (const node of children) counts.set(node.state, (counts.get(node.state) || 0) + 1);
  const countText = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([state, count]) => `${state}=${count}`).join(", ");
  let out = `${input.acceptedText}\nEstado final: ${input.state}.`;
  if (children.length) out += `\nTarefas: ${children.length}${countText ? ` (${countText})` : ""}.`;
  if (input.snapshotUnavailable) return `${out}\nOs resumos dos filhos estão temporariamente indisponíveis; consulte Trabalhos no Jarvis pela execução ${input.rootExecutionId}.`;
  let included = 0;
  for (const node of children) {
    const title = oneLine(node.title, 200) || oneLine(node.executionId, 200) || "Tarefa";
    const summary = oneLine(node.summary, MAX_SUMMARY);
    const line = `\n- ${title}: ${node.state}${summary ? ` — ${summary}` : ""}`;
    if (out.length + line.length > MAX_REPORT) break;
    out += line; included += 1;
  }
  if (included < children.length) out += `\n… ${children.length - included} tarefa(s) omitida(s) por limite de resposta; o relatório completo permanece em Trabalhos.`;
  return out;
}
