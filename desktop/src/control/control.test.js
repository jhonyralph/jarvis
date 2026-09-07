// The tray's decision logic is pure so it tests headless (Electron never runs in CI). Locks the
// state classification, the offline-transition detector, the menu model, and the command builders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { classify, hubWentOffline, trayTemplate } = req("./status.js");
const { logPath, taskStateArgs, taskControlArgs, runnerSelfUpdateArgs, repoRootFromTaskArguments, runnerService, repoRootFromUnixService } = req("./actions.js");

const ids = (t) => t.filter((i) => i.id).map((i) => i.id);

test("classify: hub up + runner up → ok", () => {
  const st = classify({ hasHub: true, hubReachable: true, hubVersion: "v0.8.0", hasRunnerTask: false, runnerRunning: null });
  assert.equal(st.level, "ok");
  assert.equal(st.hub.up, true);
  assert.match(st.tooltip, /Hub no ar v0\.8\.0/);
});

test("classify: present hub that is unreachable → down", () => {
  const st = classify({ hasHub: true, hubReachable: false, hasRunnerTask: false, runnerRunning: null });
  assert.equal(st.level, "down");
  assert.match(st.tooltip, /OFFLINE/);
});

test("classify: runner-only machine (Notebook) — no hub, runner stopped → down + runnerOnly", () => {
  const st = classify({ hasHub: false, hubReachable: false, hasRunnerTask: true, runnerRunning: false });
  assert.equal(st.runnerOnly, true);
  assert.equal(st.level, "down");
  const t = trayTemplate(st);
  assert.equal(ids(t).includes("hub-restart"), false, "no hub controls on a runner-only box");
  assert.ok(ids(t).includes("runner-start"), "offers to start the stopped runner");
  assert.ok(ids(t).includes("runner-update"), "runner-only gets git-pull update");
});

test("classify: hub machine with runner up shows hub controls, not runner-only update", () => {
  const st = classify({ hasHub: true, hubReachable: true, hubVersion: "v0.8.0", hasRunnerTask: true, runnerRunning: true });
  const t = trayTemplate(st, { openAtLogin: true });
  assert.ok(ids(t).includes("hub-restart"));
  assert.ok(ids(t).includes("update-runners"));
  assert.ok(ids(t).includes("runner-stop"));
  assert.equal(ids(t).includes("runner-update"), false);
  const login = t.find((i) => i.id === "login");
  assert.equal(login.checked, true);
  assert.ok(ids(t).includes("quit"));
});

test("classify: nothing detected → down with a hint", () => {
  const st = classify({ hasHub: false, hubReachable: false, hasRunnerTask: false, runnerRunning: null });
  assert.equal(st.level, "down");
  assert.ok(ids(trayTemplate(st)).includes("none"));
});

test("hubWentOffline: fires only on a present-hub up→down edge", () => {
  const up = classify({ hasHub: true, hubReachable: true });
  const down = classify({ hasHub: true, hubReachable: false });
  assert.equal(hubWentOffline(up, down), true);
  assert.equal(hubWentOffline(down, up), false, "recovery is not an offline event");
  assert.equal(hubWentOffline(up, up), false);
  assert.equal(hubWentOffline(null, down), false);
});

test("action builders: servico OU tarefa no MESMO comando, args seguros, caminhos de log", () => {
  assert.match(logPath("hub"), /[\\/]\.jarvis[\\/]hub\.log$/);
  assert.match(logPath("runner"), /runner\.log$/);
  // Um comando so, que decide em tempo de execucao. Os dois ramos sao obrigatorios: sem o de
  // servico, maquina migrada perde o botao de ligar (foi o bug — a migracao desativa a tarefa
  // homonima e Start-ScheduledTask numa tarefa Disabled falha calado); sem o de tarefa, maquina
  // nao migrada perde o dela.
  const start = taskControlArgs("JarvisRunner", "start").at(-1);
  assert.match(start, /Get-Service -Name 'JarvisRunner'/);
  assert.match(start, /Start-Service -Name 'JarvisRunner'/);
  assert.match(start, /Start-ScheduledTask -TaskName 'JarvisRunner'/);
  const stop = taskControlArgs("JarvisRunner", "stop").at(-1);
  assert.match(stop, /Stop-Service -Name 'JarvisRunner'/);
  assert.match(stop, /Stop-ScheduledTask -TaskName 'JarvisRunner'/);
  const state = taskStateArgs("JarvisRunner").at(-1);
  assert.match(state, /Get-Service -Name 'JarvisRunner'/);
  assert.match(state, /Get-ScheduledTask -TaskName 'JarvisRunner'/);
  assert.match(state, /'Running'/, "o vocabulario da tarefa e o contrato dos parsers a jusante");
  const upd = runnerSelfUpdateArgs("C:/repo", "JarvisRunner").at(-1);
  assert.match(upd, /git fetch --tags origin; git pull --ff-only/);
  assert.match(upd, /Restart-Service -Name 'JarvisRunner' -Force/);
  assert.match(upd, /Start-ScheduledTask -TaskName 'JarvisRunner'/);
});

