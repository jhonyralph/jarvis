/**
 * Self-update via git — shared by the Hub and Runners. "New version" = new commits
 * on origin/<branch>. Only works when the install is a git clone (has .git + a remote);
 * pack/copy installs update manually. Safe by construction: fast-forward only, refuses
 * a dirty tree, records the previous commit per checkout, verifies dependencies/code and
 * rolls Git + dependencies back when preparation fails. All git/npm calls are ASYNC so
 * they never block the Hub's event loop.
 */
import { execFile, exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, readFileSync, mkdirSync, openSync, closeSync, unlinkSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const pExecFile = promisify(execFile);
const pExec = promisify(exec);
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
function updateDir(): string { return join(process.env.JARVIS_HOME || homedir(), ".jarvis", "updates"); }
function legacyPrevFile(): string { return join(process.env.JARVIS_HOME || homedir(), ".jarvis", "update-prev"); }

function checkoutKey(root: string): string { const path = resolve(root); return createHash("sha256").update(process.platform === "win32" ? path.toLowerCase() : path).digest("hex").slice(0, 20); }
function prevFile(root: string): string { return join(updateDir(), checkoutKey(root) + ".prev"); }
function lockFile(root: string): string { return join(updateDir(), checkoutKey(root) + ".lock"); }

/** Cross-process lock: Hub, Runner and recovery CLI may share a checkout. */
function acquireUpdateLock(root: string): (() => void) | null {
  mkdirSync(updateDir(), { recursive: true });
  const file = lockFile(root);
  try {
    if (existsSync(file)) {
      let stale = Date.now() - statSync(file).mtimeMs > 90 * 60_000;
      try { const pid = Number(JSON.parse(readFileSync(file, "utf8")).pid); if (pid > 0) { try { process.kill(pid, 0); stale = false; } catch { stale = true; } } } catch { /* age fallback */ }
      if (stale) unlinkSync(file);
    }
  } catch { /* race: the exclusive open below remains authoritative */ }
  let fd: number;
  try { fd = openSync(file, "wx"); } catch { return null; }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), root: resolve(root) })); } catch { /* lock itself is enough */ }
  return () => { try { closeSync(fd); } catch { /* ignore */ } try { unlinkSync(file); } catch { /* ignore */ } };
}

