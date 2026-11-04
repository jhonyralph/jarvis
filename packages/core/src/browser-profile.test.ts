import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareBrowserProfile } from "./browser-profile.js";

function fixture(t: test.TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-browser-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("fresh Windows browser profile suppresses blank-password probing without allowing blank-password auth", async (t) => {
  const dir = fixture(t);
  await prepareBrowserProfile(dir, "win32");
  const state = JSON.parse(readFileSync(join(dir, "Local State"), "utf8"));
  assert.equal(state.password_manager.os_password_blank, false);
  const stamp = state.password_manager.os_password_last_changed;
  assert.equal(typeof stamp, "string", "Chromium int64 preferences reject JSON numbers");
  const now = (BigInt(Date.now()) + 11_644_473_600_000n) * 1_000n;
  assert.ok(BigInt(stamp) > now && BigInt(stamp) <= now + 60_000_000n);
  assert.deepEqual(readdirSync(dir), ["Local State"], "atomic write leaves no temporary file");
});

test("existing profile keeps encryption keys and unrelated preferences on repeated preparations", async (t) => {
  const dir = fixture(t), file = join(dir, "Local State");
  writeFileSync(file, JSON.stringify({ os_crypt: { encrypted_key: "fixture-key" }, profile: { last_used: "Default" },
    password_manager: { unrelated: true, os_password_blank: true, os_password_last_changed: "1" } }));
  await prepareBrowserProfile(dir, "win32");
  await prepareBrowserProfile(dir, "win32");
  const state = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(state.os_crypt, { encrypted_key: "fixture-key" });
  assert.deepEqual(state.profile, { last_used: "Default" });
  assert.equal(state.password_manager.unrelated, true);
  assert.equal(state.password_manager.os_password_blank, false);
});

test("corrupt or unexpected Local State is preserved and blocks browser launch", async (t) => {
  const file = join(fixture(t), "Local State"), dir = file.slice(0, -"Local State".length);
  for (const invalid of ['{"os_crypt":', "null", "[]", '{"password_manager":42}']) {
    writeFileSync(file, invalid);
    await assert.rejects(prepareBrowserProfile(dir, "win32"));
    assert.equal(readFileSync(file, "utf8"), invalid);
  }
});

test("other operating systems do not change browser state", async (t) => {
  const dir = fixture(t);
  await prepareBrowserProfile(dir, "linux"); await prepareBrowserProfile(dir, "darwin");
  assert.deepEqual(readdirSync(dir), []);
});
