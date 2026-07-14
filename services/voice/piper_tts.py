"""
Local TTS via Piper — the first working voice adapter (TTSAdapter).

100% offline: no network, no third parties. Speaks on this machine only.
Voice models live in ~/.jarvis/voices (downloaded with `piper.download_voices`).

CLI:
    python piper_tts.py "Good evening, sir."
    python piper_tts.py --voice pt_BR-faber-medium "Bom dia, Jonathan."
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile

VOICES_DIR = os.path.join(os.path.expanduser("~"), ".jarvis", "voices")
DEFAULT_VOICE = "en_GB-alan-medium"


def voice_path(voice: str) -> str:
    path = os.path.join(VOICES_DIR, f"{voice}.onnx")
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"voice model not found: {path}\n"
            f"download it with: python -m piper.download_voices {voice}"
        )
    return path


def synthesize(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """text -> WAV bytes (fully local)."""
    model = voice_path(voice)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        out = tf.name
    try:
        subprocess.run(
            [sys.executable, "-m", "piper", "-m", model, "-f", out],
            input=text.encode("utf-8"),
            check=True,
            capture_output=True,
        )
        with open(out, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(out)
        except OSError:
            pass


def _main() -> int:
    ap = argparse.ArgumentParser(description="Local Piper TTS")
    ap.add_argument("text", nargs="*", help="text to speak")
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    ap.add_argument("--out", default=os.path.join(os.path.expanduser("~"), ".jarvis", "out.wav"))
    args = ap.parse_args()

    text = " ".join(args.text) or "Good evening, sir. All systems are operational."
    data = synthesize(text, args.voice)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "wb") as f:
        f.write(data)
    print(f"[piper] {len(data)} bytes -> {args.out} (voice={args.voice})")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
