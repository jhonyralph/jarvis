import test from "node:test";
import assert from "node:assert/strict";
import { PendingRequestRegistry, SessionDispatchReservations, remoteErrorRoute } from "./sessionIsolation.js";

test("delayed replies require the original runner, session, principal and operation", () => {
  const pending = new PendingRequestRegistry<object>(() => 10);
  const socket = {};
  pending.set("req-1", { socket, runnerId: "runner-a", sessionIds: ["session-a"], principalId: "alice", operation: "history" });

  assert.equal(pending.take("req-1", { runnerId: "runner-b", operations: new Set(["history"]), sessionId: "session-a", authorize: () => true }), undefined);
  assert.ok(pending.get("req-1"), "a different runner cannot consume the real request");
  assert.equal(pending.take("req-1", { runnerId: "runner-a", operations: new Set(["filediff"]), sessionId: "session-a", authorize: () => true }), undefined);
  assert.ok(pending.get("req-1"), "a different operation cannot consume the real request");
  assert.equal(pending.take("req-1", { runnerId: "runner-a", operations: new Set(["history"]), sessionId: "session-b", authorize: () => true }), undefined);
  assert.equal(pending.get("req-1"), undefined, "a malformed matching-runner response is one-shot");
});

test("authorization is rerun when a delayed response arrives", () => {
  const pending = new PendingRequestRegistry<object>();
  pending.set("req-1", { socket: {}, runnerId: "runner-a", sessionIds: ["session-a"], principalId: "alice", operation: "preview" });
  let authorized = true;
  authorized = false;

  assert.equal(pending.take("req-1", { runnerId: "runner-a", operations: new Set(["preview"]), sessionId: "session-a", authorize: (request) => authorized && request.principalId === "alice" }), undefined);
  assert.equal(pending.get("req-1"), undefined, "a revoked response cannot be replayed later");
});

test("duplicate request ids cannot replace an existing request owner", () => {
  const pending = new PendingRequestRegistry<object>();
  const original = {};
  pending.set("req-1", { socket: original, runnerId: "runner-a", principalId: "alice", operation: "history" });

  assert.throws(
    () => pending.set("req-1", { socket: {}, runnerId: "runner-a", principalId: "bob", operation: "history" }),
    /duplicate pending request id/,
  );
  assert.equal(pending.get("req-1")?.socket, original);
});

test("remote error routing discards unscoped text and retains no runner message", () => {
  const secret = "provider token leaked by runner";
  assert.deepEqual(remoteErrorRoute({ message: secret }), { scope: "discard" });
  assert.deepEqual(remoteErrorRoute({ sessionId: "session-a", message: secret }), { scope: "session", sessionId: "session-a" });
  assert.equal(JSON.stringify(remoteErrorRoute({ sessionId: "session-a" })).includes(secret), false);
});

test("one dispatch reservation exists per runner and session across async preparation", () => {
  const reservations = new SessionDispatchReservations();
  const first = reservations.tryAcquire("runner-a", "session-a", "alice", "send");
  assert.ok(first);
  assert.equal(reservations.tryAcquire("runner-a", "session-a", "alice", "flush"), undefined);
  assert.ok(reservations.tryAcquire("runner-a", "session-b", "alice", "send"));
  assert.ok(reservations.tryAcquire("runner-b", "session-a", "alice", "send"));
});

test("a stale release cannot unlock a newer dispatch", () => {
  const reservations = new SessionDispatchReservations();
  const first = reservations.tryAcquire("runner-a", "session-a", "alice", "send")!;
  assert.equal(reservations.release(first), true);
  const second = reservations.tryAcquire("runner-a", "session-a", "alice", "flush")!;

  assert.equal(reservations.release(first), false);
  assert.equal(reservations.isCurrent(second), true);
});
