// Jarvis service worker — Web Push notifications + an offline app shell.
//
// Caching strategy is chosen to KEEP the "reload is the deploy" model intact:
//   • navigations (the HTML) → NETWORK-FIRST: online you always get the freshest UI (deploy);
//     the last good copy is cached and only served when the network is unreachable (Tailscale
//     dropped, tab resumed offline) so the app opens instead of showing a blank page.
//   • static shell assets (manifest, icon) → cache-first with a background refresh.
// Everything else (POST, /pasted/ images, cross-origin) is passed straight through, untouched.
// Bumped v1 → v2 when the app JS moved out of index.html into /app.js: the shell now MUST cache the
// external script or an offline open would render an empty page.
const CACHE = "jarvis-shell-v2";
const SHELL = ["/", "/app.js", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // best-effort: a missing asset must not abort the whole install
    await Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith("jarvis-shell-")) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network-first, but with a TIMEOUT that falls back to cache. Pure network-first (await fetch with
// no timeout) was the mobile hang: on a slow/flaky link fetch doesn't reject, it just hangs, so the
// SW blocked first paint until the full HTML + 287KB app.js finished downloading ("uma era" to open
// on cellular). Now we race the network against ~2.5s; if a cached copy exists and the network is
// slower than that, we serve the cache instantly and refresh it in the background. Fast connections
// (LAN/desktop) still win the race almost always, so "reload is the deploy" stays intact there.
const NET_TIMEOUT_MS = 2500;
async function networkFirstWithTimeout(req, cacheKey) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey || req);
  const network = fetch(req).then((res) => { if (res && res.ok) cache.put(cacheKey || req, res.clone()); return res; });
  if (!cached) {
    // Nothing cached yet (first ever open): must wait for the network, but still fall back on error.
    try { return await network; } catch { return (await cache.match(cacheKey || req)) || Response.error(); }
  }
  // Have a cached copy: give the network a short head start, else serve cache and let it refresh in bg.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NET_TIMEOUT_MS));
  const winner = await Promise.race([network.catch(() => null), timeout]);
  if (winner && winner.ok) return winner;   // network was fast enough → freshest copy (the deploy)
  network.catch(() => {});                   // keep the background refresh alive without unhandled rejection
  return cached;                             // slow/failed network → instant cached shell
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch cross-origin
  if (url.pathname.startsWith("/pasted/")) return;    // user images: always live, never cached

  if (req.mode === "navigate") {
    event.respondWith(networkFirstWithTimeout(req, "/"));
    return;
  }

  // app.js is the app CODE (the deploy artifact), not a static asset — same network-first-with-timeout
  // as the HTML so a normal online reload still ships the latest client, but a slow mobile link gets
  // the cached script instantly instead of hanging on the 287KB download.
  if (url.pathname === "/app.js") {
    event.respondWith(networkFirstWithTimeout(req, req));
    return;
  }

  // Shell assets: serve from cache immediately, refresh in the background (stale-while-revalidate).
  if (SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const network = fetch(req).then((res) => { if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { /* ignore */ }
  event.waitUntil((async () => {
    const cls = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (cls.some((c) => c.focused)) return; // app aberto e em foco -> não incomoda
    await self.registration.showNotification(d.title || "Jarvis", {
      body: d.body || "",
      tag: d.tag || "jarvis",
      renotify: true,
      data: { sid: d.sid || "" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const sid = event.notification.data && event.notification.data.sid;
  const url = self.registration.scope + (sid ? "#" + encodeURIComponent(sid) : "");
  event.waitUntil((async () => {
    const cls = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of cls) {
      if ("focus" in c) { try { await c.navigate(url); } catch (e) { /* ignore */ } return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