async function npmStep(root: string, args: string): Promise<string> {
  const { stdout } = await pExec(`${NPM} ${args}`, { cwd: root, timeout: 600_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  return String(stdout).trim().split(/\r?\n/).slice(-1)[0] || "done";
}

async function installAndVerify(root: string): Promise<string> {
  const install = existsSync(join(root, "package-lock.json")) ? "ci" : "install";
  const installed = await npmStep(root, install);
  const verified = await npmStep(root, "run update:verify --if-present");
  return `npm ${install}: ok (${installed})\nverificação: ok (${verified})`;
}

async function git(root: string, args: string[], timeoutMs = 20000): Promise<string> {
  const { stdout } = await pExecFile("git", args, { cwd: root, timeout: timeoutMs, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return String(stdout).trim();
}

/** The repo's origin URL (for showing the right `git clone …` command), or "". */
export async function repoRemoteUrl(root: string): Promise<string> {
  try { return (await git(root, ["remote", "get-url", "origin"])).replace(/\.git$/, ""); } catch { return ""; }
}

/** Short HEAD sha of a checkout, "+dirty" if the tree has uncommitted changes. "" if not a git repo.
 *  Used so runners can report which build they're actually running, to catch version drift. */
export async function repoCommit(root: string): Promise<string> {
  try {
    const sha = await git(root, ["rev-parse", "--short", "HEAD"]);
    let dirty = false;
    try { dirty = (await git(root, ["status", "--porcelain"])) !== ""; } catch { /* treat as clean */ }
    return sha + (dirty ? "+dirty" : "");
  } catch { return ""; }
}

export interface UpdateStatus {
  supported: boolean;      // git clone with a remote?
  current: string;         // short sha of HEAD
  currentFull?: string;
  branch: string;
  behind: number;          // commits HEAD..origin/branch
  ahead: number;           // commits that exist only in the checkout
  clean: boolean;          // working tree clean?
  latest?: { sha: string; subject: string; date: string };
  checkedAt?: number;
  error?: string;
}

export interface RunnerSelfUpdateDecision {
  update: boolean;
  reason: string;
  targetCommit?: string;
  retryable?: boolean;
}

/**
 * Conservative autonomous runner update policy.
 *
 * The Hub remains the primary coordinator. This fallback is for a runner that is alive but unable
 * to register/stay connected after the Hub moved forward. It only fast-forwards a clean checkout
 * with no local-only commits and no active work; otherwise it reports why it refused.
 */
export function runnerSelfUpdateDecision(
  status: Pick<UpdateStatus, "supported" | "error" | "clean" | "behind" | "ahead" | "latest" | "current">,
  opts?: { busy?: boolean; updateInProgress?: boolean },
): RunnerSelfUpdateDecision {
  if (opts?.updateInProgress) return { update: false, reason: "atualização já em andamento" };
  if (opts?.busy) return { update: false, reason: "há turnos/trabalhos ativos" };
  if (!status.supported) return { update: false, reason: status.error || "auto-update não suportado", retryable: false };
  if (status.error) return { update: false, reason: status.error, retryable: true };
  if (!status.clean) return { update: false, reason: "checkout com alterações locais", retryable: false };
  if ((status.ahead || 0) > 0) return { update: false, reason: "checkout possui commits locais fora do origin", retryable: false };
  if ((status.behind || 0) <= 0) return { update: false, reason: "já está atualizado" };
  const targetCommit = status.latest?.sha;
  if (!targetCommit) return { update: false, reason: "origin tem atualização, mas o commit alvo não foi resolvido", retryable: true };
  return { update: true, reason: `${status.behind} commit(s) atrás de origin`, targetCommit };
}

export async function updateCheck(root: string, fetch = true): Promise<UpdateStatus> {
  let branch = "?", current = "?", currentFull = "";
  try {
    branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    current = await git(root, ["rev-parse", "--short", "HEAD"]);
    currentFull = await git(root, ["rev-parse", "HEAD"]);
  } catch {
    return { supported: false, current, currentFull, branch, behind: 0, ahead: 0, clean: true, checkedAt: Date.now(), error: "não é um repositório git (instale via git clone para auto-update)" };
  }
  try { await git(root, ["remote", "get-url", "origin"]); }
  catch { return { supported: false, current, currentFull, branch, behind: 0, ahead: 0, clean: true, checkedAt: Date.now(), error: "sem remote git (instale via git clone para auto-update)" }; }
  if (fetch) {
    try { await git(root, ["fetch", "--quiet", "origin", branch], 30000); }
    catch (e: any) { return { supported: true, current, currentFull, branch, behind: 0, ahead: 0, clean: true, checkedAt: Date.now(), error: "fetch falhou (rede?): " + String(e?.message ?? e).slice(0, 120) }; }
  }
  let behind = 0, ahead = 0, clean = true, latest: UpdateStatus["latest"];
  try { const [a, b] = (await git(root, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`])).split(/\s+/).map(Number); ahead = a || 0; behind = b || 0; }
  catch (e: any) { return { supported: true, current, currentFull, branch, behind, ahead, clean, checkedAt: Date.now(), error: "não foi possível comparar com origin/" + branch + ": " + String(e?.message ?? e).slice(0, 120) }; }
  try { clean = (await git(root, ["status", "--porcelain"])) === ""; }
  catch (e: any) { return { supported: true, current, currentFull, branch, behind, ahead, clean: false, checkedAt: Date.now(), error: "não foi possível verificar alterações locais: " + String(e?.message ?? e).slice(0, 120) }; }
  try { const p = (await git(root, ["log", "-1", `origin/${branch}`, "--format=%h%x1f%s%x1f%cI"])).split("\x1f"); latest = { sha: p[0], subject: p[1], date: p[2] }; } catch { /* ignore */ }
  return { supported: true, current, currentFull, branch, behind, ahead, clean, latest, checkedAt: Date.now() };
}

export interface UpdateResult { ok: boolean; log: string; prev?: string; behind?: number; dirty?: boolean; changed?: boolean; restartRequired?: boolean; current?: string; rolledBack?: boolean; busy?: boolean; retryable?: boolean; }

/**
 * `force` DISCARDS local changes (`git reset --hard origin/<branch>`) before pulling.
 *
 * Refusing a dirty tree is the right default — it's someone's unsaved work. But a runner is not a
 * workstation: its tree goes dirty on its own (a stray npm install, line-ending churn), and then
 * every update aborts forever and the machine silently rots on old code. Without a way to say
 * "this one is disposable, take the latest", the only fix is physically going to the machine —
 * which defeats the point of remote updates. So: still refuses by default, obeys when forced.
 *
 * `dirty` is reported back so the caller can offer forcing instead of guessing from a log string.
 */
export async function updateApply(root: string, opts?: { force?: boolean; targetCommit?: string }): Promise<UpdateResult> {
  const release = acquireUpdateLock(root);
  if (!release) return { ok: false, busy: true, retryable: true, log: "outra atualização já está em andamento neste checkout" };
  try {
    const st = await updateCheck(root, true);
    if (!st.supported) return { ok: false, retryable: false, log: st.error || "auto-update não suportado neste install" };
    if (st.error) return { ok: false, retryable: true, log: st.error };
    if (!st.clean && !opts?.force) return { ok: false, dirty: true, retryable: false, log: "há alterações locais não commitadas — abortando por segurança (rode `git status`)" };
    const remoteFull = await git(root, ["rev-parse", `origin/${st.branch}`]);
    let desiredFull = remoteFull;
    if (opts?.targetCommit) {
      const requested = opts.targetCommit.replace("+dirty", "");
      try { desiredFull = await git(root, ["rev-parse", `${requested}^{commit}`]); }
      catch { return { ok: false, retryable: false, log: `o commit que o Hub solicitou (${requested}) não existe neste checkout após o fetch` }; }
      try { await git(root, ["merge-base", "--is-ancestor", desiredFull, remoteFull]); }
      catch { return { ok: false, retryable: false, log: `o commit que o Hub solicitou (${desiredFull.slice(0, 12)}) não pertence mais a origin/${st.branch}` }; }
    }
    let aheadTarget = 0, behindTarget = 0;
    try { const [a, b] = (await git(root, ["rev-list", "--left-right", "--count", `HEAD...${desiredFull}`])).split(/\s+/).map(Number); aheadTarget = a || 0; behindTarget = b || 0; }
    catch (e: any) { return { ok: false, retryable: false, log: "não foi possível comparar o checkout com o alvo solicitado: " + String(e?.message ?? e).slice(0, 180) }; }
    if (aheadTarget > 0 && !opts?.force) return { ok: false, dirty: true, retryable: false, log: `checkout possui ${aheadTarget} commit(s) fora do alvo solicitado — force somente se este checkout for descartável` };
    const previous = st.currentFull || await git(root, ["rev-parse", "HEAD"]);
    // A repair of the current commit must not overwrite the last genuinely older rollback point.
    try { mkdirSync(updateDir(), { recursive: true }); if (previous !== desiredFull || !existsSync(prevFile(root))) writeFileSync(prevFile(root), previous); } catch { /* rollback remains best-effort */ }
    let log = "";
    let moved = false;
    try {
      if (opts?.force && (!st.clean || aheadTarget > 0)) {
        // reset (not pull): a pull can't move a dirty/divergent tree. This line throws away local
        // work and is reachable only from the owner's explicit, per-machine force confirmation.
        log += "descartando alterações locais/divergentes (git reset --hard " + desiredFull.slice(0, 12) + "):\n";
        log += (await git(root, ["reset", "--hard", desiredFull], 30000)) + "\n";
        moved = previous !== desiredFull;
      } else if (behindTarget > 0) {
        // Merge the durable deployment target, not today's origin tip. A runner may reconnect after
        // a newer push; it still has to finish and prove the exact deployment the Hub queued.
        log += "git fast-forward para o alvo solicitado:\n" + (await git(root, ["merge", "--ff-only", desiredFull], 60000)) + "\n";
        moved = true;
      } else {
        log += "git: código já aponta para o alvo solicitado; reparando dependências e validando\n";
      }
      log += await installAndVerify(root);
      const current = await git(root, ["rev-parse", "--short", "HEAD"]);
      return { ok: true, log, prev: previous, behind: behindTarget, changed: moved, restartRequired: true, current };
    } catch (e: any) {
      const reason = String(e?.stderr ?? e?.message ?? e).slice(0, 800);
      if (!moved) return { ok: false, retryable: false, log: log + "\nERRO na preparação: " + reason, behind: behindTarget };
      let rollbackLog = "";
      try {
        rollbackLog += await git(root, ["reset", "--hard", previous], 30000);
        rollbackLog += "\n" + await installAndVerify(root);
        return { ok: false, retryable: false, rolledBack: true, log: log + "\nERRO na preparação: " + reason + "\nRollback automático concluído:\n" + rollbackLog, prev: previous, behind: behindTarget };
      } catch (rollbackError: any) {
        return { ok: false, retryable: false, rolledBack: false, log: log + "\nERRO na preparação: " + reason + "\nERRO também no rollback: " + String(rollbackError?.stderr ?? rollbackError?.message ?? rollbackError).slice(0, 800), prev: previous, behind: behindTarget };
      }
    }
  } finally { release(); }
}

/** Roll back to the commit recorded before the last update. */
export async function updateRollback(root: string): Promise<UpdateResult> {
  let prev = "";
  try { prev = readFileSync(prevFile(root), "utf8").trim(); }
  catch { try { prev = readFileSync(legacyPrevFile(), "utf8").trim(); } catch { /* none */ } }
  if (!prev) return { ok: false, log: "sem ponto de rollback registrado" };
  const release = acquireUpdateLock(root);
  if (!release) return { ok: false, busy: true, log: "outra atualização já está em andamento neste checkout" };
  try {
    const log = await git(root, ["reset", "--hard", prev], 30000);
    const prepared = await installAndVerify(root);
    return { ok: true, restartRequired: true, log: `rollback para ${prev}: ${log}\n${prepared}`, prev };
  } catch (e: any) { return { ok: false, log: "rollback falhou: " + String(e?.message ?? e) }; }
  finally { release(); }
}

/** Restart the OS service so the new code takes effect. Detached, survives our exit. */
export function restartService(kind: "hub" | "runner"): void {
  const p = process.platform;
  if (p === "win32") {
    const task = kind === "hub" ? "JarvisHub" : "JarvisRunner";
    // Hub: the launcher is a supervisor loop — just kill the node process and the loop
    // relaunches with the new code (tsx runs from source). Start-ScheduledTask is only a
    // fallback for the rare case the supervisor itself died; IgnoreNew makes it a no-op
    // when the supervisor is alive. This avoids the old Stop/Start race that left it down.
    const cmd = kind === "hub"
      ? `Start-Sleep 3; $c=Get-NetTCPConnection -LocalPort 4577 -State Listen -EA SilentlyContinue; if($c){Stop-Process -Id $c.OwningProcess -Force -EA SilentlyContinue}; Start-ScheduledTask -TaskName '${task}' -EA SilentlyContinue`
      // The scheduled task's PowerShell launcher is already a supervisor loop. Exiting this Node
      // process is enough. Start-ScheduledTask is still fired unconditionally as a fallback for a
      // stale/dead supervisor; the task is installed with IgnoreNew, so this is a no-op if alive.
      : `Start-Sleep 5; Start-ScheduledTask -TaskName '${task}' -EA SilentlyContinue`;
    spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", cmd], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (p === "darwin") {
    const label = kind === "hub" ? "com.jarvis.hub" : "com.jarvis.runner";
    spawn("/bin/sh", ["-c", `sleep 3; launchctl kickstart -k gui/$(id -u)/${label}`], { detached: true, stdio: "ignore" }).unref();
  } else {
    const unit = kind === "hub" ? "jarvis-hub" : "jarvis-runner";
    spawn("/bin/sh", ["-c", `sleep 3; systemctl --user restart ${unit}`], { detached: true, stdio: "ignore" }).unref();
  }
}
