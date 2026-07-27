// Design Mode — crop a screenshot of the selected element from the guest webContents (main process).
// LEI 9: the guest can't be trusted to self-capture, so capture happens here in main.

/**
 * @param {import("electron").WebContents} guest
 * @param {{x:number,y:number,width:number,height:number}} rect  CSS-pixel rect from the grab payload
 * @returns {Promise<{pngDataUrl:string}|{unavailable:true}>}
 */
async function captureRegion(guest, rect) {
  try {
    if (!guest || guest.isDestroyed()) return { unavailable: true }
    // Electron capturePage wants an integer rect in the page's CSS pixels.
    const clip = {
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
    }
    const image = await guest.capturePage(clip)
    if (!image || image.isEmpty()) return { unavailable: true }
    return { pngDataUrl: image.toDataURL() }
  } catch {
    return { unavailable: true }
  }
}

module.exports = { captureRegion }
