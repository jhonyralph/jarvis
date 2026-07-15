"""
Local voiceprint store — enroll / identify speakers, fully on-machine.

Each enrolled user is a single .npy centroid under ~/.jarvis/voiceprints/. There is
NO cloud, NO third party: voiceprints never leave the machine (Jonathan's hard req).

identify() returns the best-matching enrolled name and cosine score; `known` is True
only when the score clears the threshold (default 0.75, tuned for Resemblyzer).
"""
from __future__ import annotations

import os
import re

import numpy as np

from speaker_id import cosine, embed_many, embed_wav

DIR = os.environ.get(
    "JARVIS_VOICEPRINTS",
    os.path.join(os.path.expanduser("~"), ".jarvis", "voiceprints"),
)
DEFAULT_THRESHOLD = float(os.environ.get("JARVIS_VOICE_THRESHOLD", "0.75"))


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name).strip("_") or "user"


def _path(name: str) -> str:
    return os.path.join(DIR, _safe(name) + ".npy")


def enroll(name: str, wav_paths: list[str]) -> dict:
    """Average several utterances into one voiceprint centroid for `name`."""
    os.makedirs(DIR, exist_ok=True)
    emb = embed_many(wav_paths)
    np.save(_path(name), emb)
    return {"name": _safe(name), "samples": len(wav_paths), "dim": int(emb.shape[0])}


def list_names() -> list[str]:
    if not os.path.isdir(DIR):
        return []
    return sorted(os.path.splitext(f)[0] for f in os.listdir(DIR) if f.endswith(".npy"))


def _load_all() -> dict:
    out: dict = {}
    if not os.path.isdir(DIR):
        return out
    for f in os.listdir(DIR):
        if f.endswith(".npy"):
            out[os.path.splitext(f)[0]] = np.load(os.path.join(DIR, f))
    return out


def identify(wav_path: str, threshold: float | None = None) -> dict:
    """Best-matching enrolled speaker for an utterance (or unknown)."""
    threshold = DEFAULT_THRESHOLD if threshold is None else threshold
    prints = _load_all()
    if not prints:
        return {"name": None, "score": 0.0, "known": False, "enrolled": [], "threshold": threshold}
    emb = embed_wav(wav_path)
    scores = {n: cosine(emb, v) for n, v in prints.items()}
    best = max(scores, key=scores.get)
    score = scores[best]
    known = score >= threshold
    return {
        "name": best if known else None,
        "best": best,
        "score": round(float(score), 4),
        "known": bool(known),
        "threshold": threshold,
        "scores": {k: round(float(v), 4) for k, v in scores.items()},
    }


def delete(name: str) -> bool:
    p = _path(name)
    if os.path.exists(p):
        os.remove(p)
        return True
    return False
