// Design Mode — main-process IPC handlers backing window.jarvis.browser.* (see preload.js).
//
// The renderer (the Hub-served web UI) owns the <webview> element and passes its webContentsId; main
// resolves the guest WebContents and does the privileged work (inject picker, capturePage). Keeping
// the guest reference in main means a hostile preview page never gets a handle to these capabilities.

const { armProgram, awaitProgram, teardownProgram } = require("./grab-guest-script")
const { captureRegion } = require("./screenshot")

/**
 * @param {{ ipcMain: import("electron").IpcMain, webContents: typeof import("electron").webContents }} deps
 */
function registerBrowserIpc({ ipcMain, webContents }) {
  const guestFor = (id) => {
    const guest = webContents.fromId(id)
    if (!guest || guest.isDestroyed()) throw new Error("PREVIEW_UNREACHABLE")
    return guest
  }

  ipcMain.handle("jarvis:browser:setGrabMode", async (_e, webContentsId, on) => {
    const guest = guestFor(webContentsId)
    await guest.executeJavaScript(on ? armProgram() : teardownProgram())
  })

  ipcMain.handle("jarvis:browser:awaitGrabSelection", async (_e, webContentsId) => {
    const guest = guestFor(webContentsId)
    // The injected Promise resolves with a plain-JSON GrabSelection on the next click.
    return guest.executeJavaScript(awaitProgram())
  })

  ipcMain.handle("jarvis:browser:captureSelectionScreenshot", async (_e, webContentsId, rect) => {
    const guest = guestFor(webContentsId)
    return captureRegion(guest, rect)
  })

  ipcMain.handle("jarvis:browser:cancelGrab", async (_e, webContentsId) => {
    const guest = guestFor(webContentsId)
    await guest.executeJavaScript(teardownProgram())
  })
}

module.exports = { registerBrowserIpc }
