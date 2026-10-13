// Tradução dos erros do electron-updater que têm ação do lado do usuário. Pura, então testa sem
// Electron (que nunca roda em CI) — mesmo padrão do control.test.js.
//
// Por que este teste existe: o erro de arquitetura no macOS era o modo de falha que o suporte a
// Mac Intel expôs. O updater filtra os assets do canal pela substring "arm64" no nome do arquivo;
// enquanto a release saía arm64-only, um Mac Intel ficava com lista vazia e a UI mostrava o erro
// cru logo depois de anunciar que havia atualização.
//
// Os erros abaixo são os que o electron-updater 6.8.9 REALMENTE produz — conferidos no código do
// pacote, não escritos de memória. A primeira versão deste teste montava um erro que aquele
// caminho nunca gera (`ZIP file not provided: []`, com lista vazia), passava, e não protegia nada:
// o código de verdade para lista vazia é ERR_UPDATER_NO_FILES_PROVIDED, jogado antes, em
// Provider.findFile. Se mexer aqui, confira no pacote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { describeUpdaterError } = req("./register-updater-ipc.js");

test("lista vazia por filtro de arquitetura: explica a causa em vez de repassar 'No files provided'", () => {
  // Provider.js:77 — `if (files.length === 0) throw newError("No files provided", "ERR_UPDATER_NO_FILES_PROVIDED")`.
  // É ESTE o erro que um Mac Intel recebe numa release arm64-only.
  const real = { code: "ERR_UPDATER_NO_FILES_PROVIDED", message: "No files provided" };
  const m = describeUpdaterError(real);
  assert.doesNotMatch(m, /No files provided/, "a string crua não deve sobrar na mensagem");
  assert.match(m, /releases/, "tem de dizer o que fazer");
  if (process.platform === "darwin") {
    assert.match(m, /arquitetura deste Mac/);
    assert.match(m, new RegExp(process.arch), "cita a arquitetura da máquina");
  } else {
    // Num Windows/Linux o updater não filtra por arquitetura; falar em "Mac" seria mandar o
    // usuário procurar um DMG que não existe para ele.
    assert.doesNotMatch(m, /Mac|DMG/);
  }
});

test("release só com .dmg (sem zip) cai na mesma explicação", () => {
  // MacUpdater.js:83 — o outro código, alcançável com lista NÃO vazia e sem .zip. A mensagem real
  // carrega os arquivos no texto, então o teste usa o formato verdadeiro.
  const real = { code: "ERR_UPDATER_ZIP_FILE_NOT_FOUND", message: 'ZIP file not provided: [{"url":"Jarvis-1.0.0-x64.dmg"}]' };
  const m = describeUpdaterError(real);
  assert.doesNotMatch(m, /ZIP file not provided/);
  assert.match(m, /releases/);
});

test("reconhece pelo texto quando o `code` não vem", () => {
  // Defesa contra mudança interna: o `code` é posto por newError() e já mudou de lugar entre
  // versões; o texto é o que o usuário vê de qualquer forma.
  assert.match(describeUpdaterError({ message: "No files provided" }), /releases/);
});

test("falta de assinatura vira 'atualização manual', não erro técnico", () => {
  const m = describeUpdaterError({ message: "Could not get code signature for running application" });
  assert.match(m, /MANUAL/);
  assert.match(m, /DMG/);
});

test("erro desconhecido passa como está, limitado a 300 chars", () => {
  assert.equal(describeUpdaterError({ message: "net::ERR_INTERNET_DISCONNECTED" }), "net::ERR_INTERNET_DISCONNECTED");
  assert.equal(describeUpdaterError({ message: "x".repeat(500) }).length, 300);
});
