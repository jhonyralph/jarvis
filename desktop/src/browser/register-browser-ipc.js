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
  const coverageSessions = new Map()
  const guestFor = (id) => {
    const guest = webContents.fromId(id)
    if (!guest || guest.isDestroyed()) throw new Error("PREVIEW_UNREACHABLE")
    return guest
  }
  function ensureDebugger(guest, prior) {
    const wasAttached = guest.debugger.isAttached()
    if (!wasAttached) guest.debugger.attach("1.3")
    return { dbg: guest.debugger, attachedByJarvis: prior ? !!prior.attachedByJarvis : !wasAttached }
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

  ipcMain.handle("jarvis:browser:startCoverage", async (_e, webContentsId) => {
    const guest = guestFor(webContentsId)
    let dbg = null, onMessage = null, attachedByJarvis = false
    try {
      const prior = coverageSessions.get(webContentsId)
      ;({ dbg, attachedByJarvis } = ensureDebugger(guest, prior))
      if (prior) {
        dbg.removeListener("message", prior.onMessage)
        coverageSessions.delete(webContentsId)
      }
      const scripts = []
      onMessage = (_event, method, params) => {
        if (method !== "Debugger.scriptParsed" || !params) return
        scripts.push({
          url: params.url || "",
          sourceMapURL: params.sourceMapURL || "",
          startLine: params.startLine,
          endLine: params.endLine,
        })
        if (scripts.length > 300) scripts.shift()
      }
      dbg.on("message", onMessage)
      coverageSessions.set(webContentsId, { onMessage, scripts, attachedByJarvis })
      try { await dbg.sendCommand("Debugger.enable") } catch {}
      await dbg.sendCommand("Profiler.enable")
      await dbg.sendCommand("Profiler.startPreciseCoverage", { callCount: true, detailed: true })
      try { await dbg.sendCommand("CSS.enable"); await dbg.sendCommand("CSS.startRuleUsageTracking") } catch {}
      return { ok: true }
    } catch (error) {
      if (dbg && onMessage) {
        try { dbg.removeListener("message", onMessage) } catch {}
        coverageSessions.delete(webContentsId)
      }
      if (dbg && attachedByJarvis) {
        try { if (dbg.isAttached()) dbg.detach() } catch {}
      }
      return { ok: false, error: String(error && error.message || error) }
    }
  })

  ipcMain.handle("jarvis:browser:stopCoverage", async (_e, webContentsId) => {
    const guest = guestFor(webContentsId)
    const meta = coverageSessions.get(webContentsId)
    try {
      if (!guest.debugger.isAttached()) return { js: [], css: [], unsupported: true }
      const dbg = guest.debugger
      let js = [], css = []
      try { js = (await dbg.sendCommand("Profiler.takePreciseCoverage")).result || [] } catch {}
      try { await dbg.sendCommand("Profiler.stopPreciseCoverage") } catch {}
      try { css = (await dbg.sendCommand("CSS.stopRuleUsageTracking")).ruleUsage || [] } catch {}
      try { await dbg.sendCommand("Profiler.disable") } catch {}
      try { await dbg.sendCommand("Debugger.disable") } catch {}
      if (meta?.attachedByJarvis) {
        try { if (dbg.isAttached()) dbg.detach() } catch {}
      }
      return { js: js.slice(0, 80), css: css.slice(0, 300), scripts: (meta?.scripts || []).filter((s) => s.sourceMapURL).slice(0, 80) }
    } catch (error) {
      return { js: [], css: [], error: String(error && error.message || error) }
    } finally {
      if (meta) {
        try { guest.debugger.removeListener("message", meta.onMessage) } catch {}
        coverageSessions.delete(webContentsId)
      }
    }
  })
}

module.exports = { registerBrowserIpc }
