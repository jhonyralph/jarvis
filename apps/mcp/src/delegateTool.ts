import { createHash } from "node:crypto";
import type { ExecutionNode } from "@jarvis/protocol";
import type { NormalizedDelegateRequest } from "./delegate.js";
import { formatDelegateTerminalReport, isCorrelatedExecutionSnapshot, readExecutionTree, rootTerminalState } from "./delegateReport.js";
import { HubReplyTimeoutError, type PendingHubReply } from "./replyWaiters.js";

export interface DelegateToolBridge {
  createId(): string;
  waitFor(type: string, timeoutMs: number, match?: (message: unknown) => boolean): PendingHubReply<unknown>;
  request(message: unknown, replyType: string, timeoutMs?: number, match?: (message: unknown) => boolean): Promise<unknown>;
}

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : undefined;

/** Namespace a caller-stable seed by machine. The execution UI uses canonical IDs globally, so a
 * human-friendly seed such as "release" must not collide when delegated to two Runners. */
export function managedRootExecutionId(machine: string, seed: string): string {
  return `managed:${createHash("sha256").update(`${machine}\0${seed}`).digest("hex").slice(0, 32)}`;
}

/** Complete MCP lifecycle: register terminal observation before submitting, correlate the accept,
 * then page the stable terminal tree and return a bounded report to the calling model. */
export async function executeDelegate(normalized: NormalizedDelegateRequest, bridge: DelegateToolBridge): Promise<string> {
  const requestId = bridge.createId();
  const rootExecutionId = managedRootExecutionId(normalized.machine, normalized.rootExecutionId || bridge.createId());
  const tasks = normalized.tasks.map((task) => task.parentExecutionId === normalized.rootExecutionId
    ? { ...task, parentExecutionId: rootExecutionId }
    : task);
  const terminal = normalized.mode === "wait" ? bridge.waitFor("execution_delta", normalized.waitTimeoutMs,
    (message) => rootTerminalState(message, rootExecutionId, normalized.machine) !== undefined) : undefined;
  // Both branches are attached before the delegate request. Very short timeouts can expire while
  // the Hub is still acknowledging, and must never become a transient unhandled rejection.
  const terminalOutcome = terminal?.promise.then(
    (message) => ({ ok: true as const, state: rootTerminalState(message, rootExecutionId, normalized.machine)! }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  let rawReply: unknown;
  try {
    rawReply = await bridge.request({
      t: "execution_delegate",
      requestId,
      title: normalized.title,
      plan: { rootExecutionId, runnerId: normalized.machine, tasks },
      policy: normalized.policy,
    }, "execution_delegate_result", 30_000, (message) => record(message)?.requestId === requestId);
  } catch (error) {
    terminal?.cancel(error instanceof Error ? error : new Error(String(error)));
    await terminalOutcome;
    throw error;
  }
  const reply = record(rawReply);
  if (!reply || reply.ok !== true) {
    const error = new Error(typeof reply?.error === "string" ? reply.error : "Hub recusou a delegação");
    terminal?.cancel(error); await terminalOutcome; throw error;
  }
  if (reply.rootExecutionId !== undefined && reply.rootExecutionId !== rootExecutionId) {
    const error = new Error("Hub confirmou uma raiz diferente da raiz delegada");
    terminal?.cancel(error); await terminalOutcome; throw error;
  }

  const acceptedText = `Workflow aceito na máquina "${normalized.machine}" · execução ${rootExecutionId} · ${normalized.tasks.length} tarefa(s).`;
  if (!terminalOutcome) return `${acceptedText} Acompanhe em Trabalhos no Jarvis.`;
  const outcome = await terminalOutcome;
  if (!outcome.ok) {
    if (outcome.error instanceof HubReplyTimeoutError) return `${acceptedText} O tempo de espera terminou; o workflow continua e pode ser acompanhado em Trabalhos no Jarvis.`;
    return `${acceptedText} A conexão com o Hub foi perdida antes da confirmação terminal; consulte Trabalhos no Jarvis antes de assumir o resultado.`;
  }

  let nodes: ExecutionNode[] | undefined;
  let snapshotUnavailable = false;
  try {
    nodes = await readExecutionTree(rootExecutionId, normalized.machine, ({ requestId: snapshotRequestId, cursor, limit }) => bridge.request(
      { t: "executions_list", requestId: snapshotRequestId, scope: "all", rootExecutionId, runnerId: normalized.machine, cursor, limit },
      "executions_snapshot", 15_000,
      (message) => isCorrelatedExecutionSnapshot(message, snapshotRequestId, rootExecutionId, normalized.machine),
    ));
  } catch { snapshotUnavailable = true; }
  return formatDelegateTerminalReport({ acceptedText, rootExecutionId, state: outcome.state, nodes, snapshotUnavailable });
}
