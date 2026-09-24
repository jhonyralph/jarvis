import test from "node:test";
import assert from "node:assert/strict";
import { findHistoryGaps, isInjectedPrompt, mergeByTimestamp, normalizePrompt, MAX_GAPS_PER_SESSION } from "./history-gaps.js";

test("prompt injetado pelo Jarvis/CLI nunca conta como turno humano", () => {
  // Todos estes saíram da auditoria de 2026-09-23 contra transcripts reais — eram a MAIORIA dos
  // "turnos perdidos" (125 brutos -> ~20 reais). Restaurar um destes seria pior que o buraco.
  for (const t of [
    "Base directory for this skill: C:\\Users\\Jonathan\\.claude\\skills\\evidence-driven-delivery # Evidence…",
    "Continue from where you left off.",
    "This session is being continued from a previous conversation that ran out of context.",
    "Fluxo de trabalho ativo: \"Pipeline de engenharia (F1–F14)\" — tarefa (sem tarefa).",
    "<recommended_plugins>\nHere is a list of plugins…",
    "<system-reminder>algo</system-reminder>",
    "# path: .agent/commands/schema.md ---",
    "Imagens anexadas — use a ferramenta de leitura para vê-las",
    "ok",                       // curto demais para distinguir de ruído de protocolo
  ]) assert.equal(isInjectedPrompt(t), true, t.slice(0, 40));

  for (const t of [
    "Preciso que você faça o seguinte: 1. Você deve elencar os melhores sites…",
    "As variáveis tem que ser a mesma para os 4 ambientes?",
    "Vamos resolver os pntos de bloqueios. E decisões que precisam ser tomadas",
  ]) assert.equal(isInjectedPrompt(t), false, t.slice(0, 40));
});

test("acha o turno que sumiu do meio do histórico, com a resposta junto", () => {
  // A forma exata do incidente: o 1o turno inteiro sumiu (cancelamento + dropLast) e o store começa
  // no 2o. O transcript tem os dois.
  const nativo = [
    { role: "user", text: "Preciso que você faça o seguinte: elencar os melhores sites de UX", ts: 100 },
    { role: "assistant", text: "Concluí a análise com três agentes e organizei o dossiê", ts: 200, activity: [{ kind: "tool_completed" }] },
    { role: "user", text: "Como estamos?", ts: 300 },
    { role: "assistant", text: "A análise e os planos estão concluídos", ts: 400 },
  ];
  const store = [
    { role: "user", text: "Como estamos?", ts: 300 },
    { role: "assistant", text: "A análise e os planos estão concluídos", ts: 400 },
  ];
  const gaps = findHistoryGaps(store, nativo);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].user.text, /elencar os melhores sites/);
  assert.equal(gaps[0].user.ts, 100);
  assert.match(gaps[0].assistant.text, /três agentes/);
  assert.deepEqual(gaps[0].assistant.activity, [{ kind: "tool_completed" }]);
});

test("comando EXPANDIDO no transcript não vira turno perdido", () => {
  // O store guarda o que a pessoa digitou; o nativo guarda a skill já resolvida. São o mesmo turno.
  const nativo = [{ role: "user", text: "Vamos trabalhar nas demandas 902, 775 usando o Use a competência \"evidence-driven-delivery\" do Framework Jarvis. Instruções: …", ts: 10 },
                  { role: "assistant", text: "ok", ts: 20 }];
  const store = [{ role: "user", text: "Vamos trabalhar nas demandas 902, 775 usando o /evidence", ts: 10 }];
  assert.deepEqual(findHistoryGaps(store, nativo), []);
});

test("pergunta sem resposta NÃO é restaurada — meio turno vira corrupção, não recuperação", () => {
  const nativo = [
    { role: "user", text: "Esta pergunta ficou sem nenhuma resposta no transcript", ts: 10 },
    { role: "user", text: "Outra pergunta, esta sim respondida de verdade", ts: 30 },
    { role: "assistant", text: "resposta", ts: 40 },
  ];
  const gaps = findHistoryGaps([], nativo);
  assert.equal(gaps.length, 1, "só o par completo volta");
  assert.match(gaps[0].user.text, /Outra pergunta/);
});

test("a resposta que volta é a do PRÓPRIO turno, não a do turno seguinte", () => {
  const nativo = [
    { role: "user", text: "primeira pergunta perdida do historico", ts: 10 },
    { role: "assistant", text: "RESPOSTA A", ts: 20 },
    { role: "user", text: "segunda pergunta perdida do historico", ts: 30 },
    { role: "assistant", text: "RESPOSTA B", ts: 40 },
  ];
  const gaps = findHistoryGaps([], nativo);
  assert.deepEqual(gaps.map((g) => g.assistant.text), ["RESPOSTA A", "RESPOSTA B"]);
});

