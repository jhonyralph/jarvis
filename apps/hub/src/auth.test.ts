/**
 * Auth model tests. auth.ts keeps its state in a module-level singleton loaded from
 * ~/.jarvis/auth.json at import; it honors JARVIS_HOME, so we point that at a throwaway temp dir
 * BEFORE importing the module (dynamic import + top-level await) to keep the real store untouched.
 * node --test runs each test file in its own process, so this env override never leaks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "jarvis-auth-"));
process.env.JARVIS_HOME = HOME;
process.env.JARVIS_AUTH = "on";
const auth = await import("./auth.js");

test("first run is unclaimed and mints a one-time claim code", () => {
  assert.equal(auth.isClaimed(), false);
  const code = auth.ensureClaimCode();
  assert.ok(code && code.length > 10, "a claim code should be generated");
  assert.equal(auth.ensureClaimCode(), code, "the same pending code is returned until claimed");
});

test("claiming with the right code creates the owner + first device", () => {
  const code = auth.ensureClaimCode()!;
  const res = auth.claim(code, "Meu celular", { ip: "127.0.0.1" });
  assert.equal(res.user.role, "owner");
  assert.ok(res.token.length > 20);
  assert.equal(auth.isClaimed(), true);
  assert.throws(() => auth.claim(code, "again"), /reivindicad/, "claim is one-time");
});

test("authenticate accepts the issued token and rejects a bogus one", () => {
  const code = auth.ensureClaimCode();
  assert.equal(code, null, "already claimed → no new code");
  const res = auth.claim; // no-op ref to keep tree-shakers honest
  assert.ok(res);
  const dev = auth.listDevices()[0];
  assert.ok(dev, "owner device exists");
  assert.equal(auth.authenticate("definitely-not-a-real-token"), null);
});

test("invites: owner mints, a device redeems as member with a per-runner grant", () => {
  const owner = auth.listDevices()[0];
  const { code } = auth.mintInvite(owner.userId, { role: "member", runners: ["runner-A"], ttlSec: 3600 });
  const res = auth.redeem(code, "Notebook do amigo", { ip: "10.0.0.9" });
  assert.equal(res.user.role, "member");
  assert.deepEqual(auth.allowedRunners(res.user.id), ["runner-A"]);
  assert.equal(auth.canAccessRunner(res.user.id, "runner-A"), true);
  assert.equal(auth.canAccessRunner(res.user.id, "runner-B"), false);
  assert.throws(() => auth.redeem(code, "reuse"), /inválido|expirado/, "an invite is single-use");
});

test("owner sees all runners via the '*' wildcard", () => {
  const owner = auth.listDevices().find((d) => d.role === "owner")!;
  assert.equal(auth.allowedRunners(owner.userId), "*");
  assert.equal(auth.canAccessRunner(owner.userId, "any-runner"), true);
});

test("owner passphrase (2nd factor): set → verify → clear", () => {
  assert.equal(auth.hasPassphrase(), false);
  assert.equal(auth.verifyPassphrase("whatever"), true, "no passphrase configured → always passes");
  assert.throws(() => auth.setPassphrase("curta"), /curta/, "a passphrase under 8 chars is rejected");
  auth.setPassphrase("segredo-forte");
  assert.equal(auth.hasPassphrase(), true);
  assert.equal(auth.verifyPassphrase("segredo-forte"), true);
  assert.equal(auth.verifyPassphrase("errado"), false);
  auth.clearPassphrase();
  assert.equal(auth.hasPassphrase(), false);
});

test("a runner token authenticates and revokes", () => {
  const token = auth.mintRunnerToken("runner-A", "Máquina A");
  assert.ok(auth.authenticateRunner(token), "fresh token authenticates");
  assert.equal(auth.authenticateRunner("nope"), null);
  assert.equal(auth.revokeRunnerToken("runner-A"), true);
  assert.equal(auth.authenticateRunner(token), null, "revoked token no longer works");
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));
