# Building the Jarvis app (Android APK/AAB + iOS IPA)

Step-by-step to turn the `mobile/` Capacitor project into installable builds. The web UI is the
existing `apps/hub/web` (staged into `www`); the native shell adds push/share/biometrics/wake-word.

> **Platform reality:** Android builds on Windows/macOS/Linux. **iOS builds ONLY on macOS** (Xcode) —
> a Windows PC can't produce an `.ipa`. For iOS from Windows, use a Mac, a cloud Mac (e.g. MacinCloud),
> or a CI runner (GitHub Actions `macos-latest`).
>
> Native Android checks run on Windows/Linux/macOS. Xcode compilation, archive validation, and
> on-device permission/geofence behavior still require macOS and physical iOS hardware.

---

## 0. One-time prerequisites

**Both:** Node ≥ 22.

**Android:**
- **Android Studio** (bundles the Android SDK + platform tools) — https://developer.android.com/studio
- A **JDK 21** (the Jarvis native plugins compile with Java/Kotlin JVM target 21).
- First launch of Android Studio → let it install the SDK + a build-tools + a platform (API 34+).
- Optional CLI: set `ANDROID_HOME` (e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`).

**iOS (on a Mac):**
- **Xcode** (App Store) + once: `xcode-select --install`.
- **CocoaPods**: `sudo gem install cocoapods` (or `brew install cocoapods`).

---

## 1. Install deps + add the native platforms (once)

```sh
cd mobile

# Installs the compatible Capacitor versions and local native plugins declared in package.json.
npm install

npm run sync-web            # stage apps/hub/web -> www
npx cap add android         # creates mobile/android/  (gitignored)
npx cap add ios --packagemanager CocoaPods # macOS only; SPM requires every installed plugin to support it
```

Set your app identity before a store build: edit `appId` in `capacitor.config.ts`
(`chat.jarvis.app` → your reverse-domain) and `appName` if you want.

---

## 2. Point the app at your Hub (OTA) and sync

```sh
# loads the LIVE UI from your Hub over the air (web updates need no new build); www is the fallback
JARVIS_APP_HUB_URL="https://<seu-hub-tailscale>" npm run sync      # macOS/Linux
```
Windows PowerShell:
```powershell
$env:JARVIS_APP_HUB_URL="https://<seu-hub-tailscale>"; npm run sync
```
Run `npm run sync` after a web or native-plugin change. It runs Capacitor sync, applies Android shell
patches, and applies JarvisContext to every generated Android/iOS tree. For a CocoaPods tree it then
runs `pod install`, so that final dependency step requires macOS; an SPM tree needs no extra command.

---

## 3. Native config the capabilities need (edit once)

- **Mic** (voice + wake-word): Android `android/app/src/main/AndroidManifest.xml` →
  `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`; iOS `ios/App/App/Info.plist` →
  `NSMicrophoneUsageDescription`.
- **Wake-word background:** Android is implemented with openWakeWord and bundled ONNX assets; keep
  `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE`. iOS still needs `UIBackgroundModes` = audio
  plus native implementation.
- **Push (FCM/APNs):** Android → put `google-services.json` (from your Firebase project) in
  `android/app/`; iOS → add the Push Notifications capability in Xcode + upload the APNs key to Firebase.
- **Biometric:** Android `USE_BIOMETRIC`; iOS `NSFaceIDUsageDescription`.
- **Share-into-Jarvis:** Android intent-filter (ACTION_SEND) on the main activity; iOS a Share Extension.
- **JarvisContext:** never register it manually. Capacitor 8 discovery must produce one
  `JarvisContextPlugin`. Android backup rules and the `store`/`sideload` policy are applied by
  `apply-context-native.mjs`.

---

## 4A. Android — build the APK

**Fast path (debug APK, installable on any device with "unknown sources"):**
```sh
npm run build:android
```
Output: `mobile/android/app/build/outputs/apk/sideload/debug/app-sideload-debug.apk`

That command stages `apps/hub/web` into `mobile/www`, syncs Capacitor, discovers the Android SDK
from `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or standard install paths, writes
`mobile/android/local.properties`, points the APK at your Hub from `JARVIS_APP_HUB_URL`,
`JARVIS_PUBLIC_URL`, or `~/.jarvis/hub.env`, patches plugin SDK mismatches, then runs Gradle.

**Or from Android Studio:** `cd mobile && npm run open:android`, then Run ▶ on a device/emulator, or
`Build > Build Bundle(s)/APK(s) > Build APK(s)`.

**Release APK (signed — needed to share/publish):**
1. Generate a keystore (once, keep it safe — losing it blocks future updates):
   ```sh
   keytool -genkey -v -keystore jarvis-release.keystore -alias jarvis -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Tell Gradle about it — create `mobile/android/keystore.properties`:
   ```
   storeFile=../../jarvis-release.keystore
   storePassword=***
   keyAlias=jarvis
   keyPassword=***
   ```
   and in `android/app/build.gradle` load it into a `signingConfigs { release { ... } }` and set
   `buildTypes.release.signingConfig signingConfigs.release` (Android Studio's
   *Build > Generate Signed Bundle/APK* wizard writes this for you if you prefer clicking).
3. Build:
   ```sh
   npm run build:android:release  # signed APK, or *-unsigned.apk until signing is configured
   npm run build:aab              # AAB -> .../bundle/storeRelease/app-store-release.aab
   ```
Install a debug/release APK on a plugged-in phone: `adb install -r app-debug.apk`.

## 4B. iOS — build the IPA (macOS only)

```sh
npm run build:apple          # opens the generated CocoaPods or SPM Xcode project
npm run build:apple -- --archive
```
In Xcode:
1. Select the **App** target → **Signing & Capabilities** → pick your **Team** (a free Apple ID works
   for installing on your own device; a paid Apple Developer account is needed for TestFlight/App Store).
2. Set the **Bundle Identifier** to match `appId`.
3. Add capabilities you use (Push Notifications, Background Modes → Audio, Face ID via the plist).
4. **Run on a device** (▶ with your iPhone selected) to test, or **Product > Archive** → the Organizer
   opens → **Distribute App** → *Ad Hoc* / *Development* to export a `.ipa`, or *App Store Connect* for
   TestFlight.

There is no "APK" on iOS — the artifact is a `.ipa` (or you just Run onto the device from Xcode).

For a new iOS tree, the dispatcher defaults to CocoaPods because every installed plugin must expose a
`Package.swift` before the whole app can use SPM. Use `--spm` only after that compatibility check. The
archive command chooses `App.xcworkspace` for CocoaPods and `App.xcodeproj` for SPM. Continuous iOS
location background mode is not enabled by default. `--cocoapods` and `--spm` are mutually exclusive;
generated trees containing both entrypoints are rejected. The CocoaPods sync/build path reruns
`pod install` after the transform. The archive command also rejects output
without the packaged JarvisContext privacy manifest. The explicit reviewed background-mode opt-in is:

```sh
npm run build:apple -- --ios-background-mode
```

Region monitoring and significant-location changes remain per-call opt-ins. CoreLocation limits each
app to 20 regions across all of its location-manager instances and has no transaction API: Jarvis
waits for every start callback and confirms rollback, but replacement can have a short monitoring
gap. Run the Swift tests and both SPM/Pods archives on macOS before distribution.

---

## Iterating

- **Web change:** `npm run sync` (or nothing, if the app loads from the Hub via
  `JARVIS_APP_HUB_URL` — that's the OTA path).
- **Plugin/native change:** `npm run sync` then rebuild in the IDE / Gradle.
- Health-check your toolchain any time: `npm run doctor` (`npx cap doctor`).
