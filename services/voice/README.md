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

## STT — faster-whisper (next)

Planned: `faster-whisper` (needs `ffmpeg` on PATH). Model `small` fits the
Quadro P1000 (4 GB) or runs on the i7-14700KF CPU. Closes the voice loop:
audio → text → agent → TTS.

## Roadmap

- [x] TTS (Piper)
- [ ] STT (faster-whisper) + ffmpeg
- [ ] wake word (openWakeWord, "Jarvis")
- [ ] wrap as a local WS service the Hub calls (STTAdapter / TTSAdapter)
