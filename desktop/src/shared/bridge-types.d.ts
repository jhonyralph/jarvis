// Contract for window.jarvis — the feature-detected bridge the Hub-served web UI reads.
// Mirrors docs/specs/DSK-01-12-desktop-design-mode.md §4.1–§4.2. Phase 0 ships only the
// identity + capability flags; the `browser` surface is Phase 1.

export interface JarvisBridge {
  /** "browser" is the implicit shell when window.jarvis is absent. */
  shell: "electron" | "capacitor" | "browser"
  /** Semver of the desktop/ shell. */
  shellVersion: string
  /** Version of THIS bridge contract; the UI degrades gracefully across mismatches (LEI 11). */
  bridgeVersion: 1
  /** What THIS shell actually implements — the UI gates features on these. */
  capabilities: {
    designMode: boolean
    autoUpdate: boolean
  }
  /** Present only when capabilities.designMode is true (Phase 1). */
  browser?: BrowserBridge
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Design Mode surface (Phase 1). The renderer (the Hub-served web UI) owns the <webview> element and
 * passes its `webContentsId` (from `webview.getWebContentsId()`); main resolves the guest WebContents
 * and does the privileged work. This deviates from the spec's `openPreview`-returns-pageId sketch
 * because main cannot create a renderer DOM element — the renderer creates the <webview>, the bridge
 * only operates on it.
 */
export interface BrowserBridge {
  /** Arm/disarm the element picker overlay in the guest. */
  setGrabMode(webContentsId: number, on: boolean): Promise<void>
  /** Resolves with the selection on the next click; rejects on cancel/Escape. */
  awaitGrabSelection(webContentsId: number): Promise<GrabSelection>
  /** Crop a PNG of the selected element rect (captured in main). */
  captureSelectionScreenshot(
    webContentsId: number,
    rect: Rect,
  ): Promise<{ pngDataUrl: string } | { unavailable: true }>
  cancelGrab(webContentsId: number): Promise<void>
}

export interface GrabSelection {
  url: string
  viewport: { w: number; h: number; dpr: number }
  rect: Rect
  /** outerHTML sanitized (script-stripped), budgeted (<=4KB). */
  htmlSnippet: string
  computedStyles: Record<string, string>
  selector: string
  domPath: string
  sourceRef?: { file: string; line: number; column: number; framework: string }
  components?: string[]
  a11y?: { role?: string; name?: string; ariaAttributes?: Record<string, string> }
  nearbyText?: string
  /** How many fields were redacted by a secret pattern (LEI 7). */
  redactions: number
}

declare global {
  interface Window {
    jarvis?: JarvisBridge
  }
}
