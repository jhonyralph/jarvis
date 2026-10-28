import test from "node:test";
import assert from "node:assert/strict";
import { VoiceContinuation } from "./voiceContinuation.js";

function setup(opts: { windowMs?: number; cancellable?: boolean } = {}) {
  let now = 0;
  const running = new Set<string>();
  const aborted: string[] = [];
  const c = new VoiceContinuation({
    windowMs: opts.windowMs ?? 10_000,
    busy: (s) => running.has(s),
    abort: (s) => { if (opts.cancellable === false) return false; aborted.push(s); running.delete(s); return true; },
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  return { c, running, aborted, tick: (ms: number) => { now += ms; } };
}

test("voltar a falar logo depois, com o turno rodando: interrompe e manda a fala inteira", async () => {
  const { c, running, aborted, tick } = setup();
  c.note("s1", "Quero que você revise o relatório de vendas");
  running.add("s1");
  tick(4_000); // gole d'água
  const r = await c.join("s1", "e depois mande para o financeiro.");
  assert.deepEqual(r, { text: "Quero que você revise o relatório de vendas e depois mande para o financeiro.", joined: true, reason: "joined", gapMs: 4_000, settleMs: 0 });
  assert.deepEqual(aborted, ["s1"]);
});

test("três pedaços seguidos viram uma fala só", async () => {
  const { c, running, tick } = setup();
  c.note("s1", "um");
  running.add("s1");
  tick(2_000);
  const r2 = await c.join("s1", "dois");
  c.note("s1", r2.text);
  running.add("s1");
  tick(3_000);
  const r3 = await c.join("s1", "três");
  assert.equal(r3.text, "um dois três");
});

test("depois da janela é mensagem nova (não interrompe)", async () => {
  const { c, running, aborted, tick } = setup({ windowMs: 10_000 });
  c.note("s1", "primeiro pedido");
  running.add("s1");
  tick(10_001);
  assert.deepEqual(await c.join("s1", "outro assunto"), { text: "outro assunto", joined: false, reason: "window_expired", gapMs: 10_001 });
  assert.deepEqual(aborted, []);
});

test("turno já terminou: a fala segue normal, sem juntar", async () => {
  const { c, aborted, tick } = setup();
  c.note("s1", "que horas são?");
  tick(3_000);
  assert.equal((await c.join("s1", "e o clima?")).reason, "turn_finished");
  assert.deepEqual(aborted, []);
});

test("outra sessão, turno não cancelável ou janela desligada: nada muda", async () => {
  const a = setup();
  a.c.note("s1", "x");
  a.running.add("s2");
  assert.equal((await a.c.join("s2", "y")).reason, "no_previous", "nenhuma fala anterior em s2");

  const b = setup({ cancellable: false });
  b.c.note("s1", "x");
  b.running.add("s1");
  assert.equal((await b.c.join("s1", "y")).reason, "not_cancellable");

  const off = setup({ windowMs: 0 });
  off.c.note("s1", "x");
  off.running.add("s1");
  assert.equal((await off.c.join("s1", "y")).reason, "disabled");
});

test("IA que aceita mensagem no meio do turno: a continuação é entregue, nada é interrompido", async () => {
  let now = 0;
  const running = new Set(["s1"]), aborted: string[] = [], injected: string[] = [];
  let accepts = true;
  const c = new VoiceContinuation({
    windowMs: 10_000, busy: (s) => running.has(s),
    abort: (s) => { aborted.push(s); running.delete(s); return true; },
    inject: (_s, text) => { if (accepts) injected.push(text); return accepts; },
    now: () => now, sleep: async (ms) => { now += ms; },
  });
  c.note("s1", "Revise o relatório");
  now += 3_000;
  assert.deepEqual(await c.join("s1", "e mande ao financeiro."), { text: "e mande ao financeiro.", joined: false, injected: true, reason: "injected", gapMs: 3_000 });
  assert.deepEqual(injected, ["e mande ao financeiro."]);
  assert.deepEqual(aborted, [], "o turno segue rodando");
  // O turno já não aceita (anunciou o fim): volta ao interromper e juntar, com o pedido INTEIRO.
  accepts = false;
  now += 3_000;
  const r = await c.join("s1", "Com cópia para mim.");
  assert.equal(r.reason, "joined");
  assert.equal(r.text, "Revise o relatório e mande ao financeiro. Com cópia para mim.");
  assert.equal(r.gapMs, 3_000, "a janela conta a partir da fala entregue");
});
