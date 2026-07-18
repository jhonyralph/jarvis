import { test } from "node:test";
import assert from "node:assert/strict";
import { Outbox } from "./outbox.js";

test("push keeps FIFO order; drain empties and returns it", () => {
  const o = new Outbox<number>(10);
  o.push(1); o.push(2); o.push(3);
  assert.equal(o.size, 3);
  assert.deepEqual(o.drain(), [1, 2, 3]);
  assert.equal(o.size, 0, "drained buffer is empty");
  assert.deepEqual(o.drain(), [], "second drain is empty");
});

test("at capacity, the OLDEST is dropped so the terminal tail survives", () => {
  const o = new Outbox<string>(3);
  ["a", "b", "c", "d", "done"].forEach((x) => o.push(x));
  assert.equal(o.size, 3, "never exceeds cap");
  // 'a' and 'b' fell off; the most recent three — including the terminal 'done' — remain in order
  assert.deepEqual(o.drain(), ["c", "d", "done"]);
});

test("cap floors at 1 (never zero/negative)", () => {
  const o = new Outbox<number>(0);
  o.push(1); o.push(2);
  assert.deepEqual(o.drain(), [2], "cap<1 behaves as cap=1");
});
