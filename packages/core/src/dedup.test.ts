import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeenSet, filterForDispatch } from "./dedup.js";

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

test("filterForDispatch impede o mesmo item rodar duas vezes (o bug do turno duplicado)", () => {
  const dispatched = new Set(["m1"]);
  const isDone = (id: string): boolean => dispatched.has(id);

  // um item que JÁ foi despachado e voltou para a fila não pode rodar de novo
  const r1 = filterForDispatch([{ msgId: "m1", text: "oi" }, { msgId: "m2", text: "tudo bem?" }], isDone);
  assert.deepEqual(r1.keep.map((i) => i.msgId), ["m2"]);
  assert.deepEqual(r1.duplicates.map((i) => i.msgId), ["m1"]);

  // repetição DENTRO da mesma leva também é barrada (foi assim que o texto apareceu 2x num só turno)
  const r2 = filterForDispatch([{ msgId: "m3", text: "a" }, { msgId: "m3", text: "a" }], isDone);
  assert.equal(r2.keep.length, 1);
  assert.equal(r2.duplicates.length, 1);

  // sem msgId não dá para identificar: passa (o usuário pode repetir a mesma frase de propósito)
  const r3 = filterForDispatch([{ text: "oi" }, { text: "oi" }] as Array<{ msgId?: string; text: string }>, isDone);
  assert.equal(r3.keep.length, 2);
  assert.equal(r3.duplicates.length, 0);
});
