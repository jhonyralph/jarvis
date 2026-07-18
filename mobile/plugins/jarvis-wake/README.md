# jarvis-wake (custom Capacitor plugin) — background wake-word

Always-on **"Jey Jarvis"** detection while the app is backgrounded / the screen is locked. A browser
PWA can't do this; this native plugin can. **What's here is the JS contract + a web no-op** — the
native detector is NOT written (fabricating it blind would be dishonest). This README is the spec to
build it.

> Why it's staged separately: this is the hardest, most platform-specific piece and needs real-device
> testing at every step. The other three capabilities (push, share, biometrics) don't depend on it.

## How to turn this into a real plugin

1. `cd mobile && npm init @capacitor/plugin@latest` (or reuse this folder). Package name e.g.
   `jarvis-wake`, plugin class `JarvisWake`.
2. Drop in `definitions.ts` / `index.ts` / `web.ts` from here (the contract + web stub).
3. Implement the native side (below), then add the plugin to the app and `npx cap sync`.
4. The Jarvis client already calls it — see the `JarvisWake` block in the native bridge in
   `apps/hub/web/index.html` (start on the wake toggle; on the `wake` event it calls `startRec(true)`,
   the same auto-capture the Python wake listener triggers).

## Native implementation spec

**Wake engine (pick one):**
- **Picovoice Porcupine** — the pragmatic choice: a small on-device wake model, official Android/iOS
  SDKs, low CPU. Custom "Jey Jarvis" keyword via their console. (Free tier + attribution; check terms.)
- **openWakeWord / a TFLite model** — matches what the Hub's `services/voice` uses conceptually, fully
  self-hosted, but you ship a TFLite runtime + model and tune it per platform. More work, no vendor.

**Android:**
- A **foreground service** (`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE`, a persistent
  notification) so the mic keeps running in the background without the OS killing it.
- `RECORD_AUDIO` permission; capture with `AudioRecord`, feed frames to the engine, emit the `wake`
  event via `notifyListeners("wake", ...)`.

**iOS:**
- Background audio is heavily restricted. Use the **Audio** background mode (`UIBackgroundModes`) with
  an active `AVAudioSession` (`.record`/`.playAndRecord`); expect Apple review questions and real
  battery/permission caveats. Capture via `AVAudioEngine`, feed the engine, emit `wake`.
- `NSMicrophoneUsageDescription` in Info.plist.

**Bridge to the voice pipeline:** on detection the plugin only fires the `wake` JS event — the existing
Jarvis client then runs its normal capture→STT→turn flow (Hub `wake_event` + `stage_*`). No new server
protocol is needed; the on-device wake simply replaces the Python `wake_listener` as the trigger on
mobile.

**Test on device:** lock the screen → say the wake word → confirm the `wake` event fires and a turn
starts; verify battery drain and that the foreground-service notification behaves.
