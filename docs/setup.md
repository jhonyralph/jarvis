# Setting up Jarvis from scratch (Windows / Linux / macOS)

## The repository

Jarvis is **one repository** — a monorepo at `…/jarvis` (`apps/hub`, `apps/runner`,
`packages/*`). There are **no separate repos**. It lives on a **private git remote**
(`origin` → `github.com/jhonyralph/jarvis`), so a machine **with access** can just
`git clone <url>` and later `git pull` to update (this is what the README shows). If
a machine can't reach the remote, package it instead:

- **Recommended — clone from the remote:** `git clone <url>` then `git pull` to
  update. The repo is private — granting access is your call.
- **No remote access — package it:** on the Hub machine run `scripts/pack.ps1`
  (Windows) or `scripts/pack.sh` (mac/Linux) → produces `jarvis-dist.tgz`
  (committed tree, no node_modules). Copy it to the other machine, `tar -xzf` it,
  done. Update = re-pack and re-extract.
- Or just **copy the folder** (minus `node_modules`) over the network.

## How the pieces fit

- **The Hub = the "main machine".** It **is the server automatically** — you do
  NOT configure anything per secondary machine on it. It: serves the web UI,
  **stores everything locally** (`~/.jarvis/` = auth, devices, runner tokens,
  sessions, audit; `~/.claude` / `~/.codex` = the agents' own native sessions),
  runs supported agent CLIs locally ("machine 0"), and **listens for runners** on `…/runner`.
  There is exactly **one Hub**.
- **Secondary machines = runners.** Each runs the headless `apps/runner`, dials
  the Hub, and runs its own installed agent adapters. To add one you just mint a
  token on the Hub and run the installer on the machine — no Hub-side per-machine
  service to set up.
- **Clients** = any browser (phone/desktop) opening the Hub's URL.

```
   phone / desktop browsers ──► HUB (main machine: UI + store + router + machine 0)
                                     ▲            ▲
                                runner           runner        ← secondary machines
                              (Windows #2)      (Mac / Linux)     dial the Hub
```

## Prerequisites on EVERY machine (a truly fresh box has none of these)

The installers **check** these but do not install them (installing Node/agents is
interactive per-OS):

1. **Node.js ≥ 22** — nodejs.org, or `winget install OpenJS.NodeJS` / `brew install node` / your distro's package.
2. **An agent CLI + login** — choose from the current support matrix and run its
   authentication flow. `npm run agents:report` verifies presence/version without
   spending a turn. **Each machine authenticates its own agent;
   no credentials cross the network.** A machine with no authed agent shows up
   but its agents are greyed out in the picker.
3. **A way to reach the Hub** — same private network. Default: **Tailscale** on
   every machine (`tailscale up`). For public exposure use a TLS proxy (see
   `docs/security.md`).
4. **git** (to clone) — or use the pack tarball above.

## Step 1 — the Hub (do this on ONE machine)

Get the code onto it (clone / pack / copy), then:

| OS | Install the Hub (autostart) |
|----|------------------------------|
| **Windows** | `.\scripts\install-autostart.ps1` (registers the `JarvisHub` scheduled task) |
| **macOS / Linux** | `./scripts/install-hub.sh` (launchd / systemd `--user`) |

The Hub comes up on port **4577**, bound to all interfaces (so Tailscale reaches
it). Expose it how you like — e.g. Tailscale: `tailscale serve --bg http://127.0.0.1:4577`
(tailnet-only; **never `funnel`**).

## Step 2 — first access (no device is logged in yet)

Auth is **on** by default, so the first device must **claim ownership** with a
one-time **claim-code**. With zero devices logged in, get it from the host:

| OS | Get the claim-code |
|----|--------------------|
| **Windows** | it's printed in `~/.jarvis/hub.log` and saved to `~/.jarvis/claim-code.txt` — or `.\scripts\jarvis.ps1 claimcode` |
| **macOS / Linux** | `~/.jarvis/claim-code.txt` — or `./scripts/jarvis.sh claimcode` |

Open the Hub URL on your phone/desktop → the pairing screen appears → paste the
code → you're the **owner**. (Lost all devices later? `jarvis owner` mints a fresh
owner code from the host; `jarvis.* passphrase-clear` removes the 2FA password;
emergency: `JARVIS_AUTH=off`.)

## Step 3 — add a secondary machine (a runner)

**On the Hub**, mint a per-machine token (also prints the exact install command):

```
Windows:    .\scripts\jarvis.ps1 machine -label "MacBook"
mac/Linux:  ./scripts/jarvis.sh machine "MacBook"
```

