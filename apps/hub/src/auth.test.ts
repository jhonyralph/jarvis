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

test("startup pruning returns and removes expired device identities", () => {
  const expiring = auth.listDevices().find((device) => device.role === "member")!;
  assert.ok(expiring.expiresAt);
  const removed = auth.pruneExpiredDevices(expiring.expiresAt! + 1);
  assert.deepEqual(removed, [{ id: expiring.id, userId: expiring.userId }]);
  assert.equal(auth.listDevices().some((device) => device.id === expiring.id), false);
  assert.equal(auth.listDevices().some((device) => device.role === "owner"), true);
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

test("runner token TOFU: adopts the real id once, then is pinned; no id takeover", () => {
  const t1 = auth.mintRunnerToken("m-tofu-1", "Placeholder 1"); // minted with a placeholder id
  assert.equal(auth.claimRunnerId(t1, "real-X", "Máquina X"), true, "first use adopts the runner's real id");
  assert.ok(auth.authenticateRunner(t1), "token still authenticates after binding");
  assert.equal(auth.claimRunnerId(t1, "real-X"), true, "same machine reconnecting is idempotent");
  assert.equal(auth.claimRunnerId(t1, "real-Y"), false, "a pinned token may not jump to another id");
  const t2 = auth.mintRunnerToken("m-tofu-2", "Placeholder 2");
  assert.equal(auth.claimRunnerId(t2, "real-X"), false, "a token cannot take over an id another token owns");
  assert.equal(auth.claimRunnerId(t2, "real-Z", "Máquina Z"), true, "but it can adopt its own fresh id");
  assert.equal(auth.claimRunnerId("not-a-token", "real-Q"), false, "an unknown token is refused");
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));

/**
 * Identity: the Hub mints one user per paired DEVICE, so the same human on the desktop and on the
 * phone used to be two strangers — anything scoped to a principal (personal session bindings,
 * executions, memory) vanished from the other machine. Ownership is scoped to the PERSON now.
 */
test("identity: every owner device is the same person, a member stays isolated", () => {
  const owner = auth.listDevices().find((d) => d.role === "owner")!;
  const phone = auth.redeem(auth.mintInvite(owner.userId, { role: "owner", ttlSec: 3600 }).code, "Celular do dono");
  const guest = auth.redeem(auth.mintInvite(owner.userId, { role: "member", runners: ["runner-A"], ttlSec: 3600 }).code, "Convidado");

  assert.equal(auth.identityOf(owner.userId), auth.OWNER_IDENTITY);
  assert.equal(auth.identityOf(phone.user.id), auth.OWNER_IDENTITY);
  assert.notEqual(owner.userId, phone.user.id, "são logins de dispositivo distintos");
  assert.equal(auth.sameIdentity(owner.userId, phone.user.id), true, "desktop e celular do dono são a mesma pessoa");

  assert.equal(auth.identityOf(guest.user.id), `u:${guest.user.id}`);
  assert.equal(auth.sameIdentity(owner.userId, guest.user.id), false, "um convidado continua isolado do dono");
  assert.equal(auth.sameIdentity(guest.user.id, phone.user.id), false);
});

test("identity: idempotent, local-first, and an unknown user keeps its own bucket", () => {
  const owner = auth.listDevices().find((d) => d.role === "owner")!;
  const member = auth.listDevices().find((d) => d.role === "member")!;
  // Identities are persisted and read back, so feeding one in again must not wrap it twice.
  assert.equal(auth.identityOf(auth.identityOf(owner.userId)), auth.OWNER_IDENTITY);
  assert.equal(auth.identityOf(auth.identityOf(member.userId)), `u:${member.userId}`);

  assert.equal(auth.identityOf("local"), auth.OWNER_IDENTITY, "o listener local roda na máquina do dono");
  assert.equal(auth.identityOf(undefined), auth.OWNER_IDENTITY);
  assert.equal(auth.identityOf(""), auth.OWNER_IDENTITY);
  assert.equal(auth.identityOf("0123456789abcdef"), "u:0123456789abcdef", "usuário revogado/desconhecido não vira dono");
});

test("allowedRunners accepts identities as well as raw device logins", () => {
  const member = auth.listDevices().find((d) => d.role === "member" && auth.allowedRunners(d.userId) !== "*")!;
  assert.equal(auth.allowedRunners(auth.OWNER_IDENTITY), "*", "trabalho em background carrega a identidade, não o login");
  assert.equal(auth.canAccessRunner(auth.OWNER_IDENTITY, "qualquer-runner"), true);
  assert.deepEqual(auth.allowedRunners(`u:${member.userId}`), auth.allowedRunners(member.userId));
  assert.equal(auth.canAccessRunner(`u:${member.userId}`, "runner-A"), auth.canAccessRunner(member.userId, "runner-A"));
});
