"""
Machine-side wake word for Jarvis — 100% local, native, zero phone battery.

Listens on the machine mic for "Hey Jarvis" (openWakeWord, pretrained), captures
the following utterance, transcribes it locally (warm faster-whisper), and injects
it into a dedicated "voice" session on the Hub over WebSocket — exactly as if a
client had sent {t:"send", speak:true}. The Hub's reply {t:"tts"} is played on the
machine speakers. Detection is suppressed while speaking (no self-trigger).

Run:  python wake_listener.py         (Hub must be running on ws://127.0.0.1:4577)
Env:  JARVIS_HUB_WS, JARVIS_WAKE_SESSION(=voice), JARVIS_WAKE_MODEL(=hey_jarvis),
      JARVIS_WAKE_THRESHOLD(=0.5), JARVIS_WAKE_LANG(=pt), JARVIS_WAKE_MODEL_FILE
"""
from __future__ import annotations

import base64
import io
import json
import os
import queue
import sys
import tempfile
import threading
import time
import wave

import numpy as np
import sounddevice as sd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from whisper_stt import transcribe  # noqa: E402  (warm, in-process)

HUB_WS = os.environ.get("JARVIS_HUB_WS", "ws://127.0.0.1:4577")


def _wake_token() -> str:
    """Segredo por boot que prova que quem fala e um processo DESTA maquina.

    Estar em 127.0.0.1 nao prova nada: o Hub costuma ficar atras de `tailscale serve`, que disca
    loopback em nome de qualquer par do tailnet, e uma pagina web aberta aqui tambem alcanca
    ws://127.0.0.1:4577 (WebSocket nao tem CORS). O Hub grava o segredo em ~/.jarvis/wake-token a
    cada boot; so um processo local le esse arquivo. Sem ele o Hub trata estas mensagens como
    qualquer outra e exige login — o listener nao tem dispositivo pareado, entao seria silencio.
    """
    value = os.environ.get("JARVIS_WAKE_TOKEN", "").strip()
    if value:
        return value
    path = os.path.join(os.environ.get("JARVIS_HOME") or os.path.expanduser("~"), ".jarvis", "wake-token")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError as e:
        print(f"[wake] sem token local ({path}): {e} — o Hub vai recusar a injecao de voz", flush=True)
        return ""
SESSION = os.environ.get("JARVIS_WAKE_SESSION", "voice")
WAKE_NAME = os.environ.get("JARVIS_WAKE_MODEL", "hey_jarvis")
WAKE_FILE = os.environ.get("JARVIS_WAKE_MODEL_FILE")  # optional custom .onnx (e.g. bare "Jarvis")
THRESHOLD = float(os.environ.get("JARVIS_WAKE_THRESHOLD", "0.5"))
LANG = os.environ.get("JARVIS_WAKE_LANG", "pt")
GATE = os.environ.get("JARVIS_WAKE_GATE", "0") == "1"  # reject utterances from unknown voices
SR = 16000
FRAME = 1280  # 80 ms @ 16 kHz — openWakeWord's expected frame

state = {"armed": True, "speaking": False}
# Microfone como o Hub o enxerga (wake_status). "error" carrega a mensagem do PortAudio.
mic = {"status": "unknown", "error": None, "device": None}
_ws_holder = {"ws": None}
_play_q: "queue.Queue[str]" = queue.Queue()


def send_status():
    """Reporta o estado do microfone ao Hub (aparece nos ajustes). Silencioso se desconectado."""
    ws = _ws_holder["ws"]
    if not ws:
        return
    try:
        ws.send(json.dumps({"t": "wake_status", "mic": mic["status"], "error": mic["error"], "device": mic["device"], "wakeToken": _wake_token()}))
    except Exception:
        pass


def set_mic(status: str, error: str | None = None, device: str | None = None):
    changed = (status, error) != (mic["status"], mic["error"])
    mic.update(status=status, error=error, device=device)
    if changed:  # so loga TRANSICOES: o log antigo repetia o mesmo traceback ~900 vezes
        print(f"[wake] microfone: {status}" + (f" ({device})" if device else "") + (f" — {error}" if error else ""), flush=True)
        send_status()


# ----------------------------- Hub WebSocket -------------------------------
def start_ws():
    import websocket  # websocket-client

    def on_open(ws):
        _ws_holder["ws"] = ws
        ws.send(json.dumps({"t": "wake_hello", "wakeToken": _wake_token()}))
        print("[wake] connected to hub", flush=True)
        send_status()

    def on_message(ws, raw):
        try:
            m = json.loads(raw)
        except Exception:
            return
        t = m.get("t")
        if t == "tts" and m.get("audio"):
            # Fila + thread propria: tocar aqui (sd.wait) bloqueava a thread do WebSocket — sem ping,
            # sem receber nada — durante toda a fala.
            _play_q.put(m["audio"])
        elif t == "wake_state":
            armed = bool(m.get("enabled", True))
            if armed != state["armed"]:
                print(f"[wake] armed={armed}", flush=True)
            state["armed"] = armed

    def on_close(ws, *_):
        _ws_holder["ws"] = None

    def run():
        while True:
            try:
                ws = websocket.WebSocketApp(HUB_WS, on_open=on_open, on_message=on_message, on_close=on_close)
                run.ws = ws
                ws.run_forever(ping_interval=20)
            except Exception as e:
                print("[wake] ws error:", e, flush=True)
            _ws_holder["ws"] = None
            time.sleep(2)  # reconnect

    def player():
        while True:
            play_wav_b64(_play_q.get())

    run.ws = None
    threading.Thread(target=run, daemon=True).start()
    threading.Thread(target=player, daemon=True).start()
    return run


