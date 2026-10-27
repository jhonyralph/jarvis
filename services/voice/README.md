# voice service (local STT/TTS)

Runs fully offline on the machine. No third parties.

## Instalação

```bash
npm run install:voice          # macOS/Linux/Windows — escolhe o interpretador e aplica os tetos
npm run install:voice -- --core # só TTS/STT/wake word (pula o que depende de torch)
```

**Python 3.10 a 3.12.** O CI valida a sintaxe em 3.12. Os tetos abaixo não são precaução: foram
verificados resolvendo as wheels contra o PyPI.

| | Mac Intel (x86_64) | Apple Silicon | Windows | Linux |
|---|---|---|---|---|
| 3.10–3.11 | completo | completo | completo | completo |
| 3.12 | completo | completo | completo | **não instala** |
| 3.13 | núcleo OK, **sem** voice id / memória semântica | completo | completo | **não instala** |
| 3.14+ | **não instala** | completo | completo | **não instala** |

`torch` (via resemblyzer) não publica wheel macOS x86_64 desde a **2.2.2** (cp312 é o teto) — em
Python 3.13 Intel não existe nenhuma. `onnxruntime` (via openwakeword) parou o x86_64 na **1.23.2**,
e nenhuma dessas versões cobre cp314 — daí o `piper-tts` sair com `ResolutionImpossible` em 3.14 num
Mac Intel (em arm64 e no Windows existe wheel cp314 e resolve). As wheels x86_64 do onnxruntime
exigem **macOS >= 13** (em Monterey o pip trava na 1.19.2). O teto do **Linux** é outro e mais
baixo: o openwakeword exige `tflite-runtime` só lá, e ele parou na 2.14.0, com wheels até cp311.

Os requirements estão em dois arquivos por causa disso: `requirements.txt` é o núcleo (instala em
qualquer máquina) e `requirements-voiceid.txt` é o ramo que depende de torch, com os tetos presos
por marker de arquitetura. Ver os comentários de cada um.

Fazer à mão também funciona — `npm run install:voice` existe porque esse `pip install` erra de três
jeitos num Mac (não existe binário `pip`, o `python3` do PATH do launchd é o 3.9.6 do Xcode CLT, e
em Intel o Python 3.13+ não resolve):

```bash
pip install -r requirements.txt -r requirements-voiceid.txt   # numa só invocação, ver o comentário
pip install --no-deps 'resemblyzer>=0.1.4'                    # webrtcvad não tem wheel; ver o comentário
python -m piper.download_voices en_GB-alan-medium pt_BR-faber-medium
```

## Hardware e arquitetura

| Máquina | STT | Observação |
|---|---|---|
| Windows/Linux + NVIDIA | `turbo` + `JARVIS_STT_DEVICE=cuda` | ~2 s por fala (medido num Quadro P1000, int8) |
| Mac Apple Silicon | `turbo` em CPU | sem aceleração: o CTranslate2 não tem backend Metal/CoreML |
| Mac Intel (x86_64) | **`JARVIS_STT_MODEL=small`** (ou `base`) | o encoder do turbo roda inteiro na CPU e escala com a duração da fala |

**Nenhum Mac tem CUDA**, e as wheels `nvidia-*` do `requirements.txt` não se aplicam a macOS —
`JARVIS_STT_DEVICE=cpu` é o único valor válido ali. Os números de latência deste arquivo foram
medidos na máquina do dono (Windows + Quadro P1000) e são referência, não garantia.

## TTS — Piper (working)

Voices download to `~/.jarvis/voices/`. Then:

```bash
python piper_tts.py "Good evening, sir."
python piper_tts.py --voice pt_BR-faber-medium "Bom dia, Jonathan."
```

Writes a WAV to `~/.jarvis/out.wav`. Cold call ~1.5s (Python + model load);
a persistent service keeps the model loaded and streams sub-second.

## STT — faster-whisper (working)

Dois caminhos, e vale saber qual está no ar: o **serviço persistente**
`whisper_service.py` é o que o Hub usa, carrega o modelo UMA vez e tem como
default o `deepdml/faster-whisper-large-v3-turbo-ct2` (~1,5 GB, CPU int8, traz
PyAV — sem ffmpeg de sistema). O `whisper_stt.py` é o caminho legado de uma
chamada por utterance, com o modelo `small` (~460 MB). Os dois rodam em CPU; só
Windows/Linux com NVIDIA têm o caminho de GPU (ver **Hardware e arquitetura**).

