// The tray's decision logic is pure so it tests headless (Electron never runs in CI). Locks the
// state classification, the offline-transition detector, the menu model, and the command builders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { classify, hubWentOffline, trayTemplate } = req("./status.js");
const { logPath, taskStateArgs, taskControlArgs, runnerSelfUpdateArgs, repoRootFromTaskArguments } = req("./actions.js");

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

test("classify: runner-only machine (Luby) — no hub, runner stopped → down + runnerOnly", () => {
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

test("action builders: fixed task name, safe args, log paths", () => {
  assert.match(logPath("hub"), /[\\/]\.jarvis[\\/]hub\.log$/);
  assert.match(logPath("runner"), /runner\.log$/);
  assert.deepEqual(taskControlArgs("JarvisRunner", "start").slice(-1), ["Start-ScheduledTask -TaskName 'JarvisRunner'"]);
  assert.deepEqual(taskControlArgs("JarvisRunner", "stop").slice(-1), ["Stop-ScheduledTask -TaskName 'JarvisRunner'"]);
  assert.match(taskStateArgs("JarvisRunner").at(-1), /Get-ScheduledTask -TaskName 'JarvisRunner'/);
  assert.match(runnerSelfUpdateArgs("C:/repo", "JarvisRunner").at(-1), /git fetch --tags origin; git pull --ff-only/);
});

test("repoRootFromTaskArguments extracts the repo root from the task's -File path", () => {
  assert.equal(repoRootFromTaskArguments('-ExecutionPolicy Bypass -File "C:\\Users\\J\\Workspace\\jarvis\\scripts\\start-runner.ps1"'), "C:\\Users\\J\\Workspace\\jarvis");
  assert.equal(repoRootFromTaskArguments("-File /home/j/jarvis/scripts/start-runner.ps1"), "/home/j/jarvis");
  assert.equal(repoRootFromTaskArguments("nada aqui"), "");
});
