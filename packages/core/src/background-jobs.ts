/**
 * Durable store for Hub-owned BACKGROUND JOBS — the foundation of "run a long task that survives the
 * one-shot agent turn and auto-continues the session when it finishes".
 *
 * Why it exists: each agent turn is a single `claude -p`/`codex exec` process (packages/core/agents.ts).
 * When the model defers work to its NATIVE background (`run_in_background`), that task dies with the
 * turn's process and the next turn is a fresh `--resume` process with no handle to it — so "I'll
 * continue when it's done" never happens. Instead the agent launches a job HERE: the Hub owns the
 * process (detached, updater-style), records its lifecycle durably, and on the terminal transition
 * injects an autonomous continuation turn into the origin session (see the Hub wiring, not this file).
 *
 * Durability mirrors execution-store.ts: an append-only JSONL journal, one line per lifecycle event,
 * each `appendFileSync`+`fsyncSync`'d so a transition is on physical disk before we act on it. Recovery
 * replays the journal and STOPS at the first torn/inconsistent line (a crash mid-append only loses the
 * incomplete tail, never earlier state). Compaction rewrites the journal from live state via the atomic
 * temp+fsync+rename in persist.ts, dropping old terminal jobs so the file can't grow unbounded.
 *
 * This module is PURE state + persistence: no process spawning, no turn injection. That keeps it fully
 * unit-testable and lets the Hub/Runner own the side effects.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeTextAtomic } from "./persist.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(["succeeded", "failed", "cancelled"]);
export function isTerminalJobStatus(s: JobStatus): boolean { return TERMINAL.has(s); }

/** Allowed lifecycle transitions — mirrors execution-store's guard so a bad event can't corrupt replay. */
const TRANSITIONS: Record<JobStatus, ReadonlySet<JobStatus>> = {
  queued: new Set<JobStatus>(["running", "failed", "cancelled"]),
  running: new Set<JobStatus>(["succeeded", "failed", "cancelled"]),
  succeeded: new Set<JobStatus>(),
  failed: new Set<JobStatus>(),
  cancelled: new Set<JobStatus>(),
};

export interface BackgroundJob {
  jobId: string;
  /** Session to auto-continue when the job reaches a terminal state. */
  originSessionId: string;
  /** Runner that owns the session/process — "local" for the Hub machine. */
  runnerId: string;
  command: string;
  cwd: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  /** Real PID of the detached worker, self-registered after spawn (the `cmd /c start /b` pid is useless). */
  pid?: number;
  exitCode?: number;
  /** Bounded tail of the job's output, fed into the continuation turn. */
  resultSummary?: string;
  /** True once the auto-continuation turn has been injected — idempotency against double-fire. */
  continued?: boolean;
  /** How many auto-continuations deep this chain is — anti-loop guard, carried from the origin turn. */
  autoContinueDepth: number;
}

type JobEvent =
  | { k: "created"; at: number; job: Omit<BackgroundJob, "updatedAt" | "continued"> }
  | { k: "pid"; at: number; jobId: string; pid: number }
  | { k: "status"; at: number; jobId: string; status: JobStatus; exitCode?: number; resultSummary?: string }
  | { k: "continued"; at: number; jobId: string };

export interface CreateJobInput {
  jobId?: string;
  originSessionId: string;
  runnerId?: string;
  command: string;
  cwd: string;
  autoContinueDepth?: number;
}

export interface BackgroundJobStoreOptions {
  /** Storage dir; defaults to ~/.jarvis/hub. Tests pass a temp dir. */
  dir?: string;
  now?: () => number;
  /** Drop terminal jobs older than this on compaction (default 24h). 0 = keep all. */
  retainTerminalMs?: number;
  /** Compact once the journal passes this many appended events (default 500). */
  compactEvery?: number;
}

/** Default ceiling on how many times a single chain may auto-continue itself (background→continue→…). */
export const DEFAULT_MAX_AUTO_CONTINUE_DEPTH = 8;

export interface ContinuationPlan {
  /** Whether the Hub should inject a continuation turn for this job. */
  act: boolean;
  reason: string;
  /** The prompt text to feed the resumed session (only when act). */
  text?: string;
  /** autoContinueDepth to stamp on any NEW job the continuation turn spawns (anti-loop). */
  nextDepth?: number;
}

