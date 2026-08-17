/** Ponte de contexto: o resultado que rodou FORA da sessão precisa chegar à IA uma vez, inteiro o
 *  bastante para ela responder sobre ele, e sempre declarando o que foi cortado. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionBriefingBlock, pruneStoredBriefings,
  SESSION_BRIEFING_MAX_CHARS, SESSION_BRIEFING_MAX_ITEMS,
  SESSION_BRIEFING_MAX_PER_SESSION, SESSION_BRIEFING_MAX_SESSIONS, SESSION_BRIEFING_TTL_MS,
} from "./session-briefing.js";

test("sem resultado pendente não há bloco (o turno normal não paga nada)", () => {
  assert.equal(buildSessionBriefingBlock([]), "");
  assert.equal(buildSessionBriefingBlock([{ kind: "🗣️ Debate", body: "   " }]), "");
});

test("o bloco diz o que rodou, entrega o conteúdo e enquadra como contexto", () => {
  const block = buildSessionBriefingBlock([{ kind: "🗣️ Debate", body: "**Veredito**: migrar para SQLite." }]);
  assert.match(block, /CONTEXTO QUE VOCÊ NÃO VIU/);
  assert.match(block, /### 🗣️ Debate/);
  assert.match(block, /migrar para SQLite/);
  // Sem este enquadramento a IA responde ao veredito como se fosse um pedido novo do usuário.
  assert.match(block, /não refaça o trabalho/i);
  assert.match(block, /O pedido do usuário vem abaixo/);
});

test("vários resultados: mantém os mais recentes e DECLARA os omitidos", () => {
  const itens = Array.from({ length: SESSION_BRIEFING_MAX_ITEMS + 2 }, (_v, i) => ({ kind: `R${i + 1}`, body: `corpo ${i + 1}` }));
  const block = buildSessionBriefingBlock(itens);
  assert.match(block, /2 resultado\(s\) mais antigo\(s\) omitido\(s\)/);
  assert.ok(!block.includes("corpo 1"), "o mais antigo saiu");
  assert.match(block, /corpo 5/, "o mais recente ficou");
  assert.equal((block.match(/^### /gm) || []).length, SESSION_BRIEFING_MAX_ITEMS);
});

// ---- Protocolo do que sobrevive ao restart do Hub ----
// Um debate que levou minutos não pode virar nada porque o Hub reiniciou entre o resultado e a sua
// próxima mensagem. O que segura o arquivo é teto, não sorte.
const NOW = 1_700_000_000_000;

test("prune: descarta expirado e lixo, e aceita o que está no prazo", () => {
  const raw = {
    viva: [{ kind: "🗣️ Debate", body: "veredito", at: NOW - 60_000 }],
    velha: [{ kind: "🗣️ Debate", body: "veredito antigo", at: NOW - SESSION_BRIEFING_TTL_MS - 1 }],
    lixo: [{ kind: "x", body: "   ", at: NOW }, { kind: "y", at: NOW }, null, "nada"],
    naoArray: { kind: "z", body: "b", at: NOW },
  };
  const out = pruneStoredBriefings(raw, NOW);
  assert.deepEqual(Object.keys(out), ["viva"], "só a sessão com item válido e no prazo sobrevive");
  assert.equal(out.viva[0].body, "veredito");
  assert.deepEqual(pruneStoredBriefings(null, NOW), {}, "arquivo ausente/corrompido não derruba nada");
  assert.deepEqual(pruneStoredBriefings([1, 2], NOW), {}, "formato errado vira vazio, não exceção");
});

test("prune: aplica os tetos por sessão e por número de sessões, mantendo o mais recente", () => {
  const muitos = Array.from({ length: SESSION_BRIEFING_MAX_PER_SESSION + 3 }, (_v, i) => ({ kind: "k", body: `b${i + 1}`, at: NOW - 1000 + i }));
  const porSessao = pruneStoredBriefings({ s: muitos }, NOW);
  assert.equal(porSessao.s.length, SESSION_BRIEFING_MAX_PER_SESSION);
  assert.equal(porSessao.s[porSessao.s.length - 1].body, `b${muitos.length}`, "o mais recente fica");

  const sessoes: Record<string, unknown> = {};
  for (let i = 0; i < SESSION_BRIEFING_MAX_SESSIONS + 5; i++) sessoes[`s${i}`] = [{ kind: "k", body: "b", at: NOW - (SESSION_BRIEFING_MAX_SESSIONS + 5 - i) * 1000 }];
  const out = pruneStoredBriefings(sessoes, NOW);
  assert.equal(Object.keys(out).length, SESSION_BRIEFING_MAX_SESSIONS);
  assert.ok(out[`s${SESSION_BRIEFING_MAX_SESSIONS + 4}`], "a sessão mais recente sobrevive ao teto");
  assert.ok(!out.s0, "a mais parada é a que cai");
});

test("prune é idempotente — ler e gravar aplicam exatamente a mesma regra", () => {
  const raw = { a: [{ kind: "k", body: "b", at: NOW }], b: [{ kind: "k", body: "c", at: NOW - 5 }] };
  const um = pruneStoredBriefings(raw, NOW);
  assert.deepEqual(pruneStoredBriefings(um, NOW), um);
});

test("corpo gigante entra cortado, e o corte é dito — não silencioso", () => {
  const block = buildSessionBriefingBlock([{ kind: "🧠 Conselho", body: "x".repeat(SESSION_BRIEFING_MAX_CHARS + 500) }]);
  assert.match(block, /cortado em 4000 caracteres/);
  assert.match(block, /texto completo está na conversa/);
  assert.ok(!block.includes("x".repeat(SESSION_BRIEFING_MAX_CHARS + 1)), "não passa do teto");
});
