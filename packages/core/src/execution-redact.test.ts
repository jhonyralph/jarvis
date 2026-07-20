import test from "node:test";
import assert from "node:assert/strict";
import { redactExecutionText } from "./execution-redact.js";

test("execution redactor removes common credentials without erasing ordinary tool text", () => {
  const value = redactExecutionText("curl -H 'Authorization: Bearer abcdefghijklmnop' https://user:pass123@example.com TOKEN=super-secret-value npm test");
  assert.equal(value?.includes("abcdefghijklmnop"), false);
  assert.equal(value?.includes("pass123"), false);
  assert.equal(value?.includes("super-secret-value"), false);
  assert.match(value || "", /npm test/);
});

test("execution redactor removes private key blocks", () => {
  const value = redactExecutionText("x\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\ny");
  assert.equal(value, "x\n[REDACTED_PRIVATE_KEY]\ny");
});
