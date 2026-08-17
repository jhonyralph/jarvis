/** Debate: prompts carregam o tema + as posições das outras IAs; o parecer do juiz é tolerante; o teto
 *  de rodadas é limitado. O laço em si (parar cedo no consenso) é do Hub e testado lá/no e2e. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampDebateRounds, parseDebateVerdict,
  buildDebateOpeningPrompt, buildDebateRebuttalPrompt, buildDebateJudgePrompt, buildDebateSynthesisPrompt,
  buildDebateInterjectionBlock,
  formatDebateFinalMessage, DEBATE_DEFAULT_MAX_ROUNDS, DEBATE_MAX_ROUNDS_CAP, DEBATE_INTERJECTION_MAX_CHARS, DEBATE_INTERJECTION_MAX_KEPT,
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

test("interjeição: bloco vazio sem recado, e recado limpo/limitado quando há", () => {
  assert.equal(buildDebateInterjectionBlock([]), "", "sem recado não gera bloco");
  assert.equal(buildDebateInterjectionBlock(["", "   "]), "", "recado só de espaço não vira bloco");

  const bloco = buildDebateInterjectionBlock(["foca no custo", "  ignore o plano B  "]);
  assert.match(bloco, /ORGANIZADOR/);
  assert.match(bloco, /- foca no custo/);
  assert.match(bloco, /- ignore o plano B$/m, "recado é aparado nas pontas");
  assert.match(bloco, /instrução/i, "o recado vale como instrução, não como mais uma posição a rebater");

  const gigante = buildDebateInterjectionBlock(["x".repeat(DEBATE_INTERJECTION_MAX_CHARS + 500)]);
  assert.ok(gigante.includes("x".repeat(DEBATE_INTERJECTION_MAX_CHARS)), "mantém o teto de caracteres");
  assert.ok(!gigante.includes("x".repeat(DEBATE_INTERJECTION_MAX_CHARS + 1)), "corta o que passa do teto");

  const finalScope = buildDebateInterjectionBlock(["foca no custo"], "final");
  assert.match(finalScope, /veredito precisa respondê-los/i, "na síntese o recado vira exigência de resposta");

  // Volume: o prompt não pode crescer sem limite, mas o corte é DECLARADO — engolir recado em
  // silêncio seria repetir, dentro do prompt, o bug que a interjeição veio corrigir.
  const muitos = Array.from({ length: DEBATE_INTERJECTION_MAX_KEPT + 3 }, (_v, i) => `recado ${i + 1}`);
  const cortado = buildDebateInterjectionBlock(muitos);
  assert.match(cortado, /3 recado\(s\) mais antigo\(s\) omitido\(s\)/, "o corte é dito, não escondido");
  assert.ok(!cortado.includes("- recado 1\n"), "os mais antigos saem");
  assert.match(cortado, /- recado 23$/m, "os mais recentes ficam");
  assert.equal((cortado.match(/^- recado /gm) || []).length, DEBATE_INTERJECTION_MAX_KEPT);
});

test("interjeição entra nos prompts das rodadas e da síntese — e não aparece quando não houve", () => {
  const topic = "vale migrar o hub para SQLite?";
  const others = [{ id: "p2", label: "Codex", text: "acho arriscado por causa de X" }];
  const recados = ["decida pensando em custo de operação"];

  const abertura = buildDebateOpeningPrompt(topic, recados);
  assert.match(abertura, /custo de operação/);
  assert.ok(!buildDebateOpeningPrompt(topic).includes("ORGANIZADOR"), "sem recado, nada de bloco na rodada 1");

  const reb = buildDebateRebuttalPrompt(topic, 2, "minha posição", others, recados);
  assert.match(reb, /custo de operação/);
  assert.match(reb, /como você atendeu/i, "a regra de responder ao recado só existe quando há recado");
  assert.ok(reb.indexOf("ORGANIZADOR") > reb.indexOf("Codex"), "o recado vem depois das posições, colado nas regras");
  const semRecado = buildDebateRebuttalPrompt(topic, 2, "minha posição", others);
  assert.ok(!semRecado.includes("ORGANIZADOR"));
  assert.ok(!/como você atendeu/i.test(semRecado));

  const synth = buildDebateSynthesisPrompt(topic, others, { converged: true, rounds: 2, interjections: recados });
  assert.match(synth, /custo de operação/);
  assert.match(synth, /\*\*Recados do organizador\*\*/, "o veredito ganha uma seção para responder os recados");
  const synthSem = buildDebateSynthesisPrompt(topic, others, { converged: true, rounds: 2 });
  assert.ok(!synthSem.includes("Recados do organizador"), "sem recado, o veredito não pede seção vazia");
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
