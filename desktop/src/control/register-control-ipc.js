// Side-effectful half of the tray control center: probes Hub/Runner health on a timer and runs the
// menu actions. The DECISIONS (classify/menu/commands) live in the pure modules (unit-tested); this
// file only wires them to fetch/child_process/Notification. Cross-OS: the Runner service is managed via
// Task Scheduler (Windows), launchd (macOS) or systemd --user (Linux) — see runnerService() in
// actions.js. Hub controls (restart/update/logs) are HTTP/file-based and already OS-agnostic.

const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { classify, hubWentOffline, HUB_HEALTH_URL, HUB_ADMIN_URL } = require("./status.js");
const { runnerService, repoRootFromUnixService, logPath } = require("./actions.js");

const POLL_MS = 3000;
const svc = runnerService(process.platform);

/** Spawn a command spec ({cmd,args}) and resolve its {code,out,err}. Never rejects (missing binary,
 *  timeout, non-Windows PowerShell, etc. → a benign negative code). */
function run(spec, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!spec || !spec.cmd) return resolve({ code: -1, out: "", err: "no-op" });
    let out = "", err = "", done = false, p;
    const finish = (code) => { if (done) return; done = true; resolve({ code, out: out.trim(), err: err.trim() }); };
    try { p = spawn(spec.cmd, spec.args || [], { windowsHide: true }); }
    catch (e) { return finish(-1); }
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } finish(-2); }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => { clearTimeout(timer); finish(-1); });
    p.on("close", (c) => { clearTimeout(timer); finish(c ?? 0); });
  });
}

/** Probe whether this machine has a Runner service and whether it's running — per-OS. */
async function probeRunner() {
  if (svc.kind === "win") {
    const out = (await run(svc.statusSpec(), 5000)).out;
    const present = svc.parsePresent(out);
    return { present, running: present ? svc.parseRunning(out) : null };
  }
  // mac/linux: "present" = the service definition file exists (installed as a runner).
  const present = !!svc.defPath && existsSync(svc.defPath);
  if (!present) return { present: false, running: null };
  const r = await run(svc.runningSpec(), 5000);
  return { present: true, running: svc.parseRunning(r.out, r.code) };
}

/** Discover the runner's repo root (for the runner-only "update now"), per-OS. */
async function discoverRepoRoot() {
  if (svc.kind === "win") return svc.parseRoot((await run(svc.discoverSpec(), 5000)).out);
  try { return svc.defPath ? repoRootFromUnixService(readFileSync(svc.defPath, "utf8")) : ""; } catch { return ""; }
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
  const { present: hasRunnerTask, running: runnerRunning } = await probeRunner();
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
  discoverRepoRoot().then((r) => { repoRoot = r; }).catch(() => {});

  void tick();
  timer = setInterval(() => void tick(), POLL_MS);
  if (timer.unref) timer.unref();

  const actions = {
    async restartHub() { await fetch(`${HUB_ADMIN_URL}/admin/restart`, { method: "POST", signal: AbortSignal.timeout(4000) }).catch(() => {}); },
    async updateRunners() { await fetch(`${HUB_ADMIN_URL}/admin/update-runners`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {}); },
    async runnerControl(action) { await run(svc.controlSpec(action), 8000); setTimeout(() => void tick(), 800); },
    async runnerSelfUpdate() { if (repoRoot) await run(svc.selfUpdateSpec(repoRoot), 120000); },
    logPath,
    refresh: () => void tick(),
    getState: () => prev,
  };

  return { actions, stop: () => { if (timer) clearInterval(timer); } };
}

module.exports = { startControl, probe };
