/** O registro que responde "por que a fila não saiu". O que importa: `since` não pode se mover
 *  enquanto o motivo for o mesmo, e o chamador precisa saber quando transmitir. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { QueueBlockRegistry } from "./queue-block.js";

test("o primeiro motivo é uma mudança e começa a contar do zero", () => {
  const r = new QueueBlockRegistry();
  const { block, changed } = r.note("s1", "turn_running", "o turno anterior ainda está rodando", 1000);
  assert.equal(changed, true, "chamador transmite");
  assert.deepEqual(block, { code: "turn_running", reason: "o turno anterior ainda está rodando", since: 1000, attempts: 1 });
});

test("motivo repetido conta tentativa mas NÃO reinicia o relógio", () => {
  const r = new QueueBlockRegistry();
  r.note("s1", "turn_running", "x", 1000);
  const a = r.note("s1", "turn_running", "x", 16_000);
  const b = r.note("s1", "turn_running", "x", 31_000);
  assert.equal(a.changed, false, "sem frame novo — a rede de segurança reavalia a cada 15s");
  assert.equal(b.block.since, 1000, "'parada há 30s', não 'reavaliada agora' — é este número que denuncia o encalhe");
  assert.equal(b.block.attempts, 3);
});

test("motivo diferente reinicia relógio e contagem, e volta a transmitir", () => {
  const r = new QueueBlockRegistry();
  r.note("s1", "turn_running", "x", 1000);
  r.note("s1", "turn_running", "x", 2000);
  const { block, changed } = r.note("s1", "runner_offline", "a máquina está offline", 5000);
  assert.equal(changed, true);
  assert.deepEqual(block, { code: "runner_offline", reason: "a máquina está offline", since: 5000, attempts: 1 });
});

test("limpar remove o motivo e diz se havia algo", () => {
  const r = new QueueBlockRegistry();
  assert.equal(r.clear("s1"), false, "nada a limpar → nada a transmitir");
  r.note("s1", "no_lease", "x", 1000);
  assert.equal(r.has("s1"), true);
  assert.equal(r.clear("s1"), true);
  assert.equal(r.get("s1"), undefined);
  assert.equal(r.size, 0);
});

test("sessões são independentes e `get` não vaza a referência interna", () => {
  const r = new QueueBlockRegistry();
  r.note("s1", "turn_running", "x", 1000);
  r.note("s2", "runner_offline", "y", 2000);
  assert.equal(r.get("s1")!.code, "turn_running");
  assert.equal(r.get("s2")!.code, "runner_offline");
  const copia = r.get("s1")!;
  copia.attempts = 999;
  assert.equal(r.get("s1")!.attempts, 1, "mexer na cópia não corrompe o registro");
  assert.equal(r.size, 2);
});
