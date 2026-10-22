import test from "node:test";
import assert from "node:assert/strict";
import { VoiceStreams } from "./voiceStream.js";
import type { StreamEvent } from "./stt.js";

function harness(opts: { openFails?: boolean } = {}) {
  const frames: Array<Record<string, unknown>> = [];
  const pushed: string[] = [];
  let closed = 0;
  let emit: (ev: StreamEvent) => void = () => {};
  const streams = new VoiceStreams<string>({
    open: async (_id, onEvent) => {
      if (opts.openFails) throw new Error("serviço indisponível");
      emit = onEvent;
      return { push: (p) => { pushed.push(p); }, close: () => { closed++; } };
    },
    send: (_socket, frame) => { frames.push(frame); },
  });
  return { streams, frames, pushed, closed: () => closed, emit: (ev: StreamEvent) => emit(ev) };
}

test("abre, recebe pedaços e avisa que está pronto", async () => {
  const h = harness();
  await h.streams.start("ws1", "vs_abc123");
  assert.deepEqual(h.frames, [{ t: "voice_stream_ready", streamId: "vs_abc123" }]);
  h.streams.push("ws1", "vs_abc123", "AAAA");
  h.streams.push("ws1", "outro_id1", "BBBB");
  h.streams.push("ws2", "vs_abc123", "CCCC");
  assert.deepEqual(h.pushed, ["AAAA"], "só o dono e só a gravação certa");
});

test("frase completa + pausa curta = fim de turno; parcial vai para a tela", async () => {
  const h = harness();
  await h.streams.start("ws1", "vs_abc123");
  h.emit({ event: "vad", speechMs: 2_800, silenceMs: 480, durMs: 4_000, partialFresh: false });
  h.emit({ event: "partial", text: "Verifica se o build passou e me avisa.", fresh: true });
  assert.equal(h.frames.at(-1)?.t, "voice_partial");
  h.emit({ event: "vad", speechMs: 2_800, silenceMs: 704, durMs: 4_250, partialFresh: true });
  assert.deepEqual(h.frames.at(-1), { t: "voice_endpoint", streamId: "vs_abc123", reason: "frase_completa", silenceMs: 704, spoke: true });
  h.emit({ event: "vad", speechMs: 2_800, silenceMs: 960, durMs: 4_500, partialFresh: true });
  assert.equal(h.frames.filter((f) => f.t === "voice_endpoint").length, 1, "o fim é avisado uma vez só");
});

test("pausa depois de conector espera mais", async () => {
  const h = harness();
  await h.streams.start("ws1", "vs_abc123");
  h.emit({ event: "partial", text: "Quero que você revise o PR e", fresh: true });
  h.emit({ event: "vad", speechMs: 2_000, silenceMs: 1_800, durMs: 4_000, partialFresh: true });
  assert.equal(h.frames.some((f) => f.t === "voice_endpoint"), false);
});

test("falha do serviço: o aparelho é avisado e volta ao fim de fala local", async () => {
  const h = harness({ openFails: true });
  await h.streams.start("ws1", "vs_abc123");
  assert.equal(h.frames[0].t, "voice_stream_failed");
  assert.equal(h.streams.open, 0);
  const h2 = harness();
  await h2.streams.start("ws1", "vs_abc123");
  h2.emit({ event: "error", error: "STT: serviço encerrou" });
  assert.equal(h2.frames.at(-1)?.t, "voice_stream_failed");
  assert.equal(h2.closed(), 1);
});

test("nova gravação no mesmo aparelho fecha a anterior; parar fecha; id inválido é ignorado", async () => {
  const h = harness();
  await h.streams.start("ws1", "vs_abc123");
  await h.streams.start("ws1", "vs_def456");
  assert.equal(h.closed(), 1);
  h.streams.stop("ws1", "vs_abc123");
  assert.equal(h.streams.open, 1, "parar com o id antigo não derruba a nova");
  h.streams.stop("ws1");
  assert.equal(h.streams.open, 0);
  await h.streams.start("ws1", "../x");
  assert.equal(h.streams.open, 0);
});

test("pedaço grande demais é descartado", async () => {
  const h = harness();
  await h.streams.start("ws1", "vs_abc123");
  h.streams.push("ws1", "vs_abc123", "x".repeat(80_000));
  assert.deepEqual(h.pushed, []);
});