## Wake word — "Hey Jarvis" (working, machine-side)

`wake_listener.py` runs on the machine (native, no phone battery). It listens
on the mic for **"Hey Jarvis"** (openWakeWord pretrained, onnx), captures the
following utterance, transcribes it with the warm faster-whisper, and injects it
into the Hub's dedicated `voice` session over WebSocket — exactly as a client
`{t:"send", speak:true}`. The Hub's spoken reply is played on the machine
speakers. Self-triggering is suppressed while speaking.

```bash
npm run install:voice                     # openwakeword + sounddevice + websocket-client
python wake_listener.py                   # Hub must be running (ws://127.0.0.1:4577)
```

Then just say **"Hey Jarvis, ..."**. Toggle it from the web UI (Configurações →
Wake word) — the switch arms/disarms the listener live over the Hub.

Env: `JARVIS_HUB_WS`, `JARVIS_WAKE_SESSION` (=voice), `JARVIS_WAKE_MODEL`
(=hey_jarvis), `JARVIS_WAKE_MODEL_FILE` (custom .onnx for bare "Jarvis"),
`JARVIS_WAKE_THRESHOLD` (=0.5), `JARVIS_WAKE_LANG` (=pt).

**Microphone.** By default it opens the Windows default input. `JARVIS_WAKE_DEVICE` (part of the
device name, e.g. `webcam`, or its index) pins one — set it in `~/.jarvis/hub.env`, which the launcher
reads. A microphone that opens but delivers **digital silence** for `JARVIS_WAKE_SILENT_SECS` (=10) is
reported as *no sound* in Configurações (it used to show "ok" while deaf — a muted headset, 2026-10-26);
unless one is pinned, the listener then switches to another microphone with signal, never to a
loopback/"stereo mix" input. Opening the mic has a `JARVIS_WAKE_OPEN_TIMEOUT` (=20 s) deadline: if the
audio driver hangs, the listener reports it and exits so the launcher restarts it.

> The pretrained phrase is "Hey Jarvis". A bare "Jarvis" needs a custom-trained
> `.onnx` (openWakeWord's training notebook) pointed at via `JARVIS_WAKE_MODEL_FILE`.

## Voice identification — Resemblyzer (working, multi-user)

Local speaker verification. Each user enrolls a **voiceprint** (a 256-d embedding
averaged over a few short clips), stored under `~/.jarvis/voiceprints/` — nothing
leaves the machine. Every voice utterance is then matched (cosine similarity) to
the enrolled voiceprints: the message is labelled with who spoke, and — if the
gate is on — utterances from **unknown** voices are rejected.

- `speaker_id.py` — Resemblyzer embedding (audio decoded via faster-whisper).
- `voiceprints.py` — enroll / identify / list / delete against the local store.
- `voice_cli.py` — CLI the Hub shells out to (JSON on stdout).

```bash
python voice_cli.py enroll --name jonathan a.wav b.wav c.wav
python voice_cli.py identify utterance.webm      # -> {"name": ..., "score": ...}
python voice_cli.py list
```

Enroll from the web UI: **Configurações → Identificação de voz → Cadastrar minha
voz** (records 3 clips). Toggle "Exigir voz cadastrada" to gate unknown voices.

Env: `JARVIS_VOICEPRINTS` (store dir), `JARVIS_VOICE_THRESHOLD` (=0.75). The wake
listener honours `JARVIS_WAKE_GATE=1` to ignore unrecognized voices.

> Resemblyzer pulls torch (CPU). `webrtcvad` (a Resemblyzer dep) needs
> `pkg_resources`, so setuptools is pinned `<81` — e não tem wheel nenhuma no
> PyPI, por isso o instalador usa o fork `webrtcvad-wheels` e instala o
> resemblyzer com `--no-deps` (ver `requirements-voiceid.txt`).
>
> **Em Mac Intel (x86_64) este recurso exige Python 3.10–3.12**: o torch parou na
> 2.2.2 para essa arquitetura. Com 3.13 o `npm run install:voice` pula este ramo
> e avisa; TTS, STT e wake word seguem funcionando.

## Roadmap

- [x] TTS (Piper)
- [x] STT (faster-whisper)
- [x] wake word (openWakeWord, "Hey Jarvis")
- [x] voice identification (Resemblyzer, multi-user, optional gate)
- [x] serviço persistente que carrega os modelos uma vez (`whisper_service.py`,
      `piper_service.py`, `embed_service.py` — stdio JSON, não WS)
