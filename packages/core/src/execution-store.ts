import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  EXECUTION_SCHEMA_VERSION,
  executionNodeProblems,
  isExecutionEvent,
  type ExecutionArtifact,
  type ExecutionEvent,
  type ExecutionEventInput,
  type ExecutionManifestEntry,
  type ExecutionMetricSet,
  type ExecutionNode,
  type ExecutionSnapshot,
  type ExecutionState,
} from "@jarvis/protocol";
import { writeJsonAtomic } from "./persist.js";

const TERMINAL = new Set<ExecutionState>(["succeeded", "failed", "cancelled"]);
const TRANSITIONS: Record<ExecutionState, ReadonlySet<ExecutionState>> = {
  queued: new Set(["running", "failed", "cancelled", "orphaned", "unknown"]),
  running: new Set(["waiting_input", "succeeded", "failed", "cancelled", "orphaned", "unknown"]),
  waiting_input: new Set(["running", "succeeded", "failed", "cancelled", "orphaned", "unknown"]),
  succeeded: new Set(), failed: new Set(), cancelled: new Set(),
  orphaned: new Set(["running", "succeeded", "failed", "cancelled"]),
  unknown: new Set(["queued", "running", "waiting_input", "succeeded", "failed", "cancelled", "orphaned"]),
};

interface Projection {
  journalId: string;
  rootExecutionId: string;
  rootTurnId: string;
  lastSeq: number;
  nodes: Map<string, ExecutionNode>;
  artifacts: Map<string, ExecutionArtifact>;
  pendingInputs: Map<string, { executionId: string; inputId: string; inputKind: "approval" | "question"; summary: string; choices?: string[]; expiresAt?: number }>;
  events: ExecutionEvent[];
  truncated: boolean;
  updatedAt: number;
  connection?: ExecutionSnapshot["connection"];
}

export type ExecutionApplyResult =
  | { status: "applied"; event: ExecutionEvent }
  | { status: "duplicate"; event: ExecutionEvent }
  | { status: "gap"; expectedSeq: number; receivedSeq: number }
  | { status: "journal_mismatch"; expectedJournalId: string; receivedJournalId: string }
  | { status: "invalid"; reason: string };

export interface ExecutionStoreOptions {
  root: string;
  maxEventsPerRoot?: number;
  snapshotEvery?: number;
  now?: () => number;
}

function metricAdd(target: ExecutionMetricSet, source: ExecutionMetricSet, replace: boolean): void {
  for (const key of ["toolCalls", "inputTokens", "cachedInputTokens", "outputTokens", "costUsd"] as const) {
    const value = source[key]; if (value === undefined) continue;
    target[key] = replace ? value : (target[key] || 0) + value;
  }
  if (source.costKind) target.costKind = source.costKind;
}

function usageMetric(event: Extract<ExecutionEvent, { kind: "usage" }>): ExecutionMetricSet {
  return { inputTokens: event.usage.inputTokens, cachedInputTokens: event.usage.cachedInputTokens,
    outputTokens: event.usage.outputTokens, costUsd: event.usage.costUsd, costKind: event.usage.costKind };
}

function cloneNode(node: ExecutionNode): ExecutionNode {
  return { ...node, dependsOn: [...node.dependsOn], capabilities: { ...node.capabilities }, metrics: { self: { ...node.metrics.self }, subtree: node.metrics.subtree ? { ...node.metrics.subtree } : undefined } };
}

function projectionSnapshot(p: Projection, now: number): ExecutionSnapshot {
  return { schemaVersion: EXECUTION_SCHEMA_VERSION, journalId: p.journalId, rootExecutionId: p.rootExecutionId,
    rootTurnId: p.rootTurnId, lastSeq: p.lastSeq, generatedAt: now,
    nodes: [...p.nodes.values()].map(cloneNode), artifacts: [...p.artifacts.values()].map((a) => ({ ...a })),
    pendingInputs: [...p.pendingInputs.values()].map((i) => ({ ...i, choices: i.choices ? [...i.choices] : undefined })),
    truncated: p.truncated, connection: p.connection };
}

