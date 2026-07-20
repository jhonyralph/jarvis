import test from "node:test";
import assert from "node:assert/strict";
import { HubReplyTimeoutError, HubReplyWaiters } from "./replyWaiters.js";

test("correlated waiters do not consume another request's reply", async () => {
  const queue = new HubReplyWaiters();
  const a = queue.add<{ requestId: string }>("execution_delegate_result", 1000, (message) => message.requestId === "a");
  const b = queue.add<{ requestId: string }>("execution_delegate_result", 1000, (message) => message.requestId === "b");
  assert.equal(queue.resolve({ t: "execution_delegate_result", requestId: "b", ok: true }), true);
  assert.equal(await b.promise.then((message) => message.requestId), "b");
  assert.equal(queue.size, 1);
  assert.equal(queue.resolve({ t: "execution_delegate_result", requestId: "a", ok: true }), true);
  assert.equal((await a.promise).requestId, "a");
});

test("legacy replies remain FIFO instead of resolving all same-type requests", async () => {
  const queue = new HubReplyWaiters();
  const first = queue.add<{ seq: number }>("sessions", 1000);
  const second = queue.add<{ seq: number }>("sessions", 1000);
  queue.resolve({ t: "sessions", seq: 1 });
  assert.equal((await first.promise).seq, 1);
  assert.equal(queue.size, 1);
  queue.resolve({ t: "sessions", seq: 2 });
  assert.equal((await second.promise).seq, 2);
});

test("disconnect rejects and removes every pending waiter", async () => {
  const queue = new HubReplyWaiters();
  const pending = queue.add("fleet", 1000);
  queue.rejectAll(new Error("offline"));
  await assert.rejects(pending.promise, /offline/);
  assert.equal(queue.size, 0);
});

test("timeout is typed so callers do not misreport disconnects as elapsed waits", async () => {
  const queue = new HubReplyWaiters();
  const pending = queue.add("execution_delta", 1);
  await assert.rejects(pending.promise, (error) => error instanceof HubReplyTimeoutError && error.replyType === "execution_delta");
  assert.equal(queue.size, 0);
});

test("a malformed frame or throwing predicate cannot consume another pending request", async () => {
  const queue = new HubReplyWaiters();
  const pending = queue.add<{ requestId: string }>("reply", 1000, () => { throw new Error("bad predicate"); });
  assert.equal(queue.resolve(null), false);
  assert.equal(queue.resolve({ t: "reply", requestId: "x" }), false);
  assert.equal(queue.size, 1);
  queue.rejectAll(new Error("cleanup"));
  await assert.rejects(pending.promise, /cleanup/);
});
