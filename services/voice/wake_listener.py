"""
Machine-side wake word for Jarvis — 100% local, native, zero phone battery.

Listens on the machine mic for "Hey Jarvis" (openWakeWord, pretrained), captures
the following utterance, transcribes it locally (warm faster-whisper), and injects
it into a dedicated "voice" session on the Hub over WebSocket — exactly as if a
client had sent {t:"send", speak:true}. The Hub's reply {t:"tts"} is played on the
machine speakers. Detection is suppressed while speaking (no self-trigger).

Run:  python wake_listener.py         (Hub must be running on ws://127.0.0.1:4577)
Env:  JARVIS_HUB_WS, JARVIS_WAKE_SESSION(=voice), JARVIS_WAKE_MODEL(=hey_jarvis),
      JARVIS_WAKE_THRESHOLD(=0.5), JARVIS_WAKE_LANG(=pt), JARVIS_WAKE_MODEL_FILE,
      JARVIS_WAKE_DEVICE (trecho do nome ou indice do microfone; vazio = padrao do Windows),
      JARVIS_WAKE_SILENT_SECS(=10). O launcher (scripts/start-wake.ps1) le ~/.jarvis/hub.env.
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
import traceback
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

# Qual microfone ouvir. Vazio = o padrao do Windows (como sempre foi). Em 2026-10-26 o padrao era o
# headset G933 com o microfone MUDO: abria sem erro, entregava silencio digital, o listener dizia
# "microfone: ok" e nenhum "Hey Jarvis" foi ouvido em 15 h — enquanto a webcam captava o ambiente.
DEVICE = os.environ.get("JARVIS_WAKE_DEVICE", "").strip()
# Silencio DIGITAL: |amostra| <= 2 em int16. Microfone vivo sempre tem ruido de fundo (a webcam
# mediu pico ~2900 numa sala quieta; o G933 mudo, pico 1). Nao e "sala silenciosa", e microfone morto.
SILENT_PEAK = 2
SILENT_SECS = float(os.environ.get("JARVIS_WAKE_SILENT_SECS", "10"))
# Abrir microfone pelo PortAudio TRAVA as vezes dentro do driver nesta maquina (2026-10-26: 4 de 9
# processos novos, tanto no G933 quanto na webcam, >20 s parados no waveInOpen). Travado ali o
# listener nunca escutaria e o launcher nao o relancaria (o processo nao morre). Com prazo: avisa o
# Hub e sai — o launcher (start-wake.ps1) relanca em 3 s, com uma tentativa nova.
OPEN_TIMEOUT = float(os.environ.get("JARVIS_WAKE_OPEN_TIMEOUT", "20"))
# Entradas que NAO sao microfone: loopback do som do PC (o Jarvis se acordaria com um video dizendo
# "Hey Jarvis") e os "mapeadores" virtuais do Windows. Nunca viram reserva automatica.
_NOT_A_MIC = ("mapeador", "mapper", "driver de captura", "primary sound capture", "mixagem", "stereo mix",
              "loopback", "what u hear", "o que voce ouve")

state = {"armed": True, "speaking": False}
# Microfone como o Hub o enxerga (wake_status). "error" carrega a mensagem do PortAudio.
mic = {"status": "unknown", "error": None, "device": None}
# Dispositivo aberto agora (indice do PortAudio; None = padrao do Windows) e o nome dele.
current = {"idx": None, "name": None}
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


def _input_devices():
    """Entradas no MESMO host API do microfone padrao (MME no Windows), sem loopback/mapeadores.
    Misturar host APIs ia parar no WDM-KS, que nao suporta a leitura bloqueante usada aqui."""
    default = sd.query_devices(kind="input")
    out = []
    for i, d in enumerate(sd.query_devices()):
        name = str(d.get("name") or "")
        if d["max_input_channels"] > 0 and d["hostapi"] == default["hostapi"] and not any(x in name.lower() for x in _NOT_A_MIC):
            out.append((i, name))
    return default, out


def pick_device():
    """(indice, nome) do microfone a abrir: o fixado em JARVIS_WAKE_DEVICE, senao o padrao (None)."""
    default, devs = _input_devices()
    if not DEVICE:
        return None, str(default.get("name") or "")
    if DEVICE.isdigit():
        d = sd.query_devices(int(DEVICE))
        if d["max_input_channels"] <= 0:
            raise RuntimeError(f"JARVIS_WAKE_DEVICE={DEVICE} nao e um microfone ({d.get('name')})")
        return int(DEVICE), str(d.get("name") or "")
    for i, name in devs:
        if DEVICE.lower() in name.lower():
            return i, name
    raise RuntimeError(f"microfone '{DEVICE}' (JARVIS_WAKE_DEVICE) nao encontrado entre: " + ", ".join(n for _, n in devs))


def _peak(block) -> int:
    pcm = block[:, 0] if getattr(block, "ndim", 1) > 1 else block
    return int(np.abs(pcm.astype(np.int32)).max()) if pcm.size else 0


def find_live_device(exclude_idx, exclude_name):
    """Outro microfone COM SINAL (meio segundo de amostra cada), ou None. So para a reserva automatica."""
    try:
        _, devs = _input_devices()
    except Exception:
        return None
    for i, name in devs:
        if i == exclude_idx or (exclude_idx is None and name == exclude_name):
            continue
        try:
            with sd.InputStream(device=i, samplerate=SR, channels=1, dtype="int16", blocksize=FRAME) as s:
                peak = max(_peak(s.read(FRAME)[0]) for _ in range(6))
            if peak > SILENT_PEAK:
                return i, name
        except Exception:
            continue
    return None


def _open_stream(idx):
    """So abre e inicia o stream; nao mexe em `current` (pode rodar na thread da reserva)."""
    dev = sd.query_devices(idx) if idx is not None else sd.query_devices(kind="input")
    # Com o servico "Audio do Windows" parado, MME/DirectSound/WASAPI somem e o PortAudio cai
    # no WDM-KS, que nao suporta leitura bloqueante (visto em 2026-10-07). Diz isso claramente.
    if sd.query_hostapis(dev["hostapi"])["name"] == "Windows WDM-KS":
        raise RuntimeError("nenhum microfone pelo Windows Audio (servico 'Audio do Windows' parado?)")
    stream = sd.InputStream(device=idx, samplerate=SR, channels=1, dtype="int16", blocksize=FRAME)
    stream.start()
    return stream, str(dev.get("name") or "")


def _open(idx, name):
    stream, dev_name = _open_stream(idx)
    current.update(idx=idx, name=name or dev_name or None)
    return stream


def open_mic():
    """Abre o microfone escolhido (pick_device). Em falha NAO derruba o processo: reporta ao Hub e
    tenta de novo com backoff ate 60 s. De 25/09 a 28/09 o listener morreu ~900 vezes em "Error opening
    InputStream [MME error 11]", relancado pelo launcher a cada 3 s, sem ninguem saber pela UI."""
    delay = 2.0
    while True:
        try:
            idx, name = pick_device()
            box = {}

            def opener():
                try:
                    box["opened"] = _open_stream(idx)
                except Exception as e:  # noqa: BLE001 — devolvido ao laco abaixo
                    box["error"] = e

            th = threading.Thread(target=opener, name="wake-open", daemon=True)
            th.start()
            th.join(OPEN_TIMEOUT)
            if th.is_alive():
                set_mic("error", error=f"abrir o microfone travou no driver (>{OPEN_TIMEOUT:.0f} s); reiniciando o listener", device=name or None)
                time.sleep(1.0)  # da tempo do wake_status chegar ao Hub
                os._exit(3)
            if "error" in box:
                raise box["error"]
            stream, dev_name = box["opened"]
            current.update(idx=idx, name=name or dev_name or None)
            set_mic("ok", device=current["name"])
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


