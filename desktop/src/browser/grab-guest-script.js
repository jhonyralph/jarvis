// Design Mode — the element picker injected into the previewed <webview> guest (page world).
//
// The guest has NO preload and NO Node (LEI 8), so this is plain page-world JS delivered as a string
// via guest.webContents.executeJavaScript(). Three lifecycle actions share state on window.__jarvisGrab:
//   - arm:      install the crosshair overlay + hover highlight, park an extractor on the page.
//   - await:    return a Promise that resolves with the GrabSelection on the next click.
//   - teardown: remove the overlay and reject a pending await.
//
// The extractor sanitizes + budgets + secret-redacts everything BEFORE it leaves the page (LEI 7),
// and the return value is plain JSON (executeJavaScript serializes it back to main).

const STATE = "window.__jarvisGrab"

/** Page-world program installed once per arm. Kept as a stringified IIFE. */
function armProgram() {
  return `(() => {
  const HOST_ID = "__jarvis-grab-host";
  if (window.__jarvisGrab && window.__jarvisGrab.active) return "already-armed";

  // ---- budgets & secret redaction (all runs in the page, before anything leaves) ----
  const HTML_BUDGET = 4096;
  const TEXT_BUDGET = 400;
  const SECRET_RE = [
    /\\b(sk|pk|rk|ghp|gho|ghs|xox[baprs])[-_][A-Za-z0-9]{16,}\\b/g,
    /\\b(eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,})\\b/g, // JWT
    /\\b[A-Za-z0-9_-]{40,}\\b/g,                                                // long opaque token
    /(bearer\\s+)[A-Za-z0-9._-]{12,}/gi,
  ];
  let REDACTIONS = 0;
  const redact = (s) => {
    if (typeof s !== "string") return s;
    let out = s;
    for (const re of SECRET_RE) out = out.replace(re, () => { REDACTIONS++; return "[redacted]"; });
    return out;
  };
  const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

  // ---- element analysis ----
  const cssEscape = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"));
  function selectorFor(el) {
    if (el.id) return "#" + cssEscape(el.id);
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        part += "." + Array.from(node.classList).slice(0, 2).map(cssEscape).join(".");
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (node.id) { parts[0] = "#" + cssEscape(node.id); break; }
      node = node.parentElement;
    }
    return parts.join(" > ");
  }
  function domPathFor(el) {
    const path = [];
    let node = el;
    while (node && node.nodeType === 1) { path.unshift(node.tagName.toLowerCase()); node = node.parentElement; }
    return path.join(" > ");
  }
  const STYLE_KEYS = [
    "display","position","width","height","margin","padding","border","box-sizing",
    "flex-direction","justify-content","align-items","gap","grid-template-columns",
    "font-family","font-size","font-weight","line-height","color","background-color",
    "border-radius","box-shadow","opacity","z-index","overflow","text-align",
  ];
  function stylesFor(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const k of STYLE_KEYS) { const v = cs.getPropertyValue(k); if (v) out[k] = v; }
    return out;
  }
  function htmlFor(el) {
    let html = el.outerHTML || "";
    html = html.replace(/<script[\\s\\S]*?<\\/script>/gi, "");
    return redact(clip(html, HTML_BUDGET));
  }
  function a11yFor(el) {
    const aria = {};
    for (const a of el.attributes || []) if (a.name.startsWith("aria-") || a.name === "role") aria[a.name] = a.value;
    return {
      role: el.getAttribute("role") || undefined,
      name: clip((el.getAttribute("aria-label") || el.textContent || "").trim(), 120),
      ariaAttributes: Object.keys(aria).length ? aria : undefined,
    };
  }
  function sourceRefFor(el) {
    // Best-effort React source via the fiber __debugSource (dev builds only).
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (!key) return { sourceRef: undefined, components: undefined };
    let fiber = el[key];
    const comps = [];
    let sourceRef;
    for (let i = 0; fiber && i < 30; i++) {
      const t = fiber.type;
      const name = typeof t === "function" ? (t.displayName || t.name) : (typeof t === "string" ? undefined : undefined);
      if (name && !comps.includes(name)) comps.push(name);
      const ds = fiber._debugSource;
      if (ds && !sourceRef) sourceRef = { file: ds.fileName, line: ds.lineNumber, column: ds.columnNumber || 0, framework: "react" };
      fiber = fiber._debugOwner || fiber.return;
    }
    return { sourceRef, components: comps.length ? comps.slice(0, 8) : undefined };
  }
  function extract(el) {
    const r = el.getBoundingClientRect();
    const { sourceRef, components } = sourceRefFor(el);
    const payload = {
      url: location.href,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 },
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      htmlSnippet: htmlFor(el),
      computedStyles: stylesFor(el),
      selector: selectorFor(el),
      domPath: domPathFor(el),
      sourceRef,
      components,
      a11y: a11yFor(el),
      nearbyText: redact(clip((el.parentElement ? el.parentElement.textContent : el.textContent || "").trim(), TEXT_BUDGET)),
      redactions: REDACTIONS,
    };
    return payload;
  }

  // ---- overlay (closed shadow root, full viewport) ----
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;";
  const root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;pointer-events:none;border:2px solid #7c5cff;background:rgba(124,92,255,.12);border-radius:2px;transition:all .03s;display:none;";
  const label = document.createElement("div");
  label.style.cssText = "position:fixed;pointer-events:none;font:11px/1.4 ui-monospace,monospace;background:#7c5cff;color:#fff;padding:1px 6px;border-radius:3px;display:none;white-space:nowrap;";
  root.appendChild(box); root.appendChild(label);
  document.documentElement.appendChild(host);

  const elAt = (x, y) => { host.style.pointerEvents = "none"; const el = document.elementFromPoint(x, y); host.style.pointerEvents = "auto"; return el; };
  const paint = (el) => {
    if (!el) { box.style.display = "none"; label.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.x + "px"; box.style.top = r.y + "px"; box.style.width = r.width + "px"; box.style.height = r.height + "px";
    label.style.display = "block";
    label.style.left = r.x + "px"; label.style.top = Math.max(0, r.y - 18) + "px";
    label.textContent = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + " " + Math.round(r.width) + "×" + Math.round(r.height);
  };

  const state = {
    active: true, hovered: null, result: null, onResult: null, onCancel: null,
    teardown() {
      this.active = false;
      host.removeEventListener("mousemove", onMove, true);
      host.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      if (host.parentNode) host.parentNode.removeChild(host);
    },
  };
  function onMove(e) { state.hovered = elAt(e.clientX, e.clientY); paint(state.hovered); }
  function onClick(e) {
    e.preventDefault(); e.stopPropagation();
    const el = elAt(e.clientX, e.clientY);
    if (!el) return;
    let payload;
    try { payload = extract(el); } catch (err) { payload = { error: String(err && err.message || err) }; }
    state.teardown();
    state.result = payload;
    if (state.onResult) { const cb = state.onResult; state.onResult = null; cb(payload); }
  }
  function onKey(e) { if (e.key === "Escape") { state.teardown(); if (state.onCancel) { const cb = state.onCancel; state.onCancel = null; cb(); } } }
  host.addEventListener("mousemove", onMove, true);
  host.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);

  window.__jarvisGrab = state;
  return "armed";
})()`
}

/** Returns a Promise (awaited by executeJavaScript) that resolves with the selection on click. */
function awaitProgram() {
  return `new Promise((resolve, reject) => {
  const g = ${STATE};
  if (!g || !g.active && !g.result) { reject(new Error("not-armed")); return; }
  if (g.result) { resolve(g.result); return; }
  g.onResult = resolve;
  g.onCancel = () => reject(new Error("cancelled"));
})`
}

function teardownProgram() {
  return `(() => { const g = ${STATE}; if (g && g.active) { g.teardown(); if (g.onCancel) { const cb = g.onCancel; g.onCancel = null; cb(); } } return "torn-down"; })()`
}

module.exports = { armProgram, awaitProgram, teardownProgram }
