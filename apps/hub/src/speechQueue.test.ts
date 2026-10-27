import test from "node:test";
import assert from "node:assert/strict";
import { SpeechQueue, type SpeechCommand, type SpeechItem, type SpeechKind } from "./speechQueue.js";

const MIN = 60_000;
let n = 0;
const item = (session: string, kind: SpeechKind = "reply", extra: Partial<SpeechItem> = {}): SpeechItem => ({ id: `${session}#${++n}`, session, kind, ...extra });
const plays = (cmds: SpeechCommand[]): string[] => cmds.filter((c) => c.type === "play").map((c) => (c as { item: SpeechItem }).item.id);
const has = (cmds: SpeechCommand[], type: SpeechCommand["type"]): boolean => cmds.some((c) => c.type === type);
const opts = { replyGraceMs: 10_000, moreStaleMs: 20_000, windowMaxMs: 60_000 };

/** Toca até a janela abrir, devolvendo a ordem do que tocou. */
function drain(q: SpeechQueue, first: SpeechCommand[], now: number): { order: string[]; last: SpeechCommand[] } {
  const order: string[] = [];
  let cmds = first;
  for (let guard = 0; guard < 50; guard++) {
    const p = plays(cmds);
    if (!p.length) return { order, last: cmds };
    order.push(...p);
    cmds = q.played(p[0], now);
  }
  throw new Error("não terminou de tocar");
}

test("uma fala por vez: a segunda sessão espera a primeira tocar e a janela dela fechar (RN-O1, RN-O3)", () => {
  const q = new SpeechQueue(opts);
  const a = item("s1"), b = item("s2");
  assert.deepEqual(plays(q.enqueue(a, 0)), [a.id]);
  assert.deepEqual(plays(q.enqueue(b, 1)), [], "s2 não fala por cima de s1");
  const done = q.played(a.id, 2);
  assert.deepEqual(done, [{ type: "window", session: "s1" }], "terminou s1 → janela de resposta de s1, não s2");
  assert.equal(q.focus(), "s1", "o que o dono falar agora vai para s1");
  assert.deepEqual(plays(q.windowClosed("s1", 3)), [b.id], "janela fechou sem fala → vez de s2");
});

test("fila 1 → 2 → 1 toca 1+1 e depois 2 (RN-O2)", () => {
  const q = new SpeechQueue(opts);
  const a1 = item("s1"), b = item("s2"), a2 = item("s1");
  const first = q.enqueue(a1, 0);
  q.enqueue(b, 1);
  q.enqueue(a2, 2);
  const { order, last } = drain(q, first, 3);
  assert.deepEqual(order, [a1.id, a2.id]);
  assert.deepEqual(last, [{ type: "window", session: "s1" }]);
  assert.deepEqual(plays(q.windowClosed("s1", 4)), [b.id]);
});

test("fala nova da sessão que está falando entra logo depois; de outra sessão espera a janela (I-1)", () => {
  const q = new SpeechQueue(opts);
  const a1 = item("s1"), b = item("s2"), a2 = item("s1");
  q.enqueue(a1, 0);
  q.enqueue(b, 1); // s2 chegou primeiro…
  q.enqueue(a2, 2); // …mas a nova de s1 chegou com s1 falando
  assert.deepEqual(plays(q.played(a1.id, 3)), [a2.id], "empilha na fala atual, sem ir para o fim");
});

test("resposta que chega com a janela aberta toca já, na mesma vez", () => {
  const q = new SpeechQueue(opts);
  const a1 = item("s1"), b = item("s2"), a2 = item("s1");
  q.enqueue(a1, 0);
  q.played(a1.id, 1); // janela de s1 aberta
  q.enqueue(b, 2);
  assert.deepEqual(plays(q.enqueue(a2, 3)), [a2.id]);
});

test("o dono respondeu na janela: a resposta da sessão toca antes de outra (aguarda um tempo curto)", () => {
  const q = new SpeechQueue(opts);
  const a1 = item("s1"), b = item("s2"), a2 = item("s1");
  q.enqueue(a1, 0);
  q.played(a1.id, 1);
  q.userSpoke("s1", 2);
  assert.deepEqual(plays(q.enqueue(b, 3)), [], "s2 espera a resposta de s1");
  assert.deepEqual(plays(q.enqueue(a2, 4)), [a2.id]);
});

