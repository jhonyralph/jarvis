/**
 * End-to-end: a Framework Jarvis publish fans out over the real Hub wire path. A UI client triggers
 * `publish_framework`; the Hub reads the canonical tree, sends `framework_publish` to a connected
 * runner, and forwards the runner's `framework_published` reply back to the client as `framework_status`.
 * The runner here is a raw WebSocket (the real materialize is unit-tested in framework.test.ts); this
 * proves the Hub's dispatch, per-machine confirmation and version bump.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { RUNNER_PROTOCOL_VERSION } from "@jarvis/protocol";

const pExecFile = promisify(execFile);
async function freePort(): Promise<number> { return new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const a = s.address(); const p = typeof a === "object" && a ? a.port : 0; s.close(() => res(p)); }); }); }
async function stop(pid?: number): Promise<void> { if (!pid) return; try { if (process.platform === "win32") await pExecFile("taskkill", ["/pid", String(pid), "/T", "/F"]); else process.kill(-pid, "SIGTERM"); } catch { /* already gone */ } }
async function waitHealth(port: number): Promise<void> { const end = Date.now() + 20_000; while (Date.now() < end) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch { /* booting */ } await new Promise((r) => setTimeout(r, 100)); } throw new Error("Hub did not become healthy"); }
function inbox(ws: WebSocket) {
  const frames: any[] = [], waiters: Array<() => void> = [];
  ws.on("message", (raw) => { try { frames.push(JSON.parse(raw.toString())); } catch { /* ignore */ } while (waiters.length) waiters.shift()?.(); });
  return { send: (v: unknown) => ws.send(JSON.stringify(v)), async take(match: (v: any) => boolean, timeout = 10_000): Promise<any> {
    const end = Date.now() + timeout;
    for (;;) { const i = frames.findIndex(match); if (i >= 0) return frames.splice(i, 1)[0]; const left = end - Date.now(); if (left <= 0) throw new Error("timed out; saw " + JSON.stringify(frames.map((f) => f.t))); await new Promise<void>((res, rej) => { const timer = setTimeout(() => rej(new Error("frame timeout")), left); waiters.push(() => { clearTimeout(timer); res(); }); }); }
  } };
}
async function open(url: string): Promise<{ ws: WebSocket; box: ReturnType<typeof inbox> }> {
  const ws = new WebSocket(url); await new Promise<void>((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  return { ws, box: inbox(ws) };
}

test("publish_framework fans out to a runner and confirms back to the client", { timeout: 60_000 }, async () => {
  const root = resolve(import.meta.dirname, "../../.."), home = mkdtempSync(join(tmpdir(), "jarvis-fw-hub-"));
  // Seed the canonical framework the Hub will read at publish time.
  mkdirSync(join(home, ".jarvis", "framework", "commands"), { recursive: true });
  writeFileSync(join(home, ".jarvis", "framework", "commands", "plan.md"), "Plan the work for $ARGUMENTS.");
  const port = await freePort(), adminPort = await freePort();
  let hub: ReturnType<typeof spawn> | undefined, hubPid: number | undefined;
  try {
    hub = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], { cwd: root, detached: process.platform !== "win32", stdio: "ignore",
      env: { ...process.env, JARVIS_PORT: String(port), JARVIS_ADMIN_PORT: String(adminPort), JARVIS_HOME: home, JARVIS_AUTH: "off", JARVIS_AGENT: "mock", JARVIS_ENABLE_MOCK: "1" } });
    hubPid = hub.pid;
    await waitHealth(port);

    const runnerId = "runner-fw-e2e";
    const runner = await open(`ws://127.0.0.1:${port}/runner`);
    runner.box.send({ t: "register", token: "", info: { runnerId, host: "fw-runner", os: "test", agents: ["mock"], protocolVersion: RUNNER_PROTOCOL_VERSION, commit: "fw00000" } });
    await runner.box.take((m) => m.t === "welcome");

    const client = await open(`ws://127.0.0.1:${port}/`);
    client.box.send({ t: "publish_framework" });

    // The Hub reads the canonical tree and dispatches it to the runner.
    const pub = await runner.box.take((m) => m.t === "framework_publish");
    assert.ok(pub.requestId, "publish carries a correlation id");
    assert.ok(pub.version >= 1, "version is bumped on publish");
    const planFile = (pub.files || []).find((f: any) => f.path === "commands/plan.md");
    assert.ok(planFile, "the seeded command is in the manifest");
    assert.match(planFile.content, /Plan the work for \$ARGUMENTS/);

    // The client got the synchronous ack listing this machine as sent.
    const ack = await client.box.take((m) => m.t === "framework_status" && Array.isArray(m.results));
    assert.ok(ack.results.some((r: any) => r.runnerId === runnerId && r.state === "sent"), "runner listed as sent");

    // The runner confirms materialization; the Hub forwards a per-machine status to the client.
    runner.box.send({ t: "framework_published", requestId: pub.requestId, ok: true, version: pub.version, hash: pub.hash, written: 1, removed: 0, skipped: false });
    const status = await client.box.take((m) => m.t === "framework_status" && m.runnerId === runnerId);
    assert.equal(status.ok, true);
    assert.equal(status.state, "materialized");

    runner.ws.close(); client.ws.close();
  } finally {
    await stop(hubPid);
    try { const { rmSync } = await import("node:fs"); rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