# Reserva automatica NUMA THREAD. Abrir microfone pelo PortAudio pode travar dentro do driver: em
# 2026-10-26 o waveInOpen da webcam ficou >20 s preso em 2 de 3 tentativas. No laco principal isso
# trocaria um listener surdo por um listener CONGELADO. Aqui o laco segue lendo o microfone mudo e so
# troca quando a reserva estiver aberta; se o driver travar, so esta thread fica presa.
_switch = {"thread": None, "result": None, "lock": threading.Lock()}


def report_silence():
    hint = "mudo, desligado ou haste do microfone levantada?"
    if DEVICE:
        hint += f" (fixado em JARVIS_WAKE_DEVICE={DEVICE})"
    else:
        hint += " Procurando outro microfone com sinal..."
    set_mic("silent", error=f"sem som ha {SILENT_SECS:.0f} s: {hint}", device=current["name"])


def start_fallback():
    """Procura e abre outro microfone com sinal, fora do laco principal. Nunca com microfone fixado."""
    th = _switch["thread"]
    if DEVICE or (th is not None and th.is_alive()):
        return
    exclude_idx, exclude_name = current["idx"], current["name"]

    def work():
        alt = find_live_device(exclude_idx, exclude_name)
        new = None
        if alt:
            try:
                new, _ = _open_stream(alt[0])
            except Exception:
                new = None
        if new is None:
            # so reclama se nada mudou enquanto procurava (o original pode ter voltado a ter som)
            if mic["status"] == "silent" and current["idx"] == exclude_idx and current["name"] == exclude_name:
                set_mic("silent", error=f"sem som ha {SILENT_SECS:.0f} s: mudo, desligado ou haste do microfone "
                                        "levantada? Nenhum outro microfone com sinal.", device=exclude_name)
            return
        with _switch["lock"]:
            _switch["result"] = (alt, new)

    th = threading.Thread(target=work, name="wake-fallback", daemon=True)
    _switch["thread"] = th
    th.start()


