"""
Persistent STT service — loads faster-whisper ONCE and serves transcription requests over
stdio (JSON lines). This avoids reloading the model on every voice message, which is what makes
a bigger/better model (large-v3-turbo) usable without paying a multi-second load per utterance.

Protocol (one JSON object per line):
  stdin  ->  {"id": 1, "path": "C:\\...\\clip.webm", "lang": "pt"|null, "langs": ["pt","en"]|null,
              "hotwords": "Docker git ..."}
  stdout <-  {"ready": true, "model": "...", "device": "cuda"|"cpu", "compute": "int8"}   # once
             {"id": 1, "text": "...", "lang": "pt", "conf": 0.83}  # per request
             {"id": 1, "error": "..."}                            # per request, on failure

"langs" (VOZ-00 RN-H3): the language is detected ONLY among these and the clip is then transcribed
with the winner pinned. Free auto-detect over ~100 languages is what turned Portuguese into Romanian;
a restricted set keeps the "speak English sometimes" door open without that failure. "lang" wins
over "langs" when both come.

Streaming (VOZ-00 F4/F5) — while the user is still talking:
  stdin  ->  {"op": "stream_open", "sid": "s1", "lang": "pt"|null, "langs": [...]|null, "hotwords": "..."}
             {"op": "stream_audio", "sid": "s1", "pcm": "<base64 int16 mono 16 kHz>"}
             {"op": "stream_close", "sid": "s1"}
  stdout <-  {"sid": "s1", "event": "vad", "speechMs": 1830, "silenceMs": 420, "durMs": 2900, "partialFresh": true}
             {"sid": "s1", "event": "partial", "text": "verifica se o build", "fresh": false}
             {"sid": "s1", "event": "error", "error": "..."}
The model-based voice detector (Silero, shipped with faster-whisper) measures silence since the last
SPEECH — not since the last noise — and partial transcripts tell the Hub whether the sentence sounds
finished. The Hub decides the end of turn; the final transcript still comes from the normal request.

"conf" is a 0..1 confidence (exp of the duration-weighted mean token log-prob). The Hub uses it to
decide whether paying an LLM correction pass is worth it (VOZ-00 RN-C3).

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
import platform
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

import math

import numpy as np
from faster_whisper import WhisperModel, decode_audio

_DEFAULT_MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2"
MODEL = os.environ.get("JARVIS_STT_MODEL", _DEFAULT_MODEL)
DEVICE = os.environ.get("JARVIS_STT_DEVICE", "cpu")
COMPUTE = os.environ.get("JARVIS_STT_COMPUTE", "int8")
BEAM = int(os.environ.get("JARVIS_STT_BEAM", "1"))  # greedy by default — the decode is cheaper than beam=5
_lang_env = os.environ.get("JARVIS_STT_LANG", "pt").strip().lower()
LANG = None if _lang_env in ("", "auto", "none") else _lang_env


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(msg: str) -> None:
    # stderr nunca e parseado como linha de protocolo (o stdout e), entao e o canal seguro para
    # diagnostico. O Hub le o stderr e encaminha ao hub.log APENAS as linhas prefixadas com
    # "[stt]" (apps/hub/src/stt.ts); o resto — progresso de carga de modelo — segue descartado.
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


def _pick_language(model: WhisperModel, audio: "np.ndarray", allowed: list) -> str:
    """Most probable language AMONG `allowed` (not among all ~100). Falls back to the first allowed
    one when detection fails or none of them shows up in the probabilities."""
    try:
        _lang, _prob, probs = model.detect_language(audio=audio, vad_filter=True)
        ranked = {code: p for code, p in (probs or [])}
        best = max(allowed, key=lambda code: ranked.get(code, 0.0))
        return best if ranked.get(best, 0.0) > 0 else allowed[0]
    except Exception as e:  # noqa: BLE001 — detection is an optimization; transcription still runs
        _log(f"[stt] deteccao de idioma falhou ({e}); usando {allowed[0]}")
        return allowed[0]


def _confidence(segments: list) -> "float | None":
    """exp(mean avg_logprob weighted by segment duration), clamped to 0..1. None without segments."""
    total = 0.0
    weight = 0.0
    for seg in segments:
        dur = max(0.01, float(seg.end) - float(seg.start))
        total += float(seg.avg_logprob) * dur
        weight += dur
    if weight <= 0:
        return None
    return max(0.0, min(1.0, math.exp(total / weight)))


# --- streaming (VOZ-00 F4/F5) ---------------------------------------------------------------------
_VAD_WINDOW = 512                 # 32 ms a 16 kHz — a janela do Silero
_VAD_TRAIL = 16000 * 8            # o silêncio é medido nos últimos 8 s (custo constante por pedaço)
_STREAM_MAX = 16000 * 120         # teto de 2 min por gravação
_PARTIAL_EVERY = 16000 * 1.5      # parcial a cada ~1,5 s de áudio novo enquanto há fala
_PAUSE_PARTIAL_MS = 350           # numa pausa, uma parcial que cubra tudo o que foi dito
_vad_model = None


def _vad():
    global _vad_model
    if _vad_model is None:
        from faster_whisper.vad import get_vad_model
        _vad_model = get_vad_model()
    return _vad_model


class _Stream:
    def __init__(self, sid: str, lang, langs, hotwords):
        self.sid = sid
        self.lang = lang
        self.langs = langs or []
        self.hotwords = hotwords
        self.buf = np.zeros(0, dtype=np.float32)
        self.counted = 0            # amostras já contadas no total de fala
        self.speech_ms = 0
        self.last_speech_end = -1   # amostra onde a última fala terminou
        self.partial_at = 0         # tamanho do buffer na última parcial


_streams: dict = {}


def _stream_partial(model: WhisperModel, st: "_Stream", fresh: bool) -> None:
    lang = st.lang
    if not lang and len(st.langs) == 1:
        lang = st.langs[0]
    if not lang and len(st.langs) > 1:
        lang = st.lang = _pick_language(model, st.buf, st.langs)   # decide uma vez por gravação
    segments, _info = model.transcribe(
        st.buf, language=lang or LANG or None, vad_filter=False, beam_size=1,
        hotwords=st.hotwords or None, condition_on_previous_text=False, without_timestamps=True,
    )
    text = " ".join(seg.text.strip() for seg in segments).strip()
    st.partial_at = len(st.buf)
    _emit({"sid": st.sid, "event": "partial", "text": text, "fresh": fresh})


def _stream_audio(model: WhisperModel, st: "_Stream", pcm: bytes) -> None:
    chunk = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    if len(st.buf) + len(chunk) > _STREAM_MAX:
        chunk = chunk[: max(0, _STREAM_MAX - len(st.buf))]
    st.buf = np.concatenate([st.buf, chunk])
    n = len(st.buf) // _VAD_WINDOW * _VAD_WINDOW
    start = max(0, (n - _VAD_TRAIL) // _VAD_WINDOW * _VAD_WINDOW)
    if n - start < _VAD_WINDOW:
        return
    probs = np.asarray(_vad()(st.buf[start:n])).reshape(-1)
    speech = probs >= 0.5
    # Total de fala: conta só janelas novas (as já contadas ficam como estavam).
    first_new = max(0, (st.counted - start) // _VAD_WINDOW)
    st.speech_ms += int(speech[first_new:].sum()) * 32
    st.counted = n
    idx = np.where(speech)[0]
    if len(idx):
        st.last_speech_end = start + (int(idx[-1]) + 1) * _VAD_WINDOW
    silence_ms = int((n - st.last_speech_end) / 16) if st.last_speech_end >= 0 else int(n / 16)
    fresh = st.last_speech_end >= 0 and st.partial_at >= st.last_speech_end
    _emit({"sid": st.sid, "event": "vad", "speechMs": st.speech_ms, "silenceMs": silence_ms, "durMs": int(len(st.buf) / 16), "partialFresh": fresh})
    if st.speech_ms < 250:
        return
    if silence_ms >= _PAUSE_PARTIAL_MS and not fresh:
        _stream_partial(model, st, True)       # pausa: o Hub precisa saber se a frase acabou
    elif silence_ms < _PAUSE_PARTIAL_MS and len(st.buf) - st.partial_at >= _PARTIAL_EVERY:
        _stream_partial(model, st, False)      # falando: parcial para mostrar na tela


def _handle_stream(model: WhisperModel, req: dict) -> None:
    op, sid = req.get("op"), str(req.get("sid") or "")
    if not sid:
        return
    try:
        if op == "stream_open":
            langs = [c for c in (req.get("langs") or []) if isinstance(c, str) and c]
            _streams[sid] = _Stream(sid, req.get("lang") or None, langs, req.get("hotwords") or None)
            if len(_streams) > 8:   # aparelho que sumiu sem fechar: descarta o mais antigo
                _streams.pop(next(iter(_streams)))
        elif op == "stream_audio":
            st = _streams.get(sid)
            if st is not None:
                import base64
                _stream_audio(model, st, base64.b64decode(req.get("pcm") or ""))
        elif op == "stream_close":
            _streams.pop(sid, None)
    except Exception as e:  # noqa: BLE001 — um pedaço ruim não derruba o serviço
        _emit({"sid": sid, "event": "error", "error": str(e)})


def _warn_mac_cpu_only() -> None:
    """Num Mac, o STT roda 100% em CPU — e isso nao e configuravel.

    Nenhum Mac tem NVIDIA, e o CTranslate2 (motor do faster-whisper) nao tem backend Metal nem
    CoreML: `JARVIS_STT_DEVICE=cuda` so pode falhar e cair para cpu. O default
    large-v3-turbo tem o ENCODER em tamanho cheio, que na CPU domina o custo e escala com a duracao
    da fala. Num Mac Intel sem GPU isso aparece como "o Jarvis demora para me entender", e nada no
    produto dizia por que — so o comentario deste arquivo, que o usuario nao le.

    Avisa uma vez no boot do servico, no stderr. O Hub encaminha para o log APENAS as linhas
    prefixadas com "[stt]" (apps/hub/src/stt.ts) — o resto do stderr e progresso de carga de modelo
    e segue descartado. Por isso o prefixo nao e decoracao: sem ele a mensagem some.

    NAO troca o default: o modelo e escolha do dono, e trocar por arquitetura em silencio
    transforma uma diferenca de hardware em bug de suporte.
    """
    if platform.system() != "Darwin":
        return
    arch = platform.machine()
    _log(f"[stt] macOS ({arch}): o CTranslate2 nao tem backend Metal/CoreML — o STT roda 100% em CPU.")
    if MODEL == _DEFAULT_MODEL:
        slow = " Numa CPU x86_64 sem GPU uma fala longa pode passar de 20s." if arch == "x86_64" else ""
        _log(
            f"[stt] modelo default ({MODEL}) tem encoder em tamanho cheio.{slow}"
            " Para 3-5x mais rapido: JARVIS_STT_MODEL=small (ou base) em ~/.jarvis/hub.env."
        )
    if DEVICE != "cpu":
        _log(f"[stt] JARVIS_STT_DEVICE={DEVICE} nao existe em macOS; o servico vai cair para cpu/int8.")


def main() -> int:
    _warn_mac_cpu_only()
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
            if req.get("op"):
                _handle_stream(model, req)
                continue
            req_id = req.get("id")
            lang = req.get("lang") or None
            allowed = [code for code in (req.get("langs") or []) if isinstance(code, str) and code]
            source = req["path"]
            if not lang and len(allowed) == 1:
                lang = allowed[0]
            elif not lang and len(allowed) > 1:
                source = decode_audio(req["path"], sampling_rate=16000)   # decode once, reuse below
                lang = _pick_language(model, source, allowed)
            segments, info = model.transcribe(
                source,
                language=lang or LANG or None,   # request lang/langs > JARVIS_STT_LANG > auto
                vad_filter=True,
                beam_size=int(req.get("beam", BEAM)),
                hotwords=req.get("hotwords") or None,
                condition_on_previous_text=False,   # each utterance is independent; avoids drift
            )
            segs = list(segments)
            text = " ".join(s.text.strip() for s in segs).strip()
            conf = _confidence(segs)
            _emit({"id": req_id, "text": text, "lang": getattr(info, "language", None), "conf": None if conf is None else round(conf, 3)})
        except Exception as e:  # noqa: BLE001 — one bad request must not kill the service
            _emit({"id": req_id, "error": str(e)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
