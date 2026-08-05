import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Jarvis mobile shell (Capacitor). The strategy (decided with the user):
 *   - The WEB UI is the existing apps/hub/web/index.html — NOT rewritten. `npm run sync-web` stages
 *     it into ./www so `cap sync` bundles it as the offline/first-launch fallback.
 *   - OTA "like a game": when JARVIS_APP_HUB_URL is set, the app loads the LIVE UI straight from your
 *     Hub (server.url). So a web change on the Hub is instantly live in the app — "reload is the
 *     deploy" now works on mobile too, with NO store update. Offline is covered by the web client's
 *     existing service worker. Only NATIVE code (the shell + plugins) needs a store update.
 *   - Trade-off to weigh (see docs/mobile.md): a remote server.url needs the Hub reachable on first
 *     launch, and Apple review scrutinizes remote-loaded apps. The bundled ./www is the fallback;
 *     for a stricter offline-first posture, drop server.url and use a live-update plugin instead.
 *
 * appId: change to YOUR reverse-domain before building for a store.
 */
// OPTIONAL personal build: set JARVIS_APP_HUB_URL to bake YOUR Hub as server.url. Left empty (the CI
// default) the app is server-AGNOSTIC — no URL is embedded; the bundled launcher (www/index.html) asks
// the user for their Hub URL at runtime and navigates the WebView there. This is what lets a single
// generic APK/IPA be shared: each user enters their own address.
const HUB = process.env.JARVIS_APP_HUB_URL || "";

const config: CapacitorConfig = {
  appId: "chat.jarvis.app",
  appName: "Jarvis",
  webDir: "www",
  server: HUB
    ? { url: HUB, cleartext: HUB.startsWith("http://"), allowNavigation: ["*"] } // personal build: OTA to the Hub
    // generic build: launcher navigates to the user's Hub (any host); cleartext allows an http LAN/tailnet Hub
    : { androidScheme: "https", cleartext: true, allowNavigation: ["*"] },
  plugins: {
    // Native push (APNs/FCM). The token is registered in the web bridge and sent to the Hub; the Hub
    // sends via APNs/FCM (server keys required — see docs/mobile.md; distinct from the web-push/VAPID
    // path the browser PWA already uses).
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
