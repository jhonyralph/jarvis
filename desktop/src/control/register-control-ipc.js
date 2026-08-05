// Side-effectful half of the tray control center: probes Hub/Runner health on a timer and runs the
// menu actions. The DECISIONS (classify/menu/commands) live in the pure modules (unit-tested); this
// file only wires them to fetch/child_process/Notification. Windows is the first-class host (scheduled
// tasks); on macOS/Linux the runner-task controls are skipped (launchd/systemd is a follow-up).

const { spawn } = require("node:child_process");
const { classify, hubWentOffline, HUB_HEALTH_URL, HUB_ADMIN_URL, RUNNER_TASK } = require("./status.js");
const { taskStateArgs, taskControlArgs, taskActionArgs, runnerSelfUpdateArgs, repoRootFromTaskArguments, logPath } = require("./actions.js");

const IS_WIN = process.platform === "win32";
const POLL_MS = 3000;

function runPs(args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!IS_WIN) return resolve({ code: -1, out: "", err: "não-Windows" });
    let out = "", err = "", done = false;
    const p = spawn("powershell.exe", ["-NoLogo", ...args], { windowsHide: true });
    const finish = (code) => { if (done) return; done = true; resolve({ code, out: out.trim(), err: err.trim() }); };
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } finish(-2); }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => { clearTimeout(timer); finish(-1); });
    p.on("close", (c) => { clearTimeout(timer); finish(c ?? 0); });
  });
}

async function fetchJson(url, ms = 1500) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
async function probeUp(url, ms = 1500) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok; } catch { return false; }
}

/** One full probe → classified state (+ discovered repoRoot for runner-only update). */
async function probe() {
  const hubReachable = await probeUp(HUB_HEALTH_URL);
  const upd = hubReachable ? await fetchJson(`${HUB_ADMIN_URL}/admin/update`) : null;
  const hubVersion = upd && typeof upd.current === "string" ? (upd.latest?.sha && upd.behind ? upd.current : upd.current) : "";
  // A hub is "present" if it answered health OR its loopback admin is up (covers a hub mid-restart).
  const adminUp = hubReachable || (await probeUp(`${HUB_ADMIN_URL}/admin/update`, 800));
  const taskState = IS_WIN ? (await runPs(taskStateArgs(RUNNER_TASK), 5000)).out : "";
  const hasRunnerTask = !!taskState;
  const runnerRunning = hasRunnerTask ? /running/i.test(taskState) : null;
  const st = classify({ hasHub: hubReachable || adminUp, hubReachable, hubVersion, hasRunnerTask, runnerRunning });
  return st;
}

/** Start polling. `onState(state)` fires immediately and on every change. Returns controls for the tray. */
function startControl({ onState, notify }) {
  let prev = null;
  let repoRoot = "";
  let timer = null;

  const emit = (st) => { if (onState) onState(st); prev = st; };

  const tick = async () => {
    const st = await probe();
    if (prev && hubWentOffline(prev, st) && notify) notify("Jarvis — Hub offline", "O Hub parou de responder. Clique para abrir e verificar.");
    emit(st);
  };

  // discover the runner repo root once (best-effort) for the runner-only "update now"
  runPs(taskActionArgs(RUNNER_TASK), 5000).then((r) => { repoRoot = repoRootFromTaskArguments(r.out); }).catch(() => {});

  void tick();
  timer = setInterval(() => void tick(), POLL_MS);
  if (timer.unref) timer.unref();

  const actions = {
    async restartHub() { await fetch(`${HUB_ADMIN_URL}/admin/restart`, { method: "POST", signal: AbortSignal.timeout(4000) }).catch(() => {}); },
    async updateRunners() { await fetch(`${HUB_ADMIN_URL}/admin/update-runners`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {}); },
    async runnerControl(action) { await runPs(taskControlArgs(RUNNER_TASK, action), 8000); setTimeout(() => void tick(), 800); },
    async runnerSelfUpdate() { if (repoRoot) await runPs(runnerSelfUpdateArgs(repoRoot, RUNNER_TASK), 120000); },
    logPath,
    refresh: () => void tick(),
    getState: () => prev,
  };

  return { actions, stop: () => { if (timer) clearInterval(timer); } };
}

module.exports = { startControl, probe };
