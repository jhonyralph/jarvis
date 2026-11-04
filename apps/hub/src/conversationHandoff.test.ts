import test from "node:test";
import assert from "node:assert/strict";
import { conversationHandoff } from "./conversationHandoff.js";
test("new work receives the approved plan with its source, and missing context is explicit", () => {
  const source = { runnerId: "pc", sessionId: "design", cwd: "project", history: [{ role: "assistant", text: "P0: preservar dados; P1: validar recuperação" }], conversation: [{ text: "Pode implementar tudo" }] };
  const packet = conversationHandoff(source)!;
  assert.match(packet, /P0: preservar dados/); assert.match(packet, /pc \/ design/);
  assert.match(conversationHandoff({ ...source, history: [{ role: "assistant", text: "x".repeat(49000) }] })!, /contexto parcial/);
  assert.equal(conversationHandoff({ ...source, history: [], conversation: [] }), undefined);
});
