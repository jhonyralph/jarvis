import test from "node:test";
import assert from "node:assert/strict";
import { endOfTurnDecision, partialShape, DEFAULT_ENDPOINT_THRESHOLDS as TH } from "./voice-endpoint.js";

const base = { speechMs: 2_000, elapsedMs: 4_000, partialFresh: true };

test("formato da parcial: completa, incompleta ou sem sinal", () => {
  assert.equal(partialShape("Verifica se o build passou."), "complete");
  assert.equal(partialShape("Can you check the build?"), "complete");
  assert.equal(partialShape("Verifica se o build passou e"), "incomplete");
  assert.equal(partialShape("eu acho que, tipo,"), "incomplete");
  assert.equal(partialShape("então..."), "incomplete");
  assert.equal(partialShape("Olha, o problema é que."), "incomplete", "ponto depois de 'que' é a transcrição fechando cedo demais");
  assert.equal(partialShape("Quiero practicar pero"), "incomplete");
  assert.equal(partialShape("verifica o build"), "unknown");
  assert.equal(partialShape(""), "unknown");
});

test("RN-A1: pausa de raciocínio depois de conector NÃO encerra", () => {
  const d = endOfTurnDecision({ ...base, silenceMs: 2_000, partial: "Eu quero que você revise o PR e" });
  assert.equal(d.end, false);
  assert.equal(d.waitMs, TH.incompleteMs);
});

test("frase completa encerra rápido", () => {
  assert.deepEqual(endOfTurnDecision({ ...base, silenceMs: 750, partial: "Roda os testes do hub." }), { end: true, reason: "frase_completa", waitMs: TH.completeMs });
  assert.equal(endOfTurnDecision({ ...base, silenceMs: 500, partial: "Roda os testes do hub." }).end, false);
});

test("parcial velha (não cobre a última fala) não decide: usa a espera neutra", () => {
  const d = endOfTurnDecision({ ...base, silenceMs: 800, partial: "Roda os testes.", partialFresh: false });
  assert.equal(d.end, false);
  assert.equal(d.waitMs, TH.neutralMs);
  assert.deepEqual(endOfTurnDecision({ ...base, silenceMs: 1_300, partialFresh: false }), { end: true, reason: "pausa_neutra", waitMs: TH.neutralMs });
});

test("RN-A3: o teto de silêncio sempre encerra, mesmo depois de conector", () => {
  assert.deepEqual(endOfTurnDecision({ ...base, silenceMs: TH.maxSilenceMs, partial: "e então" }), { end: true, reason: "teto_de_silencio", waitMs: TH.maxSilenceMs });
});

test("RN-A3: ninguém falou — desiste no prazo próprio; estalo curto não conta como fala", () => {
  assert.equal(endOfTurnDecision({ speechMs: 0, silenceMs: 5_000, elapsedMs: 5_000 }).end, false);
  assert.deepEqual(endOfTurnDecision({ speechMs: 100, silenceMs: 6_000, elapsedMs: 6_000 }), { end: true, reason: "sem_fala", waitMs: TH.noSpeechMs });
});

test("limiares são configuráveis", () => {
  const d = endOfTurnDecision({ ...base, silenceMs: 400, partial: "Pronto." }, { ...TH, completeMs: 300 });
  assert.equal(d.end, true);
});

test("fala longa: frase completa NÃO encerra num gole d'água — vale a espera longa", () => {
  const long = { speechMs: 45_000, elapsedMs: 60_000, partialFresh: true };
  const pausa = endOfTurnDecision({ ...long, silenceMs: 4_000, partial: "E o cliente reclamou disso ontem." });
  assert.equal(pausa.end, false, "4 s de pausa no meio de uma explicação não encerram");
  assert.equal(pausa.waitMs, TH.longCompleteMs);
  assert.deepEqual(endOfTurnDecision({ ...long, silenceMs: 5_100, partial: "E o cliente reclamou disso ontem." }), { end: true, reason: "frase_completa", waitMs: TH.longCompleteMs });
  assert.equal(endOfTurnDecision({ ...long, silenceMs: 7_000, partial: "e aí eu pensei que" }).end, false, "conector: espera ainda mais");
  assert.deepEqual(endOfTurnDecision({ ...long, silenceMs: 10_000, partial: "e aí eu pensei que" }), { end: true, reason: "teto_de_silencio", waitMs: TH.longMaxSilenceMs });
});

test("fala curta continua rápida: o modo longo só vale depois de muita fala", () => {
  const short = { speechMs: TH.longSpeechMs - 1, elapsedMs: 12_000, partialFresh: true };
  assert.equal(endOfTurnDecision({ ...short, silenceMs: 750, partial: "Roda os testes." }).end, true);
  assert.equal(endOfTurnDecision({ ...short, silenceMs: TH.maxSilenceMs, partial: "e" }).reason, "teto_de_silencio");
});

test("frase de fim encerra já, até no meio de uma explicação longa", () => {
  const long = { speechMs: 90_000, elapsedMs: 120_000, partialFresh: true };
  for (const fim of ["... e era isso, pode mandar.", "Terminei.", "Câmbio!", "ok, that's all", "eso es todo"]) {
    assert.deepEqual(endOfTurnDecision({ ...long, silenceMs: 800, partial: fim }), { end: true, reason: "frase_de_fim", waitMs: TH.completeMs }, fim);
  }
  assert.equal(endOfTurnDecision({ ...long, silenceMs: 800, partial: "O que eu quero é isso." }).end, false, "'é isso' comum não encerra");
  assert.equal(endOfTurnDecision({ ...long, silenceMs: 800, partial: "terminei o relatório e depois" }).end, false, "'terminei' no meio da frase não conta");
  assert.equal(endOfTurnDecision({ speechMs: 90_000, elapsedMs: 120_000, partialFresh: false, silenceMs: 800, partial: "pode mandar" }).end, false, "parcial velha não decide");
});