test("repoRootFromTaskArguments extracts the repo root from the task's -File path", () => {
  assert.equal(repoRootFromTaskArguments('-ExecutionPolicy Bypass -File "C:\\Users\\J\\Workspace\\jarvis\\scripts\\start-runner.ps1"'), "C:\\Users\\J\\Workspace\\jarvis");
  assert.equal(repoRootFromTaskArguments("-File /home/j/jarvis/scripts/start-runner.ps1"), "/home/j/jarvis");
  assert.equal(repoRootFromTaskArguments("nada aqui"), "");
});

test("repoRootFromTaskArguments tambem le o binPath de um SERVICO, nao so os Arguments da tarefa", () => {
  // taskActionArgs passou a devolver PathName quando ha servico. Os dois formatos carregam o mesmo
  // -File "<root>\\scripts\\start-runner.ps1", entao um parser so serve aos dois.
  const binPath = '"C:\\Users\\J\\.jarvis\\bin\\JarvisService.exe" JarvisRunner "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"'
    + ' "C:\\Users\\J\\Workspace\\jarvis" "C:\\Users\\J\\.jarvis\\runner.log" -NoProfile -NonInteractive -ExecutionPolicy Bypass'
    + ' -File "C:\\Users\\J\\Workspace\\jarvis\\scripts\\start-runner.ps1" -Once';
  assert.equal(repoRootFromTaskArguments(binPath), "C:\\Users\\J\\Workspace\\jarvis");
});

test("runnerService(win32): um spec cobre servico e tarefa; parsers inalterados", () => {
  const s = runnerService("win32");
  assert.equal(s.kind, "win");
  assert.equal(s.defPath, null);
  const start = s.controlSpec("start").args.at(-1);
  assert.match(start, /Start-Service -Name 'JarvisRunner'/);
  assert.match(start, /Start-ScheduledTask -TaskName 'JarvisRunner'/);
  assert.equal(s.parsePresent("Running"), true);
  assert.equal(s.parsePresent("  "), false);
  assert.equal(s.parseRunning("Running"), true);
  assert.equal(s.parseRunning("Ready"), false);
});

test("runnerService(darwin): launchd agent — load/unload, PID = running", () => {
  const s = runnerService("darwin");
  assert.equal(s.kind, "launchd");
  assert.match(s.defPath, /[\\/]LaunchAgents[\\/]com\.jarvis\.runner\.plist$/);
  assert.deepEqual(s.controlSpec("start"), { cmd: "launchctl", args: ["load", s.defPath] });
  assert.deepEqual(s.controlSpec("stop"), { cmd: "launchctl", args: ["unload", s.defPath] });
  assert.deepEqual(s.runningSpec(), { cmd: "launchctl", args: ["list", "com.jarvis.runner"] });
  assert.equal(s.parseRunning('\t"PID" = 4321;', 0), true, "a PID means running");
  assert.equal(s.parseRunning('Could not find service', 1), false, "not loaded → not running");
  assert.equal(s.parseRunning('no pid here', 0), false);
  assert.match(s.selfUpdateSpec("/Users/j/jarvis").args.at(-1), /git pull --ff-only[\s\S]*launchctl load/);
});

test("runnerService(linux): systemd --user — start/stop, is-active", () => {
  const s = runnerService("linux");
  assert.equal(s.kind, "systemd");
  assert.match(s.defPath, /[\\/]systemd[\\/]user[\\/]jarvis-runner\.service$/);
  assert.deepEqual(s.controlSpec("start"), { cmd: "systemctl", args: ["--user", "start", "jarvis-runner.service"] });
  assert.deepEqual(s.controlSpec("stop"), { cmd: "systemctl", args: ["--user", "stop", "jarvis-runner.service"] });
  assert.deepEqual(s.runningSpec(), { cmd: "systemctl", args: ["--user", "is-active", "jarvis-runner.service"] });
  assert.equal(s.parseRunning("active", 0), true);
  assert.equal(s.parseRunning("inactive", 3), false);
  assert.match(s.selfUpdateSpec("/home/j/jarvis").args.at(-1), /git pull --ff-only && systemctl --user restart jarvis-runner\.service/);
});

test("repoRootFromUnixService: extracts the repo root from a plist OR a systemd unit", () => {
  assert.equal(repoRootFromUnixService("<string>/Users/j/jarvis/scripts/start-runner.sh</string>"), "/Users/j/jarvis");
  assert.equal(repoRootFromUnixService("ExecStart=/bin/sh /home/j/jarvis/scripts/start-runner.sh"), "/home/j/jarvis");
  assert.equal(repoRootFromUnixService("sem caminho"), "");
});
