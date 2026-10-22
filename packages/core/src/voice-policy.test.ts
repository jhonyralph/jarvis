import test from "node:test";
import assert from "node:assert/strict";
import { normalizeListenConfig, listenLanguages, replyLanguage, normalizeGateLevel, voiceGateDecision, DEFAULT_LISTEN_CONFIG, type VoiceGateInput } from "./voice-policy.js";

test("escuta: padrão é português fixo, com correção ligada na prática", () => {
  assert.deepEqual(normalizeListenConfig(undefined), DEFAULT_LISTEN_CONFIG);
  assert.deepEqual(listenLanguages(DEFAULT_LISTEN_CONFIG), { lang: "pt" });
  assert.equal(DEFAULT_LISTEN_CONFIG.correct, true);
});

test("escuta: valores desconhecidos caem no padrão, nunca quebram", () => {
  const c = normalizeListenConfig({ mode: "xyz", lang: "ro", langs: ["ro", 3], practice: "klingon", correct: "sim" });
  assert.equal(c.mode, "fixed");
  assert.equal(c.lang, "pt", "romeno não é idioma oferecido — foi justamente o erro de 2026-08-04");
  assert.deepEqual(c.langs, ["pt", "en"]);
  assert.equal(c.practice, "en");
  assert.equal(c.correct, true);
});

test("escuta: conjunto com um idioma só é completado; duplicados somem", () => {
  assert.deepEqual(normalizeListenConfig({ mode: "set", langs: ["es"] }).langs, ["es", "pt"]);
  assert.deepEqual(normalizeListenConfig({ mode: "set", langs: ["pt", "pt"] }).langs, ["pt", "en"]);
  assert.deepEqual(listenLanguages(normalizeListenConfig({ mode: "set", langs: ["pt", "es", "en"] })), { langs: ["pt", "es", "en"] });
});

test("prática: escuta o idioma praticado e o português; responde no praticado", () => {
  const c = normalizeListenConfig({ mode: "practice", practice: "es" });
  assert.deepEqual(listenLanguages(c), { langs: ["es", "pt"] });
  assert.equal(replyLanguage(c), "es");
  assert.equal(replyLanguage(normalizeListenConfig({ mode: "set" })), "pt", "fora da prática a resposta é em português");
  assert.equal(normalizeListenConfig({ mode: "practice", practice: "pt" }).practice, "en", "praticar português não faz sentido aqui");
});

test("nível do portão: migra da chave antiga", () => {
  assert.equal(normalizeGateLevel({}), "balanced");
  assert.equal(normalizeGateLevel({ relevance: "on" }), "balanced");
  assert.equal(normalizeGateLevel({ relevance: "off" }), "fast");
  assert.equal(normalizeGateLevel({ gateLevel: "strict", relevance: "off" }), "strict", "a escolha nova vence a antiga");
});

const base: VoiceGateInput = { text: "verifica se o build passou", level: "balanced", handsFree: false, speakerKnown: false };

test("rigoroso chama o modelo sempre; rápido nunca", () => {
  assert.deepEqual(voiceGateDecision({ ...base, level: "strict" }), { drop: false, callModel: true, modelMayDrop: true, reason: "rigoroso" });
  assert.deepEqual(voiceGateDecision({ ...base, level: "fast", handsFree: true }), { drop: false, callModel: false, modelMayDrop: false, reason: "rapido" });
});

test("fala vazia é descartada em qualquer nível, sem custo", () => {
  for (const level of ["fast", "balanced", "strict"] as const) assert.equal(voiceGateDecision({ ...base, level, text: " ." }).drop, true);
});

test("equilibrado: intenção explícita vai direto, sem modelo", () => {
  assert.equal(voiceGateDecision(base).reason, "toque", "tocar no microfone é intenção");
  assert.equal(voiceGateDecision({ ...base, handsFree: true, speakerKnown: true }).reason, "dono_reconhecido");
  assert.equal(voiceGateDecision({ ...base, handsFree: true, text: "Jarvis, abre o projeto" }).reason, "chamou_jarvis");
  assert.equal(voiceGateDecision({ ...base, handsFree: true, wakeWord: true }).reason, "palavra_de_ativacao");
  assert.equal(voiceGateDecision({ ...base, handsFree: true, isControl: true, text: "cancela" }).callModel, false);
  for (const reason of ["toque", "dono_reconhecido"]) assert.equal(voiceGateDecision({ ...base, handsFree: reason !== "toque", speakerKnown: reason === "dono_reconhecido" }).callModel, false);
});

test("equilibrado: escuta aberta sozinha com voz desconhecida é o caso do modelo", () => {
  assert.deepEqual(voiceGateDecision({ ...base, handsFree: true, text: "e não vou na igreja sete horas" }), { drop: false, callModel: true, modelMayDrop: true, reason: "ambigua" });
});

test("equilibrado: transcrição duvidosa pede correção, mas o modelo não pode descartar uma fala explícita", () => {
  assert.deepEqual(voiceGateDecision({ ...base, confidence: 0.2 }), { drop: false, callModel: true, modelMayDrop: false, reason: "baixa_confianca" });
  assert.equal(voiceGateDecision({ ...base, confidence: 0.9 }).callModel, false);
  assert.equal(voiceGateDecision({ ...base, confidence: 0.5, correctBelow: 0.6 }).callModel, true, "o limiar é configurável");
});

test("equilibrado: só hesitação é descartada; frase com hesitação não", () => {
  for (const t of ["hum", "Hmm...", "ahn", "éh", "tipo", "então"]) assert.equal(voiceGateDecision({ ...base, text: t }).drop, true, t);
  assert.equal(voiceGateDecision({ ...base, text: "hum, roda os testes" }).drop, false);
});
