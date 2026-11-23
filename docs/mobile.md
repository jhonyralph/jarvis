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

- **Android:** CI workflow **"Release mobile"** (`.github/workflows/release-mobile.yml`) builds the
  **sideload-debug APK** (debug-signed → installable via "unknown sources", no release keystore) and
  attaches it to the GitHub Release as `Jarvis-<tag>-android.apk`. Locally: `npm run build:android`.
- **When it runs:** `release.yml` calls it after every published release (job `mobile`, next to
  `desktop`), and you can run it by hand from **Actions → "Release mobile" → Run workflow** (tick
  `publish` to attach/upload to the latest Release, `force` to ignore the gate below).
- **It skips when the app did not change.** The app is a **WebView shell**, so a first `decide` job
  fingerprints exactly what ends up in it (`scripts/mobile-app-hash.mjs` over `apps/hub/web/**`, the
  `mobile/` shell and the build scripts — docs/tests/generated dirs excluded) and compares it to the
  fingerprint saved on the most recent release that shipped **that platform**
  (`mobile-app-hash.txt` for Android, `mobile-app-hash-ios.txt` for iOS — separate on purpose, so
  enabling iOS later is not blocked by an Android build that already published the same fingerprint).
  Unchanged → no build and **no mobile asset on that release**; the previous APK/TestFlight build is
  still current because the shell loads the live UI from the Hub. Changed / never shipped / `force` →
  it builds. Editing only the Hub backend or docs never rebuilds the app; any web UI or shell change does.
- **iOS / Apple → TestFlight (needs a paid account; OFF until enabled):** an iPhone/iPad cannot install
  an APK or a loose `.ipa`; the supported route is **TestFlight**. The `ios` job archives on a macOS
  runner, signs with **manual** signing (only the App target is patched —
  `mobile/apply-ios-signing.mjs`), exports an App Store `.ipa` and uploads it with `xcrun altool`.
  The marketing version is the release version; the build number is a UTC timestamp
  (`yyMMddHHmm`) so it only grows. **Not yet run end-to-end** (no Apple account in this repo's
  history) — expect to iterate on the first execution. To enable:
  1. **Enroll in the Apple Developer Program — US$99/year** at <https://developer.apple.com/programs/>.
     A *free* Apple ID can run on **your own device** from Xcode (7-day profile) but cannot sign a
     shareable build or a CI build.
  2. **Identifiers** → register App ID `chat.jarvis.app` (change `appId` in
     `mobile/capacitor.config.ts` **and** `IOS_BUNDLE_ID` in `scripts/build-mobile.mjs` if you use
     your own domain). Enable the Push Notifications capability there if you will use push.
  3. **Certificates** → create an **Apple Distribution** certificate (CSR from a Mac or `openssl`),
     export it with its private key as a `.p12` with a password.
  4. **Profiles** → create an **App Store** distribution profile for that App ID and certificate;
     download the `.mobileprovision`.
  5. **App Store Connect → Apps** → create the app with the same bundle id.
  6. **App Store Connect → Users and Access → Integrations → App Store Connect API** → create a key
     (role *App Manager* or *Admin*). Note the **Issuer ID** and **Key ID**; download the `.p8` (only
     once).
  7. In GitHub → Settings → Secrets and variables → Actions add these **secrets** (files as base64,
     e.g. `base64 -w0 file` / `[Convert]::ToBase64String([IO.File]::ReadAllBytes("file"))`):
     `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`,
     `APPLE_TEAM_ID` (10 characters, from the Membership page), `ASC_KEY_ID`, `ASC_ISSUER_ID`,
     `ASC_KEY_P8_BASE64`; and the **variable** `ENABLE_IOS_BUILD=true`.
  8. Run **Release mobile** once by hand with `publish` + `force` ticked to prove the signing before
     relying on the automatic path. From then on every release with an app change uploads a build.
  9. On the device install **TestFlight**, accept the invitation (add yourself under *TestFlight →
     Internal Testing*; internal testers need no Apple review) and install Jarvis; each new build arrives
     as an update. Builds expire after 90 days.
  - If the first upload sits at "Missing Compliance" in TestFlight, answer the export-compliance
    question once (or add `ITSAppUsesNonExemptEncryption` to the Info.plist transform).
  - No paid account yet → leave `ENABLE_IOS_BUILD` unset; the job is skipped and **Android + the PWA
    ("Add to Home Screen" in Safari) cover testing** in the meantime.

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
