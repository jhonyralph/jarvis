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

/** Repo root from a UNIX service definition (launchd plist OR systemd unit) — both reference
 *  `<root>/scripts/start-runner.sh`. Excludes quotes/`<>`/spaces so it works for either format. */
function repoRootFromUnixService(text) {
  const m = String(text || "").match(/([^\s"'<>]+)\/scripts\/start-runner\.sh/);
  return m ? m[1] : "";
}

/**
 * Per-OS Runner service adapter. Returns pure command SPECS ({cmd,args}) + parsers so the
 * side-effect layer (register-control-ipc.js) is platform-agnostic and this stays unit-testable.
 *   Windows → Task Scheduler (JarvisRunner)   · present/running from one Get-ScheduledTask call
 *   macOS   → launchd (com.jarvis.runner)     · present = plist exists; control = launchctl load/unload
 *   Linux   → systemd --user (jarvis-runner)  · present = unit exists; control = systemctl start/stop
 * `defPath` (mac/linux) is the service file whose existence means "this machine is a runner" and whose
 * contents yield the repo root; on Windows it's null (discovery is a separate task-query spec).
 */
function runnerService(platform) {
  if (platform === "darwin") {
    const plist = join(homedir(), "Library", "LaunchAgents", "com.jarvis.runner.plist");
    return {
      kind: "launchd", defPath: plist,
      runningSpec: () => ({ cmd: "launchctl", args: ["list", "com.jarvis.runner"] }),
      parseRunning: (out, code) => code === 0 && /"PID"\s*=\s*\d+/.test(String(out)),
      // KeepAlive=true, so a plain `stop` would just respawn — load/unload the agent to truly start/stop.
      controlSpec: (action) => ({ cmd: "launchctl", args: [action === "start" ? "load" : "unload", plist] }),
      selfUpdateSpec: (root) => ({ cmd: "/bin/sh", args: ["-c",
        `cd '${root}' && git fetch --tags origin && git pull --ff-only; launchctl unload '${plist}' 2>/dev/null; sleep 2; launchctl load '${plist}'`] }),
    };
  }
  if (platform === "linux") {
    const unit = "jarvis-runner.service";
    const def = join(homedir(), ".config", "systemd", "user", unit);
    return {
      kind: "systemd", defPath: def,
      runningSpec: () => ({ cmd: "systemctl", args: ["--user", "is-active", unit] }),
      parseRunning: (out, code) => code === 0 || String(out).trim() === "active",
      controlSpec: (action) => ({ cmd: "systemctl", args: ["--user", action === "start" ? "start" : "stop", unit] }),
      selfUpdateSpec: (root) => ({ cmd: "/bin/sh", args: ["-c",
        `cd '${root}' && git fetch --tags origin && git pull --ff-only && systemctl --user restart ${unit}`] }),
    };
  }
  // win32 (default): scheduled tasks via PowerShell (present + running come from one status call).
  const task = "JarvisRunner";
  return {
    kind: "win", defPath: null,
    statusSpec: () => ({ cmd: "powershell.exe", args: ["-NoLogo", ...taskStateArgs(task)] }),
    parsePresent: (out) => !!String(out).trim(),
    parseRunning: (out) => /running/i.test(String(out)),
    discoverSpec: () => ({ cmd: "powershell.exe", args: ["-NoLogo", ...taskActionArgs(task)] }),
    parseRoot: (out) => repoRootFromTaskArguments(out),
    controlSpec: (action) => ({ cmd: "powershell.exe", args: ["-NoLogo", ...taskControlArgs(task, action)] }),
    selfUpdateSpec: (root) => ({ cmd: "powershell.exe", args: ["-NoLogo", ...runnerSelfUpdateArgs(root, task)] }),
  };
}

module.exports = { logPath, taskStateArgs, taskControlArgs, taskActionArgs, runnerSelfUpdateArgs, repoRootFromTaskArguments, repoRootFromUnixService, runnerService };
