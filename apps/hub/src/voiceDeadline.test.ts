import test from "node:test";
import assert from "node:assert/strict";
import { voiceDeadline } from "./voiceDeadline.js";

test("dependency that never becomes ready is cancelled and rejected", async () => {
  let cancelled = 0;
  await assert.rejects(voiceDeadline(new Promise(() => {}), 5, "STT unavailable", () => cancelled++), /STT unavailable/);
  assert.equal(cancelled, 1);
});
test("successful or failed dependency clears its cancellation timer", async () => {
  let cancelled = 0;
  assert.equal(await voiceDeadline(Promise.resolve("ok"), 5, "late", () => cancelled++), "ok");
  await assert.rejects(voiceDeadline(Promise.reject(new Error("load failed")), 5, "late", () => cancelled++), /load failed/);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(cancelled, 0);
});
test("a cancellation failure rejects the wait without escaping the timer callback", async () => {
  const cause = new Error("process already inaccessible");
  await assert.rejects(voiceDeadline(new Promise(() => {}), 5, "STT unavailable", () => { throw cause; }), (error: Error) => {
    assert.equal(error.message, "STT unavailable");
    assert.equal(error.cause, cause);
    return true;
  });
});