test("restaurar é idempotente: o que voltou casa consigo mesmo na passada seguinte", () => {
  const nativo = [
    { role: "user", text: "pergunta que vai ser restaurada agora", ts: 10 },
    { role: "assistant", text: "resposta", ts: 20 },
  ];
  const primeira = findHistoryGaps([], nativo);
  assert.equal(primeira.length, 1);
  const storeDepois = [primeira[0].user, primeira[0].assistant];
  assert.deepEqual(findHistoryGaps(storeDepois, nativo), [], "rodar de novo não duplica o turno");
});

test("timestamp incoerente é descartado em vez de embaralhar a conversa", () => {
  const semTempo = [{ role: "user", text: "pergunta sem timestamp nenhum aqui" }, { role: "assistant", text: "resposta" }];
  assert.deepEqual(findHistoryGaps([], semTempo), []);
  const invertido = [{ role: "user", text: "pergunta com resposta ANTERIOR a ela", ts: 90 }, { role: "assistant", text: "resposta", ts: 10 }];
  assert.deepEqual(findHistoryGaps([], invertido), []);
});

test("teto por sessão: casamento ruim restaura pouco, nunca o transcript inteiro", () => {
  const nativo: any[] = [];
  for (let i = 0; i < MAX_GAPS_PER_SESSION + 15; i++) {
    nativo.push({ role: "user", text: `pergunta numero ${i} com tamanho suficiente`, ts: i * 10 + 1 });
    nativo.push({ role: "assistant", text: `resposta ${i}`, ts: i * 10 + 2 });
  }
  assert.equal(findHistoryGaps([], nativo).length, MAX_GAPS_PER_SESSION);
});

test("mergeByTimestamp intercala sem reordenar o que já existia", () => {
  const existente = [{ ts: 300, role: "user" }, { ts: 400, role: "assistant" }];
  const novo = [{ ts: 100, role: "user" }, { ts: 200, role: "assistant" }];
  assert.deepEqual(mergeByTimestamp(existente, novo).map((m) => m.ts), [100, 200, 300, 400]);
  assert.deepEqual(mergeByTimestamp(existente, []).map((m) => m.ts), [300, 400]);
  // Empate: o que já estava no store vem antes do restaurado.
  assert.deepEqual(mergeByTimestamp([{ ts: 5, role: "user" }], [{ ts: 5, role: "assistant" }]).map((m) => m.role), ["user", "assistant"]);
});

test("normalizePrompt colapsa espaço para o casamento não depender de formatação", () => {
  assert.equal(normalizePrompt("  a\n\n b \t c  "), "a b c");
  assert.equal(normalizePrompt(undefined), "");
});

test("skill EXPANDIDA no meio da frase nao vira turno perdido", () => {
  // O caso que quase estragou tudo: a pessoa digita o comando curto, o transcript guarda a skill
  // resolvida, e a expansao acontece no MEIO — o comeco e identico nos dois lados. No dry-run contra
  // os transcripts reais isto sozinho respondia pela maioria dos falsos positivos.
  const nativo = [
    { role: "user", text: 'Preciso que faca o seguinte. Na skill Use a competência "evidence-driven-delivery" do Framework Jarvis. Instruções: …', ts: 10 },
    { role: "assistant", text: "ok", ts: 20 },
  ];
  const store = [{ role: "user", text: "Preciso que faca o seguinte. Na skill /jarvis:evidence, ajuste X", ts: 10 }];
  assert.deepEqual(findHistoryGaps(store, nativo), []);
  // E mesmo com o store VAZIO o marcador de expansao segura: nao e pedido de ninguem.
  assert.deepEqual(findHistoryGaps([], nativo), []);
});

test("preambulo de persona/skill do provedor nunca e restaurado", () => {
  // Todos vistos no dry-run real; cada um gerava uma proposta de restauracao errada.
  for (const t of [
    "Approach this as the design lead at a small studio known for their versatility",
    "Load and follow the `ts-engineering-pipeline` skill, **Phase 1 — Spec**, for: …",
    "`high effort → 3+5 angles × 6 candidates → 1-vote verify (recall-biased)` You are a code reviewer",
    "Modo: STATUS (processo de análise, não é Persona) ## Instruções para Execução ### 1) Identificar",
    "100% das features de # path: .agent/commands/schema.md --- description: Ativa persona Database",
  ]) assert.equal(isInjectedPrompt(t), true, t.slice(0, 44));

  // …e o humano curto continua passando: foi uma perda real ("Não vi pr não.", 2026-09-16).
  assert.equal(isInjectedPrompt("Não vi pr não."), false);
  assert.equal(isInjectedPrompt("Resolva o conflito por favor da 940"), false);
});
