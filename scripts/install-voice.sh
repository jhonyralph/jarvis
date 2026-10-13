#!/usr/bin/env sh
# install-voice.sh — instala a stack de voz local (TTS, STT, wake word e, quando a máquina permite,
# identificação de voz + memória semântica). macOS / Linux.
#
# Por que existe: até aqui NÃO havia script nenhum que rodasse o pip. A instrução era um
# `pip install -r services/voice/requirements.txt` solto no README, que num Mac erra de três jeitos
# ao mesmo tempo — o binário `pip` não existe, o `python3` do sistema é o 3.9.6 do Xcode CLT sem as
# deps, e num Mac Intel o Python 3.13+ não resolve a stack. O resultado era um erro de resolução de
# dependências de 40 linhas no lugar de uma frase dizendo o que instalar.
#
# Uso:  npm run install:voice            (ou ./scripts/install-voice.sh)
#       npm run install:voice -- --core  (só TTS/STT/wake; pula o que depende de torch)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --core|--core-only) CORE_ONLY=1 ;;
    -h|--help) echo "uso: install-voice.sh [--core]"; exit 0 ;;
  esac
done

ARCH="$(uname -m)"
OS="$(uname -s)"

# Escolhe o interpretador com o MESMO resolvedor que o Hub usa em tempo de execução
# (apps/hub/src/python.ts). Instalar num interpretador e rodar em outro é exatamente o bug que
# fazia o doctor dar PASS enquanto a voz morria.
PY=""
if [ -d "$ROOT/node_modules" ]; then
  PY="$(cd "$ROOT" && node --import tsx apps/hub/src/python.ts --path 2>/dev/null | head -1 || true)"
fi
# Sem node_modules (ou sem nenhum candidato com as deps) o resolvedor não responde — cai no PATH.
[ -n "$PY" ] || PY="${JARVIS_PYTHON:-$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)}"
[ -n "$PY" ] || { echo "Python não encontrado. Instale o Python 3.12 e rode de novo."; exit 1; }

PYV="$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "0.0")"
PYMAJ="${PYV%%.*}"; PYMIN="${PYV#*.}"
PYARCH="$("$PY" -c 'import platform; print(platform.machine())' 2>/dev/null || echo '?')"
echo "Python: $PY  (versão $PYV, arquitetura $PYARCH)   host: $OS $ARCH"

# O interpretador tem de ser da arquitetura do host. Um Python x86_64 sob Rosetta num Mac ARM
# instala wheels x86_64 — que FUNCIONAM, mas emuladas e lentas; e um Python ARM num host Intel
# simplesmente não existe. Avisar aqui é mais barato que descobrir pela latência do STT.
if [ "$PYARCH" != "?" ] && [ "$PYARCH" != "$ARCH" ]; then
  echo "AVISO: o Python é $PYARCH num host $ARCH (provavelmente rodando sob Rosetta)."
  echo "       As wheels seguem o interpretador, não o host — a voz vai rodar emulada."
fi

# --- tetos de versão, POR PLATAFORMA e com o motivo exato -------------------------------------
# Verificado resolvendo contra o PyPI (pip --dry-run --only-binary=:all:), não de memória:
#   win_amd64 py3.14          -> resolve (onnxruntime 1.31.0)
#   macosx_14_0_arm64 py3.14  -> resolve (onnxruntime 1.31.0)
#   macosx_13_0_x86_64 py3.12 -> resolve TUDO, inclusive torch 2.2.2
#   macosx_13_0_x86_64 py3.13 -> núcleo OK, torch "from versions: none"
#   macosx_13_0_x86_64 py3.14 -> ResolutionImpossible
# O teto, portanto, NÃO é global: só o Mac Intel tem um. Um gate sem olhar a plataforma barrava
# Windows e Apple Silicon que funcionam perfeitamente em 3.13/3.14.
if [ "$PYMAJ" -ne 3 ] 2>/dev/null; then
  echo "ERRO: Python 3 obrigatório (encontrado $PYV)."; exit 1
