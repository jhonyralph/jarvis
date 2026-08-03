import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "@jarvis/core";
import { PersonalSessionBindings } from "./personalSessionBindings.js";

test("personal session binding persists and only permits its principal", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-bindings-"));
  const file = join(root, "hub", "personal-session-bindings.json");
  const first = new PersonalSessionBindings(file, () => 1234);
  assert.equal(first.allows("local", "session-a", "alice"), true);
  assert.equal(first.claim("local", "session-a", "alice").boundAt, 1234);
  assert.equal(first.allows("local", "session-a", "alice"), true);
  assert.equal(first.allows("local", "session-a", "bob"), false);
  assert.throws(() => first.claim("local", "session-a", "bob"), /another user/);

  const reloaded = new PersonalSessionBindings(file, () => 9999);
  assert.equal(reloaded.get("local", "session-a")?.principalId, "alice");
  assert.equal(reloaded.get("local", "session-a")?.boundAt, 1234);
  assert.equal(reloaded.capture("local", "session-a").generation, 1);
});

test("native alias ownership survives deletion of only its managed alias and restart", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-bindings-"));
  const file = join(root, "bindings.json");
  const bindings = new PersonalSessionBindings(file, () => 100);
  bindings.claimMany("local", ["managed-a", "claude:native-a"], "alice");

  assert.equal(bindings.remove("local", "managed-a"), true);
  assert.equal(bindings.get("local", "managed-a"), undefined);
  assert.equal(bindings.get("local", "claude:native-a")?.principalId, "alice");

  const restarted = new PersonalSessionBindings(file);
  assert.equal(restarted.allows("local", "claude:native-a", "alice"), true);
  assert.equal(restarted.allows("local", "claude:native-a", "bob"), false);
});

test("a stale remote delete generation cannot remove a newer owner", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-bindings-"));
  const bindings = new PersonalSessionBindings(join(root, "bindings.json"));
  bindings.claim("runner-1", "session-a", "alice");
  const staleDelete = bindings.capture("runner-1", "session-a");

  bindings.remove("runner-1", "session-a");
  bindings.claim("runner-1", "session-a", "bob");

  assert.equal(bindings.invalidateIfCurrent(staleDelete), false);
  assert.equal(bindings.get("runner-1", "session-a")?.principalId, "bob");
});

test("binding generations invalidate an unbound session for delayed indexing", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-bindings-"));
  const bindings = new PersonalSessionBindings(join(root, "bindings.json"));
  const indexingLease = bindings.capture("runner-1", "session-a");

  assert.equal(bindings.remove("runner-1", "session-a"), false);
  assert.equal(bindings.matches(indexingLease), false);
  assert.equal(new PersonalSessionBindings(join(root, "bindings.json")).capture("runner-1", "session-a").generation, 1);
});

test("corrupt primary and backup fail closed instead of loading an empty allow-all store", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-bindings-"));
  const file = join(root, "bindings.json");
  writeFileSync(file, "{broken-primary");
  writeFileSync(`${file}.bak`, "{broken-backup");
  assert.throws(() => new PersonalSessionBindings(file), /store is corrupt/);
});

test("a valid backup recovers a corrupt primary", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-bindings-"));
  const file = join(root, "bindings.json");
  writeFileSync(file, "{broken-primary");
  writeFileSync(`${file}.bak`, JSON.stringify({ version: 1, bindings: [{ runnerId: "local", sessionId: "session-a", principalId: "alice", boundAt: 1 }] }));
  assert.equal(new PersonalSessionBindings(file).get("local", "session-a")?.principalId, "alice");
});

test("remove rolls back its in-memory row and generation when persistence fails", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-personal-bindings-"));
  const file = join(root, "bindings.json");
  let fail = false;
  const bindings = new PersonalSessionBindings(file, () => 1, (path, data, opts) => {
    if (fail) throw new Error("disk full");
    writeJsonAtomic(path, data, opts);
  });
  bindings.claim("local", "session-a", "alice");
  const before = bindings.capture("local", "session-a");
  fail = true;

  assert.throws(() => bindings.remove("local", "session-a"), /disk full/);
  assert.deepEqual(bindings.capture("local", "session-a"), before);
  assert.equal(bindings.get("local", "session-a")?.principalId, "alice");
  assert.equal(new PersonalSessionBindings(file).get("local", "session-a")?.principalId, "alice");
});
