import test from "node:test";
import assert from "node:assert/strict";
import { runDebate, type DebateHost, type DebateRoundOutcome } from "./debate-run.js";
import type { DebateDebater, DebateVerdict } from "./debate.js";

const debaters: DebateDebater[] = [
  { id: "p1", agent: "claude-code", label: "Claude" },
  { id: "p2", agent: "codex", label: "Codex" },
];

interface Recorded {
  posts: string[];
  progress: Array<{ round: number; phase: string; interjected: number; states: string[] }>;
  prompts: string[];
  judgeCalls: string[];
  verdicts: Array<{ round: number; verdict: DebateVerdict }>;
}

/** Host de teste: substitui store/broadcast/CLIs por listas. É o que permite exercitar o LAÇO —
 *  que antes desta extração não tinha teste nenhum, só os construtores de prompt. */
function fakeHost(opts: {
  judge?: (prompt: string, call: number) => string;
  round?: (round: number) => DebateRoundOutcome;
  interjections?: string[][];
  abortAfterRound?: number;
} = {}): { host: DebateHost; rec: Recorded; closed: () => boolean } {
  const rec: Recorded = { posts: [], progress: [], prompts: [], judgeCalls: [], verdicts: [] };
  const queued = [...(opts.interjections || [])];
  // `all` acumula quando o recado CHEGA (é assim no Hub: acceptDebateInterjection empilha em all e
  // em pending). Só `pending` é drenado por rodada — por isso um recado tardio some das rodadas mas
  // continua visível para a síntese.
  const all: string[] = (opts.interjections || []).flat();
  let closed = false, aborted = false, judgeCall = 0, roundsRun = 0;
  const host: DebateHost = {
    postAssistant: (text) => { rec.posts.push(text); },
    emitProgress: (p) => { rec.progress.push({ round: p.round, phase: p.phase, interjected: p.interjected, states: p.debaters.map((d) => d.state) }); },
    drainInterjections: () => queued.shift() || [],
    allInterjections: () => [...all],
    closeInterjections: () => { closed = true; },
    runRound: async ({ round, promptFor }) => {
      roundsRun++;
      for (const d of debaters) rec.prompts.push(promptFor(d));
      const outcome = opts.round ? opts.round(round) : {
        responses: debaters.map((d) => ({ id: d.id, label: d.label, text: `${d.label} na rodada ${round}` })),
        failed: false,
        states: debaters.map(() => "done"),
      };
      if (opts.abortAfterRound === roundsRun) aborted = true;
      return outcome;
    },
    oneShotJudge: async (prompt) => { rec.judgeCalls.push(prompt); return opts.judge ? opts.judge(prompt, ++judgeCall) : '{"converged":false,"confidence":0.2,"reason":"segue divergindo"}'; },
    publishRoundVerdict: (round, verdict) => { rec.verdicts.push({ round, verdict }); },
    get aborted() { return aborted; },
  };
  return { host, rec, closed: () => closed };
}

test("o debate para cedo quando o juiz declara consenso, sem gastar as rodadas restantes", async () => {
  const { host, rec } = fakeHost({ judge: (_p, call) => call === 1 ? '{"converged":true,"confidence":0.9,"reason":"mesma conclusão"}' : "{}" });
  const out = await runDebate(host, { topic: "vale migrar?", debaters, maxRounds: 5 });
  assert.equal(out.rounds, 1, "parou na primeira rodada");
  assert.equal(out.converged, true);
  assert.equal(out.failed, false);
  // 1 juiz + 1 síntese: as rodadas 2..5 nunca foram pagas.
  assert.equal(rec.judgeCalls.length, 2);
});

test("sem consenso, roda até o teto e o texto final reflete isso", async () => {
  const { host, rec } = fakeHost();
  const out = await runDebate(host, { topic: "tema", debaters, maxRounds: 3 });
  assert.equal(out.rounds, 3);
  assert.equal(out.converged, false);
  assert.equal(rec.judgeCalls.length, 4, "3 vereditos + 1 síntese");
  assert.equal(rec.verdicts.length, 3, "cada rodada publica o parecer na sua fase");
});

