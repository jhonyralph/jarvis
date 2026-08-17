/**
 * Persistência dos acompanhamentos de fluxo. O estado é do HUB (decisão da descoberta: sincronizar
 * entre máquinas), então ele precisa sobreviver a restart e a crash no meio de uma escrita.
 *
 * Mesma receita já provada em background-jobs/execution-store: journal append-only, uma linha por
 * evento, `fsync` a cada append (a transição está no disco físico antes de agirmos sobre ela), replay
 * que PARA na primeira linha corrompida (um crash no meio do append perde só a cauda incompleta) e
 * compactação atômica para o arquivo não crescer sem limite.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeTextAtomic } from "./persist.js";
import type { WorkflowRun } from "./workflow-run.js";

type RunEvent =
  | { k: "put"; at: number; run: WorkflowRun }
  | { k: "del"; at: number; runId: string }
  /** foco por SESSÃO (multi-tarefa): qual run esta sessão está olhando; null limpa. */
  | { k: "focus"; at: number; sessionId: string; runId: string | null };

export interface WorkflowRunStoreOptions {
  dir?: string;
  now?: () => number;
  /** descarta runs concluídos/abandonados mais antigos que isto na compactação (default 30 dias). */
  retainClosedMs?: number;
  compactEvery?: number;
}

const JARVIS_HOME = process.env.JARVIS_HOME || homedir();

export class WorkflowRunStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly retainClosedMs: number;
  private readonly compactEvery: number;
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly focus = new Map<string, string>();
  private appended = 0;

  constructor(opts: WorkflowRunStoreOptions = {}) {
    const dir = opts.dir || join(JARVIS_HOME, ".jarvis", "hub");
    this.file = join(dir, "workflow-runs.jsonl");
    this.now = opts.now || (() => Date.now());
    this.retainClosedMs = opts.retainClosedMs ?? 30 * 24 * 60 * 60 * 1000;
    this.compactEvery = Math.max(1, opts.compactEvery ?? 400);
    mkdirSync(dir, { recursive: true });
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    let raw = "";
    try { raw = readFileSync(this.file, "utf8"); } catch { return; }
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      let ev: RunEvent;
      try { ev = JSON.parse(line) as RunEvent; } catch { break; }  // cauda torta: fica com o prefixo bom
      if (!this.apply(ev)) break;
    }
  }

  private apply(ev: RunEvent): boolean {
    if (!ev || typeof ev !== "object") return false;
    if (ev.k === "put") {
      if (!ev.run?.runId) return false;
      this.runs.set(ev.run.runId, ev.run);
      return true;
    }
    if (ev.k === "del") { this.runs.delete(ev.runId); return true; }
    if (ev.k === "focus") {
      if (!ev.sessionId) return false;
      if (ev.runId) this.focus.set(ev.sessionId, ev.runId); else this.focus.delete(ev.sessionId);
      return true;
    }
    return false;
  }

  private write(ev: RunEvent): void {
    if (!this.apply(ev)) throw new Error("workflow-runs: evento inconsistente");
    let fd: number | undefined;
    try {
      fd = openSync(this.file, "a");
      appendFileSync(fd, JSON.stringify(ev) + "\n");
      fsyncSync(fd);
    } finally { if (fd !== undefined) closeSync(fd); }
    if (++this.appended >= this.compactEvery) this.compact();
  }

  /** Grava o run inteiro (o estado é pequeno e o journal compacta — simples vence esperto aqui). */
  put(run: WorkflowRun): WorkflowRun {
    this.write({ k: "put", at: this.now(), run });
    return this.get(run.runId)!;
  }

  remove(runId: string): boolean {
    if (!this.runs.has(runId)) return false;
    this.write({ k: "del", at: this.now(), runId });
    return true;
  }

  get(runId: string): WorkflowRun | undefined {
    const r = this.runs.get(runId);
    return r ? structuredClone(r) : undefined;
  }

  list(): WorkflowRun[] {
    return [...this.runs.values()].map((r) => structuredClone(r)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  active(): WorkflowRun[] { return this.list().filter((r) => r.status === "active"); }

  /** Run ativo associado a uma sessão — é o que o painel da sessão mostra. */
  forSession(sessionId: string): WorkflowRun | undefined {
    return this.list().find((r) => r.status === "active" && r.sessions.includes(sessionId));
  }

  /** TODOS os runs ativos da sessão (multi-tarefa): a sessão gerencia uma lista, não um único fluxo. */
  activeForSession(sessionId: string): WorkflowRun[] {
    return this.list().filter((r) => r.status === "active" && r.sessions.includes(sessionId));
  }

  /**
   * Foco por sessão: com N tarefas acompanhadas, qual delas é o assunto dos turnos. Cai para o run
   * mais recente quando o foco aponta para algo encerrado/desvinculado — nunca devolve run inválido.
   */
  focusedFor(sessionId: string): WorkflowRun | undefined {
    const id = this.focus.get(sessionId);
    if (id) {
      const run = this.runs.get(id);
      if (run && run.status === "active" && run.sessions.includes(sessionId)) return structuredClone(run);
    }
    return this.forSession(sessionId);
  }

  setFocus(sessionId: string, runId: string | null): void {
    if (!sessionId) return;
    if (runId && !this.runs.has(runId)) return;
    if ((this.focus.get(sessionId) || null) === runId) return;
    this.write({ k: "focus", at: this.now(), sessionId, runId });
  }

  /** Um run encerrado não pode continuar sendo o foco de ninguém. */
  clearFocusOfRun(runId: string): void {
    for (const [sessionId, focused] of [...this.focus]) {
      if (focused === runId) this.write({ k: "focus", at: this.now(), sessionId, runId: null });
    }
  }

  /** Run já existente para a mesma tarefa — evita abrir dois acompanhamentos do mesmo ticket. */
  /** Esta sessão JÁ teve algum acompanhamento — inclusive concluído ou abandonado. É o que impede o
   *  início automático de ressuscitar, no turno seguinte, um fluxo que você acabou de abandonar. */
  hasSession(sessionId: string): boolean {
    return this.list().some((r) => r.sessions.includes(sessionId));
  }

  forTask(tracker: string, key: string): WorkflowRun | undefined {
    const t = String(tracker || "").toLowerCase(), k = String(key || "");
    if (!k) return undefined;
    return this.list().find((r) => r.status === "active" && r.task.key === k && (r.task.tracker || "") === t);
  }

  compact(): void {
    const at = this.now();
    const keep = [...this.runs.values()].filter((r) => r.status === "active" || at - r.updatedAt < this.retainClosedMs);
    const keptIds = new Set(keep.map((r) => r.runId));
    const focusLines = [...this.focus].filter(([, runId]) => keptIds.has(runId))
      .map(([sessionId, runId]) => JSON.stringify({ k: "focus", at, sessionId, runId } satisfies RunEvent));
    const lines = [...keep.map((r) => JSON.stringify({ k: "put", at: r.updatedAt, run: r } satisfies RunEvent)), ...focusLines];
    writeTextAtomic(this.file, lines.length ? lines.join("\n") + "\n" : "");
    this.runs.clear();
    this.focus.clear();
    for (const r of keep) this.runs.set(r.runId, r);
    for (const line of focusLines) { const ev = JSON.parse(line) as RunEvent; this.apply(ev); }
    this.appended = 0;
  }
}
