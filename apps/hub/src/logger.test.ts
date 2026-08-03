/** Structured logger: levels gate writes, enable/disable, retention purge, size rotation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubLogger } from "./logger.js";

function dayFileNames(dir: string): string[] {
  const logs = join(dir, "logs");
  return existsSync(logs) ? readdirSync(logs).filter((n) => n.endsWith(".jsonl")) : [];
}
function readAll(dir: string): any[] {
  const logs = join(dir, "logs");
  if (!existsSync(logs)) return [];
  return readdirSync(logs).flatMap((n) => readFileSync(join(logs, n), "utf8").split(/\n/).filter(Boolean).map((l) => JSON.parse(l)));
}

test("level gates which events are written", () => {
  const dir = mkdtempSync(join(tmpdir(), "jlog-"));
  try {
    const l = new HubLogger(dir);
    l.configure({ enabled: true, level: "warn" }, false);
    l.error("e"); l.warn("w"); l.info("i"); l.debug("d");
    const evs = readAll(dir).map((r) => r.ev).sort();
    assert.deepEqual(evs, ["e", "w"], "info/debug below the warn threshold are dropped");
    const entry = readAll(dir).find((r) => r.ev === "w");
    assert.equal(entry.lvl, "warn"); assert.match(entry.t, /^\d{4}-\d\d-\d\dT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("disabled writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "jlog-"));
  try {
    const l = new HubLogger(dir);
    l.configure({ enabled: false, level: "trace" }, false);
    l.error("e"); l.info("i");
    assert.equal(dayFileNames(dir).length, 0);
    assert.equal(l.isEnabled("error"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("fields are merged into the entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "jlog-"));
  try {
    const l = new HubLogger(dir);
    l.configure({ enabled: true, level: "info" }, false);
    l.info("turn", { traceId: "t1", sessionId: "s1", durationMs: 1234, tokens: 42, costUsd: 0.001, ok: true });
    const e = readAll(dir)[0];
    assert.equal(e.ev, "turn"); assert.equal(e.traceId, "t1"); assert.equal(e.durationMs, 1234); assert.equal(e.ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("configure persists to log-config.json and reloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "jlog-"));
  try {
    new HubLogger(dir).configure({ enabled: false, level: "debug", retentionDays: 3, maxFileMb: 7 }, true);
    const reopened = new HubLogger(dir).getConfig();
    assert.equal(reopened.enabled, false); assert.equal(reopened.level, "debug"); assert.equal(reopened.retentionDays, 3); assert.equal(reopened.maxFileMb, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("purgeOld removes daily files older than retentionDays", () => {
  const dir = mkdtempSync(join(tmpdir(), "jlog-"));
  try {
    const logs = join(dir, "logs"); mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, "jarvis-20200101.jsonl"), "{}\n");
    writeFileSync(join(logs, "jarvis-20991231.jsonl"), "{}\n");
    const old = new Date("2020-01-01").getTime(); utimesSync(join(logs, "jarvis-20200101.jsonl"), old / 1000, old / 1000);
    const l = new HubLogger(dir); l.configure({ retentionDays: 14 }, false);
    const removed = l.purgeOld(Date.now());
    assert.equal(removed, 1);
    assert.ok(!existsSync(join(logs, "jarvis-20200101.jsonl")));
    assert.ok(existsSync(join(logs, "jarvis-20991231.jsonl")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("size guard rotates the day file to .1", () => {
  const dir = mkdtempSync(join(tmpdir(), "jlog-"));
  try {
    const l = new HubLogger(dir);
    l.configure({ enabled: true, level: "info", maxFileMb: 1 }, false);
    const big = "x".repeat(200 * 1024);
    for (let i = 0; i < 12; i++) l.info("bulk", { pad: big }); // ~2.4MB total → crosses 1MB and rotates
    const names = dayFileNames(dir);
    assert.ok(names.some((n) => n.endsWith(".1.jsonl")), `expected a rotated .1 file, got ${names}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
