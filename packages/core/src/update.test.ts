import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autonomousUpdateAttempt, gitErrorDetail, resolveCommit, runnerSelfUpdateDecision, updateApply, updateCheck, updatePreflight, updateRollback } from "./update.js";

const run = (cwd: string, command: string, args: string[] = []): string => String(execFileSync(command, args, { cwd, windowsHide: true, encoding: "utf8" })).trim();
const git = (cwd: string, ...args: string[]): string => run(cwd, "git", args);

test("runnerSelfUpdateDecision only auto-updates clean idle runners behind origin", () => {
  const base = { supported: true, current: "aaa", clean: true, behind: 2, ahead: 0, latest: { sha: "bbb", subject: "v2", date: "2026-07-20T00:00:00Z" } };

  assert.deepEqual(runnerSelfUpdateDecision(base), { update: true, reason: "2 commit(s) atrás de origin", targetCommit: "bbb" });
  assert.equal(runnerSelfUpdateDecision(base, { busy: true }).update, false);
  assert.equal(runnerSelfUpdateDecision(base, { updateInProgress: true }).update, false);
  assert.equal(runnerSelfUpdateDecision({ ...base, clean: false }).update, false);
  assert.equal(runnerSelfUpdateDecision({ ...base, ahead: 1 }).update, false);
  assert.equal(runnerSelfUpdateDecision({ ...base, behind: 0 }).update, false);
  assert.deepEqual(runnerSelfUpdateDecision({ ...base, latest: undefined }), { update: false, reason: "origin tem atualização, mas o commit alvo não foi resolvido", retryable: true });
  assert.deepEqual(runnerSelfUpdateDecision({ ...base, error: "fetch falhou" }), { update: false, reason: "fetch falhou", retryable: true });
});

test("updatePreflight só derruba o processo quando o update tem chance de dar certo", () => {
  const ok = { status: { supported: true, clean: true, ahead: 0 }, targetResolved: true, targetCommit: "abc1234567890" };

  assert.equal(updatePreflight(ok).proceed, true);
  // Instalação sem git: insistir é inútil — e cada tentativa custava a máquina fora do ar.
  assert.deepEqual(updatePreflight({ ...ok, status: { supported: false, clean: true, ahead: 0, error: "não é um repositório git" } }),
    { proceed: false, retryable: false, reason: "não é um repositório git" });
  // Fetch quebrado: recusa ANTES de matar o runner, e devolve o motivo real para o dono.
  assert.deepEqual(updatePreflight({ ...ok, status: { supported: true, clean: true, ahead: 0, error: "git fetch falhou: ref rejeitada" } }),
    { proceed: false, retryable: true, reason: "git fetch falhou: ref rejeitada" });
  const missing = updatePreflight({ ...ok, targetResolved: false });
  assert.equal(missing.proceed, false); assert.equal(missing.retryable, true); assert.match(missing.reason, /abc123456789.*não existe neste checkout/);
  assert.equal(updatePreflight({ ...ok, status: { supported: true, clean: false, ahead: 0 } }).proceed, false);
  assert.equal(updatePreflight({ ...ok, status: { supported: true, clean: false, ahead: 0 }, force: true }).proceed, true, "force é o consentimento explícito do dono");
  assert.equal(updatePreflight({ ...ok, status: { supported: true, clean: true, ahead: 2 } }).proceed, false);
  assert.equal(updatePreflight({ ...ok, status: { supported: true, clean: true, ahead: 2 }, force: true }).proceed, true);
});

test("updatePreflight NÃO recusa um runner limpo já no alvo (o force do Hub existe para reiniciar)", () => {
  // Invariante do handshake: git no alvo não prova que o PROCESSO subiu no código novo, então o Hub
  // re-entrega com force. Recusar aqui deixaria a máquina presa em quarentena de protocolo.
  assert.equal(updatePreflight({ status: { supported: true, clean: true, ahead: 0 }, targetResolved: true, targetCommit: "abc1234", force: true }).proceed, true);
});

