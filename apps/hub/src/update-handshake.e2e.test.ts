import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { RUNNER_PROTOCOL_VERSION } from "@jarvis/protocol";
import { UPDATE_MAX_DELIVERIES } from "@jarvis/core";

const pExecFile = promisify(execFile);
/** Reserva N portas livres DE UMA VEZ: mantém todos os sockets abertos enquanto escolhe, e só então
 *  fecha. Pedir uma por vez (abre→lê→fecha, repete) devolve a MESMA porta no Linux, onde o kernel
 *  reusa a porta efêmera recém-liberada — o Hub então tentava bindar HTTP e admin na mesma porta,
 *  não subia, e o teste morria com ECONNREFUSED (falha só no CI Linux). */
async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((res, rej) => {
    const server = createServer(); server.once("error", rej); server.listen(0, "127.0.0.1", () => res(server));
  })));
  const ports = servers.map((server) => { const address = server.address(); return typeof address === "object" && address ? address.port : 0; });
  await Promise.all(servers.map((server) => new Promise<void>((res) => server.close(() => res()))));
  return ports;
}
/** Mata o Hub e ESPERA ele morrer de fato. Antes só disparava o sinal e voltava: no Linux o SIGTERM
 *  é assíncrono, então o processo velho ainda segurava a porta quando o teste subia o Hub seguinte
 *  na MESMA porta. O novo falhava ao bindar, o waitHealth passava (quem respondia era o velho) e a
 *  conexão seguinte estourava ECONNREFUSED quando o velho enfim saía. No Windows o `taskkill /F` já
 *  era síncrono — por isso a falha só aparecia no CI Linux. */
async function stop(child?: ReturnType<typeof spawn>): Promise<void> {
  const pid = child?.pid;
  if (!child || !pid || child.exitCode !== null) return;
  const exited = new Promise<void>((res) => child.once("exit", () => res()));
  try {
    if (process.platform === "win32") await pExecFile("taskkill", ["/pid", String(pid), "/T", "/F"]);
    else process.kill(-pid, "SIGTERM");
  } catch { /* already stopped */ }
  // se não sair em 5s, força e espera de novo — nunca devolver com a porta ainda ocupada
  const forced = new Promise<void>((res) => setTimeout(res, 5_000));
  if (await Promise.race([exited.then(() => true), forced.then(() => false)]) === false) {
    try { if (process.platform !== "win32") process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    await Promise.race([exited, new Promise<void>((res) => setTimeout(res, 3_000))]);
  }
}
async function waitHealth(port: number): Promise<void> { const end = Date.now() + 45_000; while (Date.now() < end) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch { /* booting */ } await new Promise((r) => setTimeout(r, 100)); } throw new Error("Hub did not become healthy"); }

