import test from "node:test";
import assert from "node:assert/strict";
import { LoopStallPolicy } from "./loopStallPolicy.js";

const MIN = 60_000;
const opts = { limitMs: 45_000, repeat: 3, windowMs: 30 * MIN };

test("atraso curto não conta; trava longa isolada só registra (o Hub já voltou)", () => {
  const p = new LoopStallPolicy(opts);
  assert.equal(p.record(0, 2_000).verdict, "ignore");
  assert.equal(p.record(1_000, 44_999).verdict, "ignore", "abaixo do limite");
  assert.deepEqual(p.record(2_000, 48_256), { verdict: "recovered", recent: 1 });
});

test("a 3ª trava longa dentro da janela reinicia o Hub (estado degradado)", () => {
  const p = new LoopStallPolicy(opts);
  assert.equal(p.record(0, 50_000).verdict, "recovered");
  assert.equal(p.record(10 * MIN, 60_000).verdict, "recovered");
  assert.deepEqual(p.record(20 * MIN, 70_000), { verdict: "exit", recent: 3 });
});

test("travas espalhadas além da janela não se somam — o dia de 26/10 não reiniciaria nenhuma vez", () => {
  // as 5 travas que o guarda derrubou em 26/10 (horas desde a primeira): 11:29, 12:55, 13:09, 15:29, 20:40
  const p = new LoopStallPolicy(opts);
  const at = [0, 86, 100, 240, 551].map((m) => m * MIN);
  const lags = [48_256, 62_276, 65_688, 125_805, 141_587];
  // 12:55 e 13:09 caem na mesma janela de 30 min, mas são só 2 (< 3)
  assert.deepEqual(at.map((t, i) => p.record(t, lags[i]).verdict), ["recovered", "recovered", "recovered", "recovered", "recovered"]);
});

test("repeat = 1 reproduz o comportamento antigo (encerra na primeira trava longa)", () => {
  const p = new LoopStallPolicy({ ...opts, repeat: 1 });
  assert.equal(p.record(0, 46_000).verdict, "exit");
});
