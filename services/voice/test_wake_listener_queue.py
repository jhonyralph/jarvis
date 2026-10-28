"""Listener na fila de fala do Hub (VOZ-01 F1, passo 5): "terminei", interrupcao e janela de resposta.

Roda sem microfone e sem alto-falante (som, captura e Hub sao falsos):
    python -m unittest services/voice/test_wake_listener_queue.py
Precisa das dependencias do listener instaladas (numpy, sounddevice, faster-whisper); sem elas, pula.
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import unittest
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import numpy as np
    import wake_listener as wl
except Exception as e:  # noqa: BLE001 - maquina sem as dependencias de voz
    wl = None
    _skip = str(e)


def _wav_b64(ms=50):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(np.zeros(16 * ms, dtype=np.int16).tobytes())
    return base64.b64encode(buf.getvalue()).decode("ascii")


class FakeSocket:
    def __init__(self):
        self.sent = []

    def send(self, raw):
        self.sent.append(json.loads(raw))


class FakeHub:
    """O `ws` que o main() passa adiante: um objeto com `.ws`."""

    def __init__(self):
        self.ws = FakeSocket()


class FakeSound:
    def __init__(self, on_play=None):
        self.played = 0
        self.stopped = 0
        self.on_play = on_play

    def play(self, *_a, **_k):
        self.played += 1
        if self.on_play:
            self.on_play()

    def wait(self):
        pass

    def stop(self):
        self.stopped += 1


@unittest.skipIf(wl is None, "dependencias do listener ausentes")
class ListenerQueueTest(unittest.TestCase):
    def setUp(self):
        self.socket = FakeSocket()
        wl._ws_holder["ws"] = self.socket
        wl._stopped_rids.clear()
        wl._play.update(qid=None, rid=None, cut=False)
        wl._window["pending"] = None
        while not wl._play_q.empty():
            wl._play_q.get_nowait()
        self.sound = FakeSound()
        self._orig = {k: getattr(wl, k) for k in ("sd", "time", "chime", "capture_with_hub", "send_utterance", "follow_ups")}
        wl.sd = self.sound
        wl.chime = lambda *a, **k: None

        class _T:  # sem a pausa de 0,4 s depois de tocar
            time = staticmethod(__import__("time").time)

            @staticmethod
            def sleep(_s):
                pass

        wl.time = _T

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(wl, k, v)
        wl._ws_holder["ws"] = None

    def acks(self):
        return [m["qid"] for m in self.socket.sent if m["t"] == "tts_played"]

    def test_avisa_terminei_ao_acabar_de_tocar(self):
        wl.play_one({"audio": _wav_b64(), "qid": "q1", "rid": "r1"})
        self.assertEqual(self.sound.played, 1)
        self.assertEqual(self.acks(), ["q1"])
        self.assertFalse(wl.state["speaking"])

    def test_fala_interrompida_nao_avisa_e_o_resto_dela_nao_toca(self):
        # A interrupcao chega enquanto a fala toca (barge-in ou tts_stop do Hub).
        self.sound.on_play = wl.stop_playback
        wl.play_one({"audio": _wav_b64(), "qid": "q1", "rid": "r1"})
        self.assertEqual(self.acks(), [], "interrompida: o Hub ja seguiu, nao precisa do terminei")
        self.sound.on_play = None
        # Proximo trecho da MESMA resposta: nao toca, mas libera a fila do Hub.
        wl.play_one({"audio": _wav_b64(), "qid": "q2", "rid": "r1"})
        self.assertEqual(self.sound.played, 1)
        self.assertEqual(self.acks(), ["q2"])
        # Outra resposta toca normalmente.
        wl.play_one({"audio": _wav_b64(), "qid": "q3", "rid": "r2"})
        self.assertEqual(self.sound.played, 2)
        self.assertEqual(self.acks(), ["q2", "q3"])

    def test_parar_descarta_as_falas_pendentes(self):
        wl._play_q.put({"audio": _wav_b64(), "qid": "q9", "rid": "r9"})
        wl.stop_playback()
        self.assertTrue(wl._play_q.empty())
        self.assertIn("r9", wl._stopped_rids)
        self.assertEqual(self.sound.stopped, 1)

    def _window(self, capture):
        hub = FakeHub()
        sent = []
        wl.capture_with_hub = capture
        wl.send_utterance = lambda ws, pcm, ok: sent.append(pcm.size) or True
        wl.follow_ups = lambda *a, **k: sent.append("follow")
        wl.run_window(object(), hub, {"runnerId": "pc2", "sessionId": "s1", "at": 0})
        return hub.ws.sent, sent

    def test_janela_sem_fala_avisa_o_hub_com_a_sessao(self):
        def capture(stream, ws, follow_up=False, no_speech_secs=6.0):
            self.assertEqual(no_speech_secs, wl.WINDOW_SECS)
            wl._last_capture.update(end="sem_fala_local")
            return np.zeros(0, dtype=np.int16), True, False
        frames, sent = self._window(capture)
        closed = [m for m in frames if m["t"] == "tts_window_closed"]
        self.assertEqual(closed, [{"t": "tts_window_closed", "runnerId": "pc2", "sessionId": "s1", "wakeToken": closed[0]["wakeToken"]}])
        self.assertEqual(sent, [])

    def test_janela_com_fala_manda_a_fala_e_segue_ouvindo(self):
        def capture(stream, ws, follow_up=False, no_speech_secs=6.0):
            wl._last_capture.update(end="pausa_neutra")
            return np.ones(wl.SR, dtype=np.int16), True, True
        frames, sent = self._window(capture)
        self.assertEqual(sent, [wl.SR, "follow"])
        self.assertFalse([m for m in frames if m["t"] == "tts_window_closed"], "falou: a janela nao fecha vazia")

    def test_janela_cortada_por_nova_fala_da_sessao_nao_fecha(self):
        def capture(stream, ws, follow_up=False, no_speech_secs=6.0):
            wl._last_capture.update(end="resposta_tocou")
            return np.zeros(0, dtype=np.int16), True, False
        frames, _ = self._window(capture)
        self.assertFalse([m for m in frames if m["t"] == "tts_window_closed"], "a fila ja esta tocando de novo")


if __name__ == "__main__":
    unittest.main()
