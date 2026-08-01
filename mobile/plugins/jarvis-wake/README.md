# jarvis-wake (custom Capacitor plugin) - background wake word

Always-on **"Hey Jarvis"** detection while the app is backgrounded / the screen is locked. A browser
PWA cannot do this; this plugin falls back to a web no-op there. Android is implemented in the app
shell with openWakeWord, ONNX Runtime, bundled wake-word assets, and a foreground microphone service;
iOS is still pending.

The Android implementation lives under `mobile/android/app/src/main/java/chat/jarvis/app/` because it
is registered directly in the Capacitor shell.

## Android setup

1. Build/install the APK:

   ```powershell
   npm --prefix mobile run android:debug
   ```

2. In the APK, enable wake word in Configuracoes -> Voz -> Wake word.

`mobile/apply-android-native.mjs` downloads the three required ONNX assets into
`mobile/android/app/src/main/assets/` when they are missing:

- `melspectrogram.onnx`
- `embedding_model.onnx`
- `hey_jarvis.onnx`

No Picovoice key or paid wake-word provider is required. The packaged phrase is "Hey Jarvis" with a
threshold of `0.45`.

## Native implementation spec

**Android:** implemented with a foreground service (`FOREGROUND_SERVICE` +
`FOREGROUND_SERVICE_MICROPHONE`) and `RECORD_AUDIO`. On detection the service brings `MainActivity`
forward and emits the retained `wake` event to the JS bridge.

**iOS:**
- Background audio is heavily restricted. Use the **Audio** background mode (`UIBackgroundModes`) with
  an active `AVAudioSession` (`.record`/`.playAndRecord`); expect Apple review questions and real
  battery/permission caveats. Capture via `AVAudioEngine`, feed the engine, emit `wake`.
- `NSMicrophoneUsageDescription` in Info.plist.

**Bridge to the voice pipeline:** on detection the plugin only fires the `wake` JS event. The existing
Jarvis client then runs its normal capture -> STT -> turn flow (Hub `wake_event` + `stage_*`). No new
server protocol is needed; the on-device wake simply replaces the Python `wake_listener` as the trigger
on mobile.

**Test on device:** lock the screen -> say "Hey Jarvis" -> confirm the `wake` event fires and a turn
starts; verify battery drain and that the foreground-service notification behaves.
