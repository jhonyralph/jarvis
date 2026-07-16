/**
 * Self-update via git — shared by the Hub and Runners. "New version" = new commits
 * on origin/<branch>. Only works when the install is a git clone (has .git + a remote);
 * pack/copy installs update manually. Safe by construction: fast-forward only, refuses
 * a dirty tree, records the previous commit for rollback, never restarts if `npm install`
 * failed. All git/npm calls are ASYNC so they never block the Hub's event loop.
 */
import { execFile, exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const pExecFile = promisify(execFile);
const pExec = promisify(exec);
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const PREV_FILE = join(homedir(), ".jarvis", "update-prev");

async function git(root: string, args: string[], timeoutMs = 20000): Promise<string> {
  const { stdout } = await pExecFile("git", args, { cwd: root, timeout: timeoutMs, windowsHide: true });
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
  branch: string;
  behind: number;          // commits HEAD..origin/branch
  clean: boolean;          // working tree clean?
  latest?: { sha: string; subject: string; date: string };
  checkedAt?: number;
  error?: string;
}

export async function updateCheck(root: string, fetch = true): Promise<UpdateStatus> {
  let branch = "?", current = "?";
  try {
    branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    current = await git(root, ["rev-parse", "--short", "HEAD"]);
  } catch {
    return { supported: false, current, branch, behind: 0, clean: true, checkedAt: Date.now(), error: "não é um repositório git (instale via git clone para auto-update)" };
  }
  try { await git(root, ["remote", "get-url", "origin"]); }
  catch { return { supported: false, current, branch, behind: 0, clean: true, checkedAt: Date.now(), error: "sem remote git (instale via git clone para auto-update)" }; }
  if (fetch) {
    try { await git(root, ["fetch", "--quiet", "origin", branch], 30000); }
    catch (e: any) { return { supported: true, current, branch, behind: 0, clean: true, checkedAt: Date.now(), error: "fetch falhou (rede?): " + String(e?.message ?? e).slice(0, 120) }; }
  }
  let behind = 0, clean = true, latest: UpdateStatus["latest"];
  try { behind = Number(await git(root, ["rev-list", "--count", `HEAD..origin/${branch}`]) || "0"); } catch { /* 0 */ }
  try { clean = (await git(root, ["status", "--porcelain"])) === ""; } catch { /* true */ }
  try { const p = (await git(root, ["log", "-1", `origin/${branch}`, "--format=%h%x1f%s%x1f%cI"])).split("\x1f"); latest = { sha: p[0], subject: p[1], date: p[2] }; } catch { /* ignore */ }
  return { supported: true, current, branch, behind, clean, latest, checkedAt: Date.now() };
}

export interface UpdateResult { ok: boolean; log: string; prev?: string; behind?: number; dirty?: boolean; }

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
export async function updateApply(root: string, opts?: { force?: boolean }): Promise<UpdateResult> {
  const st = await updateCheck(root, true);
  if (!st.supported) return { ok: false, log: st.error || "auto-update não suportado neste install" };
  if (st.error) return { ok: false, log: st.error };
  if (!st.clean && !opts?.force) return { ok: false, dirty: true, log: "há alterações locais não commitadas — abortando por segurança (rode `git status`)" };
  if (st.behind === 0 && st.clean) return { ok: true, log: "já está na última versão", behind: 0 };
  try { mkdirSync(join(homedir(), ".jarvis"), { recursive: true }); writeFileSync(PREV_FILE, st.current); } catch { /* ignore */ }
  let log = "";
  try {
    if (opts?.force && !st.clean) {
      // reset (not pull): a pull can't move a dirty tree. updateCheck already fetched, so
      // origin/<branch> is current. This is the line that throws away local work — only ever
      // reached because the caller explicitly asked for it.
      log += "descartando alterações locais (git reset --hard origin/" + st.branch + "):\n";
      log += (await git(root, ["reset", "--hard", `origin/${st.branch}`], 30000)) + "\n";
    } else {
      log += "git pull:\n" + (await git(root, ["pull", "--ff-only", "origin", st.branch], 60000)) + "\n";
    }
    // exec (shell) — Node 22 rejects execFile on npm.cmd (.cmd security change)
    const { stdout } = await pExec(`${NPM} install`, { cwd: root, timeout: 300000, windowsHide: true });
    log += "npm install: ok (" + (String(stdout).trim().split("\n").slice(-1)[0] || "done") + ")";
    return { ok: true, log, prev: st.current, behind: st.behind };
  } catch (e: any) {
    return { ok: false, log: log + "\nERRO: " + String(e?.stderr ?? e?.message ?? e).slice(0, 400) };
  }
}

/** Roll back to the commit recorded before the last update. */
export async function updateRollback(root: string): Promise<UpdateResult> {
  let prev = "";
  try { prev = readFileSync(PREV_FILE, "utf8").trim(); } catch { /* none */ }
  if (!prev) return { ok: false, log: "sem ponto de rollback registrado" };
  try {
    const log = await git(root, ["reset", "--hard", prev], 30000);
    await pExec(`${NPM} install`, { cwd: root, timeout: 300000, windowsHide: true });
    return { ok: true, log: `rollback para ${prev}: ${log}`, prev };
  } catch (e: any) { return { ok: false, log: "rollback falhou: " + String(e?.message ?? e) }; }
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
      : `Start-Sleep 3; Stop-ScheduledTask -TaskName '${task}' -EA SilentlyContinue; Start-Sleep 1; Start-ScheduledTask -TaskName '${task}'`;
    spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", cmd], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (p === "darwin") {
    const label = kind === "hub" ? "com.jarvis.hub" : "com.jarvis.runner";
    spawn("/bin/sh", ["-c", `sleep 3; launchctl kickstart -k gui/$(id -u)/${label}`], { detached: true, stdio: "ignore" }).unref();
  } else {
    const unit = kind === "hub" ? "jarvis-hub" : "jarvis-runner";
    spawn("/bin/sh", ["-c", `sleep 3; systemctl --user restart ${unit}`], { detached: true, stdio: "ignore" }).unref();
  }
}
