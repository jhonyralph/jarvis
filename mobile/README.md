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

# 1) Install the compatible versions declared by this mobile package.
npm install
# The client bridge looks these plugins up by their runtime names — NativeBiometric (biometric
# unlock), Share (share out), SendIntent (share INTO Jarvis), App (resume/lock hooks),
# PushNotifications (push). Verify each package's current name/version with `npm run doctor`.

# 2) Stage the web UI into ./www
npm run sync-web

# 3) Generate the native projects (creates android/ and ios/ — gitignored)
npx cap add android
npx cap add ios --packagemanager CocoaPods  # macOS only; use SPM only if every plugin supports it

# 4) Sync web/native config and apply the idempotent transforms
npm run sync

# 5) Open in the platform IDE to run on a device/emulator
npm run open:android   # or: npm run open:ios
```

Verify the toolchain any time with `npm run doctor` (`npx cap doctor`).

For Android debug builds, use the repo helper instead of running Gradle directly:

```sh
npm run build:android
```

It stages the web UI, runs `cap sync android`, applies the Android shell and JarvisContext
transforms, discovers the Android SDK from
`ANDROID_HOME`, `ANDROID_SDK_ROOT`, or the standard OS install paths, writes
`android/local.properties`, points the APK at your Hub from `JARVIS_APP_HUB_URL`,
`JARVIS_PUBLIC_URL`, or `~/.jarvis/hub.env`, then runs `gradlew assembleSideloadDebug`.

Other root-level build commands follow the same dispatcher pattern as install/setup:
`npm run build:android:release`, `npm run build:aab`, and `npm run build:apple`. Apple/iOS builds
must run on macOS with Xcode.

## JarvisContext hardening

`@jarvis/context` is discovered automatically by Capacitor 8. Its protected state never enters app
backup: Android uses `noBackupFilesDir`; iOS uses protected Application Support storage excluded from
backup. Legacy Android SharedPreferences and iOS UserDefaults keys are migrated and cleared.

Android builds have separate policies: `store` has no background-location or boot rearm, while
`sideload` enables both. iOS geofence replacement waits for CoreLocation confirmation and rolls back
on failure. Significant-location monitoring defaults off and is enabled only per configuration. See
[`plugins/jarvis-context/README.md`](plugins/jarvis-context/README.md) for error codes, the iOS
20-region limit, storage guarantees, and validation commands.

The Apple dispatcher detects CocoaPods versus SPM and selects the matching archive entrypoint:

```sh
npm run build:apple -- --archive
npm run build:apple -- --spm
npm run build:apple -- --cocoapods
npm run build:apple -- --ios-background-mode
```

On CocoaPods projects both `npm run sync` and the Apple dispatcher rerun `pod install` after the
native transform; that finalization requires macOS. A generated tree containing both CocoaPods and
SPM entrypoints is rejected instead of choosing one implicitly. Archives are accepted only after the
bundled JarvisContext `PrivacyInfo.xcprivacy` is found and its required-reason declaration is verified.

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
2. **Background wake-word ("Hey Jarvis" always-on).** Android is implemented with a custom Capacitor
   plugin, openWakeWord, bundled ONNX assets, and a foreground microphone service. It does not need a
   paid access key. iOS still needs a native background-audio implementation and review-specific testing.
3. **Share + biometric unlock.** Share INTO Jarvis (share-sheet target) needs a native share extension
   (iOS) / intent filter (Android); sharing OUT uses `@capacitor/share`. Biometric app-unlock (Face
   ID / fingerprint instead of the passphrase) via a maintained biometric plugin (verify the current
   package name/version with `npx cap doctor`). **Status: to wire + test.**