**On the new machine** (code present, prereqs met), run what it printed:

| OS | Install the runner (autostart) |
|----|--------------------------------|
| **Windows** | `.\scripts\install-runner.ps1 -Hub "wss://<hub>/" -Token "<token>" -Label "…"` (Task Scheduler) |
| **macOS / Linux** | `./scripts/install-runner.sh -h "wss://<hub>/" -t "<token>" -l "…"` (launchd / systemd) |

It writes `~/.jarvis/runner.env`, sets autostart, and connects. The machine then
appears in the Hub's **machine selector** (top of the side panel). Pick it to run
agents there. Rename with the ✏; revoke with `jarvis status` → its runner token.

## Quick reference — same flow, per OS

| Task | Windows | macOS / Linux |
|------|---------|----------------|
| Package (no remote) | `pack.ps1` | `pack.sh` |
| Install **Hub** | `install-autostart.ps1` | `install-hub.sh` |
| Hub launcher | `start-hub.ps1` | `start-hub.sh` |
| Admin / recovery | `jarvis.ps1 …` | `jarvis.sh …` |
| Mint machine token | `jarvis.ps1 machine` | `jarvis.sh machine` |
| Install **runner** | `install-runner.ps1` | `install-runner.sh` |

## macOS (Apple Silicon e Intel)

As duas arquiteturas são suportadas e o caminho de instalação é o mesmo. O que difere está aqui.
Os limites de versão foram verificados resolvendo as dependências contra o PyPI; os números de
desempenho (o "3-5x" do item 3) vêm da documentação do faster-whisper e não foram medidos neste
projeto — trate-os como ordem de grandeza.

**1. Confirme que o Node é nativo.** `node -p process.arch` responde `x64` num Mac Intel e `arm64`
num Apple Silicon, e tem de bater com `uname -m`. Se der `x64` num host `arm64`, o Node está sob
Rosetta e as dependências nativas vão seguir o PROCESSO, não a máquina — reinstale num terminal
nativo. (Num Mac Intel `sysctl -n sysctl.proc_translated` não existe; o erro é o esperado.) O
`npm run doctor` já reporta as duas arquiteturas no cabeçalho e avisa sobre essa divergência.

**2. Python 3.10–3.12 para a voz — em Mac Intel o 3.12 é o TETO.**

```bash
npm run install:voice          # escolhe o interpretador, aplica os tetos e explica o que pular
```

| Python | Mac Intel (x86_64) | Apple Silicon (arm64) |
|---|---|---|
| 3.10 – 3.12 | stack completa | stack completa |
| 3.13 | TTS, STT e wake word OK; **sem** identificação de voz nem memória semântica | stack completa |
| 3.14+ | **nada instala** | stack completa |

(O teto é só do Mac Intel. Windows não tem teto superior; **Linux para no 3.11**, por um motivo
diferente — o `openwakeword` exige `tflite-runtime` só no Linux, e ele parou na 2.14.0, com wheels
até cp311.)

Os motivos, que são de empacotamento e não do Jarvis: o **`torch`** (puxado pelo `resemblyzer`)
não publica wheel para macOS x86_64 desde a **2.2.2**, que cobre até o cp312 — para Python 3.13 em
Intel não existe nenhuma versão. O **`onnxruntime`** (via `openwakeword`) parou o x86_64 na
**1.23.2**, e nenhuma dessas versões cobre cp314; como o `piper-tts` exige `onnxruntime>=1`, em 3.14
num Mac Intel o pip sai com `ResolutionImpossible`. Em arm64 isso não acontece: lá o onnxruntime tem
wheel cp314 e a stack resolve. Além disso, as wheels x86_64 do `onnxruntime` exigem **macOS >= 13**:
num Mac Intel em Monterey o pip resolve, mas trava o onnxruntime na 1.19.2.

O `install:voice` grava `JARVIS_PYTHON` em `~/.jarvis/hub.env` com o caminho ABSOLUTO do
interpretador (substituindo o que estiver lá). Isso importa: sob launchd o PATH é só
`/usr/bin:/bin:/usr/sbin:/sbin`, onde o único Python é o **3.9.6 do Xcode Command Line Tools** —
abaixo do piso 3.10 da stack, e instalar nele só sujaria `~/Library/Python/3.9` sem resolver nada.
Para apontar outro à mão:

```bash
echo 'JARVIS_PYTHON=/Library/Frameworks/Python.framework/Versions/3.12/bin/python3' >> ~/.jarvis/hub.env
```

