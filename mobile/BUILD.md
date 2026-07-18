# Building the Jarvis app (Android APK/AAB + iOS IPA)

Step-by-step to turn the `mobile/` Capacitor project into installable builds. The web UI is the
existing `apps/hub/web` (staged into `www`); the native shell adds push/share/biometrics/wake-word.

> **Platform reality:** Android builds on Windows/macOS/Linux. **iOS builds ONLY on macOS** (Xcode) —
> a Windows PC can't produce an `.ipa`. For iOS from Windows, use a Mac, a cloud Mac (e.g. MacinCloud),
> or a CI runner (GitHub Actions `macos-latest`).
>
> Nothing here was run in the Hub's headless environment — it's the standard Capacitor path. Expect to
> troubleshoot plugin/native config on first build (flag me the error).

---

## 0. One-time prerequisites

**Both:** Node ≥ 22.

**Android:**
- **Android Studio** (bundles the Android SDK + platform tools) — https://developer.android.com/studio
- A **JDK 17** (Android Studio ships one; or install Temurin 17).
- First launch of Android Studio → let it install the SDK + a build-tools + a platform (API 34+).
- Optional CLI: set `ANDROID_HOME` (e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`).

**iOS (on a Mac):**
- **Xcode** (App Store) + once: `xcode-select --install`.
- **CocoaPods**: `sudo gem install cocoapods` (or `brew install cocoapods`).

---

## 1. Install deps + add the native platforms (once)

```sh
cd mobile

# Capacitor + the plugins the client bridge uses (verify names/versions with `npm run doctor`)
npm install @capacitor/core@latest @capacitor/cli@latest @capacitor/android@latest @capacitor/ios@latest \
            @capacitor/push-notifications@latest @capacitor/app@latest @capacitor/share@latest \
            capacitor-native-biometric send-intent

npm run sync-web            # stage apps/hub/web -> www
npx cap add android         # creates mobile/android/  (gitignored)
npx cap add ios             # macOS only — creates mobile/ios/
```

Set your app identity before a store build: edit `appId` in `capacitor.config.ts`
(`chat.jarvis.app` → your reverse-domain) and `appName` if you want.

---

## 2. Point the app at your Hub (OTA) and sync

```sh
# loads the LIVE UI from your Hub over the air (web updates need no new build); www is the fallback
JARVIS_APP_HUB_URL="https://<seu-hub-tailscale>" npx cap sync      # macOS/Linux
```
Windows PowerShell:
```powershell
$env:JARVIS_APP_HUB_URL="https://<seu-hub-tailscale>"; npx cap sync
```
Run `npx cap sync` again after any web change (`npm run sync-web` first) or plugin change.

---

## 3. Native config the capabilities need (edit once)

- **Mic** (voice + wake-word): Android `android/app/src/main/AndroidManifest.xml` →
  `<uses-permission android:name="android.permission.RECORD_AUDIO"/>`; iOS `ios/App/App/Info.plist` →
  `NSMicrophoneUsageDescription`.
- **Wake-word background** (when you build the native plugin, see `plugins/jarvis-wake/README.md`):
  Android `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE`; iOS `UIBackgroundModes` = audio.
- **Push (FCM/APNs):** Android → put `google-services.json` (from your Firebase project) in
  `android/app/`; iOS → add the Push Notifications capability in Xcode + upload the APNs key to Firebase.
- **Biometric:** Android `USE_BIOMETRIC`; iOS `NSFaceIDUsageDescription`.
- **Share-into-Jarvis:** Android intent-filter (ACTION_SEND) on the main activity; iOS a Share Extension.

---

## 4A. Android — build the APK

**Fast path (debug APK, installable on any device with "unknown sources"):**
```sh
cd mobile/android
./gradlew assembleDebug          # Windows: .\gradlew.bat assembleDebug
```
Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

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
   ./gradlew assembleRelease      # APK  -> app/build/outputs/apk/release/app-release.apk
   ./gradlew bundleRelease        # AAB  -> app/build/outputs/bundle/release/app-release.aab (Play Store)
   ```
Install a debug/release APK on a plugged-in phone: `adb install -r app-debug.apk`.

## 4B. iOS — build the IPA (macOS only)

```sh
cd mobile && npm run open:ios          # opens ios/App/App.xcworkspace in Xcode
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

---

## Iterating

- **Web change:** `npm run sync-web && npx cap sync` (or nothing, if the app loads from the Hub via
  `JARVIS_APP_HUB_URL` — that's the OTA path).
- **Plugin/native change:** `npx cap sync` then rebuild in the IDE / gradle.
- Health-check your toolchain any time: `npm run doctor` (`npx cap doctor`).
