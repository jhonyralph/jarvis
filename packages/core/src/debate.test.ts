/** Debate: prompts carregam o tema + as posições das outras IAs; o parecer do juiz é tolerante; o teto
 *  de rodadas é limitado. O laço em si (parar cedo no consenso) é do Hub e testado lá/no e2e. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampDebateRounds, parseDebateVerdict,
  buildDebateOpeningPrompt, buildDebateRebuttalPrompt, buildDebateJudgePrompt, buildDebateSynthesisPrompt,
  formatDebateFinalMessage, DEBATE_DEFAULT_MAX_ROUNDS, DEBATE_MAX_ROUNDS_CAP,
} from "./debate.js";

test("clampDebateRounds: default no inválido, limita ao intervalo [1, cap]", () => {
  assert.equal(clampDebateRounds(undefined), DEBATE_DEFAULT_MAX_ROUNDS);
  assert.equal(clampDebateRounds("abc"), DEBATE_DEFAULT_MAX_ROUNDS);
  assert.equal(clampDebateRounds(0), 1);
  assert.equal(clampDebateRounds(-5), 1);
  assert.equal(clampDebateRounds(3), 3);
  assert.equal(clampDebateRounds(999), DEBATE_MAX_ROUNDS_CAP);
  assert.equal(clampDebateRounds(2.9), 2);
});

test("parseDebateVerdict: JSON válido, embutido em texto, e falha-segura", () => {
  const ok = parseDebateVerdict('{"converged": true, "confidence": 0.9, "reason": "concordam no essencial"}');
  assert.equal(ok.converged, true);
  assert.equal(ok.confidence, 0.9);
  assert.match(ok.reason, /essencial/);

  const embedded = parseDebateVerdict('Aqui está: {"converged": false, "confidence": 0.2, "reason": "ainda divergem no ponto X"} fim');
  assert.equal(embedded.converged, false);
  assert.equal(embedded.confidence, 0.2);

  const garbage = parseDebateVerdict("o modelo não respondeu em JSON");
  assert.equal(garbage.converged, false, "sem JSON válido → não convergiu (falha-segura)");
  assert.equal(garbage.confidence, 0);

  const clamped = parseDebateVerdict('{"converged": true, "confidence": 5}');
  assert.equal(clamped.confidence, 1, "confiança é limitada a [0,1]");
});

test("prompts carregam o tema e as posições das outras IAs", () => {
  const topic = "vale migrar o hub para SQLite?";
  assert.match(buildDebateOpeningPrompt(topic), /migrar o hub/);
  assert.match(buildDebateOpeningPrompt(topic), /somente leitura/i);

  const others = [{ id: "p2", label: "Codex", text: "acho arriscado por causa de X" }];
  const reb = buildDebateRebuttalPrompt(topic, 2, "minha posição inicial", others);
  assert.match(reb, /Rodada 2/);
  assert.match(reb, /minha posição inicial/);
  assert.match(reb, /Codex/);
  assert.match(reb, /arriscado por causa de X/);

  const judge = buildDebateJudgePrompt(topic, 2, others);
  assert.match(judge, /JUIZ/i);
  assert.match(judge, /"converged"/);

  const synth = buildDebateSynthesisPrompt(topic, others, { converged: true, rounds: 2 });
  assert.match(synth, /veredito final/i);
  assert.match(synth, /Convergiu para consenso: sim/);
});

test("formatDebateFinalMessage reflete consenso vs teto atingido", () => {
  const won = formatDebateFinalMessage({ rounds: 2, maxRounds: 10, converged: true, debaters: ["Claude", "Codex"], summary: "decisão: migrar" });
  assert.match(won, /Consenso em 2 rodada/);
  assert.match(won, /Claude, Codex/);
  assert.match(won, /migrar/);

  const capped = formatDebateFinalMessage({ rounds: 10, maxRounds: 10, converged: false, debaters: ["Claude", "Codex"] });
  assert.match(capped, /Sem consenso/);
  assert.match(capped, /teto de 10/);
});
