import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateApply, updateCheck, updateRollback } from "./update.js";

const run = (cwd: string, command: string, args: string[] = []): string => String(execFileSync(command, args, { cwd, windowsHide: true, encoding: "utf8" })).trim();
const git = (cwd: string, ...args: string[]): string => run(cwd, "git", args);

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
    rmSync(join(checkout, "dirty.txt"));

    writeFileSync(join(checkout, "local.txt"), "local commit"); git(checkout, "add", "."); git(checkout, "commit", "-m", "local only");
    const status = await updateCheck(checkout, true); assert.equal(status.ahead, 1); assert.equal(status.behind, 0);
    const divergent = await updateApply(checkout); assert.equal(divergent.ok, false); assert.equal(divergent.dirty, true); assert.match(divergent.log, /commit\(s\) fora do alvo/);
  } finally {
    if (priorHome === undefined) delete process.env.JARVIS_HOME; else process.env.JARVIS_HOME = priorHome;
    rmSync(base, { recursive: true, force: true });
  }
});
