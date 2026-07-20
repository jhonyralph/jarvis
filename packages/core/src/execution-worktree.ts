/** Safe workspace provisioning for Jarvis-managed child executions. */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readJson, writeJsonAtomic } from "./persist.js";
import type { ManagedWorkspaceAccess } from "./execution-policy.js";

export type ManagedReadOnlyEnforcement = "provider_sandbox" | "os_sandbox";

export interface ManagedWorkspaceLease {
  leaseId: string;
  executionId: string;
  access: ManagedWorkspaceAccess;
  cwd: string;
  repoRoot: string;
  gitRepository: boolean;
  worktree?: string;
  baseCommit?: string;
  sourceWasDirty?: boolean;
  /** `false` is explicit: a worktree is based on a commit, never an implicit copy of dirty files. */
  baseIncludesUncommitted: false;
}

export interface PrepareManagedWorkspaceInput {
  executionId: string;
  cwd: string;
  write?: boolean;
  baseRef?: string;
  /** Opt-in means "use committed HEAD despite dirtiness", not "copy uncommitted files". */
  allowCommittedSnapshotWhenDirty?: boolean;
}

export interface ManagedLaunchSpec {
  agent: string;
  command: string;
  args: readonly string[];
  cwd: string;
  shell: false;
  workspaceAccess: ManagedWorkspaceAccess;
  readOnlyEnforcement?: ManagedReadOnlyEnforcement;
}

export interface BuildManagedLaunchSpecInput {
  agent: string;
  command: string;
  args?: readonly string[];
  workspace: ManagedWorkspaceLease;
  /** Required for shared-cwd/read-only tasks. A label is not accepted as enforcement. */
  readOnlyEnforcement?: ManagedReadOnlyEnforcement;
}

export interface ManagedGitRunner {
  run(args: readonly string[]): string;
}

export type ManagedWorkspaceErrorCode =
  | "INVALID_EXECUTION_ID"
  | "INVALID_PATH"
  | "NOT_A_DIRECTORY"
  | "NOT_A_GIT_REPOSITORY"
  | "UNSAFE_WORKTREE_ROOT"
  | "INVALID_GIT_REF"
  | "DIRTY_REPOSITORY"
  | "WORKTREE_EXISTS"
  | "GIT_FAILED"
  | "LEASE_INVALID"
  | "EXECUTION_ACTIVE"
  | "READ_ONLY_NOT_ENFORCED"
  | "INVALID_LAUNCH_SPEC"
  | "WORKTREE_REMOVE_INCOMPLETE";

export class ManagedWorkspaceError extends Error {
  constructor(readonly code: ManagedWorkspaceErrorCode, message: string) {
    super(message);
    this.name = "ManagedWorkspaceError";
  }
}

class NodeGitRunner implements ManagedGitRunner {
  run(args: readonly string[]): string {
    const result = spawnSync("git", [...args], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const detail = String(result.stderr || result.error?.message || "git falhou").trim().slice(0, 2_000);
      throw new ManagedWorkspaceError("GIT_FAILED", detail);
    }
    return String(result.stdout || "");
  }
}

function safeExecutionId(value: string): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
}

function canonicalDirectory(path: string): string {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new ManagedWorkspaceError("INVALID_PATH", `diretório não existe: ${absolute}`);
  if (!statSync(absolute).isDirectory()) throw new ManagedWorkspaceError("NOT_A_DIRECTORY", `não é diretório: ${absolute}`);
  return realpathSync(absolute);
}

export function pathIsStrictlyInside(parent: string, target: string): boolean {
  const rel = relative(resolve(parent), resolve(target));
  return rel.length > 0 && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && rel !== ".." && !isAbsolute(rel);
}

function assertInside(parent: string, target: string, label: string): void {
  if (!pathIsStrictlyInside(parent, target)) throw new ManagedWorkspaceError("INVALID_PATH", `${label} fora da raiz gerenciada`);
}

function validateBaseRef(value: string): string {
  if (!value || value.length > 200 || value.startsWith("-") || /[\x00-\x20\x7f]/.test(value)) {
    throw new ManagedWorkspaceError("INVALID_GIT_REF", "baseRef inválida");
  }
  return value;
}

function targetName(executionId: string): string {
  const slug = executionId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "execution";
  const hash = createHash("sha256").update(executionId).digest("hex").slice(0, 12);
  return `${slug}-${hash}`;
}

interface LeaseMarker {
  version: 1;
  leaseId: string;
  executionId: string;
  repoRoot: string;
  worktree: string;
  baseCommit: string;
}

/**
 * Creates detached worktrees below one dedicated root. No caller-controlled target path is ever
 * accepted, and cleanup delegates removal to `git worktree remove` after validating a durable
 * ownership marker. It never recursively deletes a computed filesystem path.
 */
export class ManagedWorktreeManager {
  private readonly configuredRoot: string;
  private readonly git: ManagedGitRunner;