def open_mic():
    """Abre o microfone padrao. Em falha NAO derruba o processo: reporta ao Hub e tenta de novo com
    backoff ate 60 s. De 25/09 a 28/09 o listener morreu ~900 vezes em "Error opening InputStream
    [MME error 11]", relancado pelo launcher a cada 3 s, sem ninguem saber pela UI."""
    delay = 2.0
    while True:
        try:
            dev = sd.query_devices(kind="input")
            # Com o servico "Audio do Windows" parado, MME/DirectSound/WASAPI somem e o PortAudio cai
            # no WDM-KS, que nao suporta leitura bloqueante (visto em 2026-10-07). Diz isso claramente.
            if sd.query_hostapis(dev["hostapi"])["name"] == "Windows WDM-KS":
                raise RuntimeError("nenhum microfone pelo Windows Audio (servico 'Audio do Windows' parado?)")
            stream = sd.InputStream(samplerate=SR, channels=1, dtype="int16", blocksize=FRAME)
            stream.start()
            set_mic("ok", device=str(dev.get("name") or "") or None)
            return stream
        except Exception as e:
            set_mic("error", error=str(e).splitlines()[0][:300])
            time.sleep(delay)
            delay = min(delay * 2, 60.0)
            try:  # o PortAudio guarda a lista de dispositivos do inicio: reinicia para enxergar o atual
                sd._terminate()
                sd._initialize()
            except Exception:
                pass


def play_wav_b64(b64: str):
    try:
        data = base64.b64decode(b64)
        with wave.open(io.BytesIO(data), "rb") as w:
            sr = w.getframerate()
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        state["speaking"] = True
        sd.play(pcm, sr)
        sd.wait()
    except Exception as e:
        print("[wake] play error:", e, flush=True)
    finally:
        time.sleep(0.4)  # refractory: let the tail fade before re-arming detection
        state["speaking"] = False


# ----------------------------- utterance capture ---------------------------
def capture_utterance(stream) -> np.ndarray:
    """Read frames until ~700 ms trailing silence or ~12 s cap; return int16 PCM."""
    frames, silent, spoke = [], 0, False
    max_frames = int(12 * SR / FRAME)
    for _ in range(max_frames):
        block, _ = stream.read(FRAME)
        pcm = block[:, 0] if block.ndim > 1 else block
        frames.append(pcm.copy())
        energy = int(np.abs(pcm.astype(np.int32)).mean())
        if energy > 220:
            spoke = True
            silent = 0
        elif spoke:
            silent += 1
            if silent > int(0.7 * SR / FRAME):  # ~700 ms of trailing silence
                break
    return np.concatenate(frames) if frames else np.zeros(0, dtype=np.int16)


def pcm_to_wav(pcm: np.ndarray) -> str:
    path = os.path.join(tempfile.gettempdir(), f"jarvis_wake_{int(time.time()*1000)}.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


def identify_speaker(wav_path: str):
    """Best-effort local speaker id; returns the enrolled name (or None). Never raises.

    Cheap when no one is enrolled (voiceprints.identify short-circuits before loading
    torch), so this is zero-overhead until the user enrolls a voice.
    """
    try:
        from voiceprints import identify
        return identify(wav_path).get("name")
    except Exception as e:
        print("[wake] speaker-id skipped:", e, flush=True)
        return None


# ----------------------------- main loop -----------------------------------
def main():
    from openwakeword.model import Model

    kwargs = {"inference_framework": "onnx"}
    model = Model(wakeword_models=[WAKE_FILE] if WAKE_FILE else [WAKE_NAME], **kwargs)
    key = next(iter(model.models.keys()))
    print(f"[wake] listening for '{key}' (threshold {THRESHOLD}) — say 'Hey Jarvis'", flush=True)

    ws = start_ws()
    stream = open_mic()
    try:
        while True:
            try:
                block, _ = stream.read(FRAME)
            except Exception as e:  # microfone sumiu (fone desconectado, troca de dispositivo padrao)
                set_mic("error", error=f"leitura do microfone falhou: {str(e).splitlines()[0][:200]}")
                try:
                    stream.close()
                except Exception:
                    pass
                stream = open_mic()
                continue
            frame = block[:, 0] if block.ndim > 1 else block
            if state["speaking"] or not state["armed"]:
                continue
            # Um erro num ciclo (transcricao, rede, speaker-id) nao pode derrubar o listener inteiro.
            try:
                scores = model.predict(frame)
                if scores.get(key, 0.0) < THRESHOLD:
                    continue
                print(f"[wake] detected (score {scores.get(key, 0.0):.2f}) -> capturing", flush=True)
                if ws.ws:
                    try:
                        ws.ws.send(json.dumps({"t": "wake_event", "phase": "capturing", "wakeToken": _wake_token()}))
                    except Exception:
                        pass
                model.reset()
                pcm = capture_utterance(stream)
                if pcm.size < SR // 2:  # < 0.5 s -> noise, ignore
                    continue
                wav_path = pcm_to_wav(pcm)
                speaker = identify_speaker(wav_path)  # None if unknown / no one enrolled
                if GATE and speaker is None:
                    print("[wake] voice not recognized -> ignoring", flush=True)
                    continue
                text = transcribe(wav_path, LANG).strip()
                print(f"[wake] heard ({speaker or '?'}): {text!r}", flush=True)
                if text and ws.ws:
                    ws.ws.send(json.dumps({"t": "send", "text": text, "speak": True, "sessionId": SESSION, "speaker": speaker, "wakeToken": _wake_token()}))
            except Exception as e:
                print(f"[wake] erro no ciclo de deteccao (seguindo): {e}", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            stream.stop()
            stream.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
