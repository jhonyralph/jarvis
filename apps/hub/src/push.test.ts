/** Logic, destination isolation, reconciliation, and persistence tests for the push module. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushCenter, sanitizeSub, normalizePrefs, cleanText } from "./push.js";

test("sanitizeSub keeps only canonical web-push fields and drops the rest", () => {
  const clean = sanitizeSub({ endpoint: "https://push.example/abc", keys: { p256dh: "k1", auth: "k2" }, evil: "../../x", expirationTime: 123 });
  assert.deepEqual(clean, { endpoint: "https://push.example/abc", keys: { p256dh: "k1", auth: "k2" }, expirationTime: 123 });
  assert.equal((clean as any).evil, undefined, "arbitrary client keys are not persisted");
});

test("sanitizeSub rejects malformed subscriptions", () => {
  assert.equal(sanitizeSub(null), null);
  assert.equal(sanitizeSub({ keys: { p256dh: "a", auth: "b" } }), null, "missing endpoint");
  assert.equal(sanitizeSub({ endpoint: "x" }), null, "missing keys");
  assert.equal(sanitizeSub({ endpoint: "x", keys: { p256dh: "a" } }), null, "missing auth key");
  assert.equal(sanitizeSub({ endpoint: "x".repeat(3000), keys: { p256dh: "a", auth: "b" } }), null, "oversized endpoint");
  assert.equal(sanitizeSub({ endpoint: 5, keys: { p256dh: "a", auth: "b" } }), null, "non-string endpoint");
});

test("normalizePrefs defaults, filters unknown events, and clamps the interval", () => {
  assert.deepEqual(normalizePrefs({}), { events: ["done", "error"], mode: "each", everyMin: 15 });
  assert.deepEqual(
    normalizePrefs({ prefs: { events: ["done", "bogus", "machine"], mode: "grouped", everyMin: 9999 } }),
    { events: ["done", "machine"], mode: "grouped", everyMin: 240 },
  );
  assert.equal(normalizePrefs({ prefs: { everyMin: 0 } }).everyMin, 15, "everyMin 0 is falsy → default");
  assert.equal(normalizePrefs({ prefs: { everyMin: 0.5 } }).everyMin, 1, "a positive sub-1 value floors to 1");
  assert.equal(normalizePrefs({ prefs: { mode: "weird" } }).mode, "each", "unknown mode falls back to each");
});

test("cleanText strips markdown and collapses whitespace", () => {
  assert.equal(cleanText("## **Feito**  `ok`\n\nlinha _dois_"), "Feito ok linha dois");
  assert.equal(cleanText(""), "");
  assert.equal(cleanText(undefined as any), "");
});

test("web subscriptions and status are scoped to the authenticated principal", () => {
  const center = new PushCenter(mkdtempSync(join(tmpdir(), "jarvis-web-push-")));
  const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "key", auth: "auth" } });
  center.addSub(sub("https://push.example/alice"), undefined, { principalId: "alice", deviceId: "phone" });
  center.addSub(sub("https://push.example/bob"), undefined, { principalId: "bob", deviceId: "phone" });
  assert.equal((center.status({ principalId: "alice" }) as any).webSubs, 1);
  assert.equal((center.status({ principalId: "bob" }) as any).webSubs, 1);
  center.removeSub("https://push.example/alice", { principalId: "bob" });
  assert.equal((center.status({ principalId: "alice" }) as any).webSubs, 1);
  center.removeSub("https://push.example/alice", { principalId: "alice" });
  assert.equal((center.status({ principalId: "alice" }) as any).webSubs, 0);
});

test("device purge removes only matching web and native registrations", () => {
  const center = new PushCenter(mkdtempSync(join(tmpdir(), "jarvis-web-push-")));
  const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "key", auth: "auth" } });
  center.addSub(sub("https://push.example/alice-phone"), undefined, { principalId: "alice", deviceId: "phone" });
  center.addSub(sub("https://push.example/alice-tablet"), undefined, { principalId: "alice", deviceId: "tablet" });
  center.handleMsg({ t: "mobile_push_register", token: "native-phone", platform: "android" }, () => undefined, { principalId: "alice", deviceId: "phone" });
  assert.deepEqual(center.purgeTarget({ principalId: "alice", deviceId: "phone" }), { webSubs: 1, mobileTokens: 1 });
  assert.equal((center.status({ principalId: "alice", deviceId: "phone" }) as any).webSubs, 0);
  assert.equal((center.status({ principalId: "alice", deviceId: "tablet" }) as any).webSubs, 1);
});

test("notifyEvent never sends content without an authenticated principal destination", () => {
  const center = new PushCenter(mkdtempSync(join(tmpdir(), "jarvis-web-push-")));
  center.addSub({ endpoint: "https://push.example/alice", keys: { p256dh: "key", auth: "auth" } }, undefined, { principalId: "alice", deviceId: "phone" });
  let webSends = 0;
  let mobileSends = 0;
  (center as any).sendPush = async () => { webSends += 1; return true; };
  (center as any).mobile.notify = async () => { mobileSends += 1; };

  center.notifyEvent("done", "title", "body", "tag", { principalId: "alice" });
  assert.deepEqual({ webSends, mobileSends }, { webSends: 1, mobileSends: 1 }, "positive control reaches both transports");

  webSends = 0;
  mobileSends = 0;
  center.notifyEvent("done", "title", "body", "tag");
  center.notifyEvent("done", "title", "body", "tag", { deviceId: "phone" });
  assert.deepEqual({ webSends, mobileSends }, { webSends: 0, mobileSends: 0 });
});

test("unknown-device purge reconciles web and native registrations by the complete identity pair", () => {
  const center = new PushCenter(mkdtempSync(join(tmpdir(), "jarvis-web-push-")));
  const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "key", auth: "auth" } });
  center.addSub(sub("https://push.example/alice-phone"), undefined, { principalId: "alice", deviceId: "phone" });
  center.addSub(sub("https://push.example/alice-tablet"), undefined, { principalId: "alice", deviceId: "tablet" });
  center.addSub(sub("https://push.example/unattributed"));
  center.handleMsg({ t: "mobile_push_register", token: "alice-phone", platform: "android" }, () => undefined, { principalId: "alice", deviceId: "phone" });
  center.handleMsg({ t: "mobile_push_register", token: "alice-tablet", platform: "android" }, () => undefined, { principalId: "alice", deviceId: "tablet" });
  center.handleMsg({ t: "mobile_push_register", token: "unattributed", platform: "android" }, () => undefined);

  assert.deepEqual(
    center.purgeUnknownDevices(new Set([{ principalId: "alice", deviceId: "phone" }]), true),
    { webSubs: 2, mobileTokens: 2 },
  );
  const status = center.status({ principalId: "alice", deviceId: "phone" }) as any;
  assert.equal(status.webSubs, 1);
  assert.equal(status.mobileTokens, 1);
});

test("unknown-device purge is fail-safe and auth-off preserves local registrations", () => {
  const center = new PushCenter(mkdtempSync(join(tmpdir(), "jarvis-web-push-")));
  const sub = { endpoint: "https://push.example/local", keys: { p256dh: "key", auth: "auth" } };
  center.addSub(sub);
  center.handleMsg({ t: "mobile_push_register", token: "local", platform: "android" }, () => undefined);
  const throwingSnapshot = {
    *[Symbol.iterator](): Iterator<{ principalId: string; deviceId: string }> {
      yield { principalId: "local", deviceId: "local" };
      throw new Error("incomplete auth snapshot");
    },
  };

  assert.deepEqual(center.purgeUnknownDevices(undefined, true), { webSubs: 0, mobileTokens: 0 });
  assert.deepEqual(center.purgeUnknownDevices(throwingSnapshot, true), { webSubs: 0, mobileTokens: 0 });
  assert.deepEqual(center.purgeUnknownDevices([], false), { webSubs: 0, mobileTokens: 0 });
  assert.deepEqual(center.purgeUnknownDevices([], true), { webSubs: 1, mobileTokens: 1 }, "an explicit empty auth snapshot is authoritative");
});

test("push persistence uses private POSIX modes", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-web-push-mode-"));
  chmodSync(dir, 0o755);
  const center = new PushCenter(dir);
  center.addSub({ endpoint: "https://push.example/one", keys: { p256dh: "key", auth: "auth" } });
  center.addSub({ endpoint: "https://push.example/two", keys: { p256dh: "key", auth: "auth" } });

  assert.equal(statSync(dir).mode & 0o777, 0o700);
  for (const file of ["vapid.json", "push-subs.json", "push-subs.json.bak"]) {
    assert.equal(statSync(join(dir, file)).mode & 0o777, 0o600, `${file} must be owner-only`);
  }

  chmodSync(join(dir, "vapid.json"), 0o644);
  new PushCenter(dir);
  assert.equal(statSync(join(dir, "vapid.json")).mode & 0o777, 0o600, "existing private-key files are tightened on load");
});
