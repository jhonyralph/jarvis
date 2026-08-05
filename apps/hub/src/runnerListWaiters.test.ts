import test from "node:test";
import assert from "node:assert/strict";
import { RunnerListWaiters } from "./runnerListWaiters.js";

test("concurrent requests for the same machine are ALL served by one reply", () => {
  const waiters = new RunnerListWaiters();
  const got: string[][] = [];
  // The regression: with one callback slot per runner, this second add() overwrote the first, and the
  // first caller sat until its 6s timeout and resolved [] — the machine silently dropped out of the
  // unified view even though the runner had answered.
  waiters.add("notebook", (s) => got.push(s.map((x) => x.id)));
  waiters.add("notebook", (s) => got.push(s.map((x) => x.id)));

  assert.equal(waiters.pending("notebook"), 2);
  const served = waiters.resolve("notebook", [{ id: "a" }, { id: "b" }]);

  assert.equal(served, 2, "os dois pedidos concorrentes têm de ser atendidos");
  assert.deepEqual(got, [["a", "b"], ["a", "b"]]);
  assert.equal(waiters.pending("notebook"), 0, "a fila esvazia após servir");
});

test("a spontaneous push from the runner serves whoever is waiting", () => {
  const waiters = new RunnerListWaiters();
  let seen: any[] | null = null;
  waiters.add("notebook", (s) => { seen = s; });

  // The Runner pushes `sessions` on its own whenever its store changes — same frame, no reqId. It must
  // satisfy the pending request rather than being dropped (or stealing it from a different caller).
  waiters.resolve("notebook", [{ id: "x" }]);
  assert.deepEqual(seen, [{ id: "x" }]);
});

test("waiters are isolated per machine", () => {
  const waiters = new RunnerListWaiters();
  const calls: string[] = [];
  waiters.add("notebook", () => calls.push("notebook"));
  waiters.add("desktop", () => calls.push("desktop"));

  waiters.resolve("notebook", []);
  assert.deepEqual(calls, ["notebook"], "resolver uma máquina não pode disparar a outra");
  assert.equal(waiters.pending("desktop"), 1);
});

test("a cancelled waiter is not served later", () => {
  const waiters = new RunnerListWaiters();
  let called = 0;
  const cancel = waiters.add("notebook", () => { called++; });
  cancel();

  assert.equal(waiters.pending("notebook"), 0);
  assert.equal(waiters.resolve("notebook", [{ id: "a" }]), 0);
  assert.equal(called, 0, "o waiter que expirou/cancelou não pode resolver duas vezes");
});

test("cancelling one waiter leaves the others queued", () => {
  const waiters = new RunnerListWaiters();
  const calls: string[] = [];
  const cancelFirst = waiters.add("notebook", () => calls.push("first"));
  waiters.add("notebook", () => calls.push("second"));
  cancelFirst();

  waiters.resolve("notebook", []);
  assert.deepEqual(calls, ["second"]);
});

test("resolving a machine nobody is waiting on is a no-op", () => {
  const waiters = new RunnerListWaiters();
  assert.equal(waiters.resolve("notebook", [{ id: "a" }]), 0);
});

test("a waiter may queue a fresh request from inside its own callback", () => {
  const waiters = new RunnerListWaiters();
  const rounds: string[] = [];
  waiters.add("notebook", () => { rounds.push("first"); waiters.add("notebook", () => rounds.push("second")); });

  waiters.resolve("notebook", []);
  assert.deepEqual(rounds, ["first"], "o pedido re-enfileirado espera a PRÓXIMA lista");
  assert.equal(waiters.pending("notebook"), 1);

  waiters.resolve("notebook", []);
  assert.deepEqual(rounds, ["first", "second"]);
});