**3. STT local é CPU em todo Mac.** Nenhum Mac tem NVIDIA, e o CTranslate2 (motor do
faster-whisper) não tem backend Metal/CoreML — então `JARVIS_STT_DEVICE=cpu` é o único valor válido
e as instruções `nvidia-*` do `requirements.txt` não se aplicam. Num Mac Intel sem GPU, o modelo
default (`large-v3-turbo`) tem o encoder inteiro na CPU e o custo cresce com a duração da fala;
se a transcrição ficar lenta, o maior ganho é trocar o modelo em `~/.jarvis/hub.env`:

```bash
JARVIS_STT_MODEL=small    # 3-5x mais rápido que o turbo, alguma perda de acurácia (ou 'base')
```

**4. Homebrew muda de lugar com a arquitetura** — `/usr/local` no Intel, `/opt/homebrew` no Apple
Silicon. Os instaladores resolvem isso perguntando ao `brew --prefix` e gravam o PATH resultante no
plist do LaunchAgent; se você instalou antes desta versão, rode `npm run install:hub` de novo. Um
serviço que carrega e sai com **127** é esse problema: o `npm run doctor` passou a diagnosticá-lo
por nome.

**5. Cliente desktop.** O CI publica DMG/ZIP para as duas arquiteturas, com o sufixo no nome do
arquivo (`Jarvis-<versão>-x64.dmg` e `-arm64.dmg`). O app não é assinado ainda, então o primeiro
abrir exige liberar em **System Settings → Privacy & Security → Open Anyway**, e a atualização
automática no macOS é manual enquanto não houver Developer ID (ver `desktop/README.md`).

**5.1. O ícone pula e o app não abre.** Três causas, em ordem de frequência — `npm run
install:desktop` diagnostica as três e imprime a correção de cada uma:

- **Quarentena sem aprovação.** O app vem do navegador com o xattr `com.apple.quarantine` e, não
  sendo assinado, o Gatekeeper exige o "Open Anyway" acima. Enquanto ninguém aprova, o `open`
  devolve `-128` (cancelado) e o ícone só pula.
- **O diálogo de aprovação nunca aparece.** Visto num MacBook Pro Intel com macOS 15.8.1: o
  `CoreServicesUIAgent` — o processo que DESENHA aquele diálogo — crasha com SIGSEGV dentro do
  LocalAuthentication (`LAContext _evaluatePolicy`). Sem diálogo não há aprovação possível, e a
  instrução do item 5 não tem como ser seguida. A saída é remover a quarentena à mão, assumindo que
  você confia no binário que você mesmo publicou:

  ```bash
  xattr -dr com.apple.quarantine /Applications/Jarvis.app
  ```

- **Arquitetura errada.** Um `.app` arm64 num Mac Intel não abre de jeito nenhum — o Rosetta traduz
  x86_64 para arm64, nunca o contrário — e o sintoma é idêntico. Confira com
  `lipo -archs /Applications/Jarvis.app/Contents/MacOS/Jarvis`.

Assinar com Developer ID resolve os dois primeiros de uma vez (e destrava a atualização automática).

**5.2. Onde o app grava log.** JSONL, mesmo formato do Hub, em `~/Library/Logs/Jarvis/`
(`%APPDATA%\Jarvis\logs` no Windows, `~/.config/Jarvis/logs` no Linux) — e em
`~/Library/Logs/jarvis-desktop/` quando rodando via `npm start`. A primeira linha (`app_boot`) traz
versão, Electron, plataforma, **arquitetura** e se o build é empacotado; `render_process_gone` é o
que registra uma janela que morreu sozinha. Aberto por duplo clique não existe stdout, então este
arquivo é a única fonte — sem ele, um "fechou do nada" só deixa crash report do SO.

## Notes

- **Voice (STT/TTS)** is Hub-side. Instale com `npm run install:voice` (Piper voices em
  `~/.jarvis/voices`, serviços Python). Os números de latência na documentação foram medidos no PC
  do dono (Windows + GPU NVIDIA) — num Mac veja a seção **macOS** acima, que vale para as duas
  arquiteturas. A Hub without it runs fine in **text mode**; voice is optional extra setup.
  Runners are always headless (no voice).
- **Sandboxed runner** (share a machine without a shell): `docs/runner-sandbox.md`.
- **Exposing publicly**: `docs/security.md` (checklist: TLS, `JARVIS_TRUST_PROXY`,
  `JARVIS_REQUIRE_TLS`, keep auth on).
