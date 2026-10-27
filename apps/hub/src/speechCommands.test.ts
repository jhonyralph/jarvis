import test from "node:test";
import assert from "node:assert/strict";
import { parseSpeechCommand } from "./speechCommands.js";

test("espere / me dá um tempo pedem o degrau padrão", () => {
  for (const s of ["Espere um pouco.", "espera aí", "Aguarde um momento, por favor", "Jarvis, me dá um tempo", "me dá um tempo pra pensar", "calma"]) {
    assert.deepEqual(parseSpeechCommand(s), { kind: "wait" }, s);
  }
});

test("um tempo dito vale no lugar do degrau", () => {
  assert.deepEqual(parseSpeechCommand("me dá 7 minutos"), { kind: "wait", minutes: 7 });
  assert.deepEqual(parseSpeechCommand("Espere cinco minutos."), { kind: "wait", minutes: 5 });
  assert.deepEqual(parseSpeechCommand("me dá mais dez minutos pra pensar"), { kind: "wait", minutes: 10 });
});

test("próxima, encerrar e ligar a voz", () => {
  assert.deepEqual(parseSpeechCommand("Próxima"), { kind: "next" });
  assert.deepEqual(parseSpeechCommand("passa para a próxima"), { kind: "next" });
  assert.deepEqual(parseSpeechCommand("Encerrar a voz."), { kind: "off" });
  assert.deepEqual(parseSpeechCommand("desliga a voz"), { kind: "off" });
  assert.deepEqual(parseSpeechCommand("ligar a voz"), { kind: "on" });
});

test("sim/não só valem como resposta à pergunta de trazer as outras sessões", () => {
  assert.equal(parseSpeechCommand("sim"), null, "sem a pergunta, \"sim\" é fala normal para a sessão");
  assert.deepEqual(parseSpeechCommand("Sim, pode.", { expectingBring: true }), { kind: "bring", yes: true });
  assert.deepEqual(parseSpeechCommand("pode trazer", { expectingBring: true }), { kind: "bring", yes: true });
  assert.deepEqual(parseSpeechCommand("Não.", { expectingBring: true }), { kind: "bring", yes: false });
  assert.deepEqual(parseSpeechCommand("agora não", { expectingBring: true }), { kind: "bring", yes: false });
});

test("instrução que só COMEÇA com a palavra não vira comando", () => {
  for (const s of [
    "espere, antes de mudar o login confere o teste",
    "a próxima tarefa é revisar o relatório de vendas",
    "pode parar a voz do vídeo de demonstração que está alto demais e trocar a música",
    "passa para a próxima etapa do deploy e roda as migrações",
    "espere o build terminar e depois publique",
  ]) assert.equal(parseSpeechCommand(s), null, s);
});

test("palavras soltas ambíguas não desligam a voz nem pulam a sessão", () => {
  for (const s of ["silêncio", "para de falar", "a próxima", "seguinte", "pula", "pula esse teste"]) {
    assert.equal(parseSpeechCommand(s), null, s);
  }
});
