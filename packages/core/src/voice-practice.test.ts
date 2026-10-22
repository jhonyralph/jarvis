import test from "node:test";
import assert from "node:assert/strict";
import { parseLanguageCommand, practiceInstruction, languageSwitchConfirmation, speechMarkers } from "./voice-practice.js";

test("comando de prática em português, inglês e espanhol", () => {
  assert.deepEqual(parseLanguageCommand("Vamos praticar inglês"), { action: "practice", lang: "en" });
  assert.deepEqual(parseLanguageCommand("Jarvis, vamos praticar espanhol agora."), { action: "practice", lang: "es" });
  assert.deepEqual(parseLanguageCommand("quero treinar francês um pouco"), { action: "practice", lang: "fr" });
  assert.deepEqual(parseLanguageCommand("Let's practice Spanish!"), { action: "practice", lang: "es" });
  assert.deepEqual(parseLanguageCommand("Vamos a practicar inglés"), { action: "practice", lang: "en" });
});

test("comando de volta ao português", () => {
  for (const t of ["Volta pro português", "Jarvis, volta para o português.", "parar de praticar", "Let's go back to Portuguese", "stop practicing", "Volvamos al portugués"]) {
    assert.deepEqual(parseLanguageCommand(t), { action: "native" }, t);
  }
});

test("frase que só MENCIONA o comando não troca o modo", () => {
  assert.equal(parseLanguageCommand("Como se diz vamos praticar inglês em inglês?"), null);
  assert.equal(parseLanguageCommand("Ontem a gente ia praticar inglês mas não deu"), null);
  assert.equal(parseLanguageCommand("vamos praticar português"), null, "praticar português não é o modo prática");
  assert.equal(parseLanguageCommand("vamos praticar klingon"), null);
  assert.equal(parseLanguageCommand(""), null);
});

test("instrução ao agente: idioma, conversa falada e a correção conforme a escolha", () => {
  const on = practiceInstruction("en", true);
  assert.match(on, /inglês/);
  assert.match(on, /"Tip:"/);
  const off = practiceInstruction("es", false);
  assert.match(off, /espanhol/);
  assert.doesNotMatch(off, /Consejo/);
  assert.match(practiceInstruction("es", true), /"Consejo:"/);
});

test("confirmação já no idioma novo", () => {
  assert.equal(languageSwitchConfirmation({ action: "practice", lang: "en" }), "Okay, let's practice English. Go ahead!");
  assert.match(languageSwitchConfirmation({ action: "practice", lang: "es" }), /español/);
  assert.equal(languageSwitchConfirmation({ action: "native" }), "Certo, voltamos ao português.");
});

test("marcadores falados por idioma; sem tradução própria cai no inglês", () => {
  assert.equal(speechMarkers().table, "(tabela no chat)");
  assert.equal(speechMarkers("es").codeBlock, "(código en el chat)");
  assert.equal(speechMarkers("de").table, "(table in the chat)");
  assert.equal(speechMarkers("en").imageNamed("logo"), "image logo, in the chat");
});
