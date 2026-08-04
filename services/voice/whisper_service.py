"""
Persistent STT service — loads faster-whisper ONCE and serves transcription requests over
stdio (JSON lines). This avoids reloading the model on every voice message, which is what makes
a bigger/better model (large-v3-turbo) usable without paying a multi-second load per utterance.

Protocol (one JSON object per line):
  stdin  ->  {"id": 1, "path": "C:\\...\\clip.webm", "lang": "pt"|null, "hotwords": "Docker git ..."}
  stdout <-  {"ready": true, "model": "...", "device": "cuda"|"cpu", "compute": "int8"}   # once
             {"id": 1, "text": "...", "lang": "pt"}               # per request
             {"id": 1, "error": "..."}                            # per request, on failure

Language: pinned to JARVIS_STT_LANG (default "pt") when the request's "lang" is null. On this
single-user, Portuguese-first box, auto-detect was mis-firing (transcribing pt speech as Romanian
gibberish); pinning the language fixes accuracy AND skips the detection pass. Set JARVIS_STT_LANG
to "auto" (or empty) to restore auto-detect, or pass a per-request "lang" to override. English tech
terms inside Portuguese are still handled via the hotwords glossary.

Env:
  JARVIS_STT_MODEL    default "deepdml/faster-whisper-large-v3-turbo-ct2" (near large-v3 accuracy,
                      ~1.5GB). NOTE: turbo's ENCODER is full-size, so on a CPU it's the dominant cost
                      and scales with clip length — a long utterance can take 20s+. If STT is too slow
                      on your machine, set a SMALLER model (biggest CPU lever): "small" (~3-5x faster,
                      some accuracy loss), "medium" (in between), or "base" (fastest).
  JARVIS_STT_DEVICE   default "cpu". Set "cuda" to use an NVIDIA GPU — REQUIRES cuBLAS 12 + cuDNN 9
                      (pip: nvidia-cublas-cu12 nvidia-cudnn-cu12, or the CUDA Toolkit on PATH). If the
                      GPU can't run (missing libs, OOM), the service AUTO-FALLS-BACK to cpu/int8, so
                      setting "cuda" is always safe — voice keeps working either way.
  JARVIS_STT_COMPUTE  default "int8" (works on CPU and on Pascal GPUs, which lack fast float16).
  JARVIS_STT_BEAM     default 1 (greedy decoding — faster). Raise to 5 for max accuracy (slower).
  JARVIS_STT_LANG     default "pt". "auto"/"" restores language auto-detection.
"""
from __future__ import annotations

import json
import os
import sys


def _add_nvidia_cuda_dll_dirs() -> None:
    """Windows: the pip `nvidia-*-cu12` wheels drop cuBLAS/cuDNN DLLs under site-packages/nvidia/*/bin
    but do NOT put them on the DLL search path, so CTranslate2 fails with "cublas64_12.dll is not
    found" at the first GPU decode. Add those bin dirs explicitly. No-op off Windows / when absent, so
    it is safe to call unconditionally (harmless when running on the CPU)."""
    add = getattr(os, "add_dll_directory", None)
    if add is None:
        return
    try:
        import importlib.util
        spec = importlib.util.find_spec("nvidia")
        roots = list(spec.submodule_search_locations) if spec and spec.submodule_search_locations else []
    except Exception:  # noqa: BLE001 — best-effort; falls back to whatever is already on PATH
        roots = []
    dirs = []
    for root in roots:
        # cuda_runtime (cudart) is a TRANSITIVE dep of cublas — must be discoverable too, or cublas
        # loads but "cannot be loaded" for its missing dependency.
        for sub in ("cublas", "cudnn", "cuda_runtime", "cuda_nvrtc"):
            d = os.path.join(root, sub, "bin")
            if os.path.isdir(d):
                dirs.append(d)
    for d in dirs:
        try:
            add(d)
        except OSError:
            pass
    # PATH also covers transitive DLL deps (cublas -> cudart), which os.add_dll_directory can miss.
    if dirs:
        os.environ["PATH"] = os.pathsep.join(dirs) + os.pathsep + os.environ.get("PATH", "")


_add_nvidia_cuda_dll_dirs()

import numpy as np
from faster_whisper import WhisperModel

MODEL = os.environ.get("JARVIS_STT_MODEL", "deepdml/faster-whisper-large-v3-turbo-ct2")
DEVICE = os.environ.get("JARVIS_STT_DEVICE", "cpu")
COMPUTE = os.environ.get("JARVIS_STT_COMPUTE", "int8")
BEAM = int(os.environ.get("JARVIS_STT_BEAM", "1"))  # greedy by default — the decode is cheaper than beam=5
_lang_env = os.environ.get("JARVIS_STT_LANG", "pt").strip().lower()
LANG = None if _lang_env in ("", "auto", "none") else _lang_env


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(msg: str) -> None:
    # stderr is drained (and ignored) by the Hub — safe channel for diagnostics that must not be
    # parsed as a protocol line on stdout.
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _load(device: str, compute: str) -> WhisperModel:
    """Load the model AND force one real decode so a missing GPU compute lib (cuBLAS/cuDNN) or an OOM
    fails HERE — at startup — instead of on the user's first live utterance. The probe runs the full
    encoder (whisper always pads to a 30s mel window), which is exactly the path that pulls cuBLAS."""
    m = WhisperModel(MODEL, device=device, compute_type=compute)
    probe = np.zeros(16000, dtype=np.float32)  # 1s of silence — enough to exercise the compute path
    segments, _ = m.transcribe(probe, language=LANG or "pt", vad_filter=False, beam_size=1)
    list(segments)  # the generator is lazy; consume it to actually run inference
    return m


def main() -> int:
    device, compute = DEVICE, COMPUTE
    try:
        model = _load(device, compute)
    except Exception as e:  # noqa: BLE001 — startup failure must be reported, not crash silently
        if device != "cpu":
            _log(f"[stt] device '{device}/{compute}' indisponível ({e}); caindo para cpu/int8")
            try:
                device, compute = "cpu", "int8"
                model = _load(device, compute)
            except Exception as e2:  # noqa: BLE001
                _emit({"ready": False, "error": f"load {MODEL} on cpu: {e2}"})
                return 1
        else:
            _emit({"ready": False, "error": f"load {MODEL}: {e}"})
            return 1
    _emit({"ready": True, "model": MODEL, "device": device, "compute": compute})

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
                language=req.get("lang") or LANG or None,   # request lang > JARVIS_STT_LANG > auto
                vad_filter=True,
                beam_size=int(req.get("beam", BEAM)),
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
