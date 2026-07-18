#!/usr/bin/env python3
"""embed.py — LOCAL text embeddings for Jarvis semantic memory.

Uses sentence-transformers (default all-MiniLM-L6-v2, 384-dim). Fully offline after the first
model download (~90 MB, cached in the HF home). Reads a JSON array of strings on stdin, prints a
JSON array of vectors as the LAST line of stdout (torch/model noise may precede it — the Hub parses
the trailing JSON, same as the speaker/whisper bridges).

Install once:  pip install sentence-transformers
Env: JARVIS_EMBED_MODEL (default all-MiniLM-L6-v2).
"""
import sys
import os
import json

_model = None


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(os.environ.get("JARVIS_EMBED_MODEL", "all-MiniLM-L6-v2"))
    return _model


def main():
    raw = sys.stdin.read().strip()
    try:
        texts = json.loads(raw) if raw else []
    except Exception:
        texts = [raw] if raw else []
    if isinstance(texts, str):
        texts = [texts]
    texts = [str(t) for t in texts]
    if not texts:
        print("[]")
        return
    vecs = get_model().encode(texts, normalize_embeddings=True)
    print(json.dumps([v.tolist() for v in vecs]))


if __name__ == "__main__":
    main()
