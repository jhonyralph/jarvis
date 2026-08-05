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

## Server URL — agnostic (each user enters their own)

The distributed app bakes **no** Hub URL, so a single generic APK/IPA can be shared and each person
points it at **their own** Hub:

- The bundled entry is a small **launcher** (`mobile/launcher.html`, staged as `www/index.html` by
  `sync-web.mjs`). On first launch it asks for the Hub URL, normalizes it (mirrors the desktop's
  `hub-url.js`: missing scheme → `https`, `ws/wss` → `http/https`, strips path/query), saves it to
  `localStorage`, and navigates the WebView there (the live UI comes from the Hub, OTA). On later
  launches it auto-connects after a 2 s countdown you can cancel to **trocar servidor** (or reopen
  with `?setup`).
- `capacitor.config.ts` sets `server.allowNavigation: ["*"]` + `cleartext: true` so the launcher can
  reach any host the user enters, including an `http://` Hub on a LAN/Tailnet.
- A **personal** build can still bake a URL: set `JARVIS_APP_HUB_URL` before building and it becomes
  `server.url` (skips the launcher). CI leaves it unset → generic.
- Caveat: at a runtime-navigated remote origin the native `window.jarvis` bridge (push, native
  context) may be unavailable — the web experience works; those native extras are a device-tested
  follow-up (they were already staged, below).

## Building & distributing

- **Android (works today):** CI workflow **"Release mobile"** (`.github/workflows/release-mobile.yml`)
  builds the **sideload-debug APK** (debug-signed → installable via "unknown sources", no release
  keystore) and uploads it as an artifact / Release asset. Locally: `npm run build:android`.
- **Manual only, and it skips when nothing changed.** The workflow **never runs on push** — trigger it
  from **Actions → "Release mobile" → Run workflow** (tick `publish` to attach the APK to the matching
  Release). Because the app is a **WebView shell**, a first `decide` job fingerprints exactly what ends
  up in the app (`scripts/mobile-app-hash.mjs` over `apps/hub/web/**`, the `mobile/` shell, and the
  build scripts — docs/tests/generated dirs excluded) and compares it to the fingerprint saved beside
  the previous release. **Unchanged → the build is skipped**; changed / first run / `force` → it builds.
  So editing only the Hub backend or docs won't rebuild the app, but any change to the web UI or shell
  will. The baseline (`mobile-app-hash.txt`) is uploaded next to the APK on publish. Release builds
  (`workflow_call` from `release.yml`) always build.
- **iOS / Apple — needs a paid account (wired but OFF):** the workflow's `ios` job is fully written
  but **gated**: it only runs when the repo **variable** `ENABLE_IOS_BUILD=true` AND the signing
  **secrets** exist. To enable:
  1. **Enroll in the Apple Developer Program — US$99/year** (individual or organization) at
     <https://developer.apple.com/programs/>. A *free* Apple ID can build & run on **your own device**
     from Xcode (7-day profile) but **cannot** sign a shareable IPA or a CI build — distribution needs
     the paid program.
  2. In the Apple Developer portal create a **Distribution certificate** (export as `.p12`) and a
     **provisioning profile** for the app id `chat.jarvis.app`.
  3. Add repo **secrets**: `APPLE_CERT_P12_BASE64` (base64 of the `.p12`), `APPLE_CERT_PASSWORD`,
     `APPLE_PROVISIONING_PROFILE_BASE64`, `APPLE_TEAM_ID`; then set repo **variable**
     `ENABLE_IOS_BUILD=true`. The `ios` job then archives on a macOS runner (export-to-IPA options are
     the operator's final step).
  - No paid account yet → leave it off; **Android covers testing** in the meantime.

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