  constructor(worktreeRoot: string, git: ManagedGitRunner = new NodeGitRunner()) {
    const root = resolve(worktreeRoot);
    if (dirname(root) === root) throw new ManagedWorkspaceError("UNSAFE_WORKTREE_ROOT", "a raiz do filesystem não pode ser usada para worktrees");
    this.configuredRoot = root;
    this.git = git;
  }

  prepare(input: PrepareManagedWorkspaceInput): ManagedWorkspaceLease {
    if (!safeExecutionId(input.executionId)) throw new ManagedWorkspaceError("INVALID_EXECUTION_ID", "executionId inválido");
    const requestedCwd = canonicalDirectory(input.cwd);
    let repoRoot: string | undefined;
    try {
      const discovered = this.git.run(["-C", requestedCwd, "rev-parse", "--show-toplevel"]).trim();
      repoRoot = canonicalDirectory(discovered);
    } catch (error) {
      if (error instanceof ManagedWorkspaceError && error.code !== "GIT_FAILED") throw error;
      if (input.write === true) throw new ManagedWorkspaceError("NOT_A_GIT_REPOSITORY", `cwd não pertence a um repositório Git: ${requestedCwd}`);
      return {
        leaseId: `readonly:${randomUUID()}`,
        executionId: input.executionId,
        access: "read_only",
        cwd: requestedCwd,
        repoRoot: requestedCwd,
        gitRepository: false,
        baseIncludesUncommitted: false,
      };
    }
    const relativeCwd = relative(repoRoot, requestedCwd);
    if (relativeCwd === ".." || relativeCwd.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativeCwd)) {
      throw new ManagedWorkspaceError("INVALID_PATH", "cwd não pertence à raiz Git descoberta");
    }
    const dirty = this.git.run(["-C", repoRoot, "status", "--porcelain", "--untracked-files=normal"]).trim().length > 0;
    if (dirty && input.write === true && !input.allowCommittedSnapshotWhenDirty) {
      throw new ManagedWorkspaceError("DIRTY_REPOSITORY", "o repositório possui mudanças não commitadas; a worktree não as incluiria");
    }

    if (input.write !== true) {
      return {
        leaseId: `readonly:${randomUUID()}`,
        executionId: input.executionId,
        access: "read_only",
        cwd: requestedCwd,
        repoRoot,
        gitRepository: true,
        sourceWasDirty: dirty,
        baseIncludesUncommitted: false,
      };
    }

    // Reject lexically before mkdir: an unsafe value must not leave an untracked directory behind.
    if (pathIsStrictlyInside(repoRoot, this.configuredRoot) || resolve(repoRoot) === resolve(this.configuredRoot)) {
      throw new ManagedWorkspaceError("UNSAFE_WORKTREE_ROOT", "a raiz de worktrees não pode ficar dentro do repositório de origem");
    }
    mkdirSync(this.configuredRoot, { recursive: true });
    const root = canonicalDirectory(this.configuredRoot);
    const treesRoot = join(root, "trees");
    const leasesRoot = join(root, "leases");
    mkdirSync(treesRoot, { recursive: true });
    mkdirSync(leasesRoot, { recursive: true });
    const canonicalTrees = canonicalDirectory(treesRoot);
    const canonicalLeases = canonicalDirectory(leasesRoot);
    if (pathIsStrictlyInside(repoRoot, root) || resolve(repoRoot) === resolve(root)) {
      throw new ManagedWorkspaceError("UNSAFE_WORKTREE_ROOT", "a raiz de worktrees não pode ficar dentro do repositório de origem");
    }

