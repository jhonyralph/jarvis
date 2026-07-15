# voice service (local STT/TTS)

Runs fully offline on the machine. No third parties.

## TTS — Piper (working)

Install (once):

```bash
pip install -r requirements.txt
python -m piper.download_voices en_GB-alan-medium pt_BR-faber-medium
```

Voices download to `~/.jarvis/voices/`. Then:

```bash
python piper_tts.py "Good evening, sir."
python piper_tts.py --voice pt_BR-faber-medium "Bom dia, Jonathan."
```

Writes a WAV to `~/.jarvis/out.wav`. Cold call ~1.5s (Python + model load);
a persistent service keeps the model loaded and streams sub-second.

## STT — faster-whisper (working)

`faster-whisper` (model `small`, CPU int8; bundles PyAV so no system ffmpeg).
`whisper_stt.py` exposes `transcribe(wav_path, lang=None)`. Closes the voice
loop: audio → text → agent → TTS. First run downloads ~460 MB.

## Wake word — "Hey Jarvis" (working, machine-side)

`wake_listener.py` runs on the machine (native, no phone battery). It listens
on the mic for **"Hey Jarvis"** (openWakeWord pretrained, onnx), captures the
following utterance, transcribes it with the warm faster-whisper, and injects it
into the Hub's dedicated `voice` session over WebSocket — exactly as a client
`{t:"send", speak:true}`. The Hub's spoken reply is played on the machine
speakers. Self-triggering is suppressed while speaking.

```bash
pip install -r requirements.txt          # openwakeword + sounddevice + websocket-client
python wake_listener.py                   # Hub must be running (ws://127.0.0.1:4577)
```

Then just say **"Hey Jarvis, ..."**. Toggle it from the web UI (Configurações →
Wake word) — the switch arms/disarms the listener live over the Hub.

Env: `JARVIS_HUB_WS`, `JARVIS_WAKE_SESSION` (=voice), `JARVIS_WAKE_MODEL`
(=hey_jarvis), `JARVIS_WAKE_MODEL_FILE` (custom .onnx for bare "Jarvis"),
`JARVIS_WAKE_THRESHOLD` (=0.5), `JARVIS_WAKE_LANG` (=pt).

> The pretrained phrase is "Hey Jarvis". A bare "Jarvis" needs a custom-trained
> `.onnx` (openWakeWord's training notebook) pointed at via `JARVIS_WAKE_MODEL_FILE`.

## Roadmap

- [x] TTS (Piper)
- [x] STT (faster-whisper)
- [x] wake word (openWakeWord, "Hey Jarvis")
- [ ] voice identification (speaker verification, multi-user)
- [ ] wrap as a local WS service the Hub calls (STTAdapter / TTSAdapter)