function cloneProjection(p: Projection): Projection {
  return { ...p, nodes: new Map([...p.nodes].map(([id, node]) => [id, cloneNode(node)])),
    artifacts: new Map([...p.artifacts].map(([id, artifact]) => [id, { ...artifact }])),
    pendingInputs: new Map([...p.pendingInputs].map(([id, input]) => [id, { ...input, choices: input.choices ? [...input.choices] : undefined }])),
    events: [...p.events] };
}

function dependencyCycle(nodes: Map<string, ExecutionNode>, node: ExecutionNode): boolean {
  const deps = new Map(nodes); deps.set(node.executionId, node);
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of deps.get(id)?.dependsOn || []) if (visit(dep)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  return visit(node.executionId);
}

/** Pure projection. It mutates only `projection`, after sequence/journal validation by the store. */
export function applyExecutionEvent(projection: Projection, event: ExecutionEvent): void {
  if (event.kind === "node_created") {
    const problems = executionNodeProblems(event.node);
    if (problems.length) throw new Error(problems.join("; "));
    if (event.node.journalId !== event.journalId || event.node.rootExecutionId !== event.rootExecutionId) throw new Error("node/event root mismatch");
    if (projection.nodes.has(event.node.executionId)) return;
    if (event.node.parentExecutionId && !projection.nodes.has(event.node.parentExecutionId)) throw new Error("parent execution missing");
    for (const dep of event.node.dependsOn) if (!projection.nodes.has(dep)) throw new Error(`dependency missing: ${dep}`);
    if (dependencyCycle(projection.nodes, event.node)) throw new Error("dependency cycle");
    projection.nodes.set(event.node.executionId, cloneNode(event.node));
  } else {
    const node = projection.nodes.get(event.executionId);
    if (!node) throw new Error("execution node missing");
    if (event.kind === "state_changed") {
      if (node.state !== event.from) throw new Error(`state mismatch: expected ${node.state}, got ${event.from}`);
      if (event.to !== event.from && !TRANSITIONS[node.state].has(event.to)) throw new Error(`invalid transition ${node.state}->${event.to}`);
      node.state = event.to;
      if (event.to === "running" && node.startedAt === undefined) node.startedAt = event.at;
      if (TERMINAL.has(event.to)) node.endedAt = event.at;
      if (event.reason) node.summary = event.reason;
    } else if (event.kind === "message" || event.kind === "summary") {
      node.summary = event.kind === "message" ? event.text : event.text;
    } else if (event.kind === "agent_event") {
      const a = event.event;
      if ((a.kind === "tool_started" || a.kind === "tool_completed" || a.kind === "tool_failed") && a.tool?.status === "started") node.metrics.self.toolCalls = (node.metrics.self.toolCalls || 0) + 1;
      if (a.kind === "usage" && a.usage) {
        const target = a.usageScope === "subtree" ? (node.metrics.subtree ||= {}) : node.metrics.self;
        metricAdd(target, { inputTokens: a.usage.inputTokens, cachedInputTokens: a.usage.cachedInputTokens, outputTokens: a.usage.outputTokens, costUsd: a.usage.costUsd, costKind: a.usage.costKind }, false);
      }
    } else if (event.kind === "tool") {
      if (event.tool.status === "started") node.metrics.self.toolCalls = (node.metrics.self.toolCalls || 0) + 1;
    } else if (event.kind === "usage") {
      const target = event.scope === "self" ? node.metrics.self : (node.metrics.subtree ||= {});
      metricAdd(target, usageMetric(event), event.measure === "cumulative");
    } else if (event.kind === "input_requested") {
      projection.pendingInputs.set(event.inputId, { executionId: event.executionId, inputId: event.inputId, inputKind: event.inputKind, summary: event.summary, choices: event.choices, expiresAt: event.expiresAt });
      if (!TERMINAL.has(node.state)) node.state = "waiting_input";
    } else if (event.kind === "input_resolved") {
      projection.pendingInputs.delete(event.inputId);
      if (node.state === "waiting_input") node.state = "running";
    } else if (event.kind === "artifact") {
      projection.artifacts.set(event.artifact.artifactId, { ...event.artifact });
    } else if (event.kind === "archived") {
      node.archivedAt = event.archived ? event.at : undefined;
    } else if (event.kind === "dependency") {
      const next = cloneNode({ ...node, dependsOn: [...event.dependsOn] });
      for (const dep of next.dependsOn) if (!projection.nodes.has(dep)) throw new Error(`dependency missing: ${dep}`);
      if (dependencyCycle(projection.nodes, next)) throw new Error("dependency cycle");
      node.dependsOn = next.dependsOn;
    } else if (event.kind === "truncated") {
      node.truncated = true; projection.truncated = true;
    }
  }
  projection.lastSeq = event.seq;
  projection.updatedAt = event.at;
}