fi
if [ "$PYMIN" -lt 10 ] 2>/dev/null; then
  echo "ERRO: Python $PYV é antigo demais para a stack de voz (piso 3.10)."
  case "$PY" in */CommandLineTools/*|/usr/bin/python3)
    echo "       Esse é o Python 3.9 do Xcode Command Line Tools, abaixo do piso. Instalar nele"
    echo "       só sujaria ~/Library/Python/3.9 sem resolver. Instale o Python 3.12 (python.org"
    echo "       ou brew) e rode de novo." ;;
  esac
  exit 1
fi

# Linux tem teto PRÓPRIO, e é mais baixo: o openwakeword declara
# `tflite-runtime <3,>=2.8.0 ; platform_system == "Linux"`, e o tflite-runtime parou na 2.14.0, que
# publica wheels só até cp311 (conferido no PyPI: tags cp38/cp39/cp310/cp311). Em 3.12+ esse
# requisito fica sem candidato e não há backtracking possível.
if [ "$OS" = "Linux" ] && [ "$PYMIN" -gt 11 ] 2>/dev/null; then
  echo "ERRO: em Linux a stack de voz exige Python 3.10 ou 3.11 (você está no $PYV)."
  echo "       Motivo: openwakeword depende de tflite-runtime SÓ no Linux, e a última versão dele"
  echo "       (2.14.0) publica wheels até cp311. Em 3.12+ o pip não encontra candidato."
  echo "       Use um venv/pyenv com 3.11 e aponte para ele:"
  echo "         JARVIS_PYTHON=/caminho/para/python3.11 npm run install:voice"
  exit 1
fi

# Mac Intel: o único caso com teto superior por arquitetura.
if [ "$OS" = "Darwin" ] && [ "$PYARCH" = "x86_64" ] && [ "$PYMIN" -ge 14 ] 2>/dev/null; then
  echo "ERRO: num Mac Intel a stack de voz não resolve em Python $PYV."
  echo "       O onnxruntime não publica wheel macOS x86_64 acima da 1.23.2, e nenhuma delas cobre"
  echo "       cp3$PYMIN; como o piper-tts exige onnxruntime>=1, o pip sai com ResolutionImpossible."
  echo "       Instale o Python 3.12 e aponte para ele:"
  echo "         JARVIS_PYTHON=/caminho/para/python3.12 npm run install:voice"
  echo "       (e grave a mesma linha em ~/.jarvis/hub.env para o Hub usá-lo)"
  exit 1
fi

# Em Linux, o Python do sistema costuma ser externally-managed (PEP 668) e o pip recusa instalar
# nele antes mesmo de resolver — com uma mensagem que fala de apt, não da stack de voz.
if [ "$OS" = "Linux" ]; then
  STDLIB="$("$PY" -c 'import sysconfig; print(sysconfig.get_path("stdlib"))' 2>/dev/null || true)"
  if [ -n "$STDLIB" ] && [ -f "$STDLIB/EXTERNALLY-MANAGED" ]; then
    echo "ERRO: $PY é externally-managed (PEP 668) — o pip vai recusar instalar nele."
    echo "       Crie um venv com Python 3.10/3.11 e aponte o Hub para ele:"
    echo "         python3.11 -m venv ~/.jarvis/venv && ~/.jarvis/venv/bin/pip install --upgrade pip"
    echo "         JARVIS_PYTHON=~/.jarvis/venv/bin/python npm run install:voice"
    echo "       Em Linux o Hub NÃO varre caminhos alternativos, então gravar JARVIS_PYTHON em"
    echo "       ~/.jarvis/hub.env é obrigatório para ele achar o venv."
    exit 1
  fi
fi

# O ramo do torch é o que tem teto por ARQUITETURA. Mac Intel: última wheel é a 2.2.2 (cp312).
WANT_VOICEID=1
[ "$CORE_ONLY" -eq 1 ] && WANT_VOICEID=0
if [ "$WANT_VOICEID" -eq 1 ] && [ "$OS" = "Darwin" ] && [ "$PYARCH" = "x86_64" ] && [ "$PYMIN" -ge 13 ] 2>/dev/null; then
  WANT_VOICEID=0
  echo ""
  echo "Identificação de voz e memória semântica serão PULADAS neste Python."
  echo "  Motivo: num Mac Intel o torch não publica wheel desde a 2.2.2, que cobre até o cp312 —"
  echo "  para Python $PYV não existe nenhuma ('from versions: none')."
  echo "  TTS, STT e wake word seguem normalmente. Para ter os dois recursos, use Python 3.12."
  echo ""
fi

# macOS 11/12 em Intel resolve, mas trava o onnxruntime na 1.19.2 (as wheels x86_64 mais novas
# exigem macOS >= 13). Vale avisar: é a diferença entre "wake word velha" e "bug".
if [ "$OS" = "Darwin" ]; then
  OSV="$(sw_vers -productVersion 2>/dev/null || echo "0")"; OSMAJ="${OSV%%.*}"
  if [ "${OSMAJ:-0}" -lt 13 ] 2>/dev/null && [ "$PYARCH" = "x86_64" ]; then
    echo "AVISO: macOS $OSV — as wheels x86_64 do onnxruntime exigem macOS >= 13."
    echo "       O pip vai travar o onnxruntime na 1.19.2 (funciona, mas é uma versão antiga)."
  fi
fi

REQ="$ROOT/services/voice/requirements.txt"
VOICEID="$ROOT/services/voice/requirements-voiceid.txt"

echo "Instalando..."
if [ "$WANT_VOICEID" -eq 1 ]; then
  # UMA invocação com os dois arquivos, de propósito: em duas, o scipy é compilado contra o numpy 2
  # da primeira e fica ao lado do numpy 1.26 que a segunda instala (ver requirements-voiceid.txt).
  "$PY" -m pip install --upgrade -r "$REQ" -r "$VOICEID"
  # resemblyzer com --no-deps: ele depende da dist `webrtcvad`, que não tem wheel NENHUMA no PyPI e
  # compila C (falha em todo Mac sem Xcode CLT). As deps dele já foram instaladas acima, com o fork
  # webrtcvad-wheels no lugar — que expõe o mesmo módulo com outro nome de distribuição.
  "$PY" -m pip install --no-deps 'resemblyzer>=0.1.4'
else
  "$PY" -m pip install --upgrade -r "$REQ"
fi

echo ""
echo "Baixando as vozes do Piper (en_GB-alan-medium, pt_BR-faber-medium) em ~/.jarvis/voices..."
"$PY" -m piper.download_voices en_GB-alan-medium pt_BR-faber-medium || \
  echo "  (falhou — rode depois: $PY -m piper.download_voices pt_BR-faber-medium)"

# Fixa o interpretador para o Hub. env_set_managed (e não _once) porque o install-hub.sh pode ter
# gravado outro antes: é ESTE o interpretador onde a stack acabou de ser instalada, então ele tem de
# vencer. Com _once a linha antiga ficava e a frase "fixa o interpretador" era simplesmente falsa.
if [ -d "$HOME/.jarvis" ]; then
  . "$ROOT/scripts/service-env.sh"
  env_set_managed JARVIS_PYTHON "$PY" "$HOME/.jarvis/hub.env"
  echo "JARVIS_PYTHON fixado em ~/.jarvis/hub.env: $PY"
fi

echo ""
echo "Verificando o que ficou instalado:"
# JARVIS_PYTHON="$PY" explícito: sem isso o resolvedor herda o ambiente de quem chamou e pode
# relatar um interpretador DIFERENTE daquele onde a stack acabou de ser instalada — um relatório
# bonito sobre a máquina errada.
( cd "$ROOT" && JARVIS_PYTHON="$PY" node --import tsx apps/hub/src/python.ts ) || true
echo ""
echo "Reinicie o Hub para ele pegar o novo interpretador:"
echo "  macOS: launchctl kickstart -k gui/\$(id -u)/com.jarvis.hub"
echo "  Linux: systemctl --user restart jarvis-hub"
