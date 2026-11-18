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

test("execution redactor removes GitHub tokens with their real underscore prefixes (issue #2)", () => {
  // O caso relatado: token puro dentro de JSON (o "TOKEN=" não casa por causa da aspa antes do ":").
  const json = redactExecutionText('{"access_token": "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"}');
  assert.equal(json, '{"access_token": "[REDACTED_TOKEN]"}');
  for (const token of [
    "gho_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "ghu_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "ghs_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "ghr_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGH",
    // Chave do Stripe montada na hora: escrita inteira, tem formato de chave real e o GitHub barra o push.
    ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_"), ["sk", "test", "abcdefghijklmnopqrstuvwx"].join("_"),
  ]) assert.equal(redactExecutionText(`echo ${token} done`), "echo [REDACTED_TOKEN] done", token);
  // Os separadores que já funcionavam continuam.
  assert.equal(redactExecutionText("key sk-ant-abcdefghijklmnop1234 xoxb-1234567890-abcdefghij"), "key [REDACTED_TOKEN] [REDACTED_TOKEN]");
  // Texto comum parecido não some.
  assert.equal(redactExecutionText("ghost_town task-runner gh_pr ghp_short"), "ghost_town task-runner gh_pr ghp_short");
});

test("execution redactor removes every private key kind, even when the output was cut (issue #2)", () => {
  for (const kind of ["ENCRYPTED PRIVATE KEY", "DSA PRIVATE KEY", "RSA PRIVATE KEY", "PGP PRIVATE KEY BLOCK"]) {
    assert.equal(redactExecutionText(`x\n-----BEGIN ${kind}-----\nMIIsecret\n-----END ${kind}-----\ny`), "x\n[REDACTED_PRIVATE_KEY]\ny", kind);
  }
  assert.equal(redactExecutionText("a\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk...(cortado)"), "a\n[REDACTED_PRIVATE_KEY]", "sem END: esconde até o fim");
  assert.equal(redactExecutionText("-----BEGIN PUBLIC KEY-----\nMIIpublic\n-----END PUBLIC KEY-----"), "-----BEGIN PUBLIC KEY-----\nMIIpublic\n-----END PUBLIC KEY-----", "chave pública fica");
});
