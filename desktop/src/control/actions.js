// Pure builders for the tray's side effects (process/HTTP). Kept pure + injection-safe so they can be
// unit-tested headless; register-control-ipc.js executes them. The only interpolated value is a FIXED
// task name / a locally-discovered repo path — never user input.

const { homedir } = require("node:os");
const { join } = require("node:path");

/** Absolute path to a Jarvis log file under ~/.jarvis. */
function logPath(kind) {
  return join(homedir(), ".jarvis", kind === "runner" ? "runner.log" : "hub.log");
}

/** PowerShell args (for spawn) that print a scheduled task's State ("Running"/"Ready"/"") — empty if absent. */
function taskStateArgs(taskName) {
  return ["-NoProfile", "-NonInteractive", "-Command", `(Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue).State`];
}

/** PowerShell args to start/stop a per-user scheduled task (no elevation needed for the user's own task). */
function taskControlArgs(taskName, action) {
  const verb = action === "start" ? "Start-ScheduledTask" : "Stop-ScheduledTask";
  return ["-NoProfile", "-NonInteractive", "-Command", `${verb} -TaskName '${taskName}'`];
}

/** PowerShell args to read a task's action target (the .ps1 path) — used to discover the runner repo root. */
function taskActionArgs(taskName) {
  return ["-NoProfile", "-NonInteractive", "-Command", `(Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue).Actions.Arguments`];
}

/** Runner-only "update now": fetch tags + fast-forward, then bounce the runner task. */
function runnerSelfUpdateArgs(repoPath, taskName) {
  return ["-NoProfile", "-NonInteractive", "-Command",
    `Set-Location '${repoPath}'; git fetch --tags origin; git pull --ff-only; `
    + `Stop-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Start-ScheduledTask -TaskName '${taskName}'`];
}

/** Given a scheduled task's raw Arguments string (…-File "<repo>\scripts\start-runner.ps1"…), return the repo root. */
function repoRootFromTaskArguments(args) {
  if (!args) return "";
  const s = String(args);
  // quoted path (may contain spaces) OR an unquoted path (no spaces) ending at the launcher script
  const m = s.match(/"([^"]*[\\/]scripts[\\/]start-runner\.ps1)"/i)
    || s.match(/'([^']*[\\/]scripts[\\/]start-runner\.ps1)'/i)
    || s.match(/(\S*[\\/]scripts[\\/]start-runner\.ps1)/i);
  if (!m) return "";
  return m[1].replace(/[\\/]scripts[\\/]start-runner\.ps1$/i, ""); // repo root = parent of scripts/
}

module.exports = { logPath, taskStateArgs, taskControlArgs, taskActionArgs, runnerSelfUpdateArgs, repoRootFromTaskArguments };
