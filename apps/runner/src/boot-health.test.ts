/** Crash-loop rollback policy: a never-confirmed commit that crash-loops rolls back to last-good. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootRollbackDecision, confirmBoot } from "./boot-health.js";

const base = { cur: "bad1", lastGood: "good0", quickCrashes: 3, maxCrashes: 3 };

test("rolls back a never-confirmed commit that crash-looped to last-good", () => {
  assert.deepEqual(bootRollbackDecision(base), { rollback: true, target: "good0" });
});

test("does not roll back before the crash threshold", () => {
  assert.deepEqual(bootRollbackDecision({ ...base, quickCrashes: 2 }), { rollback: false });
});

test("does not roll back when the crashing commit IS the last-good (deps corruption, not bad code)", () => {
  assert.deepEqual(bootRollbackDecision({ ...base, cur: "good0" }), { rollback: false });
});

test("does not roll back without a known-good target", () => {
  assert.deepEqual(bootRollbackDecision({ ...base, lastGood: undefined }), { rollback: false });
});

test("never rollback-loops on the same bad commit", () => {
  assert.deepEqual(bootRollbackDecision({ ...base, rolledBackFrom: "bad1" }), { rollback: false });
  // but a DIFFERENT new bad commit still rolls back
  assert.deepEqual(bootRollbackDecision({ ...base, cur: "bad2", rolledBackFrom: "bad1" }), { rollback: true, target: "good0" });
});

test("confirmBoot marks the running commit as the new known-good", () => {
  assert.deepEqual(confirmBoot("abc123", 1000), { commit: "abc123", lastGood: "abc123", at: 1000 });
});
