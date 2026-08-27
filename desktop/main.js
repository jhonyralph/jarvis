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
const http = require("node:http")
const { spawn } = require("node:child_process")
const { registerBrowserIpc } = require("./src/browser/register-browser-ipc")
const { registerUpdaterIpc } = require("./src/updater/register-updater-ipc")
const { createTray } = require("./src/control/tray")

// Where the live Hub UI lives. Same env name as the Capacitor shell (mobile/capacitor.config.ts).
// Normalizado/validado: um valor em formato errado não falha alto — o app entraria no loop de
// reconexão e ficaria numa tela vazia sem dizer o porquê (ver src/shared/hub-url.js).
const { normalizeHubUrl } = require("./src/shared/hub-url")
const hubTarget = normalizeHubUrl(process.env.JARVIS_APP_HUB_URL)
const HUB_URL = hubTarget.url
if (hubTarget.warning) console.warn(`[jarvis] ${hubTarget.warning}`)
console.log(`[jarvis] Hub: ${HUB_URL}${hubTarget.usedFallback ? " (padrão — defina JARVIS_APP_HUB_URL para um Hub remoto)" : ""}`)

// Retry loading the Hub UI with backoff — the Hub may still be starting, or a remote Hub may be
// briefly unreachable on the tailnet. We never fabricate state; we just keep trying to connect.
const RELOAD_BASE_MS = 1500
const RELOAD_MAX_MS = 15000

/** @type {BrowserWindow | null} */
let mainWindow = null
let reloadTimer = null
let reloadDelay = RELOAD_BASE_MS
/** @type {{destroy:()=>void}|null} */
let tray = null
app.isQuitting = false

/** Show/focus the window (recreating it if it was destroyed) — used by the tray and notifications. */
function showWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
  else createWindow(true)
}
/** Real quit (tray "Sair"): a plain window close only HIDES to the tray. */
function quitApp() {
  app.isQuitting = true
  if (tray) { tray.destroy(); tray = null }
  app.quit()
}

