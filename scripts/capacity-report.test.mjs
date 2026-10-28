import test from "node:test";
import assert from "node:assert/strict";
import { parseLines, summarize, headroomAt } from "./capacity-report.mjs";

const at = (h) => new Date(2026, 9, 28, h, 0, 0).getTime();
const L = (o) => JSON.stringify({ t: "2026-10-28T15:00:00.000Z", lvl: "info", ev: "capacity_sample", totalPhysMb: 32000, commitLimitMb: 80000, reservePct: 20, failures: 0, ...o });
const log = [
  JSON.stringify({ ev: "hub_boot" }),
  L({ to: at(9), availPhysMbMin: 10000, availPhysMbAvg: 11000, commitUsedMbMax: 50000, cpuPctAvg: 10, loopLagMaxMs: 30, activeRuns: 0, hubRssMb: 900 }),
  L({ to: at(9), availPhysMbMin: 5000, availPhysMbAvg: 6000, commitUsedMbMax: 60000, cpuPctAvg: 70, loopLagMaxMs: 400, activeRuns: 3, hubRssMb: 1200 }),
  L({ to: at(14), availPhysMbMin: 7000, availPhysMbAvg: 7500, commitUsedMbMax: 55000, cpuPctAvg: 20, loopLagMaxMs: 50, activeRuns: 1, hubRssMb: 1000 }),
  '{"ev":"capacity_sample", cortada',
].join("\n");

test("lê só os resumos de capacidade e tolera linha cortada", () => {
  assert.equal(parseLines(log).length, 3);
});

test("folga com outra reserva sai do resumo gravado", () => {
  const [a] = parseLines(log);
  // física: 10000 − 6400 = 3600; comprometida: 80000 − 50000 − 16000 = 14000 → 3600
  assert.equal(headroomAt(a, 20), 3600);
  assert.equal(headroomAt(a, 0), 10000);
  assert.equal(headroomAt({}, 20), undefined);
});

test("resumo: minutos sem folga por reserva, com e sem turno do Jarvis, por hora", () => {
  const r = summarize(parseLines(log), [10, 20]);
  assert.equal(r.minutes, 3);
  // 20%: reserva física de 6400 → só o minuto com 5000 livres fica sem folga
  assert.equal(r.minutesWithoutHeadroom["20%"], "1 (33%)");
  assert.equal(r.minutesWithoutHeadroom["10%"], "0 (0%)");
  assert.equal(r.withoutJarvisTurns.minutes, 1);
  assert.equal(r.withJarvisTurns.minutes, 2);
  assert.equal(r.withJarvisTurns.activeRunsMax, 3);
  assert.deepEqual(Object.keys(r.byHour), ["09h", "14h"]);
  assert.equal(r.byHour["09h"].loopLagMaxMs, 400);
  assert.equal(r.hubRssMbMax, 1200);
  assert.deepEqual(summarize([]), { minutes: 0 });
});
