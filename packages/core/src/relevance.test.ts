import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRelevancePrompt, parseRelevanceVerdict } from "./relevance.js";

test("prompt includes the transcript, and context only when given", () => {
  const p1 = buildRelevancePrompt("rode os testes");
  assert.match(p1, /rode os testes/);
  assert.match(p1, /relevante/i);
  assert.doesNotMatch(p1, /Tema\/contexto/);
  const p2 = buildRelevancePrompt("e agora o build", "Sessão: deploy do hub");
  assert.match(p2, /Tema\/contexto/);
  assert.match(p2, /deploy do hub/);
});

test("parses JSON verdicts (pt + en keys, boolean + string)", () => {
  assert.equal(parseRelevanceVerdict('{"relevante": true}').relevant, true);
  assert.equal(parseRelevanceVerdict('{"relevante": false, "motivo":"ruído"}').relevant, false);
  assert.equal(parseRelevanceVerdict('{"relevante": false}').reason, undefined);
  assert.equal(parseRelevanceVerdict('lixo {"relevant": false} sufixo').relevant, false, "en key + surrounding text");
  assert.equal(parseRelevanceVerdict('{"relevante":"false"}').relevant, false, "string false");
  assert.equal(parseRelevanceVerdict('{"relevante":"sim"}').relevant, true, "non-negative string");
  assert.equal(parseRelevanceVerdict('{"relevante": false, "motivo":"conversa alheia"}').reason, "conversa alheia");
});

test("FAIL-OPEN on unparseable output; explicit bare negative still ignores", () => {
  assert.equal(parseRelevanceVerdict("").relevant, true, "empty → let through");
  assert.equal(parseRelevanceVerdict("sim, parece um comando").relevant, true, "prose → let through");
  assert.equal(parseRelevanceVerdict("{broken json").relevant, true, "bad json → let through");
  assert.equal(parseRelevanceVerdict("false").relevant, false, "bare negative → ignore");
  assert.equal(parseRelevanceVerdict("Não").relevant, false, "bare 'não' → ignore");
});