export class ExecutionStore {
  private roots = new Map<string, Projection>();
  private nodeRoot = new Map<string, string>();
  private readonly maxEvents: number;
  private readonly snapshotEvery: number;
  private readonly now: () => number;
  constructor(private readonly options: ExecutionStoreOptions) {
    this.maxEvents = Math.max(100, options.maxEventsPerRoot || 5_000);
    this.snapshotEvery = Math.max(10, options.snapshotEvery || 200);
    this.now = options.now || Date.now;
    mkdirSync(options.root, { recursive: true });
    this.load();
  }

  private key(rootExecutionId: string): string { return createHash("sha256").update(rootExecutionId).digest("hex"); }
  private journalPath(rootExecutionId: string): string { return join(this.options.root, `${this.key(rootExecutionId)}.jsonl`); }
  private snapshotPath(rootExecutionId: string): string { return join(this.options.root, `${this.key(rootExecutionId)}.snapshot.json`); }
  private blank(event: ExecutionEvent): Projection { return { journalId: event.journalId, rootExecutionId: event.rootExecutionId, rootTurnId: event.rootTurnId, lastSeq: 0, nodes: new Map(), artifacts: new Map(), pendingInputs: new Map(), events: [], truncated: false, updatedAt: event.at }; }

  private load(): void {
    let files: string[] = [];
    try { files = readdirSync(this.options.root).filter((f) => f.endsWith(".jsonl")); } catch { return; }
    for (const file of files) {
      const path = join(this.options.root, file); let projection: Projection | undefined;
      let lines: string[] = []; try { lines = readFileSync(path, "utf8").split(/\r?\n/); } catch { continue; }
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: unknown; try { event = JSON.parse(line); } catch { break; }
        if (!isExecutionEvent(event)) continue;
        projection ||= this.blank(event);
        if (event.journalId !== projection.journalId || event.seq !== projection.lastSeq + 1) break;
        try { applyExecutionEvent(projection, event); projection.events.push(event); } catch { break; }
      }
      if (projection && projection.events.length > this.maxEvents) {
        projection.events.splice(0, projection.events.length - this.maxEvents); projection.truncated = true;
      }
      if (projection?.nodes.size) this.install(projection);
    }
  }

  private install(projection: Projection): void {
    this.roots.set(projection.rootExecutionId, projection);
    for (const id of projection.nodes.keys()) this.nodeRoot.set(id, projection.rootExecutionId);
  }

  private persist(event: ExecutionEvent): void {
    const path = this.journalPath(event.rootExecutionId); const fd = openSync(path, "a");
    try { appendFileSync(fd, JSON.stringify(event) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  }

  private persistedEvent(rootExecutionId: string, seq: number): ExecutionEvent | undefined {
    try {
      for (const line of readFileSync(this.journalPath(rootExecutionId), "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { const event = JSON.parse(line); if (isExecutionEvent(event) && event.seq === seq) return event; } catch { return undefined; }
      }
    } catch { /* absent/unreadable journal */ }
    return undefined;
  }

  ingest(event: ExecutionEvent, opts: { persist?: boolean } = {}): ExecutionApplyResult {
    if (!isExecutionEvent(event)) return { status: "invalid", reason: "invalid event envelope" };
    if (event.eventId !== `${event.journalId}:${event.seq}`) return { status: "invalid", reason: "eventId does not match journal sequence" };
    let projection = this.roots.get(event.rootExecutionId);
    if (!projection) {
      if (event.seq !== 1 || event.kind !== "node_created") return { status: "gap", expectedSeq: 1, receivedSeq: event.seq };
      projection = this.blank(event);
    } else {
      if (projection.journalId !== event.journalId) return { status: "journal_mismatch", expectedJournalId: projection.journalId, receivedJournalId: event.journalId };
      if (event.seq <= projection.lastSeq) {
        const existing = projection.events.find((e) => e.seq === event.seq) || this.persistedEvent(event.rootExecutionId, event.seq);
        return existing && JSON.stringify(existing) === JSON.stringify(event) ? { status: "duplicate", event } : { status: "invalid", reason: "divergent duplicate sequence" };
      }
      if (event.seq !== projection.lastSeq + 1) return { status: "gap", expectedSeq: projection.lastSeq + 1, receivedSeq: event.seq };
    }
    try {
      // Validate and project on a clone first. An invalid event must never be fsynced into the
      // authoritative journal, otherwise one bad transition would truncate every future replay.
      const candidate = cloneProjection(projection);
      applyExecutionEvent(candidate, event);
      candidate.events.push(event);
      if (candidate.events.length > this.maxEvents) { candidate.events.splice(0, candidate.events.length - this.maxEvents); candidate.truncated = true; }
      if (opts.persist !== false) this.persist(event);
      this.install(candidate);
      if (candidate.lastSeq % this.snapshotEvery === 0 || TERMINAL.has(candidate.nodes.get(candidate.rootExecutionId)?.state || "unknown")) this.writeSnapshot(candidate);
      return { status: "applied", event };
    } catch (error) { return { status: "invalid", reason: String((error as Error)?.message || error) }; }
  }

  append(rootExecutionId: string, executionId: string, input: ExecutionEventInput): ExecutionEvent {
    const projection = this.roots.get(rootExecutionId);
    const journalId = projection?.journalId || randomUUID();
    const rootTurnId = projection?.rootTurnId || (input.kind === "node_created" ? input.node.rootTurnId : rootExecutionId);
    const seq = (projection?.lastSeq || 0) + 1;
    const event = { schemaVersion: EXECUTION_SCHEMA_VERSION, journalId, eventId: `${journalId}:${seq}`, executionId, rootExecutionId, rootTurnId, seq, at: this.now(), ...input } as ExecutionEvent;
    const result = this.ingest(event);
    if (result.status !== "applied") throw new Error(`execution append failed: ${result.status}${"reason" in result ? `: ${result.reason}` : ""}`);
    return event;
  }

  create(node: Omit<ExecutionNode, "schemaVersion" | "journalId"> & { journalId?: string }): ExecutionEvent {
    if (this.roots.has(node.rootExecutionId) || this.nodeRoot.has(node.executionId)) throw new Error("execution already exists");
    const journalId = node.journalId || randomUUID();
    const full: ExecutionNode = { ...node, schemaVersion: EXECUTION_SCHEMA_VERSION, journalId };
    const event: ExecutionEvent = { schemaVersion: EXECUTION_SCHEMA_VERSION, journalId, eventId: `${journalId}:1`, executionId: full.executionId, rootExecutionId: full.rootExecutionId, rootTurnId: full.rootTurnId, seq: 1, at: this.now(), kind: "node_created", node: full };
    const result = this.ingest(event); if (result.status !== "applied") throw new Error(`execution create failed: ${result.status}`); return event;
  }

  appendNode(rootExecutionId: string, node: Omit<ExecutionNode, "schemaVersion" | "journalId">): ExecutionEvent {
    const root = this.roots.get(rootExecutionId); if (!root) throw new Error("root execution missing");
    return this.append(rootExecutionId, node.executionId, { kind: "node_created", node: { ...node, schemaVersion: EXECUTION_SCHEMA_VERSION, journalId: root.journalId } });
  }

  private writeSnapshot(projection: Projection): void { writeJsonAtomic(this.snapshotPath(projection.rootExecutionId), projectionSnapshot(projection, this.now())); }
  snapshot(rootExecutionId: string): ExecutionSnapshot | undefined { const p = this.roots.get(rootExecutionId); return p ? projectionSnapshot(p, this.now()) : undefined; }
  manifest(): ExecutionManifestEntry[] { return [...this.roots.values()].map((p) => ({ rootExecutionId: p.rootExecutionId, journalId: p.journalId, lastSeq: p.lastSeq, updatedAt: p.updatedAt, sessionId: p.nodes.get(p.rootExecutionId)?.sessionId })).sort((a, b) => b.updatedAt - a.updatedAt); }
  events(rootExecutionId: string, afterSeq = 0, limit = 200): { events: ExecutionEvent[]; nextSeq?: number } {
    const p = this.roots.get(rootExecutionId); if (!p) return { events: [] };
    // The in-memory projection is bounded, but replay is an audit/recovery path and must be able to
    // serve the retained journal prefix as well. Read the append-only source when the requested
    // cursor predates the memory window; malformed crash tails are ignored like they are on load.
    let source = p.events;
    if ((source[0]?.seq || 1) > afterSeq + 1) {
      try {
        source = readFileSync(this.journalPath(rootExecutionId), "utf8").split(/\r?\n/).flatMap((line) => {
          if (!line.trim()) return [];
          try { const event = JSON.parse(line); return isExecutionEvent(event) && event.rootExecutionId === rootExecutionId && event.journalId === p.journalId ? [event] : []; }
          catch { return []; }
        });
      } catch { /* the in-memory tail remains available */ }
    }
    const events = source.filter((e) => e.seq > afterSeq).slice(0, Math.max(1, Math.min(1000, limit)));
    const last = events.at(-1)?.seq; return { events, nextSeq: last && last < p.lastSeq ? last : undefined };
  }
  rootsForSession(sessionId?: string): ExecutionSnapshot[] { return [...this.roots.values()].filter((p) => !sessionId || p.nodes.get(p.rootExecutionId)?.sessionId === sessionId).sort((a, b) => b.updatedAt - a.updatedAt).map((p) => projectionSnapshot(p, this.now())); }
  listNodes(sessionId?: string): ExecutionNode[] { return this.rootsForSession(sessionId).flatMap((s) => s.nodes).sort((a, b) => (b.startedAt || b.queuedAt) - (a.startedAt || a.queuedAt)); }
  findNode(executionId: string): { rootExecutionId: string; node: ExecutionNode } | undefined { const rootExecutionId = this.nodeRoot.get(executionId); const node = rootExecutionId ? this.roots.get(rootExecutionId)?.nodes.get(executionId) : undefined; return rootExecutionId && node ? { rootExecutionId, node: cloneNode(node) } : undefined; }
  setConnection(rootExecutionId: string, state: NonNullable<ExecutionSnapshot["connection"]>): void { const p = this.roots.get(rootExecutionId); if (p) p.connection = state; }

  /** Delete journals whose graph belongs to a deleted session. Paths are derived only from the
   * store-owned hash, never from the session id supplied by a client. */
  deleteSession(sessionId: string): number {
    const targets = [...this.roots.values()].filter((projection) => [...projection.nodes.values()].some((node) => node.sessionId === sessionId));
    let deleted = 0;
    for (const projection of targets) {
      const key = this.key(projection.rootExecutionId);
      this.roots.delete(projection.rootExecutionId);
      for (const id of projection.nodes.keys()) this.nodeRoot.delete(id);
      let files: string[] = []; try { files = readdirSync(this.options.root); } catch { /* store directory disappeared */ }
      for (const file of files) if (file === `${key}.jsonl` || file === `${key}.snapshot.json` || file.startsWith(`${key}.jsonl.stale-`) || file.startsWith(`${key}.jsonl.compact-`)) {
        try { rmSync(join(this.options.root, file), { force: true }); } catch { /* projection is already removed; retry cleanup later */ }
      }
      deleted++;
    }
    return deleted;
  }

  /**
   * Remove detailed events from terminal roots older than `cutoff`, while retaining a complete
   * summary projection (tree, terminal states and aggregate metrics). Compaction rotates the
   * journal id so remote mirrors must reconcile instead of accepting a divergent sequence.
   */
  compactBefore(cutoff: number): { roots: number; droppedEvents: number } {
    let roots = 0, droppedEvents = 0;
    for (const projection of [...this.roots.values()]) {
      const root = projection.nodes.get(projection.rootExecutionId);
      if (!root || !TERMINAL.has(root.state) || projection.updatedAt >= cutoff) continue;
      if (projection.events.some((event) => event.kind === "truncated" && event.reason === "retention")) continue;

      const journalId = randomUUID(), at = projection.updatedAt;
      const blankEvent = { journalId, rootExecutionId: projection.rootExecutionId, rootTurnId: projection.rootTurnId, at } as ExecutionEvent;
      const compacted = this.blank(blankEvent);
      const remaining = new Map([...projection.nodes].map(([id, node]) => [id, cloneNode(node)]));
      const created = new Set<string>();
      while (remaining.size) {
        let progressed = false;
        for (const [id, source] of remaining) {
          if (source.parentExecutionId && !created.has(source.parentExecutionId)) continue;
          if (source.dependsOn.some((dependency) => !created.has(dependency))) continue;
          const seq = compacted.lastSeq + 1;
          const node: ExecutionNode = { ...source, journalId, prompt: undefined, currentStep: undefined, worktree: undefined,
            truncated: true, metrics: { self: { ...source.metrics.self }, subtree: source.metrics.subtree ? { ...source.metrics.subtree } : undefined } };
          const event: ExecutionEvent = { schemaVersion: EXECUTION_SCHEMA_VERSION, journalId, eventId: `${journalId}:${seq}`,
            executionId: id, rootExecutionId: projection.rootExecutionId, rootTurnId: projection.rootTurnId,
            seq, at, kind: "node_created", node };
          applyExecutionEvent(compacted, event); compacted.events.push(event); created.add(id); remaining.delete(id); progressed = true;
        }
        if (!progressed) break;
      }
      if (remaining.size) continue; // Defensive: never replace a journal whose graph cannot be ordered.
      const dropped = Math.max(0, projection.lastSeq - compacted.events.length);
      const seq = compacted.lastSeq + 1;
      const marker: ExecutionEvent = { schemaVersion: EXECUTION_SCHEMA_VERSION, journalId, eventId: `${journalId}:${seq}`,
        executionId: projection.rootExecutionId, rootExecutionId: projection.rootExecutionId, rootTurnId: projection.rootTurnId,
        seq, at, kind: "truncated", dropped, reason: "retention" };
      applyExecutionEvent(compacted, marker); compacted.events.push(marker); compacted.connection = projection.connection;

      const path = this.journalPath(projection.rootExecutionId), temp = `${path}.compact-${randomUUID()}`;
      let fd: number | undefined;
      try {
        fd = openSync(temp, "wx");
        for (const event of compacted.events) appendFileSync(fd, JSON.stringify(event) + "\n");
        fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temp, path);
        this.install(compacted); this.writeSnapshot(compacted); roots++; droppedEvents += dropped;
      } catch {
        if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
        // The authoritative journal is replaced only by the final atomic rename. A leftover temp is
        // intentionally harmless and never loaded; cleanup can remove it on a later maintenance pass.
      }
    }
    return { roots, droppedEvents };
  }

  /** Replace a divergent mirror without deleting evidence: the old journal is renamed `.stale-*`. */
  replaceFromReplay(events: ExecutionEvent[]): ExecutionApplyResult {
    if (!events.length || events[0].seq !== 1) return { status: "invalid", reason: "replacement replay must start at seq 1" };
    const root = events[0].rootExecutionId, old = this.roots.get(root), path = this.journalPath(root);
    if (old && existsSync(path)) { try { renameSync(path, `${path}.stale-${this.now()}`); } catch (error) { return { status: "invalid", reason: `cannot preserve stale journal: ${String(error)}` }; } }
    if (old) { this.roots.delete(root); for (const id of old.nodes.keys()) this.nodeRoot.delete(id); }
    let result: ExecutionApplyResult = { status: "invalid", reason: "empty replay" };
    for (const event of events) { result = this.ingest(event); if (result.status !== "applied") break; }
    return result;
  }
}
