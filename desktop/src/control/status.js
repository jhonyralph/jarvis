// Pure status + tray-menu model for the "Jarvis Control" tray (see register-control-ipc.js for the
// side-effectful probing/actions). Kept pure so it unit-tests headless — Electron never runs in CI.
//
// A machine can be a Hub, a Runner, or both. The tray auto-adapts from two probed capabilities:
//   hasHub        — the Hub health endpoint (:4577/health) answered
//   hasRunnerTask — a `JarvisRunner` scheduled task exists on this machine
// Runner-only (e.g. Notebook) = hasRunnerTask && !hasHub → Hub controls hidden, "update" becomes git-pull.

const HUB_HEALTH_URL = "http://127.0.0.1:4577/health";
const HUB_ADMIN_URL = "http://127.0.0.1:4578";
const RUNNER_TASK = "JarvisRunner";

/** @typedef {"ok"|"warn"|"down"} Level */

/**
 * Fold a probe snapshot into the overall tray state.
 * @param {{hasHub:boolean, hubReachable:boolean, hubVersion?:string, hasRunnerTask:boolean, runnerRunning:boolean|null}} s
 * @returns {{level:Level, hub:{present:boolean,up:boolean,version:string}, runner:{present:boolean,up:boolean|null}, runnerOnly:boolean, tooltip:string}}
 */
function classify(s) {
  const hub = { present: !!s.hasHub, up: !!s.hubReachable, version: s.hubVersion || "" };
  const runner = { present: !!s.hasRunnerTask, up: s.hasRunnerTask ? !!s.runnerRunning : null };
  const runnerOnly = runner.present && !hub.present;

  // Level: down if a present component that should be up is down; warn if partial; ok otherwise.
  let level = "ok";
  if (hub.present && !hub.up) level = "down";
  else if (runner.present && runner.up === false) level = runnerOnly ? "down" : "warn";
  if (!hub.present && !runner.present) level = "down"; // nothing detected — likely nothing running

  const parts = [];
  if (hub.present) parts.push(`Hub ${hub.up ? `no ar${hub.version ? ` ${hub.version}` : ""}` : "OFFLINE"}`);
  if (runner.present) parts.push(`Runner ${runner.up ? "ativo" : "parado"}`);
  if (!parts.length) parts.push("Jarvis não detectado nesta máquina");
  return { level, hub, runner, runnerOnly, tooltip: `Jarvis — ${parts.join(" · ")}` };
}

/** Detect the up→down transition of a PRESENT hub (for a one-shot offline notification). */
function hubWentOffline(prev, next) {
  return !!prev && !!next && prev.hub.present && next.hub.present && prev.hub.up === true && next.hub.up === false;
}

/**
 * Build the tray menu as pure data (label/id/enabled/type). The Electron layer maps `id` → click.
 * Only shows controls for components that exist on THIS machine.
 * @param {ReturnType<typeof classify>} st
 * @param {{openAtLogin?:boolean}} [opts]
 */
function trayTemplate(st, opts = {}) {
  const items = [];
  items.push({ id: "open", label: "Abrir Jarvis", enabled: st.hub.present || st.runnerOnly });
  items.push({ type: "separator" });

  if (st.hub.present) {
    items.push({ id: "hub-header", label: st.hub.up ? `● Hub no ar${st.hub.version ? ` (${st.hub.version})` : ""}` : "○ Hub OFFLINE", enabled: false });
    items.push({ id: "hub-restart", label: "Reiniciar Hub", enabled: true });
    items.push({ id: "update-runners", label: "Atualizar máquinas", enabled: st.hub.up });
    items.push({ id: "logs-hub", label: "Abrir log do Hub", enabled: true });
    items.push({ type: "separator" });
  }

  if (st.runner.present) {
    items.push({ id: "runner-header", label: st.runner.up ? "● Runner ativo" : "○ Runner parado", enabled: false });
    items.push({ id: st.runner.up ? "runner-stop" : "runner-start", label: st.runner.up ? "Parar Runner" : "Iniciar Runner", enabled: true });
    if (st.runnerOnly) items.push({ id: "runner-update", label: "Atualizar esta máquina (git pull + reiniciar)", enabled: true });
    items.push({ id: "logs-runner", label: "Abrir log do Runner", enabled: true });
    items.push({ type: "separator" });
  }

  if (!st.hub.present && !st.runner.present) {
    items.push({ id: "none", label: "Nada rodando — inicie o Hub/Runner", enabled: false });
    items.push({ type: "separator" });
  }

  items.push({ id: "login", label: "Iniciar no logon", type: "checkbox", checked: !!opts.openAtLogin, enabled: true });
  items.push({ id: "quit", label: "Sair", enabled: true });
  return items;
}

module.exports = { classify, hubWentOffline, trayTemplate, HUB_HEALTH_URL, HUB_ADMIN_URL, RUNNER_TASK };
