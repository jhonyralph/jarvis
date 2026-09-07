// Pure builders for the tray's side effects (process/HTTP). Kept pure + injection-safe so they can be
// unit-tested headless; register-control-ipc.js executes them. The only interpolated value is a FIXED
// task name / a locally-discovered repo path — never user input.

const { homedir } = require("node:os");
const { join } = require("node:path");

/** Absolute path to a Jarvis log file under ~/.jarvis. */
function logPath(kind) {
  return join(homedir(), ".jarvis", kind === "runner" ? "runner.log" : "hub.log");
}

// No Windows, Hub e Runner podem estar registrados de DUAS formas com o MESMO nome: tarefa agendada
// (instalacao antiga) ou servico do Windows (scripts/install-service.ps1). A migracao para servico
// DESATIVA a tarefa homonima — e foi exatamente isso que tirou do app a capacidade de subir o Hub:
// `Start-ScheduledTask` numa tarefa Disabled falha com "A tarefa esta desabilitada", em silencio,
// e a janela so sabia dizer "nada rodando, inicie o hub/runner".
//
// A escolha entre servico e tarefa fica no PowerShell, em tempo de EXECUCAO, e nao aqui: um unico
// comando serve para maquina migrada e nao migrada, sem uma ida e volta extra so para descobrir
// qual e — e sem o app precisar guardar estado sobre a maquina.
//
// Nenhum dos dois caminhos pede elevacao: a tarefa e do proprio usuario, e o install-service.ps1
// concede START/STOP a conta no ACL do servico (o ACL padrao so da consulta ao usuario interativo).
const svcProbe = (name) => `Get-Service -Name '${name}' -ErrorAction SilentlyContinue`;

/** PowerShell args (for spawn) that print "Running"/"Ready"/"" for the SERVICE or, se nao houver, a
 *  tarefa de mesmo nome. O vocabulario e o da tarefa de proposito: parsePresent/parseRunning a
 *  jusante nao mudam. */
function taskStateArgs(taskName) {
  return ["-NoProfile", "-NonInteractive", "-Command",
    `$s = ${svcProbe(taskName)}; if ($s) { if ($s.Status -eq 'Running') { 'Running' } else { 'Ready' } } `
    + `else { (Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue).State }`];
}

/** PowerShell args to start/stop — servico quando existe, tarefa quando nao. Sem elevacao nos dois. */
function taskControlArgs(taskName, action) {
  const svcVerb = action === "start" ? "Start-Service" : "Stop-Service";
  const taskVerb = action === "start" ? "Start-ScheduledTask" : "Stop-ScheduledTask";
  return ["-NoProfile", "-NonInteractive", "-Command",
    `if (${svcProbe(taskName)}) { ${svcVerb} -Name '${taskName}' } else { ${taskVerb} -TaskName '${taskName}' }`];
}

/** PowerShell args que devolvem a linha de comando do servico (PathName) ou, sem servico, os
 *  Arguments da tarefa — usado para descobrir a raiz do repo do runner. Os dois formatos carregam
 *  o mesmo `-File "<root>\scripts\start-runner.ps1"`, entao repoRootFromTaskArguments serve aos dois. */
function taskActionArgs(taskName) {
  return ["-NoProfile", "-NonInteractive", "-Command",
    `$s = Get-CimInstance Win32_Service | Where-Object Name -eq '${taskName}'; if ($s) { $s.PathName } `
    + `else { (Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue).Actions.Arguments }`];
}

/** Runner-only "update now": fetch tags + fast-forward, then bounce the runner (servico ou tarefa). */
function runnerSelfUpdateArgs(repoPath, taskName) {
  return ["-NoProfile", "-NonInteractive", "-Command",
    `Set-Location '${repoPath}'; git fetch --tags origin; git pull --ff-only; `
    + `if (${svcProbe(taskName)}) { Restart-Service -Name '${taskName}' -Force } `
    + `else { Stop-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Start-ScheduledTask -TaskName '${taskName}' }`];
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
 *   Windows → servico JarvisRunner OU tarefa JarvisRunner · uma chamada resolve os dois
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
