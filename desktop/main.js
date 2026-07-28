// Jarvis desktop shell — Electron main process (Phase 0).
//
// Strategy (see docs/specs/DSK-01-12-desktop-design-mode.md):
//   - This is a rich CLIENT, not a rewrite. Hub/Runner stay authoritative; this window just
//     loads the LIVE Hub UI (same "OTA / reload is the deploy" model as the Capacitor app).
//   - It reaches the Hub only over the operator's private network (Tailscale/loopback).
//     LEI 5: no cloud relay, no external endpoint.
//   - Phase 0 exposes ONLY shell identity via preload (window.jarvis). Design Mode (webviewTag,
//     capturePage, the browser bridge) lands in Phase 1 — webviewTag stays OFF here.
//
// Runs with no build step: `npm install && npm start`.

const { app, BrowserWindow, shell, ipcMain, webContents } = require("electron")
const path = require("node:path")
const { registerBrowserIpc } = require("./src/browser/register-browser-ipc")
const { registerUpdaterIpc } = require("./src/updater/register-updater-ipc")

// Where the live Hub UI lives. Same env name as the Capacitor shell (mobile/capacitor.config.ts).
const HUB_URL = process.env.JARVIS_APP_HUB_URL || "http://127.0.0.1:4577"

// Retry loading the Hub UI with backoff — the Hub may still be starting, or a remote Hub may be
// briefly unreachable on the tailnet. We never fabricate state; we just keep trying to connect.
const RELOAD_BASE_MS = 1500
const RELOAD_MAX_MS = 15000

/** @type {BrowserWindow | null} */
let mainWindow = null
let reloadTimer = null
let reloadDelay = RELOAD_BASE_MS

function scheduleReload() {
  if (reloadTimer) return
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(HUB_URL).catch(() => {})
    }
  }, reloadDelay)
  reloadDelay = Math.min(reloadDelay * 2, RELOAD_MAX_MS)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0b0b0d",
    title: "Jarvis",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // LEI 8: the page can't reach Node/main except through the audited bridge.
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // Design Mode's embedded <webview> preview (Phase 1).
      // Pass the shell version to preload (preload is sandboxed and can't require package.json).
      additionalArguments: [`--jarvis-shell-version=${app.getVersion()}`],
    },
  })

  // LEI 8: Design Mode's preview <webview> guests get NO preload and NO Node, so a hostile preview
  // page can never reach the window.jarvis bridge or the main process.
  mainWindow.webContents.on("will-attach-webview", (_event, webPreferences) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })

  // Open target=_blank / external origins in the real browser, never a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })
  // Any navigation to a DIFFERENT origin than the Hub goes to the system browser too.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== new URL(HUB_URL).origin) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    } catch {
      /* malformed URL — let Electron handle it */
    }
  })

  mainWindow.webContents.on("did-finish-load", () => {
    reloadDelay = RELOAD_BASE_MS // reset backoff once we're connected
  })
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, _desc, _url, isMainFrame) => {
    // -3 is ERR_ABORTED (e.g. a redirect) — not a real failure.
    if (isMainFrame && errorCode !== -3) scheduleReload()
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  mainWindow.loadURL(HUB_URL).catch(() => scheduleReload())
}

app.whenReady().then(() => {
  registerBrowserIpc({ ipcMain, webContents })
  // Auto-update is driven by the web UI (banner + "check" + "restart and install"), so the user
  // sees it in the same place as everything else instead of a native dialog. Packaged builds only;
  // a dev run reports "unsupported" and the UI simply hides the controls.
  const updater = registerUpdaterIpc({
    ipcMain,
    isPackaged: () => app.isPackaged,
    getWindow: () => mainWindow,
  })
  createWindow()
  updater.checkOnBoot()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