test("autonomousUpdateAttempt para de insistir sozinho no mesmo alvo, e reabre em alvo novo", () => {
  const first = autonomousUpdateAttempt(undefined, "abc1234");
  assert.equal(first.allow, true); assert.equal(first.failures, 1);

  const second = autonomousUpdateAttempt({ target: "abc1234", failures: 1 }, "abc1234");
  assert.equal(second.allow, true); assert.equal(second.failures, 2);

  const blocked = autonomousUpdateAttempt({ target: "abc1234", failures: 2 }, "abc1234");
  assert.equal(blocked.allow, false); assert.match(blocked.reason, /já tentei 2x/);

  // Release nova = alvo novo: crédito renovado (o problema pode ter sido justamente o commit velho).
  const newTarget = autonomousUpdateAttempt({ target: "abc1234", failures: 9 }, "def5678");
  assert.equal(newTarget.allow, true); assert.equal(newTarget.failures, 1);
  // Registro corrompido/parcial não pode travar a máquina para sempre.
  assert.equal(autonomousUpdateAttempt({ failures: 99 } as any, "abc1234").allow, true);
});

test("gitErrorDetail prefere o stderr do git à mensagem genérica do execFile", () => {
  assert.equal(gitErrorDetail({ message: "Command failed: git fetch", stderr: "  error: cannot lock ref\n  fatal: bad\n" }),
    "error: cannot lock ref fatal: bad");
  assert.equal(gitErrorDetail({ message: "spawn git ENOENT" }), "spawn git ENOENT");
  assert.equal(gitErrorDetail(new Error("boom")), "boom");
  assert.equal(gitErrorDetail("string solta"), "string solta");
});

function writeFixture(root: string, verifyOk: boolean, marker: string): void {
  const pkg = { name: "jarvis-update-fixture", version: "1.0.0", private: true, scripts: { "update:verify": "node verify.mjs" } };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { "": { name: pkg.name, version: pkg.version } } };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock, null, 2));
  writeFileSync(join(root, "verify.mjs"), verifyOk ? "process.exit(0);\n" : "process.exit(7);\n");
  writeFileSync(join(root, "marker.txt"), marker);
}