// Falha de carga pintava a janela de `backgroundColor` e pronto: preto, para sempre, sem UMA palavra
// — o unico sinal era um console.log do processo main, invisivel quando o app abre pelo atalho. Numa
// maquina que NAO e a do Hub (a env vazia cai no loopback dela mesma) isso e garantido.
let showingError = false
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])) }
function showErrorPage(code, desc) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const dica = hubTarget.usedFallback
    ? `<div class="hint"><b>Esta maquina esta usando o endereco padrao</b> porque <code>JARVIS_APP_HUB_URL</code> nao esta definida.
       Se o Hub roda em OUTRA maquina, aponte o app para ela e reabra pelo tray:
       <pre>powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -HubUrl "http://SEU-HUB:4577"</pre></div>`
    : ""
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Jarvis</title>
    <style>body{margin:0;background:#0b0b0d;color:#e6e6e6;font:15px/1.6 system-ui,Segoe UI,sans-serif;
    display:flex;align-items:center;justify-content:center;height:100vh}
    .c{max-width:640px;padding:32px}h1{font-size:20px;margin:0 0 12px}
    .u{color:#7ecbff;word-break:break-all}.e{color:#ff9b9b}
    .hint{margin-top:20px;padding:14px;background:#17171b;border-left:3px solid #7ecbff;border-radius:4px;font-size:13px}
    pre{white-space:pre-wrap;word-break:break-all;background:#0f0f12;padding:10px;border-radius:4px;font-size:12px}
    .r{margin-top:18px;color:#8a8a8a;font-size:13px}</style>
    <div class="c"><h1>Nao consegui falar com o Hub</h1>
    <p>Tentei carregar <span class="u">${esc(HUB_URL)}</span></p>
    <p class="e">Erro ${esc(code)}${desc ? " &mdash; " + esc(desc) : ""}</p>
    ${dica}<p class="r">Continuo tentando sozinho. Assim que o Hub responder, esta tela sai.</p></div></html>`
  showingError = true
  mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).catch(() => {})
}

function scheduleReload() {
  if (reloadTimer) return
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      showingError = false
      mainWindow.loadURL(HUB_URL).catch(() => {})
    }
  }, reloadDelay)
  reloadDelay = Math.min(reloadDelay * 2, RELOAD_MAX_MS)
}

function createWindow(show = true) {
  mainWindow = new BrowserWindow({
    show, // `--tray` / launched-at-login starts hidden (tray only)
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
    if (showingError) return          // a tela de erro nao conta como conexao: nao zera o backoff
    reloadDelay = RELOAD_BASE_MS // reset backoff once we're connected
  })
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, desc, _url, isMainFrame) => {
    // -3 is ERR_ABORTED (e.g. a redirect) — not a real failure.
    if (isMainFrame && errorCode !== -3) { showErrorPage(errorCode, desc); scheduleReload() }
  })

  // Closing the window HIDES it to the tray (Jarvis keeps running in the background); real quit is the
  // tray "Sair" (quitApp sets app.isQuitting first).
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide() }
  })
  mainWindow.on("closed", () => {
    mainWindow = null
  })

  mainWindow.loadURL(HUB_URL).catch(() => scheduleReload())
}

// O app nunca subiu nada: so apontava para uma URL. Abrir o Jarvis sem Hub no ar nao serve para nada.
// Quem cria o processo e o Agendador de Tarefas, entao o Hub NAO e filho do Electron e sobrevive ao
// `app.quit()` por construcao — e nada aqui pode mata-lo na saida (ver `window-all-closed` no fim).
function ensureHubUp() {
  if (process.platform !== "win32") return           // so o Windows tem a tarefa JarvisHub
  let host = ""
  try { host = new URL(HUB_URL).hostname } catch { return }
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) return   // Hub remoto nao e nosso para subir
  const req = http.get(`${HUB_URL.replace(/\/+$/, "")}/health`, { timeout: 1500 }, (res) => { res.resume() })
  const start = () => {
    try {
      spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-Command", "Start-ScheduledTask -TaskName 'JarvisHub'"],
        { detached: true, stdio: "ignore", windowsHide: true }).unref()
      console.log("[jarvis] Hub fora do ar — disparei a tarefa JarvisHub")
    } catch (e) { console.error("[jarvis] nao consegui disparar JarvisHub:", e && e.message) }
  }
  req.on("timeout", () => { req.destroy(); start() })
  req.on("error", start)
}

// Single instance: pressing Windows→Jarvis (or launching again) focuses the running tray app instead
// of opening a second window/tray.
const HAS_LOCK = app.requestSingleInstanceLock()
if (!HAS_LOCK) app.quit()
app.on("second-instance", () => showWindow())

app.whenReady().then(() => {
  if (!HAS_LOCK) return
  registerBrowserIpc({ ipcMain, webContents })
  // Auto-update is driven by the web UI (banner + "check" + "restart and install"), so the user
  // sees it in the same place as everything else instead of a native dialog. Packaged builds only;
  // a dev run reports "unsupported" and the UI simply hides the controls.
  const updater = registerUpdaterIpc({
    ipcMain,
    isPackaged: () => app.isPackaged,
    getWindow: () => mainWindow,
  })
  // Launched at login (or with --tray) → start hidden in the tray; otherwise show the window.
  try { ensureHubUp() } catch (e) { console.error("[jarvis] ensureHubUp:", e && e.message) }   // fire-and-forget: nunca bloqueia a janela
  const startHidden = process.argv.includes("--tray") || app.getLoginItemSettings().wasOpenedAtLogin
  createWindow(!startHidden)
  try { tray = createTray({ showWindow, quit: quitApp }) } catch (e) { console.error("[jarvis] tray falhou:", e && e.message) }
  updater.checkOnBoot()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true); else showWindow()
  })
})

// With the tray, closing the last window does NOT quit — Jarvis stays in the background. Quit is the
// tray "Sair" (quitApp). Keeping the process alive on all platforms is the whole point of the tray.
app.on("window-all-closed", () => { /* intentionally no-op: the tray keeps Jarvis running */ })
