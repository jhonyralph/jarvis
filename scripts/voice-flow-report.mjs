#!/usr/bin/env node
/**
 * Relatório do fluxo de voz (2026-10-27): lê o log estruturado do Hub (~/.jarvis/logs/jarvis-AAAAMMDD.jsonl)
 * e resume cada etapa — "Hey Jarvis", fim de fala, continuação, roteamento, filtro, fila de fala e o
 * turno de voz — para calibrar os números com dados, não com impressão.
 *
 * Uso:
 *   node scripts/voice-flow-report.mjs                 hoje
 *   node scripts/voice-flow-report.mjs --days 7        últimos 7 dias
 *   node scripts/voice-flow-report.mjs --date 20261027 um dia
 *   node scripts/voice-flow-report.mjs --timeline 40   as últimas 40 etapas, em ordem (para "o que aconteceu às 12:18?")
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Eventos do fluxo de voz (os demais do log ficam de fora). */
export const VOICE_EVENTS = new Set([
  "wake_detect", "wake_flow", "voice_stream_open", "voice_stream_endpoint", "voice_stream_failed", "voice_stream_closed",
  "voice_continuation", "voice_route", "voice_ignored", "voice_turn", "speech_play", "speech_played", "speech_window",
  "speech_window_closed", "speech_barge_in", "speech_heard", "speech_command", "speech_dropped", "speech_parked", "voice_flow_config",
]);

export function parseLines(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && VOICE_EVENTS.has(o.ev)) out.push(o);
    } catch { /* linha cortada no meio de uma gravação */ }
  }
  return out;
}

function pct(values, p) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}
function count(items, key) {
  const m = {};
  for (const it of items) { const k = String(key(it) ?? "?"); m[k] = (m[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}
function stats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? { n: v.length, p50: pct(v, 50), p95: pct(v, 95), max: Math.max(...v) } : { n: 0 };
}

/** Resumo por etapa. Puro (testado em voice-flow-report.test.mjs). */
export function summarize(events) {
  const by = (ev) => events.filter((e) => e.ev === ev);
  const flow = by("wake_flow");
  const captures = flow.filter((e) => e.phase === "capture");
  const endpoints = by("voice_stream_endpoint");
  const turns = by("voice_turn");
  const plays = by("speech_play");
  const config = by("voice_flow_config").at(-1);
  return {
    configuracao: config ? { endpoint: config.endpoint, mergeMs: config.mergeMs, longPauseMs: config.longPauseMs ?? "desligado" } : "sem boot no período",
    heyJarvis: {
      deteccoes: by("wake_detect").length,
      scoreDeteccao: stats(by("wake_detect").map((e) => e.score)),
      semFalaDepoisDoBip: flow.filter((e) => e.phase === "miss").length,
      capturas: { porFim: count(captures, (e) => e.end), segundos: stats(captures.map((e) => e.secs)), continuacoes: captures.filter((e) => e.followUp).length },
      hubAceitouGravacaoMs: stats(captures.map((e) => e.readyMs)),
      transcricaoLocal: count(flow.filter((e) => e.phase === "local_stt"), (e) => e.why),
      fimDaContinuacao: count(flow.filter((e) => e.phase === "follow_end"), (e) => e.reason),
      continuacoesPorChamado: stats(flow.filter((e) => e.phase === "follow_end").map((e) => e.follows)),
      recusadas: flow.filter((e) => e.phase === "rejected").length,
    },
    fimDeFala: {
      porMotivo: count(endpoints, (e) => `${e.source || "?"}:${e.reason}`),
      silencioQueEncerrouMs: stats(endpoints.map((e) => e.silenceMs)),
      falaMs: stats(endpoints.map((e) => e.speechMs)),
      formatoDaFrase: count(endpoints, (e) => e.shape),
      falhasDaGravacao: count(by("voice_stream_failed"), (e) => String(e.error || "").slice(0, 60)),
    },
    continuacao: {
      porMotivo: count(by("voice_continuation"), (e) => e.reason),
      intervaloMs: stats(by("voice_continuation").map((e) => e.gapMs)),
      turnoInterrompidoSaiuEmMs: stats(by("voice_continuation").map((e) => e.settleMs)),
    },
    roteamento: count(by("voice_route"), (e) => `${e.source}:${e.via || e.decision}`),
    filtroDescartou: count(by("voice_ignored"), (e) => `${e.source}:${e.stage}:${e.reason}`),
    filaDeFala: {
      falas: plays.length,
      esperaNaFilaMs: stats(plays.map((e) => e.queuedMs)),
      aparelho: count(plays, (e) => e.device),
      janelas: count(by("speech_window"), (e) => e.mode),
      janelaFechadaPor: count(by("speech_window_closed"), (e) => e.by),
      interrupcoes: count(by("speech_barge_in"), (e) => e.via),
      comandos: count(by("speech_command"), (e) => e.kind),
      descartadas: count(by("speech_dropped"), (e) => e.reason),
    },
    turnoDeVoz: {
      resultado: count(turns, (e) => e.outcome),
      fimDeFalaInformado: count(turns, (e) => e.endpointReason),
      falaAteDespachoMs: stats(turns.map((e) => e.dispatchMs)),
      transcricaoMs: stats(turns.map((e) => e.sttMs)),
      agenteMs: stats(turns.map((e) => e.agentMs)),
    },
  };
}

/** Uma linha por etapa, em ordem — para reconstruir um caso pelo horário. */
export function timeline(events, limit = 40) {
  const local = (t) => { const d = new Date(t); return isNaN(d) ? String(t) : d.toLocaleTimeString("pt-BR", { hour12: false }); };
  const skip = new Set(["t", "lvl", "ev"]);
  return events.slice(-limit).map((e) => {
    const fields = Object.entries(e).filter(([k, v]) => !skip.has(k) && v !== undefined && typeof v !== "object").map(([k, v]) => `${k}=${v}`).join(" ");
    return `${local(e.t)}  ${e.ev}${e.phase ? ":" + e.phase : ""}  ${fields}`;
  });
}

function day(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = join(homedir(), ".jarvis", "logs");
  const days = [];
  if (arg("--date")) days.push(arg("--date"));
  else {
    const n = Math.max(1, Number(arg("--days")) || 1);
    for (let i = n - 1; i >= 0; i--) days.push(day(new Date(Date.now() - i * 86_400_000)));
  }
  const events = [];
  for (const d of days) {
    const f = join(dir, `jarvis-${d}.jsonl`);
    if (existsSync(f)) events.push(...parseLines(readFileSync(f, "utf8")));
  }
  if (argv.includes("--timeline")) {
    console.log(timeline(events, Math.max(1, Number(arg("--timeline")) || 40)).join("\n") || "(nenhuma etapa de voz no período)");
    return;
  }
  console.log(`Fluxo de voz — ${days.join(", ")} — ${events.length} eventos\n`);
  console.log(JSON.stringify(summarize(events), null, 2));
}

// Só roda quando chamado direto (o teste importa as funções sem disparar a leitura do log).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/voice-flow-report.mjs")) main(process.argv.slice(2));