test("git updater is repeatable, transactional and detects dirty/divergent checkouts", { timeout: 120_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "jarvis-update-"));
  const remote = join(base, "origin.git"), seed = join(base, "seed"), checkout = join(base, "runner"), priorHome = process.env.JARVIS_HOME;
  try {
    process.env.JARVIS_HOME = join(base, "state");
    mkdirSync(seed); git(base, "init", "--bare", remote); git(seed, "init", "-b", "main");
    git(seed, "config", "user.name", "Jarvis Test"); git(seed, "config", "user.email", "jarvis@example.invalid");
    writeFixture(seed, true, "v1"); git(seed, "add", "."); git(seed, "commit", "-m", "v1"); git(seed, "remote", "add", "origin", remote); git(seed, "push", "-u", "origin", "main");
    git(base, "clone", "--branch", "main", remote, checkout); git(checkout, "config", "user.name", "Jarvis Test"); git(checkout, "config", "user.email", "jarvis@example.invalid");
    const v1 = git(checkout, "rev-parse", "HEAD");
    // É disto que o preflight depende para não matar o runner por um alvo que não chegou no fetch.
    assert.equal(await resolveCommit(checkout, v1.slice(0, 7)), v1, "sha curto resolve para o completo");
    assert.equal(await resolveCommit(checkout, "0000000"), "", "commit ausente resolve vazio em vez de explodir");

    writeFixture(seed, false, "broken-v2"); git(seed, "add", "."); git(seed, "commit", "-m", "broken v2"); git(seed, "push");
    const failed = await updateApply(checkout);
    assert.equal(failed.ok, false); assert.equal(failed.rolledBack, true, failed.log);
    assert.equal(git(checkout, "rev-parse", "HEAD"), v1, "failed preparation must restore the old commit");
    assert.equal(readFileSync(join(checkout, "marker.txt"), "utf8"), "v1");

    writeFixture(seed, true, "v3"); git(seed, "add", "."); git(seed, "commit", "-m", "v3"); git(seed, "push");
    const target = git(seed, "rev-parse", "HEAD");
    const applied = await updateApply(checkout, { targetCommit: target });
    assert.equal(applied.ok, true, applied.log); assert.equal(applied.changed, true); assert.equal(applied.restartRequired, true);
    assert.equal(readFileSync(join(checkout, "marker.txt"), "utf8"), "v3");

    const repeated = await updateApply(checkout, { targetCommit: target });
    assert.equal(repeated.ok, true, repeated.log); assert.equal(repeated.changed, false, "same version repairs/verifies instead of becoming an unrepairable no-op");
    assert.equal(repeated.restartRequired, true);
    const rollback = await updateRollback(checkout);
    assert.equal(rollback.ok, true, rollback.log); assert.equal(git(checkout, "rev-parse", "HEAD"), v1, "same-version repair must preserve the prior rollback point");

    // A durable deployment target must not rot when origin advances while a runner is offline.
    // The runner first finishes exactly v3; a later untargeted update may then take v4.
    writeFixture(seed, true, "v4"); git(seed, "add", "."); git(seed, "commit", "-m", "v4"); git(seed, "push");
    const v4 = git(seed, "rev-parse", "HEAD");
    const reapplied = await updateApply(checkout, { targetCommit: target }); assert.equal(reapplied.ok, true, reapplied.log);
    assert.equal(git(checkout, "rev-parse", "HEAD"), target, "stale queued target must land on the requested commit, not the newer origin tip");
    assert.equal(readFileSync(join(checkout, "marker.txt"), "utf8"), "v3");
    const latest = await updateApply(checkout); assert.equal(latest.ok, true, latest.log);
    assert.equal(git(checkout, "rev-parse", "HEAD"), v4); assert.equal(readFileSync(join(checkout, "marker.txt"), "utf8"), "v4");

    const wrongTarget = await updateApply(checkout, { targetCommit: "0000000" });
    assert.equal(wrongTarget.ok, false); assert.equal(wrongTarget.retryable, false); assert.match(wrongTarget.log, /Hub solicitou/);

    writeFileSync(join(checkout, "dirty.txt"), "not committed");
    const dirty = await updateApply(checkout); assert.equal(dirty.ok, false); assert.equal(dirty.dirty, true);
    const forcedDirty = await updateApply(checkout, { force: true, targetCommit: v4 });
    assert.equal(forcedDirty.ok, true, forcedDirty.log);
    assert.equal(existsSync(join(checkout, "dirty.txt")), false, "force discards untracked local files on disposable runners");
    assert.equal(git(checkout, "status", "--porcelain"), "", "forced repair leaves the checkout clean");

    writeFileSync(join(checkout, "local.txt"), "local commit"); git(checkout, "add", "."); git(checkout, "commit", "-m", "local only");
    const status = await updateCheck(checkout, true); assert.equal(status.ahead, 1); assert.equal(status.behind, 0);
    const divergent = await updateApply(checkout); assert.equal(divergent.ok, false); assert.equal(divergent.dirty, true); assert.match(divergent.log, /commit\(s\) fora do alvo/);
    const forcedDivergent = await updateApply(checkout, { force: true, targetCommit: v4 });
    assert.equal(forcedDivergent.ok, true, forcedDivergent.log);
    assert.equal(git(checkout, "rev-parse", "HEAD"), v4, "force resets divergent local commits to the deployment target");
    assert.equal(existsSync(join(checkout, "local.txt")), false, "force discards files introduced only by local commits");
  } finally {
    if (priorHome === undefined) delete process.env.JARVIS_HOME; else process.env.JARVIS_HOME = priorHome;
    rmSync(base, { recursive: true, force: true });
  }
});
