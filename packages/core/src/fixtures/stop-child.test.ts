import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { stopChild } from "./stop-child.js";

// Um filho que nunca sai sozinho e com os pipes abertos — o formato exato do Hub de teste que
// prendia o arquivo de teste quando sobrevivia ao encerramento.
function teimoso(): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}
const saiu = (p: ChildProcess) => p.exitCode !== null || p.signalCode !== null;

test("stopChild encerra um filho vivo com pipes abertos", { timeout: 20_000 }, async () => {
  const p = teimoso();
  await new Promise((r) => p.once("spawn", r));
  await stopChild(p);
  assert.ok(saiu(p), "o filho tinha que ter saído");
});

test("stopChild sem taskkill (não deu para CRIAR o processo — evento 2004) cai no TerminateProcess", { timeout: 20_000, skip: process.platform !== "win32" && "o taskkill só existe no Windows" }, async () => {
  const p = teimoso();
  await new Promise((r) => p.once("spawn", r));
  // PATH vazio faz o spawnSync("taskkill") falhar com ENOENT — o mesmo caminho de código de quando a
  // memória virtual acabou e o processo não pôde ser criado. Antes isso era engolido e o filho vivia.
  const salvo = { PATH: process.env.PATH, Path: process.env.Path };
  process.env.PATH = ""; delete process.env.Path;
  try { await stopChild(p, 500); } finally {
    process.env.PATH = salvo.PATH; if (salvo.Path !== undefined) process.env.Path = salvo.Path;
  }
  assert.ok(saiu(p), "o plano B (kill pelo handle) tinha que ter matado o filho");
});

test("stopChild num filho que já saiu volta na hora", { timeout: 10_000 }, async () => {
  const p = spawn(process.execPath, ["-e", ""], { windowsHide: true, stdio: "ignore" });
  await new Promise((r) => p.once("exit", r));
  const t0 = Date.now();
  await stopChild(p);
  assert.ok(Date.now() - t0 < 500, "não devia esperar nada");
});
