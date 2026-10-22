import test from "node:test";
import assert from "node:assert/strict";
import { VoiceTurnTracker, summarizeVoiceTurns, clampClientMs, type VoiceTurnEvent } from "./voice-turn.js";

/** Relógio e temporizadores controlados: o teste avança o tempo e dispara os prazos à mão. */
function harness(opts: { clientWaitMs?: number; turnTtlMs?: number } = {}) {
  let t = 1_000;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let next = 1;
  const emitted: VoiceTurnEvent[] = [];
  const tracker = new VoiceTurnTracker({
    emit: (e) => emitted.push(e),
    now: () => t,
    clientWaitMs: opts.clientWaitMs ?? 1_000,
    turnTtlMs: opts.turnTtlMs ?? 10_000,
    setTimer: (fn, ms) => { const h = next++; timers.set(h, { fn, at: t + ms }); return h; },
    clearTimer: (h) => { timers.delete(h as number); },
  });
  const advance = (ms: number) => {
    t += ms;
    for (const [h, timer] of [...timers]) if (timer.at <= t) { timers.delete(h); timer.fn(); }
  };
  return { tracker, emitted, advance, timers };
}

const ws = { socket: 1 };

test("turno completo: etapas do Hub e do aparelho viram UM evento quando o som começa", () => {
  const { tracker, emitted, advance } = harness();
  const id = tracker.start("L\0s1", { id: "vt_abc123", owner: ws, runnerId: "L", bytes: 48_000 });
  assert.equal(id, "vt_abc123", "o id do aparelho é mantido para casar as duas metades");
  tracker.input("L\0s1", { sttMs: 900, speakerMs: 100, preflightMs: 1_200, relevant: true });
  advance(2_500); tracker.dispatched("L\0s1", "local");
  advance(4_000); tracker.agentDone("L\0s1");
  tracker.speech("L\0s1", { prepMs: 10, synthMs: 300, spokenChars: 120, summarized: false });
  advance(320);
  assert.equal(tracker.audioSent("L\0s1"), "vt_abc123", "o quadro de áudio leva o id de volta ao aparelho");
  assert.equal(emitted.length, 0, "ainda falta o relato do aparelho");
  assert.equal(tracker.client("vt_abc123", ws, { recMs: 5_000, endpointMs: 1_800, encodeMs: 20, stopToFirstAudioMs: 7_100 }), true);
  assert.equal(emitted.length, 1);
  const e = emitted[0];
  assert.equal(e.outcome, "spoken");
  assert.equal(e.path, "local");
  assert.equal(e.dispatchMs, 2_500);
  assert.equal(e.agentMs, 4_000);
  assert.equal(e.firstAudioMs, 6_820);
  assert.equal(e.perceivedMs, 8_900, "percebido = pausa esperada + do fim da gravação ao primeiro som");
  assert.equal(tracker.open, 0);
});

test("sem relato do aparelho, o evento sai mesmo assim depois do prazo", () => {
  const { tracker, emitted, advance } = harness({ clientWaitMs: 1_000 });
  tracker.start("L\0s1", { owner: ws, runnerId: "L", bytes: 10 });
  tracker.audioSent("L\0s1");
  advance(999); assert.equal(emitted.length, 0);
  advance(1); assert.equal(emitted.length, 1);
  assert.equal(emitted[0].outcome, "spoken");
  assert.equal(emitted[0].stopToFirstAudioMs, undefined);
});

test("turno sem resposta falada vence pelo teto e sai como no_audio", () => {
  const { tracker, emitted, advance } = harness({ turnTtlMs: 5_000 });
  tracker.start("L\0s1", { owner: ws, runnerId: "L", bytes: 10 });
  advance(5_000);
  assert.deepEqual(emitted.map((e) => e.outcome), ["no_audio"]);
});

test("fala ignorada encerra na hora, com as etapas de entrada", () => {
  const { tracker, emitted } = harness();
  tracker.start("L\0s1", { owner: ws, runnerId: "L", bytes: 10 });
  tracker.input("L\0s1", { sttMs: 500, relevant: false });
  tracker.end("L\0s1", "ignored");
  assert.equal(emitted[0].outcome, "ignored");
  assert.equal(emitted[0].relevant, false);
  assert.equal(tracker.open, 0);
});

test("novo turno na mesma sessão encerra o anterior como superseded", () => {
  const { tracker, emitted } = harness();
  tracker.start("L\0s1", { id: "primeiro1", owner: ws, runnerId: "L", bytes: 10 });
  tracker.start("L\0s1", { id: "segundo22", owner: ws, runnerId: "L", bytes: 10 });
  assert.deepEqual(emitted.map((e) => [e.id, e.outcome]), [["primeiro1", "superseded"]]);
  assert.equal(tracker.open, 1);
});

