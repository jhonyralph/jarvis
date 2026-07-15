// Jarvis service worker — Web Push notifications (works on a locked Android phone).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
