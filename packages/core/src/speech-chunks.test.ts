import test from "node:test";
import assert from "node:assert/strict";
import { splitSentences, speechChunks } from "./speech-chunks.js";

test("frases simples, com ! ? e reticências", () => {
  assert.deepEqual(splitSentences("Pronto. O build passou! Quer que eu publique? Vou esperar..."), ["Pronto.", "O build passou!", "Quer que eu publique?", "Vou esperar..."]);
});

test("RN-D2: números, versões e arquivos não quebram frase", () => {
  assert.deepEqual(splitSentences("A versão 0.40.0 corrige o index.ts e custa 3.5 segundos. Depois roda."), ["A versão 0.40.0 corrige o index.ts e custa 3.5 segundos.", "Depois roda."]);
  assert.deepEqual(splitSentences("São 1.234 linhas no app.js. Ok."), ["São 1.234 linhas no app.js.", "Ok."]);
});

test("RN-D2: abreviações e iniciais não quebram frase", () => {
  assert.deepEqual(splitSentences("Falei com o Dr. Silva e a Sra. Souza. Eles aprovaram."), ["Falei com o Dr. Silva e a Sra. Souza.", "Eles aprovaram."]);
  assert.deepEqual(splitSentences("O autor é J. R. Tolkien, p.ex. no livro. Fim."), ["O autor é J. R. Tolkien, p.ex. no livro.", "Fim."]);
  assert.deepEqual(splitSentences("Veja a fig. 3 e o cap. 2. Pronto."), ["Veja a fig. 3 e o cap. 2.", "Pronto."]);
});

test("número no fim seguido de minúscula continua a frase; seguido de maiúscula fecha", () => {
  assert.deepEqual(splitSentences("Faça o passo 3. depois o 4."), ["Faça o passo 3. depois o 4."]);
  assert.deepEqual(splitSentences("O total foi 3. Depois disso, parou."), ["O total foi 3.", "Depois disso, parou."]);
});

test("aspas e parênteses de fechamento ficam com a frase", () => {
  assert.deepEqual(splitSentences('Ele disse "acabou." Então fechei. (Tudo certo.) Fim.'), ['Ele disse "acabou."', "Então fechei.", "(Tudo certo.)", "Fim."]);
});

test("inglês da prática de idiomas: 'ago.' fecha a frase", () => {
  assert.deepEqual(splitSentences("It shipped two days ago. Want details?"), ["It shipped two days ago.", "Want details?"]);
});

test("nada se perde: juntar os trechos devolve o texto normalizado", () => {
  const text = "  Primeiro ponto.\n\nSegundo   ponto, com v1.2 e Sr. X!  Terceiro sem ponto final";
  assert.equal(splitSentences(text).join(" "), text.replace(/\s+/g, " ").trim());
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences("   "), []);
});

test("trechos: primeira frase sozinha, resto agrupado", () => {
  const chunks = speechChunks("O build da branch principal passou. Os testes rodaram em dois minutos. Não houve falhas. A publicação pode seguir.", { restMax: 60 });
  assert.equal(chunks[0], "O build da branch principal passou.");
  assert.deepEqual(chunks.slice(1), ["Os testes rodaram em dois minutos. Não houve falhas.", "A publicação pode seguir."]);
});

test("trechos: primeira frase curta demais leva a seguinte junto", () => {
  assert.deepEqual(speechChunks("Pronto. O build passou e publiquei a versão.", { firstMin: 24 }), ["Pronto. O build passou e publiquei a versão."]);
  assert.deepEqual(speechChunks("Uma frase só."), ["Uma frase só."]);
  assert.deepEqual(speechChunks(""), []);
});

test("trechos: frase maior que o teto vira um trecho sozinha, sem ser cortada", () => {
  const long = "x".repeat(400) + ".";
  assert.deepEqual(speechChunks(`Começando a análise agora. ${long} Fim.`, { restMax: 100 }), ["Começando a análise agora.", long, "Fim."]);
});
