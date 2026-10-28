#!/usr/bin/env node
/**
 * Relatório de capacidade da máquina (CAP-01 F1, 2026-10-28): lê os `capacity_sample` do log do Hub
 * (~/.jarvis/logs/jarvis-AAAAMMDD.jsonl, um resumo por minuto) e mostra, por hora do dia, quanto de
 * memória física e comprometida sobra, CPU e atraso do Hub — com e sem turno do Jarvis rodando.
 *
 * Para que serve: a F3 (admissão) vai segurar trabalho quando a folga não comportar o turno. Antes de
 * ligá-la, este relatório responde "com a reserva de X%, quantos minutos do meu dia normal já
 * estariam sem folga?" — se a resposta for "muitos", a regra está errada para esta máquina.
 *
 * Uso:
 *   node scripts/capacity-report.mjs                 hoje
 *   node scripts/capacity-report.mjs --days 7        últimos 7 dias
 *   node scripts/capacity-report.mjs --date 20261028 um dia
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function parseLines(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes('"capacity_sample"')) continue;
    try { const o = JSON.parse(line); if (o?.ev === "capacity_sample") out.push(o); } catch { /* linha cortada */ }
  }
  return out;
}

function pct(values, p) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}
const avg = (v) => { const n = v.filter(Number.isFinite); return n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : undefined; };

/** Folga com outra reserva, a partir do resumo (o log grava a folga com a reserva da época). */
export function headroomAt(s, reservePct) {
  const r = reservePct / 100;
  if (!Number.isFinite(s.availPhysMbMin) || !Number.isFinite(s.totalPhysMb)) return undefined;
  const phys = s.availPhysMbMin - s.totalPhysMb * r;
  const commit = Number.isFinite(s.commitLimitMb) && Number.isFinite(s.commitUsedMbMax) ? s.commitLimitMb - s.commitUsedMbMax - s.commitLimitMb * r : undefined;
  return Math.round(commit == null ? phys : Math.min(phys, commit));
}

function group(rows) {
  return {
    minutes: rows.length,
    freePhysMbP10: pct(rows.map((r) => r.availPhysMbMin), 10),
    freePhysMbMedian: pct(rows.map((r) => r.availPhysMbAvg), 50),
    commitUsedMbP90: pct(rows.map((r) => r.commitUsedMbMax), 90),
    cpuPctAvg: avg(rows.map((r) => r.cpuPctAvg)),
    loopLagMaxMs: Math.max(0, ...rows.map((r) => r.loopLagMaxMs).filter(Number.isFinite)),
  };
}

export function summarize(samples, reserves = [10, 15, 20, 25]) {
  if (!samples.length) return { minutes: 0 };
  const last = samples.at(-1);
  const idle = samples.filter((s) => !s.activeRuns), busy = samples.filter((s) => s.activeRuns > 0);
  const byHour = {};
  for (const s of samples) {
    const h = String(new Date(s.to ?? s.t).getHours()).padStart(2, "0") + "h"; // "09h": chave numérica pura ("14") iria para a frente
    (byHour[h] ||= []).push(s);
  }
  return {
    minutes: samples.length,
    machine: { totalPhysMb: last.totalPhysMb, commitLimitMb: last.commitLimitMb },
    // "Sem folga" = a F3, com essa reserva, seguraria trabalho novo naquele minuto.
    minutesWithoutHeadroom: Object.fromEntries(reserves.map((r) => {
      const n = samples.filter((s) => (headroomAt(s, r) ?? 0) < 0).length;
      return [`${r}%`, `${n} (${Math.round((100 * n) / samples.length)}%)`];
    })),
    readFailures: samples.reduce((a, s) => a + (s.failures || 0), 0),
    withoutJarvisTurns: group(idle),
    withJarvisTurns: busy.length ? { ...group(busy), activeRunsMax: Math.max(...busy.map((s) => s.activeRuns)) } : { minutes: 0 },
    hubRssMbMax: Math.max(0, ...samples.map((s) => s.hubRssMb).filter(Number.isFinite)),
    byHour: Object.fromEntries(Object.entries(byHour).sort().map(([h, rows]) => [h, group(rows)])),
  };
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
  const samples = [];
  for (const d of days) {
    // O log do dia gira para `jarvis-AAAAMMDD.1.jsonl` ao passar do tamanho máximo: lê os dois.
    for (const f of [join(dir, `jarvis-${d}.1.jsonl`), join(dir, `jarvis-${d}.jsonl`)]) {
      if (existsSync(f)) samples.push(...parseLines(readFileSync(f, "utf8")));
    }
  }
  console.log(`Capacidade da máquina — ${days.join(", ")} — ${samples.length} minutos medidos\n`);
  console.log(JSON.stringify(summarize(samples), null, 2));
}

// Só roda quando chamado direto (o teste importa as funções sem disparar a leitura do log).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/capacity-report.mjs")) main(process.argv.slice(2));
