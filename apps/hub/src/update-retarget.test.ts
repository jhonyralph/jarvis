/** Retarget policy: re-aim a stuck/in-flight update at a newer Hub commit, never a blocked one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { retargetTarget, commitPrefixMatch } from "./update-retarget.js";

test("retargets when the Hub moved past the pinned target", () => {
  assert.equal(retargetTarget({ state: "sent", targetCommit: "aa11" }, "bb22"), "bb22");
  assert.equal(retargetTarget({ state: "queued", targetCommit: "aa11" }, "bb22"), "bb22");
  assert.equal(retargetTarget({ state: "awaiting_restart", targetCommit: "aa11" }, "bb22"), "bb22");
});

test("keeps the target when already aimed at the Hub commit (short vs full sha)", () => {
  assert.equal(retargetTarget({ state: "sent", targetCommit: "aa11" }, "aa11"), null);
  assert.equal(retargetTarget({ state: "sent", targetCommit: "aa11bb22cc33" }, "aa11"), null); // full pinned, short hub
  assert.equal(retargetTarget({ state: "sent", targetCommit: "aa11" }, "aa11bb22cc33"), null); // short pinned, full hub
});

test("a blocked update is never retargeted (needs the owner)", () => {
  assert.equal(retargetTarget({ state: "blocked", targetCommit: "aa11" }, "bb22"), null);
});

test("no retarget when the Hub commit is unknown", () => {
  assert.equal(retargetTarget({ state: "sent", targetCommit: "aa11" }, ""), null);
});

test("a dirty Hub tree retargets to its committed sha (dirty stripped)", () => {
  assert.equal(retargetTarget({ state: "sent", targetCommit: "aa11" }, "bb22+dirty"), "bb22");
  assert.equal(retargetTarget({ state: "sent", targetCommit: "bb22" }, "bb22+dirty"), null); // same commit, just dirty
});

test("commitPrefixMatch handles short/full/dirty and empties", () => {
  assert.equal(commitPrefixMatch("aa11", "aa11bb22"), true);
  assert.equal(commitPrefixMatch("aa11+dirty", "aa11"), true);
  assert.equal(commitPrefixMatch("aa11", "bb22"), false);
  assert.equal(commitPrefixMatch("", "aa11"), false);
  assert.equal(commitPrefixMatch("aa11", ""), false);
});
