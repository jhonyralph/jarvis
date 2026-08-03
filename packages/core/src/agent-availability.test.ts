/** Exhaustion cache: block/expiry/clear + the next-local-midnight reset. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentAvailabilityStore, nextLocalMidnight } from "./agent-availability.js";

test("nextLocalMidnight rolls to the next day at 00:00 local", () => {
  const noon = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
  const reset = nextLocalMidnight(noon);
  const d = new Date(reset);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 16);
  assert.ok(reset > noon);
});

test("markExhausted blocks until the deadline, then expires", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-avail-"));
  try {
    const store = new AgentAvailabilityStore(dir);
    const now = 1_000_000;
    assert.equal(store.isBlocked("claude-code", now), false);
    store.markExhausted("claude-code", now + 5000, "rate limit exceeded", now);
    assert.equal(store.isBlocked("claude-code", now + 1000), true);
    assert.equal(store.blockedUntil("claude-code", now + 1000), now + 5000);
    assert.equal(store.isBlocked("claude-code", now + 6000), false, "expired");
    assert.equal(store.blockedUntil("claude-code", now + 6000), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("clear lifts a block; sweep drops expired ones; list is sorted by reset", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-avail-"));
  try {
    const store = new AgentAvailabilityStore(dir);
    const now = 1_000_000;
    store.markExhausted("claude-code", now + 9000, undefined, now);
    store.markExhausted("codex", now + 3000, undefined, now);
    assert.deepEqual(store.list(now).map((b) => b.agent), ["codex", "claude-code"], "soonest reset first");
    assert.equal(store.clear("codex"), true);
    assert.equal(store.isBlocked("codex", now), false);
    store.markExhausted("gemini", now + 1000, undefined, now);
    assert.equal(store.sweep(now + 2000), true, "gemini expired and was swept");
    assert.deepEqual(store.list(now + 2000).map((b) => b.agent), ["claude-code"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("blocks persist across store instances (survive a restart)", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-avail-"));
  try {
    const now = 1_000_000;
    new AgentAvailabilityStore(dir).markExhausted("claude-code", now + 5000, "quota", now);
    const reopened = new AgentAvailabilityStore(dir);
    assert.equal(reopened.isBlocked("claude-code", now + 1000), true);
    assert.equal(reopened.list(now)[0]?.reason, "quota");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
