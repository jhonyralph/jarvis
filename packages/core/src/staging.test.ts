import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StagingStore, buildRefinePrompt, parseRefine, STAGING_TTL_MS } from "./staging.js";

function dir() { return mkdtempSync(join(tmpdir(), "jarvis-staging-")); }

test("start/push/get one staging draft per target session", () => {
  const d = dir();
  try {
    const s = new StagingStore(d);
    s.start("sess1", { model: "haiku" });
    s.push("sess1", { role: "user", text: "conserta o login", ts: 1 }, "Refinado: consertar o login quebrado");
    const e = s.get("sess1");
    assert.equal(e?.draft, "Refinado: consertar o login quebrado");
    assert.equal(e?.turns.length, 1);
    // start again resets (one active per session)
    s.start("sess1");
    assert.equal(s.get("sess1")?.turns.length, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("TTL prunes entries older than 7 days on load", () => {
  const d = dir();
  try {
    const s = new StagingStore(d);
    s.start("old");
    // hand-age the entry beyond the TTL by reloading with a tiny ttl and pruning "now" far ahead
    const s2 = new StagingStore(d, 1000);            // 1s TTL
    const removed = s2.prune(Date.now() + 5000);      // 5s later → the entry is stale
    assert.equal(removed, 1);
    assert.equal(s2.list().length, 0);
    assert.equal(STAGING_TTL_MS, 7 * 24 * 3600 * 1000);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("remove + persistence across reload", () => {
  const d = dir();
  try {
    new StagingStore(d).start("a");
    assert.equal(new StagingStore(d).get("a")?.id, "a", "survives reload");
    const s = new StagingStore(d);
    assert.equal(s.remove("a"), true);
    assert.equal(new StagingStore(d).get("a"), undefined);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("parseRefine reads the JSON reply", () => {
  const r = parseRefine('lixo antes {"draft":"faça X","say":"é isso?","needsUpgrade":true,"reason":"ambíguo"} depois');
  assert.equal(r.draft, "faça X");
  assert.equal(r.say, "é isso?");
  assert.equal(r.needsUpgrade, true);
  assert.equal(r.reason, "ambíguo");
});

test("parseRefine falls back to raw text when not JSON", () => {
  const r = parseRefine("só um texto solto");
  assert.equal(r.draft, "só um texto solto");
  assert.equal(r.needsUpgrade, false);
});

test("buildRefinePrompt includes context, history and the new utterance", () => {
  const p = buildRefinePrompt({ context: "sessão sobre auth", turns: [{ role: "user", text: "oi", ts: 1 }], utterance: "muda o token" });
  assert.match(p, /sessão sobre auth/);
  assert.match(p, /Usuário: oi/);
  assert.match(p, /muda o token/);
  assert.match(p, /needsUpgrade/);
});
