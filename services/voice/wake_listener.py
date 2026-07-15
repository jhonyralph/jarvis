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
SESSION = os.environ.get("JARVIS_WAKE_SESSION", "voice")
WAKE_NAME = os.environ.get("JARVIS_WAKE_MODEL", "hey_jarvis")
WAKE_FILE = os.environ.get("JARVIS_WAKE_MODEL_FILE")  # optional custom .onnx (e.g. bare "Jarvis")
THRESHOLD = float(os.environ.get("JARVIS_WAKE_THRESHOLD", "0.5"))
LANG = os.environ.get("JARVIS_WAKE_LANG", "pt")
GATE = os.environ.get("JARVIS_WAKE_GATE", "0") == "1"  # reject utterances from unknown voices
SR = 16000
FRAME = 1280  # 80 ms @ 16 kHz — openWakeWord's expected frame

state = {"armed": True, "speaking": False}


# ----------------------------- Hub WebSocket -------------------------------
def start_ws():
    import websocket  # websocket-client

    def on_open(ws):
        ws.send(json.dumps({"t": "wake_hello"}))
        print("[wake] connected to hub", flush=True)

    def on_message(ws, raw):
        try:
            m = json.loads(raw)
        except Exception:
            return
        t = m.get("t")
        if t == "tts" and m.get("audio"):
            play_wav_b64(m["audio"])
        elif t == "wake_state":
            state["armed"] = bool(m.get("enabled", True))
            print(f"[wake] armed={state['armed']}", flush=True)

    def run():
        while True:
            try:
                ws = websocket.WebSocketApp(HUB_WS, on_open=on_open, on_message=on_message)
                run.ws = ws
                ws.run_forever(ping_interval=20)
            except Exception as e:
                print("[wake] ws error:", e, flush=True)
            time.sleep(2)  # reconnect

    run.ws = None
    th = threading.Thread(target=run, daemon=True)
    th.start()
    return run


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
    stream = sd.InputStream(samplerate=SR, channels=1, dtype="int16", blocksize=FRAME)
    stream.start()
    try:
        while True:
            block, _ = stream.read(FRAME)
            frame = block[:, 0] if block.ndim > 1 else block
            if state["speaking"] or not state["armed"]:
                continue
            scores = model.predict(frame)
            if scores.get(key, 0.0) < THRESHOLD:
                continue
            print("[wake] detected -> capturing", flush=True)
            if ws.ws:
                try:
                    ws.ws.send(json.dumps({"t": "wake_event", "phase": "capturing"}))
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
                ws.ws.send(json.dumps({"t": "send", "text": text, "speak": True, "sessionId": SESSION, "speaker": speaker}))
    except KeyboardInterrupt:
        pass
    finally:
        stream.stop()
        stream.close()


if __name__ == "__main__":
    main()
