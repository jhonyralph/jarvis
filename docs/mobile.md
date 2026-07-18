# Mobile app (Capacitor shell)

## Decision

Wrap the **existing** web client (`apps/hub/web/index.html`) in a **Capacitor** native shell for
Android + iOS, rather than rewriting it (React Native / Flutter) or staying a browser-only PWA. The
UI is already mature; what a browser PWA can't reach — always-on voice, reliable push, OS integration,
biometrics — comes from **native plugins**, not from redoing the UI.

Scaffold lives in `mobile/` (outside the npm workspace; own toolchain). See `mobile/README.md` for
the build steps.

## OTA update model ("like a game — no re-download for web changes")

Two layers, updated independently:

- **Web layer (the whole UI): over-the-air.** The Capacitor app sets `server.url` to the Hub
  (`JARVIS_APP_HUB_URL`), so it loads the **live** `index.html` from the Hub. A web deploy on the Hub
  is instantly live in the app — the existing "reload is the deploy" now extends to mobile, with **no
  store submission**. Offline is handled by the web client's existing service worker; the bundled
  `./www` (staged from `apps/hub/web`) is the first-launch / no-network fallback.
- **Native layer (shell + plugins): store update.** Only changes to native code need a new build in
  the Play Store / App Store.

**Trade-offs to weigh before shipping:**
- A remote `server.url` needs the Hub reachable on **first** launch (bundled `./www` mitigates, but
  keep it reasonably current). 
- **Apple review** scrutinizes apps that load remote content; be ready to justify it (it's your own
  self-hosted Hub over your private Tailnet) or fall back to the stricter posture below.
- Stricter offline-first alternative: **drop `server.url`** and use a live-update plugin (Capacitor
  Live Updates / a self-hosted bundle the app downloads + swaps). More robust offline, more moving
  parts. Start with `server.url`; switch if review or offline demands it.

## The three capabilities (all requested; staged, each device-tested)

Wired into the web client behind a **feature-detected bridge**: it checks for the Capacitor runtime
and no-ops in a plain browser, so the PWA keeps working unchanged while the shell gains the native
paths. Order below is by value/risk.

### 1. Push (APNs / FCM) — lowest risk
- Plugin: `@capacitor/push-notifications`. App registers → gets a device token → sends it to the Hub
  (new WS message, e.g. `mobile_push_register`).
- Hub stores the token and delivers via **APNs (iOS)** / **FCM (Android)** — a new server integration,
  distinct from the browser's web-push/VAPID (which stays for PWA users).
- Server keys needed: Firebase project (Android) + Apple Push key `.p8` (iOS).
- Device test: background the app, trigger a turn-done / machine-offline event, confirm delivery.

### 2. Share + biometric unlock — medium
- **Share OUT** (`@capacitor/share`): send a code snippet / result out of Jarvis.
- **Share INTO Jarvis** (share-sheet target): iOS **share extension** + Android **intent filter** —
  native config, so it's a shell change (store update).
- **Biometric unlock**: Face ID / fingerprint gates app open (replaces re-entering the owner
  passphrase on mobile). Use a maintained biometric plugin — **verify the current package** at build
  time (the ecosystem churns; don't trust a pinned name).
- Device test: share a file in → lands as an attachment; lock/reopen → biometric prompt unlocks.

### 3. Background wake-word ("Jey Jarvis" always-on) — highest risk
- **No reliable off-the-shelf plugin.** iOS restricts background audio hard; Android needs a
  foreground service.
- **Scaffolded:** the plugin CONTRACT (TS definitions + web no-op stub) and the client wiring already
  exist — see `mobile/plugins/jarvis-wake/` (its README is the native implementation spec: engine
  choice Porcupine vs TFLite, foreground service / background-audio, entitlements). The client bridge
  starts it on the wake toggle and, on the `wake` event, runs the same auto voice capture the Python
  listener triggers. The NATIVE detector itself is intentionally NOT written (blind-writing it would
  be dishonest) — that's the remaining device work.
- A mini-project of its own; treat it as a separate milestone after 1 & 2 prove the shell.
- Device test: screen locked, say the wake word, confirm capture + a turn starts.

## Staged plan

1. **Shell boots** — scaffold builds, loads the Hub UI over `server.url`, auth/claim works on device.
   (Foundation committed; build on your machine.)
2. **Push** wired end-to-end (client bridge + Hub `mobile_push_register` + APNs/FCM send).
3. **Share + biometric unlock.**
4. **Background wake-word** custom plugin.

Each step keeps the PWA path working (feature-detected bridge) and is validated on a real device — none
of it is verifiable in the Hub's headless environment, so device testing by the user gates each stage.