/** Bounded, human-readable tail so a huge log can't blow up the continuation prompt / context. */
function boundedSummary(s: string | undefined, cap = 4000): string {
  if (!s) return "";
  const t = s.trimEnd();
  return t.length <= cap ? t : `…(início cortado)\n${t.slice(t.length - cap)}`;
}

/**
 * Pure decision for the auto-continuation: given a job's durable state, should the Hub start a
 * follow-up turn, and with what prompt? Enforces the three guards that keep this safe — terminal-only,
 * idempotent (never twice), and depth-bounded (no infinite background→continue→background loop). The
 * Hub calls markContinued() and enqueues the turn only when `act` is true.
 */
export function planJobContinuation(job: BackgroundJob, opts?: { maxDepth?: number }): ContinuationPlan {
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_AUTO_CONTINUE_DEPTH;
  if (!isTerminalJobStatus(job.status)) return { act: false, reason: "job ainda em execução" };
  if (job.continued) return { act: false, reason: "continuação já injetada" };
  if (job.autoContinueDepth >= maxDepth) return { act: false, reason: `limite de auto-continuações atingido (${maxDepth})` };
  const verb = job.status === "succeeded" ? "concluiu com sucesso"
    : job.status === "failed" ? `falhou (código de saída ${job.exitCode ?? "?"})`
    : "foi cancelado";
  const tail = boundedSummary(job.resultSummary);
  const text = `[Jarvis · job de background] O comando \`${job.command}\` que você iniciou em segundo plano ${verb}.`
    + (tail ? `\n\nSaída (final):\n${tail}` : "")
    + `\n\nContinue de onde parou, usando este resultado. (Se precisar rodar outra tarefa longa, use novamente o job de background em vez de background nativo.)`;
  return { act: true, reason: "ok", text, nextDepth: job.autoContinueDepth + 1 };
}

const JARVIS_HOME = process.env.JARVIS_HOME || homedir();
let SEQ = 0; // process-local uniquifier for generated ids (Date-independent, safe for tests)

