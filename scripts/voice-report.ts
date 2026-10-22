#!/usr/bin/env node
/**
 * Relatório dos turnos de voz (VOZ-00, fase F0): lê os eventos `voice_turn` dos logs estruturados
 * do Hub e mostra, por etapa, mínimo / mediana / p90 / máximo. Só leitura — não fala com o Hub.
 *
 *   npm run voice:report                 # últimos 7 dias
 *   npm run voice:report -- --days 30
 *   npm run voice:report -- --json
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { summarizeVoiceTurns, VOICE_TURN_STAGES, type VoiceTurnEvent } from "@jarvis/core";

const LABELS: Record<string, string> = {
  endpointMs: "pausa até encerrar a gravação",
  encodeMs: "codificação no aparelho",
  sttMs: "transcrição",
  speakerMs: "identificação de falante",
  preflightMs: "correção + portão",
  dispatchMs: "do áudio recebido ao agente",
  agentMs: "trabalho do agente",
  prepMs: "preparo do texto falado",
  synthMs: "síntese",
  firstAudioMs: "do áudio recebido ao 1º áudio enviado",
  stopToFirstAudioMs: "fim da gravação → 1º som",
  perceivedMs: "última fala → 1º som (percebido)",
};

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const days = Math.max(1, Number(arg("--days")) || 7);
const dir = join(process.env.JARVIS_HOME || homedir(), ".jarvis", "logs");
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

const events: Array<Partial<VoiceTurnEvent>> = [];
let files: string[] = [];
try { files = readdirSync(dir).filter((n) => /^jarvis-\d{8}(\.1)?\.jsonl$/.test(n)); } catch { /* sem logs ainda */ }
for (const name of files) {
  let text = "";
  try { text = readFileSync(join(dir, name), "utf8"); } catch { continue; }
  for (const line of text.split("\n")) {
    if (!line.includes('"voice_turn"')) continue;
    try {
      const row = JSON.parse(line) as Partial<VoiceTurnEvent> & { ev?: string; t?: string };
      if (row.ev !== "voice_turn" || !row.t || Date.parse(row.t) < cutoff) continue;
      events.push(row);
    } catch { /* linha truncada */ }
  }
}

const summary = summarizeVoiceTurns(events);
if (process.argv.includes("--json")) console.log(JSON.stringify({ days, ...summary }, null, 2));
else {
  console.log(`Turnos de voz — últimos ${days} dia(s): ${summary.turns}`);
  if (!summary.turns) { console.log("Nenhum evento voice_turn ainda. Ele só aparece depois de reiniciar o Hub com a F0."); process.exit(0); }
  console.log("Desfechos: " + Object.entries(summary.outcomes).map(([k, v]) => `${k}=${v}`).join(" · ") + "\n");
  const s = (ms: number): string => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  for (const stage of VOICE_TURN_STAGES) {
    const st = summary.stages[stage];
    if (!st) continue;
    console.log(`${LABELS[stage].padEnd(40)} n=${String(st.n).padStart(3)}  mín ${s(st.min).padStart(8)}  mediana ${s(st.p50).padStart(8)}  p90 ${s(st.p90).padStart(8)}  máx ${s(st.max).padStart(8)}`);
  }
}
