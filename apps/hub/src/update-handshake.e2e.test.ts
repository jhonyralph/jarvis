import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { RUNNER_PROTOCOL_VERSION } from "@jarvis/protocol";

const pExecFile = promisify(execFile);
async function freePort(): Promise<number> { return new Promise((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => resolvePort(port)); }); }); }
async function stop(pid?: number): Promise<void> { if (!pid) return; try { if (process.platform === "win32") await pExecFile("taskkill", ["/pid", String(pid), "/T", "/F"]); else process.kill(-pid, "SIGTERM"); } catch { /* already stopped */ } }
async function waitHealth(port: number): Promise<void> { const end = Date.now() + 20_000; while (Date.now() < end) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch { /* booting */ } await new Promise((r) => setTimeout(r, 100)); } throw new Error("Hub did not become healthy"); }

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

test("old/offline runners retain an update until restart and commit verification", { timeout: 60_000 }, async () => {
  const root = resolve(import.meta.dirname, "../../.."), home = mkdtempSync(join(tmpdir(), "jarvis-update-hub-"));
  const port = await freePort(), adminPort = await freePort(); let hub: ReturnType<typeof spawn> | undefined;
  const start = async () => {
    hub = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], { cwd: root, detached: process.platform !== "win32", stdio: "ignore",
      env: { ...process.env, JARVIS_PORT: String(port), JARVIS_ADMIN_PORT: String(adminPort), JARVIS_HOME: home, JARVIS_AUTH: "off", JARVIS_AGENT: "mock", JARVIS_ENABLE_MOCK: "1" } });
    await waitHealth(port);
  };
  const runnerId = "runner-update-e2e";
  try {
    await start();
    const old = await connectRunner(port, { runnerId, host: "old-runner", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION - 1, commit: "old0000" });
    const first = await old.box.take((m) => m.t === "update" || m.t === "reject");
    assert.equal(first.t, "update", "an authenticated old protocol must be quarantined for update, not rejected");
    assert.ok(first.requestId && first.targetCommit); old.ws.close();
    await stop(hub?.pid); hub = undefined;

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

    const future = await connectRunner(port, { runnerId: "runner-future-e2e", host: "future", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION + 1, commit: first.targetCommit });
    const rejected = await future.box.take((m) => m.t === "reject" || m.t === "update");
    assert.equal(rejected.t, "reject", "a newer runner protocol must never be auto-downgraded");
    assert.match(rejected.reason, /Atualize o Hub primeiro/); future.ws.close();
  } finally { await stop(hub?.pid); rmSync(home, { recursive: true, force: true }); }
});
