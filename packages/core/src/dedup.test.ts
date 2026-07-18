import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeenSet } from "./dedup.js";

test("first sight is new, repeat is a duplicate", () => {
  const s = createSeenSet();
  assert.equal(s.add("t1"), true, "first time → new");
  assert.equal(s.add("t1"), false, "second time → duplicate");
  assert.equal(s.add("t2"), true);
  assert.equal(s.has("t1"), true);
  assert.equal(s.has("nope"), false);
});

test("idempotent turn dedup: a re-delivered turnId runs at most once", () => {
  const s = createSeenSet();
  const runs: string[] = [];
  const receive = (turnId: string) => { if (s.add(turnId)) runs.push(turnId); };
  receive("A"); receive("B"); receive("A"); receive("A"); receive("C"); receive("B");
  assert.deepEqual(runs, ["A", "B", "C"], "each command executes exactly once despite re-delivery");
});

test("evicts the OLDEST id past the cap (LRU window, not a wipe)", () => {
  const s = createSeenSet(3);
  assert.equal(s.add("a"), true);
  assert.equal(s.add("b"), true);
  assert.equal(s.add("c"), true);
  assert.equal(s.add("d"), true);      // pushes size to 4 → evicts "a" (oldest)
  assert.equal(s.size, 3);
  assert.equal(s.has("a"), false, "oldest evicted");
  assert.equal(s.has("b"), true);
  assert.equal(s.add("a"), true, "an evicted id is treated as new again (window has moved on)");
});

test("size reflects distinct ids seen (bounded)", () => {
  const s = createSeenSet(100);
  for (let i = 0; i < 250; i++) s.add("id" + i);
  assert.equal(s.size, 100);
});