test("resposta que demora mais que o prazo libera a fila para a próxima sessão", () => {
  const q = new SpeechQueue(opts);
  const a1 = item("s1"), b = item("s2");
  q.enqueue(a1, 0);
  q.played(a1.id, 1);
  q.userSpoke("s1", 2);
  q.enqueue(b, 3);
  assert.equal(q.nextDeadline(), 2 + opts.replyGraceMs);
  assert.deepEqual(plays(q.tick(2 + opts.replyGraceMs)), [b.id]);
});

test("trechos com `more`: a vez continua da sessão até o próximo trecho, sem abrir janela no meio", () => {
  const q = new SpeechQueue(opts);
  const c1 = item("s1", "reply", { rid: "r", more: true }), b = item("s2"), c2 = item("s1", "reply", { rid: "r" });
  q.enqueue(c1, 0);
  q.enqueue(b, 1);
  assert.deepEqual(q.played(c1.id, 2), [], "nem janela nem s2 enquanto o trecho seguinte sintetiza");
  assert.deepEqual(plays(q.enqueue(c2, 3)), [c2.id]);
  assert.deepEqual(q.played(c2.id, 4), [{ type: "window", session: "s1" }]);
});

test("trecho seguinte que nunca chega não prende a fila", () => {
  const q = new SpeechQueue(opts);
  const c1 = item("s1", "reply", { rid: "r", more: true }), b = item("s2");
  q.enqueue(c1, 0);
  q.enqueue(b, 1);
  q.played(c1.id, 2);
  assert.deepEqual(plays(q.tick(2 + opts.moreStaleMs)), [b.id]);
});

test("entre sessões: pergunta que bloqueia > término > importante > progresso; empate pela chegada (RN-O5)", () => {
  const q = new SpeechQueue(opts);
  const busy = item("s0");
  q.enqueue(busy, 0);
  const p = item("p", "progress"), i = item("i", "important"), d = item("d", "done"), d2 = item("d2", "done"), a = item("a", "ask");
  for (const x of [p, i, d, d2, a]) q.enqueue(x, 1);
  q.played(busy.id, 2);
  const order: string[] = [];
  let cmds = q.windowClosed("s0", 3);
  for (let k = 0; k < 5; k++) {
    const [id] = plays(cmds);
    order.push(id);
    q.played(id, 4);
    cmds = q.windowClosed(id.split("#")[0], 5);
  }
  assert.deepEqual(order, [a.id, d.id, d2.id, i.id, p.id]);
});

test("progresso velho nunca toca depois do término; nem depois de vencer (RN-O6)", () => {
  const q = new SpeechQueue(opts);
  const busy = item("s0");
  q.enqueue(busy, 0);
  const p1 = item("s1", "progress"), p2 = item("s1", "progress", { expiresAt: 100 }), fim = item("s1", "done");
  const r1 = q.enqueue(p1, 1);
  assert.deepEqual(r1, []);
  assert.ok(has(q.enqueue(p2, 2), "dropped"), "progresso novo substitui o antigo");
  assert.deepEqual(q.enqueue(fim, 3), [{ type: "dropped", ids: [p2.id], reason: "superseded" }]);
  const late = item("s2", "progress", { expiresAt: 50 });
  q.enqueue(late, 4);
  assert.deepEqual(q.tick(60), [{ type: "dropped", ids: [late.id], reason: "expired" }]);
});

test("\"Hey Jarvis\" no meio da fala para a voz, descarta o resto daquela resposta e foca a sessão (RN-O7, I-3)", () => {
  const q = new SpeechQueue(opts);
  const c1 = item("s1", "reply", { rid: "r", more: true }), c2 = item("s1", "reply", { rid: "r" }), outra = item("s1", "done", { rid: "z" });
  q.enqueue(c1, 0);
  q.enqueue(c2, 1);
  q.enqueue(outra, 2);
  const { session, commands } = q.bargeIn(3);
  assert.equal(session, "s1");
  assert.deepEqual(commands, [{ type: "stop", session: "s1" }, { type: "dropped", ids: [c2.id], reason: "barge_in" }]);
  assert.equal(q.state().mode, "engaged");
  assert.deepEqual(plays(q.tick(3 + opts.replyGraceMs)), [outra.id], "outra resposta da sessão não é perdida");
});

