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
// Ordem de resolução (regra única em src/shared/hub-config.js, testada lá):
//   o que o usuário salvou NO APP > env JARVIS_APP_HUB_URL > Hub do runner desta máquina > loopback.
// O passo do runner existe porque numa máquina só-runner não há Hub em 127.0.0.1:4577; o primeiro
// existe porque, sem ele, corrigir o endereço exigia sair do app e rodar PowerShell.
const { normalizeHubUrl, readRunnerHubUrl } = require("./src/shared/hub-url")
const { readSavedHubUrl, resolveHubTarget } = require("./src/shared/hub-config")
const { registerSetupIpc, probe } = require("./src/setup/register-setup-ipc")

/** Estado mutável: salvar um endereço novo na tela de configuração re-resolve tudo sem reiniciar. */
let hubTarget = { url: "http://127.0.0.1:4577", source: "fallback", sourceLabel: "padrão", usedFallback: true, candidates: [] }
/** Último erro de carga, para a tela de configuração explicar o que aconteceu. */
let lastLoadError
function resolveHub() {
  hubTarget = resolveHubTarget({
    saved: readSavedHubUrl(app.getPath("userData")),
    env: process.env.JARVIS_APP_HUB_URL,
    runner: readRunnerHubUrl(),
    normalize: normalizeHubUrl,
  })
  if (hubTarget.warning) console.warn(`[jarvis] ${hubTarget.warning}`)
  console.log(`[jarvis] Hub: ${hubTarget.url} (${hubTarget.sourceLabel})`)
  return hubTarget
}
const hubUrl = () => hubTarget.url

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

// Falha de carga pintava a janela de `backgroundColor` e pronto: preto, para sempre, sem UMA palavra.
// Depois virou uma tela de texto que só EXPLICAVA o problema e mandava rodar PowerShell. Agora é uma
// tela que RESOLVE: setup.html edita o endereço, testa a conexão e reconecta sem sair do app — a
// primeira coisa que alguém precisa fazer numa máquina onde o app ainda não sabe onde fica o Hub.
let showingError = false
function showSetupPage(code, desc) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  lastLoadError = code === undefined ? undefined : `erro ${code}${desc ? " — " + desc : ""}`
  showingError = true
  // Fica em src/setup/ e não na raiz de propósito: o electron-builder empacota `main.js`,
  // `preload.js` e `src/**/*` — um arquivo solto na raiz NÃO entraria no instalador, e a tela de
  // recuperação existiria só no `npm start` de desenvolvimento.
  mainWindow.loadFile(path.join(__dirname, "src", "setup", "setup.html")).catch((e) => {
    // Se até a tela de recuperação falhar, o pior desfecho possível é a janela preta de novo. Um
    // texto mínimo, sem arquivo e sem script, ainda diz onde mexer.
    console.error("[jarvis] setup.html não carregou:", e && e.message)
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    const html = `<!doctype html><meta charset="utf-8"><title>Jarvis</title>
      <body style="margin:0;background:#0b0b0d;color:#e6e6e6;font:15px/1.6 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
      <div style="max-width:620px;padding:32px">
      <h1 style="font-size:19px;margin:0 0 10px">Não consegui falar com o Hub</h1>
      <p>Tentei <b style="color:#7ecbff;word-break:break-all">${esc(hubUrl())}</b> (${esc(hubTarget.sourceLabel)})${lastLoadError ? " — " + esc(lastLoadError) : ""}.</p>
      <p style="color:#9aa4b2;font-size:13.5px">A tela de configuração não abriu. Use o ícone do Jarvis na bandeja →
      <b>Configurar endereço do Hub…</b>, ou defina <code>JARVIS_APP_HUB_URL</code>.</p></div>`
    mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).catch(() => {})
  })
}

