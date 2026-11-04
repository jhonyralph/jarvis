import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { createServer } from "node:http";
import { CodexAdapter, codexRolloutFiles, codexThreadTelemetry, codexPlanTelemetry, codexRolloutAppend,
  codexTelemetryFromLines, codexPatchEventsFromLines } from "./agents.js";

const row = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + "\n";
const token = (input: number) => row("event_msg", { type: "token_count", info: {
  total_token_usage: { input_tokens: input }, last_token_usage: { input_tokens: input / 2 }, model_context_window: 200_000,
} });

function fixture(t: test.TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-codex-io-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("rollout catalog serves HTTP during a cold scan and sorts by one captured mtime per file", async (t) => {
  const dir = fixture(t);
  const nested = join(dir, "2026", "11"); mkdirSync(nested, { recursive: true });
  for (let i = 0; i < 240; i++) {
    const file = join(nested, `rollout-${i}.jsonl`);
    writeFileSync(file, "{}\n"); utimesSync(file, 1_700_000_000 + i, 1_700_000_000 + i);
  }
  writeFileSync(join(nested, "unrelated.txt"), "ignore");
  const server = createServer((_req, res) => res.end("healthy"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as { port: number }).port;
  let finished = false;
  const scan = codexRolloutFiles(dir).then((files) => { finished = true; return files; });
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(await response.text(), "healthy");
  assert.equal(finished, false, "HTTP must be served BEFORE the filesystem scan completes");
  const files = await scan;
  assert.equal(files.length, 240);
  assert.equal(files[0], join(nested, "rollout-239.jsonl"));
  assert.equal(files.at(-1), join(nested, "rollout-0.jsonl"));
  assert.deepEqual(await codexRolloutFiles(join(dir, "missing")), []);
});

test("thread telemetry preserves fields across parsing batches and ignores malformed tails", async (t) => {
  const file = join(fixture(t), "thread.jsonl");
  const content = row("turn_context", { model: "model-a" }) + token(800)
    + row("response_item", { type: "function_call_output", output: "tool output" }).repeat(300)
    + row("event_msg", { type: "token_count", info: { total_token_usage: { input_tokens: 900 } } })
    + '{"type":"event_msg","payload":';
  writeFileSync(file, content);
  const telemetry = await codexThreadTelemetry("thread", file);
  assert.deepEqual(telemetry, codexTelemetryFromLines(content.split("\n")));
  assert.equal(telemetry?.model, "model-a");
  assert.equal(telemetry?.last.input_tokens, 400);
  assert.equal(telemetry?.contextWindow, 200_000);
  assert.equal(telemetry?.total.input_tokens, 900);
});

test("large thread telemetry reads a bounded tail, yields while parsing and retains latest usage", async (t) => {
  const file = join(fixture(t), "large.jsonl");
  writeFileSync(file, "x".repeat(9 * 1024 * 1024) + "\n");
  appendFileSync(file, token(700).repeat(6000) + token(900));
  let beats = 0, running = true;
  const beat = () => { if (running) { beats++; setImmediate(beat); } };
  setImmediate(beat);
  try {
    const telemetry = await codexThreadTelemetry("large", file);
    assert.equal(telemetry?.total.input_tokens, 900);
    assert.ok(beats > 5, `event loop yielded ${beats} times during I/O and parsing`);
  } finally { running = false; }
});

test("account telemetry skips missing/no-window rollouts, caps the scan and rejects expired data", async (t) => {
  const dir = fixture(t), now = Date.now();
  const empty = join(dir, "empty.jsonl"), valid = join(dir, "valid.jsonl");
  writeFileSync(empty, row("event_msg", { type: "token_count", rate_limits: { primary: null, secondary: null } }));
  writeFileSync(valid, row("event_msg", { type: "token_count", rate_limits: { primary: { used_percent: 37 } } }));
  assert.equal((await codexPlanTelemetry([join(dir, "missing"), empty, valid], now))?.rateLimits.primary.used_percent, 37);
  assert.equal(await codexPlanTelemetry([...Array(40).fill(empty), valid], now), undefined);
  utimesSync(valid, (now - 8 * 86_400_000) / 1000, (now - 8 * 86_400_000) / 1000);
  assert.equal(await codexPlanTelemetry([valid], now), undefined);
});

test("incremental reads tolerate a vanished file and preserve UTF-8 bytes across separate appends", async (t) => {
  const file = join(fixture(t), "patch.jsonl");
  assert.deepEqual(await codexRolloutAppend(file, 12), { data: Buffer.alloc(0), offset: 12, reset: false });
  const patch = Buffer.from(row("event_msg", { type: "patch_apply_end", changes: {
    "ação.ts": { type: "add", unified_diff: "+olá" },
  } }));
  const cut = patch.indexOf(Buffer.from("ç")) + 1;
  writeFileSync(file, patch.subarray(0, cut));
  const first = await codexRolloutAppend(file, 0);
  appendFileSync(file, patch.subarray(cut));
  const second = await codexRolloutAppend(file, first.offset);
  assert.equal(second.reset, false);
  assert.equal(second.offset, patch.length);
  const events = codexPatchEventsFromLines(Buffer.concat([first.data, second.data]).toString("utf8").split("\n"));
  assert.equal(events.length, 1);
  assert.equal(events[0].path, "ação.ts");
});

test("Codex turn drains async polling and delivers the final patch once, before returning", { timeout: 20_000 }, async (t) => {
  const dir = fixture(t), rollouts = join(dir, ".codex", "sessions");
  mkdirSync(rollouts, { recursive: true });
  mkdirSync(join(dir, ".jarvis"));
  // Slow down cold discovery with real files while a fake CLI completes its turn. No provider
  // invocation, credentials or user history: both homedir and executable resolution are isolated.
  for (let i = 0; i < 240; i++) writeFileSync(join(rollouts, `other-${i}.jsonl`), "{}\n");
  const homedirMock = t.mock.method(os, "homedir", () => dir);
  syncBuiltinESMExports();
  const previousPath = process.env.PATH;
  process.env.PATH = dir + (process.platform === "win32" ? ";" : ":") + (previousPath || "");
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    homedirMock.mock.restore(); syncBuiltinESMExports();
  });
  const cli = join(dir, "fake-codex.cjs");
  writeFileSync(cli, `
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, '.codex', 'sessions', 'rollout-fixture-thread.jsonl');
const say = o => console.log(JSON.stringify(o));
fs.writeFileSync(file, JSON.stringify({type:'turn_context',payload:{model:'test-model'}})+'\\n');
say({type:'thread.started',thread_id:'fixture-thread'});
setTimeout(() => {
  fs.appendFileSync(file, JSON.stringify({type:'event_msg',payload:{type:'patch_apply_end',call_id:'final-patch',changes:{'final.ts':{type:'add',unified_diff:'+done'}}}})+'\\n');
  say({type:'item.completed',item:{id:'reply',type:'agent_message',text:'finished'}});
  say({type:'turn.completed',usage:{input_tokens:10,output_tokens:2}});
}, 30);
`);
  const shellQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  if (process.platform === "win32") writeFileSync(join(dir, "codex.cmd"), `@"${process.execPath}" "%~dp0fake-codex.cjs"\r\n`);
  else writeFileSync(join(dir, "codex"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cli)}\n`, { mode: 0o755 });
  const adapter = new CodexAdapter();
  adapter.capabilities = async () => ({ models: [] });
  const events: Array<{ kind: string; path?: string }> = [];
  const reply = await adapter.send("fixture-session", "fixture prompt", dir, { signal: AbortSignal.timeout(10_000) }, (ev) => events.push(ev));
  assert.equal(reply.text, "finished");
  assert.equal(events.filter((ev) => ev.path === "final.ts").length, 1);
  const finalCount = events.length;
  await new Promise((resolve) => setTimeout(resolve, 850));
  assert.equal(events.length, finalCount, "no polling callback emits activity after send resolves");
});