test("recado entra na rodada seguinte, uma vez só, e a síntese ainda vê os recados atrasados", async () => {
  // Rodada 1 sem recado; rodada 2 com dois; o terceiro chega depois da última rodada.
  const { host, rec } = fakeHost({ interjections: [[], ["olha o custo", "e o prazo"], ["chegou tarde"]] });
  await runDebate(host, { topic: "tema", debaters, maxRounds: 2 });
  const debating = rec.progress.filter((p) => p.phase === "debating");
  assert.equal(debating[0].interjected, 0, "rodada 1 sem recado");
  assert.equal(debating.find((p) => p.round === 2)?.interjected, 2, "os dois recados entram na rodada 2");
  // Drenado: o prompt da rodada 2 cita os recados, o da rodada 1 não.
  assert.ok(rec.prompts.slice(2).some((p) => p.includes("olha o custo")), "rodada 2 carrega o recado");
  assert.ok(!rec.prompts.slice(0, 2).some((p) => p.includes("olha o custo")), "rodada 1 não poderia conhecê-lo");
  // O recado que chegou tarde demais para virar rodada ainda é respondido no veredito final.
  assert.ok(rec.judgeCalls.at(-1)?.includes("chegou tarde"), "a síntese recebe TODOS os recados");
});

test("cancelamento no meio da rodada registra o que saiu e NÃO paga o juiz", async () => {
  const { host, rec } = fakeHost({ abortAfterRound: 1 });
  const out = await runDebate(host, { topic: "tema", debaters, maxRounds: 5 });
  assert.equal(out.rounds, 1);
  assert.equal(out.failed, true, "cancelado conta como falha no texto final");
  assert.equal(rec.judgeCalls.length, 0, "nem veredito nem síntese — seria chamada paga sobre resposta cancelada");
  assert.equal(rec.posts.length, 2, "a rodada parcial é publicada, e depois o texto final");
});

test("juiz indisponível não derruba o debate: segue como 'não convergiu'", async () => {
  const { host } = fakeHost({ judge: () => { throw new Error("CLI fora do ar"); } });
  const out = await runDebate(host, { topic: "tema", debaters, maxRounds: 2 });
  assert.equal(out.rounds, 2, "seguiu até o teto");
  assert.equal(out.converged, false);
});

test("falha de um debatente marca a corrida como falha, sem interromper as rodadas", async () => {
  const { host } = fakeHost({
    round: (round) => ({
      responses: [{ id: "p1", label: "Claude", text: "posição" }, { id: "p2", label: "Codex", text: "(falha: sem resposta)" }],
      failed: round === 1,
      states: ["done", "failed"],
    }),
  });
  const out = await runDebate(host, { topic: "tema", debaters, maxRounds: 2 });
  assert.equal(out.failed, true);
  assert.equal(out.rounds, 2, "a falha de uma IA não aborta o debate");
});

test("a janela de recado fecha ANTES da síntese, para não haver ack que promete rodada inexistente", async () => {
  const events: string[] = [];
  const { host, rec } = fakeHost();
  const wrapped: DebateHost = {
    ...host,
    closeInterjections: () => { events.push("closed"); host.closeInterjections(); },
    oneShotJudge: async (p) => { events.push(p.includes("síntese") || rec.judgeCalls.length >= 1 ? "judge" : "judge"); return host.oneShotJudge(p); },
    get aborted() { return host.aborted; },
  };
  await runDebate(wrapped, { topic: "tema", debaters, maxRounds: 1 });
  const closedAt = events.indexOf("closed");
  assert.ok(closedAt >= 0, "a janela foi fechada");
  assert.equal(events.lastIndexOf("judge") > closedAt, true, "a síntese roda depois do fechamento");
  const phases = rec.progress.map((p) => p.phase);
  assert.deepEqual([...new Set(phases)], ["debating", "judging", "synthesizing"], "a ordem das fases é a do contrato do card");
});
