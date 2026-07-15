"""
Local speaker embedding (Resemblyzer) — 100% offline, nothing leaves the machine.

Turns an utterance into a 256-d L2-normalized voice embedding. Cosine similarity
between embeddings measures "same speaker". Audio is decoded with faster-whisper's
bundled decoder (PyAV) so any container the browser records (webm/opus) or the wake
listener writes (wav) works with no system ffmpeg.

Model note: Resemblyzer pulls torch (CPU is fine). Embeddings are already
L2-normalized, so cosine == dot product; we still normalize centroids defensively.
"""
from __future__ import annotations

import numpy as np

_encoder = None


def _get_encoder():
    global _encoder
    if _encoder is None:
        from resemblyzer import VoiceEncoder  # lazy: torch import is heavy
        _encoder = VoiceEncoder(device="cpu", verbose=False)
    return _encoder


def _load_audio(path: str) -> np.ndarray:
    """Decode any audio container to float32 mono @16k (reuses faster-whisper's decoder)."""
    from faster_whisper.audio import decode_audio
    return decode_audio(path, sampling_rate=16000)


def embed_wav(path: str) -> np.ndarray:
    """One utterance -> 256-d L2-normalized embedding."""
    from resemblyzer import preprocess_wav
    wav = preprocess_wav(_load_audio(path), source_sr=16000)  # trims silence, normalizes
    emb = _get_encoder().embed_utterance(wav)
    return np.asarray(emb, dtype=np.float32)


def embed_many(paths: list[str]) -> np.ndarray:
    """Mean of several utterances -> a stable, L2-normalized voiceprint centroid."""
    embs = [embed_wav(p) for p in paths]
    m = np.mean(embs, axis=0)
    n = float(np.linalg.norm(m))
    return (m / n).astype(np.float32) if n > 0 else m.astype(np.float32)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b)) or 1.0
    return float(np.dot(a, b) / denom)
