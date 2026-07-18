# Jarvis mobile (Capacitor shell)

A thin native shell (Android + iOS) around the **existing** Jarvis web client. The UI is not
rewritten — this wraps `apps/hub/web` and adds the native capabilities a browser PWA can't reach.
See [`../docs/mobile.md`](../docs/mobile.md) for the architecture and the OTA model.

> This directory is intentionally **outside** the npm workspace: it has its own toolchain (Capacitor
> + Android/Xcode SDKs) that you install here, so it never touches the Hub/runner install or CI.

## Prerequisites (on your machine, not the Hub)

- Node ≥ 22.
- **Android:** Android Studio + SDK.
- **iOS:** a Mac with Xcode (iOS can only be built on macOS).

## First build

```sh
cd mobile

# 1) Capacitor + the plugins for the three capabilities. @latest so versions resolve to the current
#    Capacitor major on your machine (this scaffold deliberately pins nothing it can't verify).
npm install @capacitor/core@latest @capacitor/cli@latest @capacitor/android@latest @capacitor/ios@latest \
            @capacitor/push-notifications@latest @capacitor/app@latest @capacitor/share@latest \
            capacitor-native-biometric send-intent
# The client bridge looks these plugins up by their runtime names — NativeBiometric (biometric
# unlock), Share (share out), SendIntent (share INTO Jarvis), App (resume/lock hooks),
# PushNotifications (push). Verify each package's current name/version with `npm run doctor`.

# 2) Stage the web UI into ./www
npm run sync-web

# 3) Generate the native projects (creates android/ and ios/ — gitignored)
npx cap add android
npx cap add ios        # macOS only

# 4) Sync web + native config into them
npx cap sync

# 5) Open in the platform IDE to run on a device/emulator
npm run open:android   # or: npm run open:ios
```

Verify the toolchain any time with `npm run doctor` (`npx cap doctor`).

## OTA web updates ("update without a new store version")

Point the app at your Hub so it loads the **live** UI over the air:

```sh
JARVIS_APP_HUB_URL="https://jarvis.your-tailnet.ts.net" npx cap sync
```

Now every web change you deploy on the Hub is instantly live in the app — no store submission. Only
**native** changes (the shell or a plugin) need a new store build. Offline is handled by the web
client's existing service worker; `./www` is the bundled fallback. (Trade-offs — remote-load review
rules, first-launch reachability — are in `../docs/mobile.md`.)

## The three native capabilities (staged — each needs on-device testing)

These are wired incrementally into the web client behind a feature-detected bridge (no-op in a plain
browser, active only inside the Capacitor shell), so the PWA keeps working unchanged.

1. **Push (APNs/FCM).** Plugin: `@capacitor/push-notifications`. The app registers and sends its token
   to the Hub; the Hub delivers via APNs/FCM. Needs Firebase (Android) + an Apple Push key (iOS) — a
   server-side integration distinct from the browser's web-push/VAPID. **Status: to wire + test.**
2. **Background wake-word ("Jey Jarvis" always-on).** No reliable off-the-shelf plugin — iOS
   background-audio is restricted. Plan: a **custom Capacitor plugin** (`npm init @capacitor/plugin`)
   using a native background-audio/foreground-service to run the wake listener, bridging to the
   existing voice pipeline. **Status: needs a custom plugin + heavy device testing.**
3. **Share + biometric unlock.** Share INTO Jarvis (share-sheet target) needs a native share extension
   (iOS) / intent filter (Android); sharing OUT uses `@capacitor/share`. Biometric app-unlock (Face
   ID / fingerprint instead of the passphrase) via a maintained biometric plugin (verify the current
   package name/version with `npx cap doctor`). **Status: to wire + test.**
