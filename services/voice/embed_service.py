"""embed_service.py — persistent LOCAL text-embedding service for Jarvis semantic memory.

Loads sentence-transformers (default all-MiniLM-L6-v2, 384-dim) ONCE and keeps it warm in memory,
so each turn's semantic-memory index avoids the Python-startup + torch + model-load cost that the
old per-call embed.py paid EVERY turn (the biggest structural cost of the post-turn background work
— tens of seconds to over a minute on CPU). Mirrors the same fix already applied to TTS/STT via
piper_service.py / whisper_service.py.

Protocol (one JSON object per line):
  stdout <- {"ready": true}                     once, after the model loads
            {"ready": false, "error": "..."}    once, if sentence-transformers is missing/failed
  stdin  -> {"id": 1, "texts": ["...", ...]}
  stdout <- {"id": 1, "vecs": [[...], ...]}      per request
            {"id": 1, "error": "..."}            per request, on failure (never kills the service)

Install once:  pip install sentence-transformers
Env: JARVIS_EMBED_MODEL (default all-MiniLM-L6-v2).
"""
from __future__ import annotations

import json
import os
import sys


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main() -> None:
    try:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(os.environ.get("JARVIS_EMBED_MODEL", "all-MiniLM-L6-v2"))
    except Exception as error:  # noqa: BLE001 — report and exit so the Hub falls back gracefully
        _emit({"ready": False, "error": str(error)})
        return
    _emit({"ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            texts = [str(t) for t in (request.get("texts") or [])]
            if not texts:
                _emit({"id": request_id, "vecs": []})
                continue
            vectors = model.encode(texts, normalize_embeddings=True)
            _emit({"id": request_id, "vecs": [v.tolist() for v in vectors]})
        except Exception as error:  # noqa: BLE001 — one bad request must not kill the warm service
            _emit({"id": request_id, "error": str(error)})


if __name__ == "__main__":
    main()
