// Auto-update driven by the WEB UI (the Hub-served client), not only by a silent background check.
//
// Why: the shell is a thin client whose UI lives in apps/hub/web. Putting "check for updates" and
// "restart and install" in that UI keeps ONE place for the user to see everything, instead of a
// native dialog the web layer knows nothing about. The main process still owns the privileged part
// (electron-updater); the page only gets an audited request/notify surface through preload.
//
// Contract (mirrors src/browser/register-browser-ipc.js):
//   invoke "jarvis:updater:check"    -> { state, version?, notes?, error? }
//   invoke "jarvis:updater:install"  -> { ok } and quits to install (no-op if nothing downloaded)
//   event  "jarvis:updater:event"    -> { state, version?, percent?, error? } pushed to the page
//
// States: idle | checking | available | downloading | downloaded | none | error | unsupported

const UNSUPPORTED = { state: "unsupported" };

/**
 * @param {object} deps
 * @param {import("electron").IpcMain} deps.ipcMain
 * @param {() => boolean} deps.isPackaged   auto-update only exists in a packaged build
 * @param {() => import("electron").BrowserWindow | null} deps.getWindow
 * @param {() => any} [deps.loadUpdater]    injectable for tests; defaults to electron-updater
 */
function registerUpdaterIpc({ ipcMain, isPackaged, getWindow, loadUpdater }) {
  let updater = null;
  let downloaded = false;
  let wired = false;

  const emit = (payload) => {
    const win = getWindow && getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("jarvis:updater:event", payload);
  };

  /** Lazily resolve electron-updater. Absent (dev run / not installed) => unsupported, never throws. */
  function get() {
    if (updater) return updater;
    if (!isPackaged()) return null;
    try {
      updater = (loadUpdater ? loadUpdater() : require("electron-updater")).autoUpdater;
    } catch {
      return null; // optionalDependency missing — stays a detectable no-op
    }
    // The page decides WHEN to install (a restart mid-conversation would be rude), so we download
    // automatically but never quit on our own.
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    if (!wired) {
      wired = true;
      updater.on("checking-for-update", () => emit({ state: "checking" }));
      updater.on("update-available", (i) => emit({ state: "available", version: i?.version, notes: typeof i?.releaseNotes === "string" ? i.releaseNotes : undefined }));
      updater.on("update-not-available", () => emit({ state: "none" }));
      updater.on("download-progress", (p) => emit({ state: "downloading", percent: Math.round(p?.percent || 0) }));
      updater.on("update-downloaded", (i) => { downloaded = true; emit({ state: "downloaded", version: i?.version }); });
      updater.on("error", (e) => emit({ state: "error", error: String(e?.message || e).slice(0, 300) }));
    }
    return updater;
  }

  ipcMain.handle("jarvis:updater:check", async () => {
    const u = get();
    if (!u) return UNSUPPORTED;
    try {
      const r = await u.checkForUpdates();
      const version = r?.updateInfo?.version;
      // checkForUpdates resolves as soon as the manifest is read; the real outcome arrives through
      // the events above, so the caller gets a best-effort snapshot plus the live stream.
      return { state: version && version !== u.currentVersion ? "available" : "none", version };
    } catch (e) {
      return { state: "error", error: String(e?.message || e).slice(0, 300) };
    }
  });

  ipcMain.handle("jarvis:updater:install", () => {
    const u = get();
    if (!u) return UNSUPPORTED;
    if (!downloaded) return { ok: false, error: "nenhuma atualização baixada ainda" };
    setImmediate(() => u.quitAndInstall()); // let the IPC reply flush before the app dies
    return { ok: true };
  });

  return {
    /** Silent check at boot: the page shows the banner if an update turns up. */
    checkOnBoot() { const u = get(); if (u) u.checkForUpdates().catch(() => {}); },
  };
}

module.exports = { registerUpdaterIpc };