function inbox(ws: WebSocket) {
  const frames: any[] = [], waiters: Array<() => void> = [];
  ws.on("message", (raw) => { try { frames.push(JSON.parse(raw.toString())); } catch { /* ignore */ } while (waiters.length) waiters.shift()?.(); });
  return { send: (value: unknown) => ws.send(JSON.stringify(value)), async take(match: (value: any) => boolean, timeout = 10_000): Promise<any> {
    const end = Date.now() + timeout;
    for (;;) { const index = frames.findIndex(match); if (index >= 0) return frames.splice(index, 1)[0]; const left = end - Date.now(); if (left <= 0) throw new Error("timed out waiting for frame; saw " + JSON.stringify(frames)); await new Promise<void>((resolveWait, reject) => { const timer = setTimeout(() => reject(new Error("frame timeout")), left); waiters.push(() => { clearTimeout(timer); resolveWait(); }); }); }
  } };
}
async function connectRunner(port: number, info: Record<string, unknown>): Promise<{ ws: WebSocket; box: ReturnType<typeof inbox> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/runner`); await new Promise<void>((resolveOpen, reject) => { ws.once("open", resolveOpen); ws.once("error", reject); });
  const box = inbox(ws); box.send({ t: "register", token: "", info }); return { ws, box };
}

test("old/offline runners retain an update until restart and commit verification", { timeout: 120_000 }, async () => {
  const root = resolve(import.meta.dirname, "../../.."), home = mkdtempSync(join(tmpdir(), "jarvis-update-hub-"));
  const [port, adminPort] = await freePorts(2); let hub: ReturnType<typeof spawn> | undefined, hubPid: number | undefined;
  const start = async () => {
    hub = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], { cwd: root, detached: process.platform !== "win32", stdio: "ignore",
      env: { ...process.env, JARVIS_PORT: String(port), JARVIS_ADMIN_PORT: String(adminPort), JARVIS_HOME: home, JARVIS_AUTH: "off", JARVIS_AGENT: "mock", JARVIS_ENABLE_MOCK: "1" } });
    hubPid = hub.pid;
    await waitHealth(port);
  };
  const runnerId = "runner-update-e2e";
  try {
    await start();
    const old = await connectRunner(port, { runnerId, host: "old-runner", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION - 1, commit: "old0000" });
    const first = await old.box.take((m) => m.t === "update" || m.t === "reject");
    assert.equal(first.t, "update", "an authenticated old protocol must be quarantined for update, not rejected");
    assert.ok(first.requestId && first.targetCommit); old.ws.close();
    await stop(hub); hub = undefined; hubPid = undefined;

    await start();
    const current = await connectRunner(port, { runnerId, host: "runner", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: "old0000" });
    await current.box.take((m) => m.t === "welcome");
    const replay = await current.box.take((m) => m.t === "update");
    assert.equal(replay.requestId, first.requestId, "the same durable deployment survives the Hub restart");
    assert.equal(replay.targetCommit, first.targetCommit);
    current.box.send({ t: "update_done", requestId: replay.requestId, ok: true, behind: 1, current: replay.targetCommit, restartRequired: true, log: "prepared" });
    await new Promise((r) => setTimeout(r, 150)); current.ws.close();

    const verified = await connectRunner(port, { runnerId, host: "runner", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: replay.targetCommit });
    await verified.box.take((m) => m.t === "welcome"); await new Promise((r) => setTimeout(r, 200));
    const pending = JSON.parse(readFileSync(join(home, ".jarvis", "hub", "pending-runner-updates.json"), "utf8"));
    assert.equal(pending[runnerId], undefined, "queue clears only after the restarted runner reports the target commit");
    verified.ws.close();

    // A same-SHA repair cannot be inferred from the commit alone: npm/validation may have failed.
    // Require the durable receipt written after preparation before clearing that deployment.
    const repairId = "runner-repair-e2e";
    const repairOld = await connectRunner(port, { runnerId: repairId, host: "repair-old", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION - 1, commit: first.targetCommit });
    const repairFirst = await repairOld.box.take((m) => m.t === "update");
    repairOld.box.send({ t: "update_done", requestId: repairFirst.requestId, ok: true, behind: 0, current: repairFirst.targetCommit, restartRequired: true, log: "repaired" });
    await new Promise((r) => setTimeout(r, 100)); repairOld.ws.close();
    const noReceipt = await connectRunner(port, { runnerId: repairId, host: "repair-new", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: repairFirst.targetCommit });
    await noReceipt.box.take((m) => m.t === "welcome");
    const retriedRepair = await noReceipt.box.take((m) => m.t === "update");
    assert.equal(retriedRepair.requestId, repairFirst.requestId, "same-SHA repair without a receipt must be retried, not falsely verified");
    noReceipt.box.send({ t: "update_done", requestId: retriedRepair.requestId, ok: true, behind: 0, current: retriedRepair.targetCommit, restartRequired: true, log: "repaired with receipt" });
    await new Promise((r) => setTimeout(r, 100)); noReceipt.ws.close();
    const withReceipt = await connectRunner(port, { runnerId: repairId, host: "repair-new", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: repairFirst.targetCommit,
      updateReceipt: { requestId: repairFirst.requestId, targetCommit: repairFirst.targetCommit, current: repairFirst.targetCommit, preparedAt: Date.now() } });
    await withReceipt.box.take((m) => m.t === "welcome"); await new Promise((r) => setTimeout(r, 200));
    const afterReceipt = JSON.parse(readFileSync(join(home, ".jarvis", "hub", "pending-runner-updates.json"), "utf8"));
    assert.equal(afterReceipt[repairId], undefined, "same-SHA repair clears only with its matching durable receipt");
    withReceipt.ws.close();

    await stop(hub); hub = undefined; hubPid = undefined;
    const staleId = "runner-stale-target-e2e";
    const currentHead = (await pExecFile("git", ["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim();
    writeFileSync(join(home, ".jarvis", "hub", "pending-runner-updates.json"), JSON.stringify({
      [staleId]: { requestId: "stale-request", targetCommit: "0000000", requestedAt: Date.now(), state: "sent", force: true, fromCommit: currentHead },
    }));
    await start();
    await new Promise((r) => setTimeout(r, 200));
    const alreadyCurrent = await connectRunner(port, { runnerId: staleId, host: "current-runner", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: currentHead });
    await alreadyCurrent.box.take((m) => m.t === "welcome");
    await assert.rejects(() => alreadyCurrent.box.take((m) => m.t === "update", 400), /timed out|frame timeout/, "stale pending target must not be redelivered as a downgrade");
    const afterStale = JSON.parse(readFileSync(join(home, ".jarvis", "hub", "pending-runner-updates.json"), "utf8"));
    assert.equal(afterStale[staleId], undefined, "stale pending target is cleared when runner is already on the current Hub commit");
    alreadyCurrent.ws.close();

    // Disjuntor da ENTREGA. Caso real (20/08): a máquina recebia o update, o updater rodava até o fim,
    // mas o runner não subia depois — então `update_done` nunca chegava, o pedido ficava em "sent", e
    // cada reconexão provocava outra entrega. 33 ciclos, derrubando a máquina em cada um, sem aviso.
    // Contar FALHAS não pegaria: todo ciclo "deu certo". O que denuncia é entregar sem o pedido andar.
    const loopId = "runner-delivery-loop-e2e";
    const quarantined = await connectRunner(port, { runnerId: loopId, host: "loop-old", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION - 1, commit: "old0000" });
    const firstLoop = await quarantined.box.take((m) => m.t === "update");
    quarantined.ws.close(); await new Promise((r) => setTimeout(r, 150));
    for (let i = 2; i <= UPDATE_MAX_DELIVERIES; i++) {
      const again = await connectRunner(port, { runnerId: loopId, host: "loop", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: "old0000" });
      const resent = await again.box.take((m) => m.t === "update");
      assert.equal(resent.requestId, firstLoop.requestId, `entrega ${i} tem de ser o MESMO pedido — é o que caracteriza o círculo`);
      again.ws.close(); await new Promise((r) => setTimeout(r, 150));
    }
    const looping = await connectRunner(port, { runnerId: loopId, host: "loop", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: "old0000" });
    await looping.box.take((m) => m.t === "welcome");
    await assert.rejects(() => looping.box.take((m) => m.t === "update", 600), /timed out|frame timeout/, "passado o teto, o Hub para de reenviar em vez de derrubar a máquina de novo");
    const afterLoop = JSON.parse(readFileSync(join(home, ".jarvis", "hub", "pending-runner-updates.json"), "utf8"));
    assert.equal(afterLoop[loopId].deliveries, UPDATE_MAX_DELIVERIES, "o contador é de ENTREGAS do mesmo pedido, não de falhas");
    assert.equal(afterLoop[loopId].stalled, true, "parar em silêncio seria trocar um problema invisível por outro");
    assert.match(String(afterLoop[loopId].lastError), /círculo/);
    looping.ws.close();

    // A guarda "a máquina já contém o alvo?" tem um jeito silencioso de dar errado: invertida, ela
    // conclui que TODA máquina atrasada já tem o alvo e para de entregar — o Hub ficaria MUDO em vez
    // de em círculo, que é o defeito pior porque não deixa rastro. Uma máquina em HEAD~1 (commit real,
    // que este Hub conhece, ao contrário dos "old0000" dos outros casos) tem de continuar recebendo.
    const behindId = "runner-behind-e2e";
    // Um commit real que ESTE checkout conhece e que nao e o alvo. Em clone raso de profundidade 1
    // ele nao existe, e o `git` responde "Needed a single revision" — erro que nao diz nada sobre o
    // que o teste queria. Quando faltar, o motivo tem de ser o motivo (ver fetch-depth no ci.yml).
    const anterior = await pExecFile("git", ["rev-parse", "--short", "HEAD~1"], { cwd: root })
      .then((r) => r.stdout.trim())
      .catch(() => { throw new Error("este checkout nao tem commit-pai (clone raso?): o e2e da guarda de alvo precisa de fetch-depth >= 2"); });
    const quarentena = await connectRunner(port, { runnerId: behindId, host: "atrasado-old", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION - 1, commit: anterior });
    const pedido = await quarentena.box.take((m) => m.t === "update");
    quarentena.ws.close(); await new Promise((r) => setTimeout(r, 150));
    const atrasado = await connectRunner(port, { runnerId: behindId, host: "atrasado", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: anterior });
    await atrasado.box.take((m) => m.t === "welcome");
    const reentrega = await atrasado.box.take((m) => m.t === "update");
    assert.equal(reentrega.requestId, pedido.requestId, "estar ATRÁS do alvo não pode ser confundido com estar à frente dele");
    atrasado.ws.close();

    const future = await connectRunner(port, { runnerId: "runner-future-e2e", host: "future", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION + 1, commit: first.targetCommit });
    const rejected = await future.box.take((m) => m.t === "reject" || m.t === "update");
    assert.equal(rejected.t, "reject", "a newer runner protocol must never be auto-downgraded");
    assert.match(rejected.reason, /Atualize o Hub primeiro/); future.ws.close();
  } finally { await stop(hub); rmSync(home, { recursive: true, force: true }); }
});
