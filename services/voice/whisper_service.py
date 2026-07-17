"""
Persistent STT service — loads faster-whisper ONCE and serves transcription requests over
stdio (JSON lines). This avoids reloading the model on every voice message, which is what makes
a bigger/better model (large-v3-turbo) usable without paying a multi-second load per utterance.

Protocol (one JSON object per line):
  stdin  ->  {"id": 1, "path": "C:\\...\\clip.webm", "lang": "pt"|null, "hotwords": "Docker git ..."}
  stdout <-  {"ready": true, "model": "..."}                      # once, at startup
             {"id": 1, "text": "...", "lang": "pt"}               # per request
             {"id": 1, "error": "..."}                            # per request, on failure

Language is AUTO-DETECTED when "lang" is null (so pt / en / es all work, including English
technical terms inside Portuguese speech). "hotwords" biases the decoder toward the vocabulary
we actually use (names, tools) — cheap and effective for domain terms.

Env:
  JARVIS_STT_MODEL    default "deepdml/faster-whisper-large-v3-turbo-ct2" (near large-v3 accuracy,
                      8-12x realtime on CPU int8, ~1.5GB). First run downloads it into the HF cache.
  JARVIS_STT_COMPUTE  default "int8" (CPU). "int8_float16"/"float16" if a GPU is set up.
  JARVIS_STT_DEVICE   default "cpu".
"""
from __future__ import annotations

import json
import os
import sys

from faster_whisper import WhisperModel

MODEL = os.environ.get("JARVIS_STT_MODEL", "deepdml/faster-whisper-large-v3-turbo-ct2")
DEVICE = os.environ.get("JARVIS_STT_DEVICE", "cpu")
COMPUTE = os.environ.get("JARVIS_STT_COMPUTE", "int8")


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    try:
        model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
    except Exception as e:  # noqa: BLE001 — startup failure must be reported, not crash silently
        _emit({"ready": False, "error": f"load {MODEL}: {e}"})
        return 1
    _emit({"ready": True, "model": MODEL})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            segments, info = model.transcribe(
                req["path"],
                language=req.get("lang") or None,   # None -> auto-detect (pt/en/es/...)
                vad_filter=True,
                beam_size=int(req.get("beam", 5)),
                hotwords=req.get("hotwords") or None,
                condition_on_previous_text=False,   # each utterance is independent; avoids drift
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            _emit({"id": req_id, "text": text, "lang": getattr(info, "language", None)})
        except Exception as e:  # noqa: BLE001 — one bad request must not kill the service
            _emit({"id": req_id, "error": str(e)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
