/**
 * Pure-logic tests for the extracted push module (push.ts). These cover the parts that used to be
 * buried in the Hub god-file with no coverage: subscription sanitization (what reaches disk),
 * prefs normalization (applied at read AND write), and body cleaning. No PushCenter instance is
 * created (its constructor touches web-push + the filesystem); only the pure exports are exercised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSub, normalizePrefs, cleanText } from "./push.js";

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