test("\"Hey Jarvis\" sem ninguém falando vai para a voice (sem foco)", () => {
  const q = new SpeechQueue(opts);
  assert.deepEqual(q.bargeIn(0), { session: null, commands: [] });
});

test("\"próxima\" encerra a vez da sessão e passa para a seguinte (DEC-09)", () => {
  const q = new SpeechQueue(opts);
  const a = item("s1"), b = item("s2");
  q.enqueue(a, 0);
  q.enqueue(b, 1);
  q.played(a.id, 2); // janela de s1
  assert.deepEqual(plays(q.next(3)), [b.id]);
});

test("espere: pergunta se pode trazer as outras; sim → a sessão vai para o fim e as outras tocam (RN-O10, RN-O11)", () => {
  const q = new SpeechQueue({ ...opts, waitSteps: [2, 5, 10] });
  const a = item("s1"), b = item("s2");
  q.enqueue(a, 0);
  q.played(a.id, 1);
  q.enqueue(b, 2);
  const ask = q.wait("s1", 3);
  assert.deepEqual(ask, [{ type: "ask_bring_others", session: "s1", minutes: 2 }]);
  assert.equal(q.state().mode, "held");
  // a pergunta é uma fala de s1 e toca na vez dela
  const pergunta = item("s1", "ask");
  assert.deepEqual(plays(q.enqueue(pergunta, 4)), [pergunta.id]);
  q.played(pergunta.id, 5);
  assert.deepEqual(plays(q.bringOthers("s1", true, 6)), [b.id]);
  // fala nova de s1 durante a espera não toca
  q.played(b.id, 7);
  q.windowClosed("s2", 8);
  assert.deepEqual(plays(q.enqueue(item("s1"), 9)), [], "s1 em espera não fala");
  // fim da espera → "conseguiu pensar?"
  assert.equal(q.nextDeadline(), 3 + 2 * MIN);
  assert.deepEqual(q.tick(3 + 2 * MIN), [{ type: "checkin", session: "s1" }]);
});

test("espere: não → a fila fica parada em silêncio até a espera acabar", () => {
  const q = new SpeechQueue(opts);
  const a = item("s1"), b = item("s2");
  q.enqueue(a, 0);
  q.played(a.id, 1);
  q.wait("s1", 2);
  q.bringOthers("s1", false, 3);
  assert.deepEqual(plays(q.enqueue(b, 4)), [], "s2 não toca durante a espera");
  assert.deepEqual(q.tick(2 + 2 * MIN), [{ type: "checkin", session: "s1" }], "na hora: pergunta antes de s2");
  const cp = item("s1", "ask");
  assert.deepEqual(plays(q.enqueue(cp, 2 + 2 * MIN + 1)), [cp.id]);
});

test("espere de novo sobe o degrau 2 → 5 → 10 min, e um tempo dito vale no lugar (RN-O10)", () => {
  const q = new SpeechQueue(opts);
  const mins = (cmds: SpeechCommand[]) => (cmds.find((c) => c.type === "ask_bring_others") as { minutes: number } | undefined)?.minutes;
  assert.equal(mins(q.wait("s1", 0)), 2);
  q.bringOthers("s1", false, 1);
  // já respondeu "não": não pergunta de novo, só alonga
  assert.deepEqual(q.wait("s1", 2), []);
  assert.equal(q.nextDeadline(), 2 + 5 * MIN);
  q.wait("s1", 3);
  assert.equal(q.nextDeadline(), 3 + 10 * MIN);
  q.wait("s1", 4);
  assert.equal(q.nextDeadline(), 4 + 10 * MIN, "para no último degrau");
  q.wait("s1", 5, 7);
  assert.equal(q.nextDeadline(), 5 + 7 * MIN, "\"me dá 7 minutos\"");
});

