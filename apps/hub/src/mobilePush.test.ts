import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MobilePush } from "./mobilePush.js";

test("register upserts a token with a filtered event list; persists", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-push-"));
  const mp = new MobilePush(dir);
  mp.register("tok-A", "android", ["done", "bogus", "machine"]);
  assert.equal(mp.count(), 1);
  // re-register same token = update, not duplicate
  mp.register("tok-A", "ios", ["error"]);
  assert.equal(mp.count(), 1);

  const onDisk = JSON.parse(readFileSync(join(dir, "mobile-push.json"), "utf8"));
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].platform, "ios");
  assert.deepEqual(onDisk[0].events, ["error"], "unknown kinds are dropped");

  // reload from disk keeps state
  const mp2 = new MobilePush(dir);
  assert.equal(mp2.count(), 1);
});

test("bad/empty events default to done+error; remove works", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-push-"));
  const mp = new MobilePush(dir);
  mp.register("tok-B", "android");
  const onDisk = JSON.parse(readFileSync(join(dir, "mobile-push.json"), "utf8"));
  assert.deepEqual(onDisk[0].events, ["done", "error"]);
  mp.register("", "android"); // empty token ignored
  assert.equal(mp.count(), 1);
  mp.remove("tok-B");
  assert.equal(mp.count(), 0);
});

test("notify is a safe no-op when FCM isn't configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-push-"));
  const prev = process.env.JARVIS_FCM_SA;
  delete process.env.JARVIS_FCM_SA;
  try {
    const mp = new MobilePush(dir);
    mp.register("tok-C", "android", ["done"]);
    await mp.notify("done", "t", "b"); // must not throw, must not hit the network
    assert.ok(true);
  } finally {
    if (prev !== undefined) process.env.JARVIS_FCM_SA = prev;
  }
});
