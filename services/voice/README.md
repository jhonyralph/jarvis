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

## Voice identification — Resemblyzer (working, multi-user)

Local speaker verification. Each user enrolls a **voiceprint** (a 256-d embedding
averaged over a few short clips), stored under `~/.jarvis/voiceprints/` — nothing
leaves the machine. Every voice utterance is then matched (cosine similarity) to
the enrolled voiceprints: the message is labelled with who spoke, and — if the
gate is on — utterances from **unknown** voices are rejected.

- `speaker_id.py` — Resemblyzer embedding (audio decoded via faster-whisper).
- `voiceprints.py` — enroll / identify / list / delete against the local store.
- `voice_cli.py` — CLI the Hub shells out to (JSON on stdout).

```bash
python voice_cli.py enroll --name jonathan a.wav b.wav c.wav
python voice_cli.py identify utterance.webm      # -> {"name": ..., "score": ...}
python voice_cli.py list
```

Enroll from the web UI: **Configurações → Identificação de voz → Cadastrar minha
voz** (records 3 clips). Toggle "Exigir voz cadastrada" to gate unknown voices.

Env: `JARVIS_VOICEPRINTS` (store dir), `JARVIS_VOICE_THRESHOLD` (=0.75). The wake
listener honours `JARVIS_WAKE_GATE=1` to ignore unrecognized voices.

> Resemblyzer pulls torch (CPU). v1 spawns Python per utterance (~2–4 s cold on
> first call while torch loads); the planned persistent voice service loads the
> model once and makes this near-instant. `webrtcvad` (a Resemblyzer dep) needs
> `pkg_resources`, so setuptools is pinned `<81`.

## Roadmap

- [x] TTS (Piper)
- [x] STT (faster-whisper)
- [x] wake word (openWakeWord, "Hey Jarvis")
- [x] voice identification (Resemblyzer, multi-user, optional gate)
- [ ] wrap as a persistent local WS service the Hub calls (load models once)
