import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundJobStore, isTerminalJobStatus, planJobContinuation, type BackgroundJob } from "./background-jobs.js";

function job(over: Partial<BackgroundJob> = {}): BackgroundJob {
  return { jobId: "j1", originSessionId: "s1", runnerId: "local", command: "npm run typecheck", cwd: "/w", status: "succeeded", createdAt: 1, updatedAt: 2, autoContinueDepth: 0, ...over };
}

function dir(): string { return mkdtempSync(join(tmpdir(), "jarvis-bgjobs-")); }
const JOURNAL = "background-jobs.jsonl";
// A monotonic clock so ordering/retention are deterministic (no Date.now in assertions).
function clock(start = 1_000): () => number { let t = start; return () => (t += 1000); }

test("create → running → succeeded persists and survives a reload", () => {
  const d = dir();
  try {
    const s = new BackgroundJobStore({ dir: d, now: clock() });
    const job = s.create({ originSessionId: "sess-1", command: "npm run typecheck", cwd: "/w" });
    assert.equal(job.status, "queued");
    assert.equal(job.runnerId, "local");
    assert.equal(job.autoContinueDepth, 0);
    s.setPid(job.jobId, 4321);
    s.setStatus(job.jobId, "running");
    s.setStatus(job.jobId, "succeeded", { exitCode: 0, resultSummary: "0 errors" });

    const reloaded = new BackgroundJobStore({ dir: d, now: clock() });
    const r = reloaded.get(job.jobId);
    assert.ok(r, "job survives reload");
    assert.equal(r!.status, "succeeded");
    assert.equal(r!.pid, 4321);
    assert.equal(r!.exitCode, 0);
    assert.equal(r!.resultSummary, "0 errors");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("illegal transitions are refused (no double-terminal, no skipping)", () => {
  const d = dir();
  try {
    const s = new BackgroundJobStore({ dir: d, now: clock() });
    const j = s.create({ originSessionId: "sess", command: "x", cwd: "/w" });
    s.setStatus(j.jobId, "running");
    s.setStatus(j.jobId, "succeeded");
    assert.throws(() => s.setStatus(j.jobId, "failed"), /inconsistent/, "cannot transition out of a terminal state");
    // queued cannot jump straight to succeeded
    const j2 = s.create({ originSessionId: "sess", command: "y", cwd: "/w" });
    assert.throws(() => s.setStatus(j2.jobId, "succeeded"), /inconsistent/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a torn trailing journal line is dropped on reload, earlier state kept", () => {
  const d = dir();
  try {
    const s = new BackgroundJobStore({ dir: d, now: clock() });
    const a = s.create({ originSessionId: "s1", command: "a", cwd: "/w" });
    s.setStatus(a.jobId, "running");
    // simulate a crash mid-append: a half-written final line
    appendFileSync(join(d, JOURNAL), '{ "k": "status", "at": 9, ');
    const reloaded = new BackgroundJobStore({ dir: d, now: clock() });
    const r = reloaded.get(a.jobId);
    assert.ok(r, "the good prefix is recovered");
    assert.equal(r!.status, "running", "the torn event is ignored, last good state stands");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("pendingContinuation lists terminal-but-not-continued jobs; markContinued clears them", () => {
  const d = dir();
  try {
    const s = new BackgroundJobStore({ dir: d, now: clock() });
    const done = s.create({ originSessionId: "s1", command: "a", cwd: "/w" });
    s.setStatus(done.jobId, "running"); s.setStatus(done.jobId, "succeeded");
    const live = s.create({ originSessionId: "s2", command: "b", cwd: "/w" });
    s.setStatus(live.jobId, "running");

    let pending = s.pendingContinuation();
    assert.deepEqual(pending.map((j) => j.jobId), [done.jobId], "only the terminal job awaits continuation");
    assert.deepEqual(s.running().map((j) => j.jobId), [live.jobId]);

    s.markContinued(done.jobId);
    assert.equal(s.pendingContinuation().length, 0, "continued jobs drop out of the queue");
    assert.equal(s.get(done.jobId)!.continued, true);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("markContinued survives reload (idempotency guard against double auto-continue)", () => {
  const d = dir();
  try {
    const s = new BackgroundJobStore({ dir: d, now: clock() });
    const j = s.create({ originSessionId: "s1", command: "a", cwd: "/w" });
    s.setStatus(j.jobId, "running"); s.setStatus(j.jobId, "failed", { exitCode: 1 });
    s.markContinued(j.jobId);
    const reloaded = new BackgroundJobStore({ dir: d, now: clock() });
    assert.equal(reloaded.pendingContinuation().length, 0, "a restart must not re-fire the continuation");
    assert.equal(reloaded.get(j.jobId)!.continued, true);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("compaction rewrites the journal, drops old continued jobs, keeps live ones", () => {
  const d = dir();
  try {
    const s = new BackgroundJobStore({ dir: d, now: clock(), retainTerminalMs: 1, compactEvery: 1000 });
    const old = s.create({ originSessionId: "s1", command: "old", cwd: "/w" });
    s.setStatus(old.jobId, "running"); s.setStatus(old.jobId, "succeeded"); s.markContinued(old.jobId);
    const live = s.create({ originSessionId: "s2", command: "live", cwd: "/w" });
    s.setStatus(live.jobId, "running");
    s.compact(); // retainTerminalMs=1 + monotonic clock → the continued terminal job is now "old"

    const reloaded = new BackgroundJobStore({ dir: d, now: clock() });
    assert.equal(reloaded.get(old.jobId), undefined, "old continued terminal job is dropped");
    assert.equal(reloaded.get(live.jobId)!.status, "running", "live job is preserved across compaction");
    // journal must not still contain the dropped job's id
    assert.equal(readFileSync(join(d, JOURNAL), "utf8").includes(old.jobId), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("automatic compaction triggers after compactEvery events without losing state", () => {
  const d = dir();
  try {
    const s = new BackgroundJobStore({ dir: d, now: clock(), compactEvery: 3, retainTerminalMs: 0 });
    const j = s.create({ originSessionId: "s1", command: "a", cwd: "/w" }); // 1 event
    s.setPid(j.jobId, 10); // 2
    s.setStatus(j.jobId, "running"); // 3 → auto-compact here
    s.setStatus(j.jobId, "succeeded", { resultSummary: "ok" });
    const reloaded = new BackgroundJobStore({ dir: d, now: clock() });
    assert.equal(reloaded.get(j.jobId)!.status, "succeeded");
    assert.equal(reloaded.get(j.jobId)!.resultSummary, "ok");
    assert.equal(reloaded.get(j.jobId)!.pid, 10);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("planJobContinuation: acts only on a fresh terminal job, within the depth limit", () => {
  // running → no action
  assert.equal(planJobContinuation(job({ status: "running" })).act, false);
  // already continued → no action (idempotency)
  assert.equal(planJobContinuation(job({ continued: true })).act, false);
  // depth ceiling reached → no action (anti-loop)
  assert.equal(planJobContinuation(job({ autoContinueDepth: 8 }), { maxDepth: 8 }).act, false);
  // fresh succeeded → act, stamps next depth
  const ok = planJobContinuation(job({ autoContinueDepth: 2 }));
  assert.equal(ok.act, true);
  assert.equal(ok.nextDepth, 3);
  assert.match(ok.text!, /concluiu com sucesso/);
  assert.match(ok.text!, /Continue de onde parou/);
});

test("planJobContinuation: failed job surfaces exit code, output tail is bounded", () => {
  const failed = planJobContinuation(job({ status: "failed", exitCode: 2, resultSummary: "TS2304: cannot find name" }));
  assert.match(failed.text!, /falhou \(código de saída 2\)/);
  assert.match(failed.text!, /TS2304/);
  // a huge summary is truncated from the FRONT (keeps the tail — where errors usually are)
  const big = "x".repeat(9000) + "TAIL_MARKER";
  const bounded = planJobContinuation(job({ resultSummary: big }));
  assert.ok(bounded.text!.length < 6000, "prompt stays bounded");
  assert.match(bounded.text!, /TAIL_MARKER/);
  assert.match(bounded.text!, /início cortado/);
});

test("a corrupt first line yields an empty store rather than throwing", () => {
  const d = dir();
  try {
    writeFileSync(join(d, JOURNAL), "not json at all\n");
    const s = new BackgroundJobStore({ dir: d, now: clock() });
    assert.deepEqual(s.list(), []);
    assert.equal(isTerminalJobStatus("succeeded"), true);
    assert.equal(isTerminalJobStatus("running"), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
