"""
Persistent TTS service — loads Piper voice models ONCE and keeps them warm in memory, so each
spoken reply avoids the Python-startup + model-load cost that `python -m piper` pays on every
single call. That per-call spawn was the biggest structural latency source in the voice pipeline
(see Gap 1 in the voice-audio-gaps backlog) — mirrors the same fix already applied to STT via
whisper_service.py.

Protocol (one JSON object per line):
  stdin  ->  {"id": 1, "text": "...", "voice": "pt_BR-faber-medium", "length_scale": 1.06,
              "sentence_silence": 0.32, "noise_w_scale": 0.9}
  stdout <-  {"ready": true}                                    # once, at startup
             {"id": 1, "wav_b64": "..."}                        # per request
             {"id": 1, "error": "..."}                          # per request, on failure

Voices are loaded LAZILY on first use and cached in memory — switching voice in Settings doesn't
reload anything already spoken before, and startup doesn't block on loading every installed voice.
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import wave

from piper import PiperVoice
from piper.config import SynthesisConfig

VOICES_DIR = os.path.join(os.path.expanduser("~"), ".jarvis", "voices")

_cache: dict[str, PiperVoice] = {}


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _load(voice: str) -> PiperVoice:
    v = _cache.get(voice)
    if v is not None:
        return v
    model_path = os.path.join(VOICES_DIR, f"{voice}.onnx")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"voice model not found: {model_path}")
    v = PiperVoice.load(model_path)
    _cache[voice] = v
    return v


def _synth(text: str, voice: str, length_scale: float, sentence_silence: float, noise_w_scale: float) -> bytes:
    v = _load(voice)
    syn_config = SynthesisConfig(length_scale=length_scale, noise_w_scale=noise_w_scale)
    # Mirrors `python -m piper`'s CLI behavior: one "sentence" per input line, with a configurable
    # silence gap inserted BETWEEN them (not before the first) — reads more naturally than one
    # single unbroken synthesis pass over the whole reply.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()] or [text]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_params_set = False
        silence_bytes = b""
        first = True
        for line in lines:
            for chunk in v.synthesize(line, syn_config):
                if not wav_params_set:
                    wav_file.setframerate(chunk.sample_rate)
                    wav_file.setsampwidth(chunk.sample_width)
                    wav_file.setnchannels(chunk.sample_channels)
                    wav_params_set = True
                    silence_bytes = bytes(int(chunk.sample_rate * sentence_silence * chunk.sample_width))
                if not first:
                    wav_file.writeframes(silence_bytes)
                first = False
                wav_file.writeframes(chunk.audio_int16_bytes)
    return buf.getvalue()


def main() -> int:
    _emit({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            wav = _synth(
                str(req.get("text") or ""),
                str(req.get("voice") or "en_GB-alan-medium"),
                float(req.get("length_scale", 1.06)),
                float(req.get("sentence_silence", 0.32)),
                float(req.get("noise_w_scale", 0.9)),
            )
            _emit({"id": req_id, "wav_b64": base64.b64encode(wav).decode("ascii")})
        except Exception as e:  # noqa: BLE001 — one bad request must not kill the service
            _emit({"id": req_id, "error": str(e)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
