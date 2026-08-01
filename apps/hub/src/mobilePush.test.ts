import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync } from "node:fs";
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

test("native tokens are attributed to a principal and cannot be removed by another principal", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-push-"));
  const mp = new MobilePush(dir);
  mp.register("tok-private", "android", ["done"], { principalId: "alice", deviceId: "phone" });
  assert.equal(mp.status({ principalId: "alice" }).tokens, 1);
  assert.equal(mp.status({ principalId: "bob" }).tokens, 0);
  mp.remove("tok-private", { principalId: "bob" });
  assert.equal(mp.count(), 1);
  mp.remove("tok-private", { principalId: "alice" });
  assert.equal(mp.count(), 0);
});

test("device purge removes only the revoked principal and device", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-push-"));
  const mp = new MobilePush(dir);
  mp.register("alice-phone", "android", ["done"], { principalId: "alice", deviceId: "phone" });
  mp.register("alice-tablet", "android", ["done"], { principalId: "alice", deviceId: "tablet" });
  mp.register("bob-phone", "android", ["done"], { principalId: "bob", deviceId: "phone" });
  assert.equal(mp.purgeTarget({ principalId: "alice", deviceId: "phone" }), 1);
  assert.equal(mp.status({ principalId: "alice" }).tokens, 1);
  assert.equal(mp.status({ principalId: "bob" }).tokens, 1);
});

test("unknown-device purge keeps only authenticated principal/device pairs", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-push-"));
  const mp = new MobilePush(dir);
  mp.register("alice-phone", "android", ["done"], { principalId: "alice", deviceId: "phone" });
  mp.register("alice-tablet", "android", ["done"], { principalId: "alice", deviceId: "tablet" });
  mp.register("bob-phone", "android", ["done"], { principalId: "bob", deviceId: "phone" });
  mp.register("unattributed", "android", ["done"]);

  assert.equal(mp.purgeUnknownDevices(new Set([
    { principalId: "alice", deviceId: "phone" },
    { principalId: "bob", deviceId: "phone" },
  ]), true), 2);
  const onDisk = JSON.parse(readFileSync(join(dir, "mobile-push.json"), "utf8"));
  assert.deepEqual(onDisk.map((row: any) => row.token), ["alice-phone", "bob-phone"]);
});

test("unknown-device purge validates the whole snapshot and bypasses auth-off", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-push-"));
  const mp = new MobilePush(dir);
  mp.register("local", "android", ["done"]);
  const throwingSnapshot = {
    *[Symbol.iterator](): Iterator<{ principalId: string; deviceId: string }> {
      yield { principalId: "local", deviceId: "local" };
      throw new Error("incomplete auth snapshot");
    },
  };

  assert.equal(mp.purgeUnknownDevices(undefined, true), 0);
  assert.equal(mp.purgeUnknownDevices([{ principalId: "local", deviceId: "" }], true), 0);
  assert.equal(mp.purgeUnknownDevices(throwingSnapshot, true), 0);
  assert.equal(mp.purgeUnknownDevices([], false), 0);
  assert.equal(mp.count(), 1);
  assert.equal(mp.purgeUnknownDevices([], true), 1, "an explicit empty auth snapshot is authoritative");
});

test("mobile token persistence uses private POSIX modes", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-push-mode-"));
  chmodSync(dir, 0o755);
  const mp = new MobilePush(dir);
  mp.register("one", "android");
  mp.register("two", "android");

  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, "mobile-push.json")).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "mobile-push.json.bak")).mode & 0o777, 0o600);

  chmodSync(join(dir, "mobile-push.json"), 0o644);
  new MobilePush(dir);
  assert.equal(statSync(join(dir, "mobile-push.json")).mode & 0o777, 0o600, "existing token files are tightened on load");
});
