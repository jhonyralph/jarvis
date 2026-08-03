// Jarvis desktop shell — preload bridge (Phase 0).
//
// Exposes a SINGLE audited surface, window.jarvis, that the Hub-served web UI feature-detects.
// LEI 2: absent capability is a detectable no-op — the UI checks window.jarvis?.capabilities?.*
// and never assumes presence, so the same apps/hub/web keeps working unchanged in a plain browser
// and in the Capacitor shell.
//
// Phase 0 exposes ONLY shell identity + capability flags. The Design Mode surface
// (window.jarvis.browser: openPreview/setGrabMode/awaitGrabSelection/captureSelectionScreenshot)
// is added in Phase 1 — see docs/specs/DSK-01-12-desktop-design-mode.md §4.2.

const { contextBridge, ipcRenderer } = require("electron")

// preload is sandboxed and can't require package.json; main passes the version via argv.
function readShellVersion() {
  const arg = process.argv.find((a) => a.startsWith("--jarvis-shell-version="))
  return arg ? arg.slice("--jarvis-shell-version=".length) : "0.0.0"
}

/** @type {import("./src/shared/bridge-types").JarvisBridge} */
const bridge = {
  shell: "electron",
  shellVersion: readShellVersion(),
  bridgeVersion: 1,
  capabilities: {
    designMode: true,
    autoUpdate: true,
  },
  // Design Mode (Phase 1). The web UI creates the <webview> and passes its webContentsId; main does
  // the privileged work (inject picker, capturePage). See src/browser/register-browser-ipc.js.
  browser: {
    setGrabMode: (webContentsId, on) => ipcRenderer.invoke("jarvis:browser:setGrabMode", webContentsId, on),
    awaitGrabSelection: (webContentsId) => ipcRenderer.invoke("jarvis:browser:awaitGrabSelection", webContentsId),
    captureSelectionScreenshot: (webContentsId, rect) =>
      ipcRenderer.invoke("jarvis:browser:captureSelectionScreenshot", webContentsId, rect),
    cancelGrab: (webContentsId) => ipcRenderer.invoke("jarvis:browser:cancelGrab", webContentsId),
    startCoverage: (webContentsId) => ipcRenderer.invoke("jarvis:browser:startCoverage", webContentsId),
    stopCoverage: (webContentsId) => ipcRenderer.invoke("jarvis:browser:stopCoverage", webContentsId),
  },
  // Auto-update surfaced IN the web UI: check on demand, listen to progress, install when the user
  // says so. Every method resolves to {state:"unsupported"} in a dev run / plain browser, so the UI
  // just hides the controls (LEI 2: absent capability is a detectable no-op).
  updater: {
    check: () => ipcRenderer.invoke("jarvis:updater:check"),
    install: () => ipcRenderer.invoke("jarvis:updater:install"),
    onEvent: (cb) => {
      const h = (_e, payload) => { try { cb(payload); } catch { /* a UI handler must not kill the bridge */ } };
      ipcRenderer.on("jarvis:updater:event", h);
      return () => ipcRenderer.removeListener("jarvis:updater:event", h);
    },
  },
}

contextBridge.exposeInMainWorld("jarvis", Object.freeze(bridge))