export class BackgroundJobStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly retainTerminalMs: number;
  private readonly compactEvery: number;
  private readonly jobs = new Map<string, BackgroundJob>();
  private appended = 0;

  constructor(opts: BackgroundJobStoreOptions = {}) {
    const dir = opts.dir || join(JARVIS_HOME, ".jarvis", "hub");
    this.file = join(dir, "background-jobs.jsonl");
    this.now = opts.now || (() => Date.now());
    this.retainTerminalMs = opts.retainTerminalMs ?? 24 * 60 * 60 * 1000;
    this.compactEvery = Math.max(1, opts.compactEvery ?? 500);
    mkdirSync(dir, { recursive: true });
    this.load();
  }

  /** Replay the journal, stopping at the first torn/invalid line so a crashed tail can't wipe state. */
  private load(): void {
    if (!existsSync(this.file)) return;
    let raw = "";
    try { raw = readFileSync(this.file, "utf8"); } catch { return; }
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      let ev: JobEvent;
      try { ev = JSON.parse(line) as JobEvent; } catch { break; } // torn last line — stop, keep the good prefix
      if (!this.apply(ev)) break; // an inconsistent event means the tail is untrustworthy
    }
  }

  /** Pure projection of one event onto in-memory state. Returns false if the event is inconsistent. */
  private apply(ev: JobEvent): boolean {
    if (!ev || typeof ev !== "object") return false;
    if (ev.k === "created") {
      const j = ev.job;
      if (!j?.jobId || !j.originSessionId) return false;
      this.jobs.set(j.jobId, { ...j, updatedAt: ev.at, continued: false });
      return true;
    }
    const job = this.jobs.get((ev as { jobId: string }).jobId);
    if (!job) return false;
    if (ev.k === "pid") { job.pid = ev.pid; job.updatedAt = ev.at; return true; }
    if (ev.k === "continued") { job.continued = true; job.updatedAt = ev.at; return true; }
    if (ev.k === "status") {
      if (!TRANSITIONS[job.status]?.has(ev.status)) return false; // illegal transition — stop replay
      job.status = ev.status;
      if (ev.exitCode !== undefined) job.exitCode = ev.exitCode;
      if (ev.resultSummary !== undefined) job.resultSummary = ev.resultSummary;
      job.updatedAt = ev.at;
      return true;
    }
    return false;
  }

  /** Durable append: fsync each event so the transition is on disk before the caller acts on it. */
  private write(ev: JobEvent): void {
    if (!this.apply(ev)) throw new Error(`background-jobs: refused inconsistent event ${JSON.stringify(ev)}`);
    let fd: number | undefined;
    try {
      fd = openSync(this.file, "a");
      appendFileSync(fd, JSON.stringify(ev) + "\n");
      fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (++this.appended >= this.compactEvery) this.compact();
  }

  private nextId(): string {
    // Deterministic-enough unique id without Date/Math.random (keeps tests reproducible): time + counter.
    return `job-${this.now().toString(36)}-${(SEQ = (SEQ + 1) & 0xffffff).toString(36)}`;
  }

  create(input: CreateJobInput): BackgroundJob {
    const at = this.now();
    const job: Omit<BackgroundJob, "updatedAt" | "continued"> = {
      jobId: input.jobId || this.nextId(),
      originSessionId: input.originSessionId,
      runnerId: input.runnerId || "local",
      command: input.command,
      cwd: input.cwd,
      status: "queued",
      createdAt: at,
      autoContinueDepth: Math.max(0, input.autoContinueDepth ?? 0),
    };
    this.write({ k: "created", at, job });
    return this.get(job.jobId)!;
  }

  setPid(jobId: string, pid: number): void { this.write({ k: "pid", at: this.now(), jobId, pid }); }

  /** Record a lifecycle transition. Throws on an illegal transition (guards against double-terminal). */
  setStatus(jobId: string, status: JobStatus, extra?: { exitCode?: number; resultSummary?: string }): void {
    this.write({ k: "status", at: this.now(), jobId, status, exitCode: extra?.exitCode, resultSummary: extra?.resultSummary });
  }

  /** Mark that the auto-continuation turn has been injected — call BEFORE injecting so a crash can't double-fire. */
  markContinued(jobId: string): void { this.write({ k: "continued", at: this.now(), jobId }); }

  get(jobId: string): BackgroundJob | undefined {
    const j = this.jobs.get(jobId);
    return j ? { ...j } : undefined;
  }

  list(): BackgroundJob[] { return [...this.jobs.values()].map((j) => ({ ...j })).sort((a, b) => a.createdAt - b.createdAt); }

  /** Jobs still executing — used on boot to reconcile against live PIDs. */
  running(): BackgroundJob[] { return this.list().filter((j) => j.status === "running" || j.status === "queued"); }

  /** Terminal jobs whose continuation hasn't been injected yet — the auto-continue work queue. */
  pendingContinuation(): BackgroundJob[] { return this.list().filter((j) => isTerminalJobStatus(j.status) && !j.continued); }

  /** Rewrite the journal from live state, dropping old continued terminal jobs. Crash-safe (atomic). */
  compact(): void {
    const at = this.now();
    const keep = [...this.jobs.values()].filter((j) => {
      if (!isTerminalJobStatus(j.status)) return true; // never drop live work
      if (!j.continued) return true; // still owes a continuation
      return this.retainTerminalMs === 0 || at - j.updatedAt < this.retainTerminalMs;
    });
    const lines: string[] = [];
    for (const j of keep) {
      // The `created` event carries the FULL current state (status/pid/exitCode/resultSummary), so replay
      // restores the job in one step. Do NOT also emit pid/status events — a second `status: running` after
      // a `created` already at `running` is an illegal running→running transition and would break replay.
      const { updatedAt: _u, continued, ...rest } = j; void _u;
      lines.push(JSON.stringify({ k: "created", at: j.createdAt, job: rest } satisfies JobEvent));
      if (continued) lines.push(JSON.stringify({ k: "continued", at: j.updatedAt, jobId: j.jobId } satisfies JobEvent));
    }
    writeTextAtomic(this.file, lines.length ? lines.join("\n") + "\n" : "");
    this.jobs.clear();
    for (const j of keep) this.jobs.set(j.jobId, j);
    this.appended = 0;
  }
}