    const worktree = resolve(canonicalTrees, targetName(input.executionId));
    assertInside(canonicalTrees, worktree, "worktree");
    if (existsSync(worktree)) throw new ManagedWorkspaceError("WORKTREE_EXISTS", `worktree já existe para ${input.executionId}`);
    const baseRef = validateBaseRef(input.baseRef ?? "HEAD");
    const baseCommit = this.git.run(["-C", repoRoot, "rev-parse", "--verify", `${baseRef}^{commit}`]).trim();
    if (!/^[0-9a-f]{40,64}$/i.test(baseCommit)) throw new ManagedWorkspaceError("GIT_FAILED", "git retornou um commit inválido");
    const leaseId = randomUUID();
    const markerPath = resolve(canonicalLeases, `${leaseId}.json`);
    assertInside(canonicalLeases, markerPath, "marker");
    let added = false;
    try {
      this.git.run(["-C", repoRoot, "worktree", "add", "--detach", worktree, baseCommit]);
      added = true;
      const marker: LeaseMarker = { version: 1, leaseId, executionId: input.executionId, repoRoot, worktree, baseCommit };
      writeJsonAtomic(markerPath, marker, { backup: false });
    } catch (error) {
      if (added) {
        try { this.git.run(["-C", repoRoot, "worktree", "remove", "--force", worktree]); } catch { /* keep original error */ }
      }
      throw error;
    }
    const childCwd = relativeCwd ? resolve(worktree, relativeCwd) : worktree;
    if (resolve(childCwd) !== resolve(worktree)) assertInside(worktree, childCwd, "cwd da worktree");
    if (!existsSync(childCwd) || !statSync(childCwd).isDirectory()) {
      // The selected cwd may only exist in the dirty source tree. Never silently substitute root.
      this.git.run(["-C", repoRoot, "worktree", "remove", "--force", worktree]);
      if (existsSync(worktree)) throw new ManagedWorkspaceError("WORKTREE_REMOVE_INCOMPLETE", "git não removeu a worktree após cwd inválido");
      if (existsSync(markerPath)) unlinkSync(markerPath);
      throw new ManagedWorkspaceError("INVALID_PATH", "o cwd selecionado não existe no commit base da worktree");
    }
    return {
      leaseId,
      executionId: input.executionId,
      access: "isolated_write",
      cwd: canonicalDirectory(childCwd),
      repoRoot,
      gitRepository: true,
      worktree: canonicalDirectory(worktree),
      baseCommit,
      sourceWasDirty: dirty,
      baseIncludesUncommitted: false,
    };
  }

  /** Returns false only when an already-removed durable lease is released again. */
  release(lease: ManagedWorkspaceLease, options: { executionTerminal: boolean }): boolean {
    if (lease.access === "read_only") return false;
    if (!options.executionTerminal) throw new ManagedWorkspaceError("EXECUTION_ACTIVE", "worktree ativa não pode ser removida");
    if (!lease.worktree || !lease.baseCommit || !safeExecutionId(lease.executionId) || !/^[0-9a-f-]{36}$/i.test(lease.leaseId)) {
      throw new ManagedWorkspaceError("LEASE_INVALID", "lease de worktree inválida");
    }
    const root = canonicalDirectory(this.configuredRoot);
    const treesRoot = canonicalDirectory(join(root, "trees"));
    const leasesRoot = canonicalDirectory(join(root, "leases"));
    const markerPath = resolve(leasesRoot, `${lease.leaseId}.json`);
    assertInside(leasesRoot, markerPath, "marker");
    if (!existsSync(markerPath)) {
      if (existsSync(lease.worktree)) throw new ManagedWorkspaceError("LEASE_INVALID", "marker ausente para uma worktree existente");
      return false;
    }
    const marker = readJson<LeaseMarker | null>(markerPath, null);
    if (!marker || marker.version !== 1 || marker.leaseId !== lease.leaseId || marker.executionId !== lease.executionId || marker.baseCommit !== lease.baseCommit || resolve(marker.worktree) !== resolve(lease.worktree) || resolve(marker.repoRoot) !== resolve(lease.repoRoot)) {
      throw new ManagedWorkspaceError("LEASE_INVALID", "marker não corresponde à lease informada");
    }
    assertInside(treesRoot, marker.worktree, "worktree");
    if (existsSync(marker.worktree)) assertInside(treesRoot, realpathSync(marker.worktree), "worktree real");
    this.git.run(["-C", marker.repoRoot, "worktree", "remove", "--force", marker.worktree]);
    if (existsSync(marker.worktree)) throw new ManagedWorkspaceError("WORKTREE_REMOVE_INCOMPLETE", "git não removeu completamente a worktree");
    unlinkSync(markerPath);
    return true;
  }
}

/**
 * Produce a shell-free launch contract. Read-only is fail-closed until the integration layer
 * names a real provider/OS sandbox. Managed Aider launches always disable auto commits, including
 * writer children in isolated worktrees.
 */
export function buildManagedLaunchSpec(input: BuildManagedLaunchSpecInput): ManagedLaunchSpec {
  if (!input.command || /[\x00-\x1f\x7f]/.test(input.command) || input.command.startsWith("-")) {
    throw new ManagedWorkspaceError("INVALID_LAUNCH_SPEC", "comando inválido");
  }
  const args = [...(input.args ?? [])];
  if (args.some((arg) => typeof arg !== "string" || /\x00/.test(arg))) {
    throw new ManagedWorkspaceError("INVALID_LAUNCH_SPEC", "argumento inválido");
  }
  if (input.workspace.access === "read_only" && !input.readOnlyEnforcement) {
    throw new ManagedWorkspaceError("READ_ONLY_NOT_ENFORCED", "executor precisa aplicar sandbox somente leitura");
  }
  if (input.workspace.access === "isolated_write" && !input.workspace.worktree) {
    throw new ManagedWorkspaceError("LEASE_INVALID", "escrita gerenciada exige worktree");
  }
  if (input.agent.toLowerCase() === "aider" && !args.includes("--no-auto-commits")) args.push("--no-auto-commits");
  return Object.freeze({
    agent: input.agent,
    command: input.command,
    args: Object.freeze(args),
    cwd: input.workspace.cwd,
    shell: false as const,
    workspaceAccess: input.workspace.access,
    readOnlyEnforcement: input.readOnlyEnforcement,
  });
}
