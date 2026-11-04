import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { stopChild } from "../../../packages/core/src/fixtures/stop-child.js";
import { ConversationLedger } from "./conversationLedger.js";
import { VoiceAudioStore } from "./voiceAudio.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
async function port(): Promise<number> {
  const server = createServer(); await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const n = (server.address() as { port: number }).port; await new Promise<void>((r) => server.close(() => r())); return n;
}
test("conversation accepts durable work, stays responsive, and recovers without replay after Hub restart", { timeout: 70_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-conversation-e2e-")); mkdirSync(join(home, ".jarvis"));
  const hubPort = await port(), adminPort = await port(); let child: ChildProcess | undefined, ws: WebSocket | undefined, logs = "";
  let frames: any[] = [];
  async function take(pred: (m: any) => boolean, ms = 12_000): Promise<any> {
    const until = Date.now() + ms;
    while (Date.now() < until) { const i = frames.findIndex(pred); if (i >= 0) return frames.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error("Missing frame: " + JSON.stringify(frames.slice(-5)) + "\n" + logs.slice(-5000));
  }
  const send = (m: unknown) => ws!.send(JSON.stringify(m));
  async function start() {
    frames = []; logs = "";
    child = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
      JARVIS_AUTH: "off", JARVIS_ENABLE_MOCK: "1", JARVIS_AGENT: "mock", JARVIS_SEARCH_AGENT: "mock", JARVIS_WAKE_AGENT: "mock", JARVIS_CWD: home,
      JARVIS_HOME: home, HOME: home, USERPROFILE: home, NODE_ENV: "test", JARVIS_PORT: String(hubPort), JARVIS_ADMIN_PORT: String(adminPort), JARVIS_VOICE_WARMUP: "0", JARVIS_CAPACITY_SAMPLE_MS: "0" } });
    child.stdout?.on("data", (b) => { logs += b; }); child.stderr?.on("data", (b) => { logs += b; });
    const until = Date.now() + 15_000; let ready = false;
    while (Date.now() < until) { try { if ((await fetch(`http://127.0.0.1:${hubPort}/health`)).ok) { ready = true; break; } } catch {} await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(ready, logs);
    ws = new WebSocket(`ws://127.0.0.1:${hubPort}`); ws.on("message", (raw) => { frames.push(JSON.parse(raw.toString())); });
    await new Promise<void>((r, reject) => { ws!.once("open", r); ws!.once("error", reject); });
    await take((m) => m.t === "version");
  }
  const request = (id: string, text: string, sid: string) => send({ t: "conversation_request", msgId: id, text, sessionId: sid, speak: false });
  async function inbox() { send({ t: "conversation_list" }); return take((m) => m.t === "conversation_inbox"); }
  try {
    await start(); send({ t: "new", agent: "mock", cwd: home }); const history = await take((m) => m.t === "history" && m.session?.agent === "mock"), sid = history.session.id;
    send({ t: "conversation_request", msgId: "wrong-machine", text: "Nova tarefa: destino errado", sessionId: sid, runnerId: "another-machine", speak: false });
    const wrongMachine = await take((m) => m.t === "conversation_reply" && m.requestId === "wrong-machine");
    assert.equal(wrongMachine.error, true); assert.match(wrongMachine.text, /máquina de origem/);
    assert.ok(!(await inbox()).tasks.some((t: any) => t.title.includes("destino errado")));
    request("accepted-request", "Nova tarefa: revisar [fixture:slow]", sid);
    await take((m) => m.t === "conversation_ack" && m.requestId === "accepted-request");
    const accepted = await take((m) => m.t === "conversation_reply" && m.requestId === "accepted-request"); assert.equal(accepted.error, undefined, accepted.text);
    assert.match(accepted.text, /registrada/);
    request("status-request", "status", sid);
    const status = await take((m) => m.t === "conversation_reply" && m.requestId === "status-request"); assert.doesNotMatch(status.text, /não consegui identificar/i);
    let view = await inbox(); const focus = view.preferences.task; assert.ok(focus?.sessionId && focus.sessionId !== sid);
    request("correction-request", "Correção: preserve os arquivos", sid);
    assert.match((await take((m) => m.t === "conversation_reply" && m.requestId === "correction-request")).text, /próximo turno/);
    const until = Date.now() + 15_000;
    while (Date.now() < until) { view = await inbox(); if (view.tasks.filter((t: any) => t.sessionId === focus.sessionId && t.state === "succeeded").length >= 2) break; await new Promise((r) => setTimeout(r, 200)); }
    assert.equal(view.tasks.filter((t: any) => t.sessionId === focus.sessionId && t.state === "succeeded").length, 2, JSON.stringify(view.tasks));
    const taskId = view.tasks.find((t: any) => t.sessionId === focus.sessionId).id;
    send({ t: "conversation_memory", taskId, kind: "responsibility", value: "Jonathan revisa o resultado" });
    assert.equal((await take((m) => m.t === "conversation_memory_result")).ok, true);
    send({ t: "conversation_memory", taskId, kind: "responsibility", value: "Jonathan valida a recuperação" });
    assert.equal((await take((m) => m.t === "conversation_memory_result")).ok, true);
    const audio = new VoiceAudioStore(join(home, ".jarvis", "voice-audio"));
    audio.save({ id: "foreign-audio", ext: "wav", runnerId: focus.runnerId, sessionId: sid, principal: "guest", opts: { clientId: "forged-retry" } }, Buffer.from("foreign recording"));
    send({ t: "voice", sessionId: sid, vtid: "forged-retry", audioId: "foreign-audio", retry: true, audio: "YWJj", conversation: true });
    await take((m) => m.t === "voice_failed" && m.vtid === "forged-retry");
    assert.equal(audio.audio("foreign-audio")?.toString(), "foreign recording", "a forged retry cannot remove another user's recording");
    const count = view.tasks.length;
    request("accepted-request", "Nova tarefa: revisar [fixture:slow]", sid);
    assert.equal((await take((m) => m.t === "conversation_reply" && m.requestId === "accepted-request")).duplicate, true);
    // Crash-gap evidence: accepted metadata without any execution must remain actionable, never rerun.
    const ledger = new ConversationLedger(join(home, ".jarvis", "hub", "conversation"));
    ledger.accept({ principalId: "owner", clientId: "crash-gap", runnerId: focus.runnerId, sessionId: sid, text: "Pedido registrado antes da queda" });
    const corrupt = ledger.accept({ principalId: "owner", clientId: "corrupt-receipt", runnerId: focus.runnerId, sessionId: sid, text: "Pedido com ACK incerto" });
    writeFileSync(join(home, ".jarvis", "hub", "conversation", `request-${corrupt.id}.json`), "broken receipt");
    audio.save({ id: "corrupt-audio", ext: "wav", runnerId: focus.runnerId, sessionId: sid, principal: "owner", opts: { clientId: "corrupt-receipt" } }, Buffer.from("preserved recording"));
    ws!.close(); await stopChild(child); child = undefined;
    await start(); view = await inbox();
    assert.deepEqual(view.preferences.task, focus);
    send({ t: "personal_context_get", requestId: "after-restart" });
    const memory = await take((m) => m.t === "personal_context_state" && m.requestId === "after-restart");
    const notes = memory.state.preferences.filter((p: any) => p.key === "conversation.responsibility");
    assert.equal(notes.length, 1); assert.equal(notes[0].value, "Jonathan valida a recuperação");
    assert.ok(notes[0].evidence.some((e: any) => e.sourceId === `${focus.runnerId}/${focus.sessionId}/${taskId}`));
    assert.equal(view.tasks.filter((t: any) => t.sessionId === focus.sessionId && t.state === "succeeded").length, 2);
    assert.ok(view.tasks.some((t: any) => t.title === "Pedido registrado antes da queda" && t.state === "interrupted"));
    const blocked = view.tasks.find((t: any) => t.id === "audio:corrupt-audio");
    assert.equal(blocked.state, "interrupted"); assert.equal(blocked.voiceId, undefined);
    assert.match(blocked.summary, /ilegível/);
    assert.equal(audio.audio("corrupt-audio")?.toString(), "preserved recording");
    request("accepted-request", "Nova tarefa: revisar [fixture:slow]", sid);
    assert.equal((await take((m) => m.t === "conversation_reply" && m.requestId === "accepted-request")).duplicate, true);
    assert.equal((await inbox()).tasks.length, count + 2);
  } finally { ws?.close(); await stopChild(child); rmSync(home, { recursive: true, force: true }); }
});
