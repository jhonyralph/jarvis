import { test } from "node:test";
import assert from "node:assert/strict";
import { ackThenWork } from "./progressive-reply.js";

test("ackThenWork speaks the ack and still returns the real work's result", async () => {
  const spoken: string[] = [];
  const result = await ackThenWork((t) => { spoken.push(t); }, "um instante", async () => 42);
  assert.equal(result, 42);
  assert.deepEqual(spoken, ["um instante"]);
});

test("ackThenWork returns the work's result even if the ack throws", async () => {
  const result = await ackThenWork(() => { throw new Error("tts indisponível"); }, "um instante", async () => "ok");
  assert.equal(result, "ok");
});

test("ackThenWork propagates the work's own rejection", async () => {
  await assert.rejects(
    () => ackThenWork(() => {}, "um instante", async () => { throw new Error("trabalho falhou"); }),
    /trabalho falhou/,
  );
});
