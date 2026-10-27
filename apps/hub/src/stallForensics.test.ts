import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStallForensics, type StallTrace } from "./stallForensics.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// O "culpado" com nome conhecido: prende a thread principal em JavaScript síncrono.
function travaOEventLoopDeProposito(ms: number): number {
  const end = Date.now() + ms;
  let x = 0;
  while (Date.now() < end) x += Math.sqrt(x + 1);
  return x;
}

test("flagra a função que prende o event loop, grava em disco e retoma a thread principal", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-stall-"));
  const logFile = join(dir, "stall-traces.jsonl");
  const traces: StallTrace[] = [];
  const f = startStallForensics({ marks: [400, 1_200], logFile, beatMs: 100, onTrace: (t) => traces.push(t) });
  try {
    await sleep(400);                       // worker de pé e recebendo batidas
    travaOEventLoopDeProposito(2_000);      // passa das DUAS marcas
    for (let i = 0; i < 50 && traces.length < 2; i++) await sleep(50);

    assert.equal(traces.length, 2, "uma pilha por marca: " + JSON.stringify(traces));
    for (const t of traces) {
      assert.equal(t.error, undefined);
      const culpado = t.frames.find((fr) => fr.fn === "travaOEventLoopDeProposito");
      assert.ok(culpado, "a pilha aponta o culpado: " + JSON.stringify(t.frames.slice(0, 4)));
      // o V8 novo não manda url na pilha: sem traduzir o scriptId, "(anon)" sem arquivo não diagnostica nada
      assert.match(culpado.url, /stallForensics\.test\.ts$/, "e o arquivo dele: " + JSON.stringify(culpado));
    }
    assert.ok(traces[0].stalledMs >= 400 && traces[1].stalledMs >= 1_200, "cada captura na sua marca");

    // gravado pela worker, de forma síncrona — vale mesmo se o Hub sair logo depois da trava
    const lines = readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].ev, "hub_loop_stall_trace");

    // a thread principal NÃO ficou pausada: timers voltam a rodar
    const t0 = Date.now(); await sleep(50);
    assert.ok(Date.now() - t0 < 1_000, "o event loop seguiu depois da captura");
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sem trava não captura nada, e uma trava nova depois de voltar captura de novo", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-stall-"));
  const traces: StallTrace[] = [];
  const f = startStallForensics({ marks: [400], logFile: join(dir, "t.jsonl"), beatMs: 100, onTrace: (t) => traces.push(t) });
  try {
    await sleep(1_000);
    assert.equal(traces.length, 0, "loop livre: nenhuma captura");
    travaOEventLoopDeProposito(900);
    for (let i = 0; i < 40 && traces.length < 1; i++) await sleep(50);
    await sleep(400);                       // batidas voltam e re-armam
    travaOEventLoopDeProposito(900);
    for (let i = 0; i < 40 && traces.length < 2; i++) await sleep(50);
    assert.equal(traces.length, 2, "re-arma a cada trava: " + traces.length);
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