test("relato de outro dono ou de id desconhecido é recusado", () => {
  const { tracker, emitted } = harness();
  tracker.start("L\0s1", { id: "vt_abc123", owner: ws, runnerId: "L", bytes: 10 });
  tracker.audioSent("L\0s1");
  assert.equal(tracker.client("vt_abc123", { socket: 2 }, { stopToFirstAudioMs: 1 }), false, "outro aparelho não completa o turno alheio");
  assert.equal(tracker.client("nao-existe", ws, { stopToFirstAudioMs: 1 }), false);
  assert.equal(tracker.client(42, ws, {}), false);
  assert.equal(emitted.length, 0);
});

test("id malformado do aparelho é trocado por um gerado no Hub", () => {
  const { tracker } = harness();
  const id = tracker.start("L\0s1", { id: "../../x y", owner: ws, runnerId: "L", bytes: 10 });
  assert.notEqual(id, "../../x y");
  assert.match(id, /^[A-Za-z0-9_-]+$/);
});

test("alias: a resposta chega sob o id da sessão na máquina e ainda casa com o turno", () => {
  const { tracker, emitted } = harness();
  tracker.start("R\0claude:x", { id: "vt_abc123", owner: ws, runnerId: "R", bytes: 10 });
  tracker.alias("R\0claude:x", "R\0managed-1");
  tracker.dispatched("R\0managed-1", "remote");
  tracker.agentDone("R\0managed-1");
  assert.equal(tracker.audioSent("R\0managed-1"), "vt_abc123");
  tracker.client("vt_abc123", ws, { stopToFirstAudioMs: 100 });
  assert.equal(emitted[0].path, "remote");
  assert.equal(tracker.open, 0);
  assert.equal(tracker.audioSent("R\0claude:x"), undefined, "as duas chaves são liberadas juntas");
});

test("chaves sem turno aberto são ignoradas — a maioria dos turnos é de texto", () => {
  const { tracker, emitted } = harness();
  assert.equal(tracker.audioSent("L\0texto"), undefined);
  tracker.dispatched("L\0texto", "local"); tracker.agentDone("L\0texto"); tracker.end("L\0texto", "error");
  assert.equal(emitted.length, 0);
});

test("só o primeiro áudio e a primeira síntese contam", () => {
  const { tracker, emitted, advance } = harness();
  tracker.start("L\0s1", { owner: ws, runnerId: "L", bytes: 10 });
  advance(100); tracker.speech("L\0s1", { synthMs: 50, spokenChars: 10 }); tracker.audioSent("L\0s1");
  advance(100); tracker.speech("L\0s1", { synthMs: 999, spokenChars: 999 }); tracker.audioSent("L\0s1");
  tracker.end("L\0s1", "error");
  advance(10_000);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].synthMs, 50);
  assert.equal(emitted[0].firstAudioMs, 100);
  assert.equal(emitted[0].outcome, "spoken", "erro depois de falar não apaga que houve resposta");
});

test("medidas do aparelho fora do plausível são descartadas", () => {
  assert.equal(clampClientMs(-1), undefined);
  assert.equal(clampClientMs(Number.NaN), undefined);
  assert.equal(clampClientMs("100"), undefined);
  assert.equal(clampClientMs(31 * 60_000), undefined);
  assert.equal(clampClientMs(12.6), 13);
});

test("emissor que lança não derruba a conversa", () => {
  const tracker = new VoiceTurnTracker({ emit: () => { throw new Error("disco cheio"); } });
  tracker.start("L\0s1", { owner: ws, runnerId: "L", bytes: 1 });
  assert.doesNotThrow(() => tracker.end("L\0s1", "error"));
  assert.equal(tracker.open, 0);
});

test("resumo: percentis por etapa e contagem por desfecho", () => {
  const events = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ outcome: "spoken" as const, sttMs: n * 100 }));
  const s = summarizeVoiceTurns([...events, { outcome: "ignored" as const }]);
  assert.equal(s.turns, 11);
  assert.deepEqual(s.outcomes, { spoken: 10, ignored: 1 });
  assert.deepEqual(s.stages.sttMs, { n: 10, min: 100, p50: 500, p90: 900, max: 1_000 });
  assert.equal(s.stages.agentMs, undefined, "etapa sem dado não aparece");
});