test("\"conseguiu pensar?\" sem resposta: uma vez para o fim da fila, depois só texto (RN-O12)", () => {
  const q = new SpeechQueue(opts);
  q.wait("s1", 0);
  q.bringOthers("s1", true, 1);
  assert.deepEqual(q.tick(2 * MIN), [{ type: "checkin", session: "s1" }]);
  const cp = item("s1", "ask");
  q.enqueue(cp, 2 * MIN + 1);
  q.played(cp.id, 2 * MIN + 2);
  const b = item("s2");
  q.enqueue(b, 2 * MIN + 3);
  // ninguém respondeu → outras tocam primeiro (s1 foi para o fim)
  assert.deepEqual(plays(q.windowClosed("s1", 2 * MIN + 4)), [b.id]);
  q.played(b.id, 2 * MIN + 5);
  // fila vazia → pergunta de novo
  assert.deepEqual(q.windowClosed("s2", 2 * MIN + 6), [{ type: "checkin", session: "s1" }]);
  const cp2 = item("s1", "ask");
  q.enqueue(cp2, 2 * MIN + 7);
  q.played(cp2.id, 2 * MIN + 8);
  assert.deepEqual(q.windowClosed("s1", 2 * MIN + 9), [{ type: "parked", session: "s1" }]);
  assert.deepEqual(q.state().waiting, []);
});

test("responder ao \"conseguiu pensar?\" encerra a espera", () => {
  const q = new SpeechQueue(opts);
  q.wait("s1", 0);
  q.bringOthers("s1", true, 1);
  q.tick(2 * MIN);
  const cp = item("s1", "ask");
  q.enqueue(cp, 2 * MIN + 1);
  q.played(cp.id, 2 * MIN + 2);
  q.userSpoke("s1", 2 * MIN + 3);
  assert.deepEqual(q.state().waiting, []);
});

test("encerrar a voz esvazia a fila, não fala mais e não reabre nada até religar (RN-O13)", () => {
  const q = new SpeechQueue(opts);
  const a = item("s1"), b = item("s2");
  q.enqueue(a, 0);
  q.enqueue(b, 1);
  q.wait("s3", 2);
  assert.deepEqual(q.off(), [{ type: "stop" }, { type: "dropped", ids: [b.id], reason: "off" }]);
  assert.ok(q.isOff());
  assert.equal(q.focus(), null);
  assert.deepEqual(q.enqueue(item("s1"), 3), [{ type: "dropped", ids: [`s1#${n}`], reason: "off" }]);
  assert.deepEqual(q.tick(10 * MIN), []);
  assert.equal(q.nextDeadline(), 0);
  q.on();
  const c = item("s1");
  assert.deepEqual(plays(q.enqueue(c, 4)), [c.id], "religada: fluxo normal");
});

test("janela sem aviso do aparelho fecha pelo teto e a fila segue", () => {
  const q = new SpeechQueue(opts);
  const a = item("s1"), b = item("s2");
  q.enqueue(a, 0);
  q.enqueue(b, 1);
  q.played(a.id, 2);
  assert.deepEqual(plays(q.tick(2 + opts.windowMaxMs)), [b.id]);
});

test("aviso atrasado do aparelho (fala que já não é a atual) é ignorado", () => {
  const q = new SpeechQueue(opts);
  const a = item("s1");
  q.enqueue(a, 0);
  assert.deepEqual(q.played("outro", 1), []);
  assert.deepEqual(q.windowClosed("s9", 1), []);
  assert.equal(q.state().playing, a.id);
});

test("aparelho que não avisa \"terminei\" não prende a fila: vale a duração do áudio", () => {
  const q = new SpeechQueue({ ...opts, playSlackMs: 1_000 });
  const a = item("s1", "reply", { durationMs: 4_000 }), b = item("s2");
  q.enqueue(a, 0);
  q.enqueue(b, 1);
  assert.equal(q.nextDeadline(), 5_000);
  assert.deepEqual(q.tick(5_000), [{ type: "window", session: "s1" }]);
});

test("fechamento (\"obrigado\") não abre janela: a fila segue para a próxima sessão", () => {
  const q = new SpeechQueue(opts);
  const a = item("s1", "reply", { closing: true }), b = item("s2");
  q.enqueue(a, 0);
  q.enqueue(b, 1);
  assert.deepEqual(plays(q.played(a.id, 2)), [b.id]);
});

test("duração do WAV pelo cabeçalho", async () => {
  const { wavDurationMs } = await import("./speechQueue.js");
  const sr = 16_000, secs = 1.5, data = Buffer.alloc(sr * 2 * secs);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  assert.equal(wavDurationMs(Buffer.concat([h, data]).toString("base64")), 1500);
  assert.equal(wavDurationMs(""), 0);
  assert.equal(wavDurationMs("bm90IGEgd2F2"), 0);
});