def take_fallback():
    """Reserva aberta e pronta para assumir (ou None)."""
    with _switch["lock"]:
        r, _switch["result"] = _switch["result"], None
    return r


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
_cycle_err = {"sig": None, "count": 0, "at": 0.0}


def report_cycle_error(e: BaseException):
    """Antes: `print(f"...: {e}")` — com excecao de mensagem vazia saiam MILHARES de linhas
    "erro no ciclo de deteccao (seguindo): " sem nada depois (wake.log, 19-20/10). Agora: tipo,
    mensagem e onde; a mesma falha repetida vira um resumo por minuto."""
    tb = traceback.extract_tb(e.__traceback__)
    where = f"{os.path.basename(tb[-1].filename)}:{tb[-1].lineno} em {tb[-1].name}" if tb else "?"
    sig = (type(e).__name__, str(e).strip()[:200] or "(sem mensagem)", where)
    now = time.time()
    if sig != _cycle_err["sig"]:
        if _cycle_err["count"]:
            print(f"[wake] (o erro anterior repetiu mais {_cycle_err['count']}x)", flush=True)
        _cycle_err.update(sig=sig, count=0, at=now)
        print(f"[wake] erro no ciclo de deteccao (seguindo): {sig[0]}: {sig[1]} [{sig[2]}]", flush=True)
        return
    _cycle_err["count"] += 1
    if now - _cycle_err["at"] >= 60:
        print(f"[wake] mesmo erro mais {_cycle_err['count']}x no ultimo minuto: {sig[0]}: {sig[1]} [{sig[2]}]", flush=True)
        _cycle_err.update(count=0, at=now)


def main():
    from openwakeword.model import Model

    kwargs = {"inference_framework": "onnx"}
    model = Model(wakeword_models=[WAKE_FILE] if WAKE_FILE else [WAKE_NAME], **kwargs)
    key = next(iter(model.models.keys()))
    print(f"[wake] listening for '{key}' (threshold {THRESHOLD}) — say 'Hey Jarvis'", flush=True)

    ws = start_ws()
    stream = open_mic()
    silent_limit = max(1, int(SILENT_SECS * SR / FRAME))
    reprobe = int(60 * SR / FRAME)  # sem saida, tenta achar microfone com sinal de novo a cada minuto
    dead = 0
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
                dead = 0
                continue
            frame = block[:, 0] if block.ndim > 1 else block
            # Reserva aberta na thread de busca: assume se o atual continua mudo; senao, descarta.
            ready = take_fallback()
            if ready is not None:
                (alt_idx, alt_name), new = ready
                if mic["status"] == "silent":
                    old_name = current["name"]
                    try:
                        stream.close()
                    except Exception:
                        pass
                    stream = new
                    current.update(idx=alt_idx, name=alt_name)
                    set_mic("ok", device=f"{alt_name} (reserva: {old_name} sem som)"[:120])
                    dead = 0
                    continue
                try:
                    new.close()
                except Exception:
                    pass
            # Microfone que abre mas entrega silencio digital: antes passava por "ok" para sempre.
            if _peak(frame) <= SILENT_PEAK:
                dead += 1
                if dead == silent_limit or (dead > silent_limit and (dead - silent_limit) % reprobe == 0):
                    report_silence()
                    start_fallback()
            else:
                if mic["status"] == "silent":
                    set_mic("ok", device=current["name"])
                dead = 0
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
                report_cycle_error(e)
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
