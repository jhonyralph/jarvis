import test from "node:test";
import assert from "node:assert/strict";
import { parseLines, summarize, timeline } from "./voice-flow-report.mjs";

const L = (o) => JSON.stringify({ t: "2026-10-27T15:00:00.000Z", lvl: "info", ...o });
const log = [
  L({ ev: "hub_boot", version: "x" }),
  L({ ev: "voice_flow_config", endpoint: { maxSilenceMs: 3500 }, mergeMs: 10000 }),
  L({ ev: "wake_detect", score: 0.8, flow: "wf1" }),
  L({ ev: "wake_flow", phase: "capture", flow: "wf1", end: "pausa_neutra", secs: 6.5, readyMs: 120, followUp: false }),
  L({ ev: "voice_stream_endpoint", source: "wake", reason: "pausa_neutra", silenceMs: 1400, speechMs: 5000, shape: "unknown" }),
  L({ ev: "wake_flow", phase: "capture", flow: "wf1", end: "pausa_neutra", secs: 3.1, readyMs: 90, followUp: true }),
  L({ ev: "voice_continuation", sessionId: "voice", joined: true, reason: "joined", gapMs: 5200, settleMs: 300 }),
  L({ ev: "wake_flow", phase: "follow_end", flow: "wf1", follows: 1, reason: "silencio" }),
  L({ ev: "speech_play", sessionId: "voice", device: "listener", queuedMs: 40 }),
  L({ ev: "voice_ignored", source: "wake", stage: "modelo", reason: "conversa paralela", text: "..." }),
  L({ ev: "voice_turn", outcome: "spoken", endpointReason: "pausa_neutra", dispatchMs: 2100, sttMs: 900 }),
  "{linha cortada",
].join("\n");

test("lê só os eventos de voz e ignora linha quebrada", () => {
  const ev = parseLines(log);
  assert.equal(ev.length, 10);
  assert.ok(!ev.some((e) => e.ev === "hub_boot"));
});

test("resume cada etapa do fluxo", () => {
  const s = summarize(parseLines(log));
  assert.equal(s.heyJarvis.deteccoes, 1);
  assert.deepEqual(s.heyJarvis.capturas.porFim, { pausa_neutra: 2 });
  assert.equal(s.heyJarvis.capturas.continuacoes, 1);
  assert.deepEqual(s.heyJarvis.fimDaContinuacao, { silencio: 1 });
  assert.deepEqual(s.fimDeFala.porMotivo, { "wake:pausa_neutra": 1 });
  assert.deepEqual(s.continuacao.porMotivo, { joined: 1 });
  assert.deepEqual(s.filaDeFala.aparelho, { listener: 1 });
  assert.deepEqual(s.filtroDescartou, { "wake:modelo:conversa paralela": 1 });
  assert.equal(s.turnoDeVoz.falaAteDespachoMs.p50, 2100);
  assert.equal(s.configuracao.mergeMs, 10000);
});

test("linha do tempo em ordem, sem campos aninhados", () => {
  const lines = timeline(parseLines(log), 3);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /speech_play/);
  assert.match(lines[2], /voice_turn .*outcome=spoken/);
});
