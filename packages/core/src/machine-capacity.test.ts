/** CAP-01 F1 — medição da máquina: cálculo puro, leitores de plataforma e o amostrador com relógio falso. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { MachineSampler, WindowsMemoryProbe, cpuPercent, headroom, parseMeminfo, parseWindowsMemLine, summarize, type MemoryReading } from "./machine-capacity.js";

const GB = 1024;
const reading = (availPhysMb: number, commitUsedMb?: number): MemoryReading => ({
  totalPhysMb: 32 * GB, availPhysMb, ...(commitUsedMb == null ? {} : { commitLimitMb: 80 * GB, commitUsedMb }),
});

test("folga desconta a reserva do dono (20% do total de cada memória) e vale a menor", () => {
  // física: 10 GB livres − 6,4 GB de reserva = 3,6 GB; comprometida: 80 − 60 − 16 = 4 GB → vale 3,6 GB
  const h = headroom(reading(10 * GB, 60 * GB));
  assert.equal(h.physMb, Math.round(10 * GB - 32 * GB * 0.2));
  assert.equal(h.commitMb, Math.round(80 * GB - 60 * GB - 80 * GB * 0.2));
  assert.equal(h.mb, h.physMb);
  // comprometida apertada manda, mesmo com física sobrando (o que derrubou a máquina em outubro)
  assert.equal(headroom(reading(20 * GB, 70 * GB)).mb, Math.round(80 * GB - 70 * GB - 16 * GB));
  // sem medida de memória comprometida: só a física
  assert.equal(headroom(reading(10 * GB)).commitMb, undefined);
  assert.equal(headroom(reading(10 * GB), 0).mb, 10 * GB);
});

test("leitura do Windows: bytes do GlobalMemoryStatusEx viram MB, usado = limite − disponível", () => {
  const r = parseWindowsMemLine('{"totalPhys":34103738368,"availPhys":6457454592,"commitLimit":85643345920,"commitAvail":26912395264}');
  assert.deepEqual(r, { totalPhysMb: 32524, availPhysMb: 6158, commitLimitMb: 81676, commitUsedMb: 56010 });
  assert.equal(parseWindowsMemLine("{}"), null);
  assert.equal(parseWindowsMemLine("lixo"), null);
});

test("leitura do Linux: /proc/meminfo", () => {
  const txt = "MemTotal:       16384000 kB\nMemFree:  100 kB\nMemAvailable:    8192000 kB\nCommitLimit:    20480000 kB\nCommitted_AS:   10240000 kB\n";
  assert.deepEqual(parseMeminfo(txt), { totalPhysMb: 16000, availPhysMb: 8000, commitLimitMb: 20000, commitUsedMb: 10000 });
  assert.equal(parseMeminfo("nada"), null);
});

test("CPU entre duas leituras dos núcleos", () => {
  const core = (user: number, idle: number) => ({ model: "x", speed: 1, times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  assert.equal(cpuPercent([core(0, 0), core(0, 0)], [core(25, 75), core(75, 25)]), 50);
  assert.equal(cpuPercent([core(1, 1)], [core(1, 1)]), undefined, "sem tempo decorrido não inventa número");
});

test("resumo da janela: mínimos, médias, máximos e a menor folga", () => {
  const s = summarize([
    { t: 1, ...reading(10 * GB, 50 * GB), cpuPct: 10 },
    { t: 2, ...reading(6 * GB, 62 * GB), cpuPct: 90 },
  ], { from: 0, to: 60_000, reservePct: 20, failures: 1, lag: { p99Ms: 40, maxMs: 120 } });
  assert.equal(s.samples, 2);
  assert.equal(s.availPhysMbMin, 6 * GB);
  assert.equal(s.availPhysMbAvg, 8 * GB);
  assert.equal(s.commitUsedMbMax, 62 * GB);
  assert.equal(s.cpuPctAvg, 50);
  assert.equal(s.cpuPctMax, 90);
  assert.equal(s.headroomMbMin, Math.min(headroom(reading(6 * GB, 62 * GB)).mb, headroom(reading(10 * GB, 50 * GB)).mb));
  assert.equal(s.loopLagMaxMs, 120);
  assert.equal(s.failures, 1);
});

test("amostrador: junta as amostras e entrega um resumo por janela; leitura que falha é contada", async () => {
  let t = 0;
  const queue: Array<MemoryReading | null> = [reading(8 * GB, 40 * GB), null, reading(4 * GB, 50 * GB)];
  const got: unknown[] = [];
  const s = new MachineSampler({
    onSummary: (x) => got.push(x), now: () => (t += 1_000), loopLag: false,
    memory: { read: async () => queue.shift() ?? null, stop: () => {} },
    cpuTimes: () => [],
  });
  await s.sample(); await s.sample(); await s.sample();
  const sum = s.flush()!;
  assert.equal(sum.samples, 2);
  assert.equal(sum.failures, 1);
  assert.equal(sum.availPhysMbMin, 4 * GB);
  assert.equal(got.length, 1);
  assert.equal(s.flush(), null, "janela vazia não gera linha no log");
  assert.equal(s.latest()?.availPhysMb, 4 * GB);
});

test("amostrador: amostras não se sobrepõem enquanto a leitura anterior não voltou", async () => {
  let release!: (r: MemoryReading) => void;
  const s = new MachineSampler({ onSummary: () => {}, loopLag: false, cpuTimes: () => [],
    memory: { read: () => new Promise((r) => { release = r; }), stop: () => {} } });
  const first = s.sample();
  assert.equal(await s.sample(), null, "a segunda chamada desiste em vez de empilhar");
  release(reading(1 * GB));
  assert.ok(await first);
});

/** PowerShell falso: responde cada linha do stdin com `reply()`; `die()` simula a saída. */
function fakeChild(reply: () => string | null) {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void };
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => child.emit("exit", 1);
  child.stdin.on("data", () => { const r = reply(); if (r != null) child.stdout.write(r + "\n"); });
  return child;
}
const LINE = '{"totalPhys":1048576000,"availPhys":524288000,"commitLimit":2097152000,"commitAvail":1048576000}';

test("sonda do Windows: um processo só, várias leituras pelo stdin", async () => {
  let spawned = 0;
  const probe = new WindowsMemoryProbe({ spawnImpl: (() => { spawned++; return fakeChild(() => LINE); }) as never });
  assert.deepEqual(await probe.read(), { totalPhysMb: 1000, availPhysMb: 500, commitLimitMb: 2000, commitUsedMb: 1000 });
  assert.ok(await probe.read());
  assert.equal(spawned, 1);
  probe.stop();
});

test("sonda do Windows: sem resposta dentro do prazo, devolve null e não relança na hora", async () => {
  let spawned = 0;
  const probe = new WindowsMemoryProbe({ timeoutMs: 30, spawnImpl: (() => { spawned++; return fakeChild(() => null); }) as never });
  assert.equal(await probe.read(), null);
  assert.equal(await probe.read(), null, "em espera crescente: nem tenta");
  assert.equal(spawned, 1);
  probe.stop();
});
