import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK_REPLY_BUDGET, ASK_REPLY_HEAD, askShape, buildAskPrompt, excerptKeepingEnd, hasProseQuestion, parseAskQuestions, stripFencedCode, summarizeAskOutcome,
} from "./askDetect.js";

test("gatilho: só pergunta em prosa chama o modelo — código e URL não", () => {
  assert.equal(hasProseQuestion("Posso seguir com a opção A?"), true);
  assert.equal(hasProseQuestion("Feito. Rodei `user?.name ?? ''` e passou."), false, "?. e ?? de código inline");
  assert.equal(hasProseQuestion("Feito.\n```ts\nconst x = a?.b ? 1 : 2;\n```\nTudo verde."), false, "código cercado");
  assert.equal(hasProseQuestion("Veja https://x.dev/busca?q=1&p=2 para detalhes."), false, "query string de URL");
  assert.equal(hasProseQuestion("```js\nx?.y\n```\nQuer que eu faça o commit?"), true, "a pergunta depois do código continua valendo");
});

test("stripFencedCode troca blocos (fechados ou não) por um marcador e preserva a prosa", () => {
  const out = stripFencedCode("Antes\n```bash\nnpm test\n```\nDepois\n~~~\nsem fim");
  assert.equal(out, "Antes\n[código omitido]\nDepois\n[código omitido]");
});

test("recorte longo mantém o COMEÇO e o FIM — é no fim que a resposta pergunta", () => {
  const meio = "x".repeat(10_000);
  const texto = "INICIO " + meio + " Qual opção você prefere?";
  const r = excerptKeepingEnd(texto);
  assert.equal(r.truncated, true);
  assert.ok(r.text.startsWith("INICIO "));
  assert.ok(r.text.endsWith("Qual opção você prefere?"), "a pergunta final sobrevive ao corte");
  assert.ok(r.text.length <= ASK_REPLY_BUDGET + 60, "teto respeitado (folga só do marcador)");
  assert.equal(r.text.indexOf("[… trecho do meio omitido …]"), ASK_REPLY_HEAD + 2);
  assert.deepEqual(excerptKeepingEnd("curto"), { text: "curto", truncated: false });
});

test("buildAskPrompt: pula sem chamar o modelo quando não há o que perguntar", () => {
  assert.equal(buildAskPrompt("ok").skip, "short");
  assert.equal(buildAskPrompt("Pronto, tudo implementado e testado.").skip, "no_question");
  assert.equal(buildAskPrompt("Pronto.\n```\nif (a?.b) {}\n```").skip, "no_question");
});

test("buildAskPrompt: resposta longa leva a pergunta do fim; o pedido do usuário entra só como contexto", () => {
  const reply = "Análise:\n" + "detalhe longo. ".repeat(600) + "\n\nPosso implementar as fases A e B?";
  const r = buildAskPrompt(reply, "analise o seletor de pastas");
  assert.equal(r.skip, undefined);
  assert.equal(r.truncated, true);
  assert.ok(r.replyChars > ASK_REPLY_BUDGET);
  assert.ok(r.prompt!.includes("Posso implementar as fases A e B?"), "a pergunta do fim chega ao modelo");
  assert.ok(r.prompt!.includes("MENSAGEM DO USUÁRIO"));
  assert.ok(r.prompt!.includes("analise o seletor de pastas"));
  assert.ok(r.prompt!.includes("o meio foi omitido"));
  assert.ok(!/GERE opções plausíveis/i.test(r.prompt!), "o prompt não manda mais inventar opções");
  assert.match(r.prompt!, /ABERTA/);
});

test("buildAskPrompt: o pedido do usuário é cortado, não o prompt inteiro", () => {
  const r = buildAskPrompt("Quer seguir?", "p".repeat(5000));
  const user = r.prompt!.split("MENSAGEM DO USUÁRIO")[1].split("RESPOSTA")[0];
  assert.ok(user.length < 800, `pedido do usuário limitado (${user.length})`);
  assert.ok(!buildAskPrompt("Quer seguir?").prompt!.includes("MENSAGEM DO USUÁRIO"), "sem pedido, sem bloco");
});

test("parseAskQuestions: mesmos tetos de antes; pergunta sem opção cai (uma opção fica: a UI soma o 'Outros')", () => {
  const raw = "lixo antes " + JSON.stringify({ questions: [
    { header: "H".repeat(80), question: "Q?", multi: true, options: [{ label: "A (Recomendado)", desc: "d" }, { label: "B" }] },
    { header: "Só uma", question: "Q2?", options: [{ label: "única" }] },
    { header: "Sem", question: "Q3?", options: [] },
  ] }) + " lixo depois";
  const { questions, error } = parseAskQuestions(raw);
  assert.equal(error, undefined);
  assert.equal(questions.length, 2);
  assert.equal(questions[1].options.length, 1);
  assert.equal(questions[0].header.length, 40);
  assert.equal(questions[0].multi, true);
  assert.deepEqual(questions[0].options, [{ label: "A (Recomendado)", desc: "d" }, { label: "B", desc: "" }]);
  assert.equal(parseAskQuestions("sem json").error, "no_json");
  assert.equal(parseAskQuestions("{quebrado").error, "no_json");
  assert.equal(parseAskQuestions("{\"questions\": [}").error, "bad_json");
  assert.equal(parseAskQuestions("{\"x\":1}").error, "bad_shape");
  assert.deepEqual(parseAskQuestions("{\"questions\":[]}"), { questions: [] });
});

const QS = [
  { header: "Rumo", question: "Qual?", multi: false, options: [{ label: "A" }, { label: "B (Recomendado)" }, { label: "C" }] },
  { header: "Itens", question: "Quais?", multi: true, options: [{ label: "x" }, { label: "y" }] },
];

test("askShape: só números — quantas opções, qual era a recomendada", () => {
  assert.deepEqual(askShape(QS), [{ n: 3, rec: 1, multi: false }, { n: 2, rec: -1, multi: true }]);
  assert.deepEqual(askShape(null as any), []);
});

test("summarizeAskOutcome: respondido mede recomendada e 'Outros' sem guardar texto", () => {
  const out = summarizeAskOutcome(QS, { kind: "answered", picks: [[1], [0, 1, 1, 99, -1, "x"]], other: [false, true] });
  assert.equal(out.kind, "answered");
  assert.deepEqual(out.picks, [[1], [0, 1]], "índices saneados: sem repetidos, fora da faixa ou não inteiros");
  assert.equal(out.other, 1);
  assert.equal(out.withRecommended, 1);
  assert.equal(out.pickedRecommended, 1);
  assert.ok(!JSON.stringify(out).includes("Recomendado"), "nenhum rótulo vai para o log");
});

test("summarizeAskOutcome: payload ausente ou estranho vira 'cleared'; os demais tipos não trazem escolhas", () => {
  assert.equal(summarizeAskOutcome(QS, undefined).kind, "cleared");
  assert.equal(summarizeAskOutcome(QS, { kind: "hackeado" }).kind, "cleared");
  const typed = summarizeAskOutcome(QS, { kind: "typed", picks: [[0]] });
  assert.equal(typed.kind, "typed");
  assert.equal(typed.picks, undefined);
  assert.equal(summarizeAskOutcome(QS, { kind: "superseded" }).questions, 2);
  assert.deepEqual(summarizeAskOutcome(QS, { kind: "answered" }).picks, [[], []], "respondido sem picks não quebra");
});
