import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildManagedLaunchSpec,
  ManagedWorkspaceError,
  ManagedWorktreeManager,
  pathIsStrictlyInside,
  type ManagedGitRunner,
} from "./execution-worktree.js";

function git(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", shell: false, windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return String(result.stdout || "").trim();
}

function repository(): { base: string; repo: string; worktrees: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), "jarvis-managed-worktree-"));
  const repo = join(base, "repo");
  const worktrees = join(base, "managed");
  mkdirSync(join(repo, "nested"), { recursive: true });
  git(["init", repo]);
  git(["-C", repo, "config", "user.email", "jarvis-test@example.invalid"]);
  git(["-C", repo, "config", "user.name", "Jarvis Test"]);
  writeFileSync(join(repo, "README.md"), "base\n");
  writeFileSync(join(repo, "nested", "file.txt"), "nested\n");
  git(["-C", repo, "add", "."]);
  git(["-C", repo, "commit", "-m", "base"]);
  return { base, repo: resolve(repo), worktrees: resolve(worktrees), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("read-only is the default and a launch fails closed without a real sandbox", () => {
  const fixture = repository();
  try {
    const workspace = new ManagedWorktreeManager(fixture.worktrees).prepare({ executionId: "read-1", cwd: fixture.repo });
    assert.equal(workspace.access, "read_only");
    assert.equal(workspace.cwd, fixture.repo);
    assert.equal(existsSync(fixture.worktrees), false, "read-only does not create a worktree");
    assert.throws(() => buildManagedLaunchSpec({ agent: "codex", command: "codex", workspace }), (error: unknown) => error instanceof ManagedWorkspaceError && error.code === "READ_ONLY_NOT_ENFORCED");
    const launch = buildManagedLaunchSpec({ agent: "codex", command: "codex", workspace, readOnlyEnforcement: "provider_sandbox" });
    assert.equal(launch.shell, false);
    assert.equal(launch.workspaceAccess, "read_only");
  } finally { fixture.cleanup(); }
});

test("read-only workspace also supports a non-Git directory", () => {
  const base = mkdtempSync(join(tmpdir(), "jarvis-readonly-nongit-"));
  try {
    const workspace = new ManagedWorktreeManager(join(base, "managed")).prepare({ executionId: "read", cwd: base });
    assert.equal(workspace.access, "read_only");
    assert.equal(workspace.gitRepository, false);
    assert.equal(workspace.cwd, realpathSync(base));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("writer gets a detached worktree and preserves the selected committed subdirectory", () => {
  const fixture = repository();
  try {
    const manager = new ManagedWorktreeManager(fixture.worktrees);
    const lease = manager.prepare({ executionId: "writer/../../escape", cwd: join(fixture.repo, "nested"), write: true });
    assert.equal(lease.access, "isolated_write");
    assert.ok(lease.worktree);
    assert.equal(pathIsStrictlyInside(join(fixture.worktrees, "trees"), lease.worktree!), true);
    assert.equal(dirname(lease.cwd), lease.worktree);
    assert.equal(existsSync(join(lease.cwd, "file.txt")), true);
    assert.equal(lease.baseIncludesUncommitted, false);
    assert.throws(() => manager.release(lease, { executionTerminal: false }), (error: unknown) => error instanceof ManagedWorkspaceError && error.code === "EXECUTION_ACTIVE");
    assert.equal(manager.release(lease, { executionTerminal: true }), true);
    assert.equal(existsSync(lease.worktree!), false);
    assert.equal(manager.release(lease, { executionTerminal: true }), false, "release is idempotent after complete removal");
  } finally { fixture.cleanup(); }
});

test("writer refuses a dirty source unless committed-only semantics are explicitly accepted", () => {
  const fixture = repository();
  try {
    writeFileSync(join(fixture.repo, "README.md"), "dirty\n");
    const manager = new ManagedWorktreeManager(fixture.worktrees);
    assert.throws(() => manager.prepare({ executionId: "writer", cwd: fixture.repo, write: true }), (error: unknown) => error instanceof ManagedWorkspaceError && error.code === "DIRTY_REPOSITORY");
    const lease = manager.prepare({ executionId: "writer", cwd: fixture.repo, write: true, allowCommittedSnapshotWhenDirty: true });
    assert.equal(lease.sourceWasDirty, true);
    assert.equal(lease.baseIncludesUncommitted, false);
    manager.release(lease, { executionTerminal: true });
  } finally { fixture.cleanup(); }
});

test("Aider managed writer launch always disables automatic commits", () => {
  const fixture = repository();
  try {
    const manager = new ManagedWorktreeManager(fixture.worktrees);
    const workspace = manager.prepare({ executionId: "aider-writer", cwd: fixture.repo, write: true });
    const launch = buildManagedLaunchSpec({ agent: "aider", command: "aider", args: ["--message-file", "prompt.txt"], workspace });
    assert.deepEqual(launch.args, ["--message-file", "prompt.txt", "--no-auto-commits"]);
    assert.equal(launch.cwd, workspace.worktree);
    assert.equal(launch.shell, false);
    manager.release(workspace, { executionTerminal: true });
  } finally { fixture.cleanup(); }
});

test("Aider commit guard is not duplicated and invalid refs/options are rejected", () => {
  const fixture = repository();
  try {
    const manager = new ManagedWorktreeManager(fixture.worktrees);
    assert.throws(() => manager.prepare({ executionId: "writer", cwd: fixture.repo, write: true, baseRef: "--help" }), (error: unknown) => error instanceof ManagedWorkspaceError && error.code === "INVALID_GIT_REF");
    const workspace = manager.prepare({ executionId: "aider", cwd: fixture.repo, write: true });
    const launch = buildManagedLaunchSpec({ agent: "AIDER", command: "aider", args: ["--no-auto-commits"], workspace });
    assert.equal(launch.args.filter((arg) => arg === "--no-auto-commits").length, 1);
    manager.release(workspace, { executionTerminal: true });
  } finally { fixture.cleanup(); }
});

test("path guard rejects equality, siblings and traversal while accepting descendants", () => {
  const root = resolve("C:/safe/root");
  assert.equal(pathIsStrictlyInside(root, root), false);
  assert.equal(pathIsStrictlyInside(root, resolve(root, "..", "root-other")), false);
  assert.equal(pathIsStrictlyInside(root, resolve(root, "child", "file")), true);
});

test("unsafe root inside the source repository is rejected without creating it", () => {
  const fixture = repository();
  try {
    const unsafe = join(fixture.repo, ".jarvis-worktrees");
    const manager = new ManagedWorktreeManager(unsafe);
    assert.throws(() => manager.prepare({ executionId: "writer", cwd: fixture.repo, write: true }), (error: unknown) => error instanceof ManagedWorkspaceError && error.code === "UNSAFE_WORKTREE_ROOT");
    assert.equal(existsSync(unsafe), false);
  } finally { fixture.cleanup(); }
});

test("failed git cleanup preserves the lease so release can be retried", () => {
  const fixture = repository();
  let failRemove = true;
  const runner: ManagedGitRunner = {
    run(args) {
      if (failRemove && args.includes("remove")) throw new Error("simulated cleanup failure");
      return git([...args]);
    },
  };
  try {
    const manager = new ManagedWorktreeManager(fixture.worktrees, runner);
    const lease = manager.prepare({ executionId: "retry-cleanup", cwd: fixture.repo, write: true });
    assert.throws(() => manager.release(lease, { executionTerminal: true }), /simulated cleanup failure/);
    assert.equal(existsSync(lease.worktree!), true);
    failRemove = false;
    assert.equal(manager.release(lease, { executionTerminal: true }), true);
  } finally { fixture.cleanup(); }
});

test("filesystem root is never accepted as the managed worktree root", () => {
  const root = dirname(resolve("C:/"));
  assert.throws(() => new ManagedWorktreeManager(root), (error: unknown) => error instanceof ManagedWorkspaceError && error.code === "UNSAFE_WORKTREE_ROOT");
});
