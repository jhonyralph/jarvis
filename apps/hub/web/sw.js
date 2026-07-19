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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch cross-origin
  if (url.pathname.startsWith("/pasted/")) return;    // user images: always live, never cached

  if (req.mode === "navigate") {
    // NETWORK-FIRST so an online reload always deploys the latest HTML; cache is the offline safety net.
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) { const c = await caches.open(CACHE); c.put("/", res.clone()); }
        return res;
      } catch {
        return (await caches.match("/")) || (await caches.match(req)) || Response.error();
      }
    })());
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
