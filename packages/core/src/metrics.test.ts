import { test } from "node:test";
import assert from "node:assert/strict";
import { Metrics, percentile } from "./metrics.js";

test("percentile uses nearest-rank and is empty-safe", () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([10], 0.95), 10);
  const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(s, 0.5), 50);
  assert.equal(percentile(s, 0.95), 100);
  assert.equal(percentile(s, 0.1), 10);
});

test("per-runner rollup computes error rate + latency percentiles", () => {
  const m = new Metrics();
  // runner A: 4 turns, 1 error, durations 100/200/300/400
  m.record({ runnerId: "A", ms: 100, ok: true, ts: 1 });
  m.record({ runnerId: "A", ms: 200, ok: true, ts: 2 });
  m.record({ runnerId: "A", ms: 300, ok: false, ts: 3 });
  m.record({ runnerId: "A", ms: 400, ok: true, ts: 4 });
  // runner B: 1 turn, ok
  m.record({ runnerId: "B", ms: 50, ok: true, ts: 10 });

  const byRunner = m.byRunner();
  assert.equal(byRunner.length, 2);
  assert.equal(byRunner[0].runnerId, "B", "sorted by most-recent lastTs first");

  const a = byRunner.find((r) => r.runnerId === "A")!;
  assert.equal(a.turns, 4);
  assert.equal(a.errors, 1);
  assert.equal(a.errorRate, 0.25);
  assert.equal(a.avgMs, 250);
  assert.equal(a.p50ms, 200); // nearest-rank over [100,200,300,400] at p=.5 → idx ceil(2)-1=1 → 200
  assert.equal(a.p95ms, 400); // idx ceil(3.8)-1=3 → 400
  assert.equal(a.lastTs, 4);

  const overall = m.overall();
  assert.equal(overall.turns, 5);
  assert.equal(overall.errors, 1);
  assert.equal(overall.runnerId, "*");
});

test("bounded window drops oldest beyond cap", () => {
  const m = new Metrics(3);
  for (let i = 0; i < 10; i++) m.record({ runnerId: "A", ms: i, ok: true, ts: i });
  assert.equal(m.size(), 3, "never exceeds the cap");
  const a = m.overall();
  assert.equal(a.turns, 3);
  // only the last three (ms 7,8,9) survive
  assert.equal(a.avgMs, 8);
});
