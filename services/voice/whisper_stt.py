"""
Local STT via faster-whisper — 100% offline. No system ffmpeg needed (PyAV bundles
the decoders). Runs on CPU (int8) — fast on the i7-14700KF, no CUDA setup required.

First run downloads the model (~460 MB for "small") from HuggingFace into the local
HF cache; after that it's fully offline.

CLI:
    python whisper_stt.py path\\to\\audio.wav
    python whisper_stt.py --lang pt audio.wav
"""
from __future__ import annotations

import argparse
import sys
import time
from functools import lru_cache

from faster_whisper import WhisperModel

MODEL_SIZE = "small"


@lru_cache(maxsize=1)
def _model() -> WhisperModel:
    return WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")


def transcribe(path: str, lang: str | None = None) -> str:
    """audio file -> text (local, offline)."""
    segments, _info = _model().transcribe(path, language=lang, vad_filter=True)
    return " ".join(s.text.strip() for s in segments).strip()


def _main() -> int:
    ap = argparse.ArgumentParser(description="Local faster-whisper STT")
    ap.add_argument("audio", help="path to an audio file (wav/mp3/…) ")
    ap.add_argument("--lang", default=None, help="language hint, e.g. pt / en")
    args = ap.parse_args()
    t0 = time.time()
    text = transcribe(args.audio, args.lang)
    print(f"[whisper] ({time.time() - t0:.1f}s) {text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