// Antes isto recarregava a URL do Hub às cegas a cada backoff. Com uma tela de configuração no lugar
// da tela de texto isso virou um bug: o recarregamento arrancava o usuário do formulário no meio da
// digitação. Agora o backoff só SONDA o /health; a janela só é trocada quando o Hub responde de
// verdade — o "assim que o Hub responder, esta tela sai" continua valendo, sem atropelar ninguém.
function scheduleReload() {
  if (reloadTimer) return
  reloadTimer = setTimeout(async () => {
    reloadTimer = null
    if (!mainWindow || mainWindow.isDestroyed()) return
    const alive = await probe(hubUrl(), 3000)
    if (alive.ok) { showingError = false; lastLoadError = undefined; mainWindow.loadURL(hubUrl()).catch(() => {}) }
    else scheduleReload()
  }, reloadDelay)
  reloadDelay = Math.min(reloadDelay * 2, RELOAD_MAX_MS)
}

/** Re-resolve a precedência e conecta já — usado pela tela de configuração ao salvar/limpar/tentar. */
function rereadAndReload() {
  resolveHub()
  if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null }
  reloadDelay = RELOAD_BASE_MS
  if (!mainWindow || mainWindow.isDestroyed()) return createWindow(true)
  showingError = false
  lastLoadError = undefined
  mainWindow.loadURL(hubUrl()).catch(() => {})
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
      if (new URL(url).origin !== new URL(hubUrl()).origin) {
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
    if (isMainFrame && errorCode !== -3) { showSetupPage(errorCode, desc); scheduleReload() }
  })

  // Closing the window HIDES it to the tray (Jarvis keeps running in the background); real quit is the
  // tray "Sair" (quitApp sets app.isQuitting first).
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide() }
  })
  mainWindow.on("closed", () => {
    mainWindow = null
  })

  mainWindow.loadURL(hubUrl()).catch(() => scheduleReload())
}

// O app nunca subiu nada: so apontava para uma URL. Abrir o Jarvis sem Hub no ar nao serve para nada.
// Quem cria o processo e o Agendador de Tarefas, entao o Hub NAO e filho do Electron e sobrevive ao
// `app.quit()` por construcao — e nada aqui pode mata-lo na saida (ver `window-all-closed` no fim).
function ensureHubUp() {
  if (process.platform !== "win32") return           // so o Windows tem servico/tarefa JarvisHub
  let host = ""
  try { host = new URL(hubUrl()).hostname } catch { return }
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) return   // Hub remoto nao e nosso para subir
  const req = http.get(`${hubUrl().replace(/\/+$/, "")}/health`, { timeout: 1500 }, (res) => { res.resume() })
  const start = () => {
    try {
      spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        // Servico quando existe, tarefa quando nao. A migracao para servico do Windows DESATIVA a
        // tarefa homonima, e `Start-ScheduledTask` numa tarefa Disabled falha calado — era por isso
        // que abrir o Jarvis so dizia "nada rodando" em vez de subir o Hub. Decidido em tempo de
        // execucao para servir maquina migrada e nao migrada com o mesmo comando.
        "-Command", "if (Get-Service -Name 'JarvisHub' -ErrorAction SilentlyContinue) { Start-Service -Name 'JarvisHub' } else { Start-ScheduledTask -TaskName 'JarvisHub' }"],
        { detached: true, stdio: "ignore", windowsHide: true }).unref()
      console.log("[jarvis] Hub fora do ar — disparei o JarvisHub (servico ou tarefa)")
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
  resolveHub() // precisa do app pronto para `getPath("userData")`; define o alvo antes da 1a janela
  registerSetupIpc({
    ipcMain,
    userDataDir: app.getPath("userData"),
    hubState: () => hubTarget,
    lastError: () => lastLoadError,
    rereadAndReload,
  })
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
  try {
    tray = createTray({
      showWindow, quit: quitApp,
      // Abre a tela de endereço a pedido, não só depois de uma falha de carga: dá para corrigir o
      // Hub mesmo com a janela conectada em outro (ou escondida no tray).
      openHubSetup: () => { showWindow(); showSetupPage() },
    })
  } catch (e) { console.error("[jarvis] tray falhou:", e && e.message) }
  updater.checkOnBoot()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true); else showWindow()
  })
})

// With the tray, closing the last window does NOT quit — Jarvis stays in the background. Quit is the
// tray "Sair" (quitApp). Keeping the process alive on all platforms is the whole point of the tray.
app.on("window-all-closed", () => { /* intentionally no-op: the tray keeps Jarvis running */ })
