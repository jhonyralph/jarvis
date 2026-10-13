#!/usr/bin/env sh
# install-runner.sh — install this machine as a Jarvis runner (macOS / Linux).
#
# Run from the cloned jarvis repo. Get the hub URL + token from the Hub:
#     ./scripts/jarvis.ps1 machine -label "Meu Mac"    (or read them from the Hub UI)
#
# Uso:
#     ./scripts/install-runner.sh -h "wss://<hub>/" -t "<token>" -l "Meu Mac"
#
# Pré-requisitos: Node >= 22 e ao menos uma CLI suportada/autenticada.
set -e
HUB=""; TOKEN=""; LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--hub) HUB="$2"; shift 2;;
    -t|--token) TOKEN="$2"; shift 2;;
    -l|--label) LABEL="$2"; shift 2;;
    *) echo "arg desconhecido: $1"; shift;;
  esac
done
[ -n "$HUB" ] && [ -n "$TOKEN" ] || { echo "uso: install-runner.sh -h <ws-url> -t <token> [-l label]"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "Node.js não encontrado (>=22). Instale e rode de novo."; exit 1; }
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[ "$NODE_MAJOR" -ge 22 ] || { echo "Node.js >=22 obrigatório (encontrado: $(node --version))."; exit 1; }
[ -d "$ROOT/.git" ] || { echo "Este runner precisa ser instalado de um git clone para receber atualizações remotas."; exit 1; }
git -C "$ROOT" remote get-url origin >/dev/null 2>&1 || { echo "Git remote origin ausente. Configure-o antes de instalar o runner."; exit 1; }
GIT_TERMINAL_PROMPT=0 git -C "$ROOT" fetch --dry-run --quiet origin || { echo "O serviço não consegue acessar origin sem prompt. Corrija URL/credenciais do Git."; exit 1; }
HAS_AGENT=0
for cmd in claude codex gemini cursor-agent copilot opencode cline qwen cn kiro-cli agy aider; do command -v "$cmd" >/dev/null 2>&1 && HAS_AGENT=1; done
[ "$HAS_AGENT" -eq 1 ] || echo "Aviso: nenhuma CLI suportada encontrada. Veja docs/agent-parity-matrix.md."

echo "Instalando dependências determinísticas e validando o checkout..."
if [ -f "$ROOT/package-lock.json" ]; then ( cd "$ROOT" && npm ci >/dev/null ); else ( cd "$ROOT" && npm install >/dev/null ); fi
( cd "$ROOT" && npm run update:verify --if-present >/dev/null )

mkdir -p "$HOME/.jarvis"
printf 'JARVIS_HUB=%s\nJARVIS_TOKEN=%s\nJARVIS_LABEL="%s"\n' "$HUB" "$TOKEN" "$LABEL" > "$HOME/.jarvis/runner.env"
chmod +x "$ROOT/scripts/start-runner.sh"

# Toolchain do serviço (PATH, npm e python absolutos) — ver scripts/service-env.sh. Depois do
# npm ci, porque a resolução do python usa o node_modules.
. "$ROOT/scripts/service-env.sh"
# env_set_managed, não _once: caminhos derivados da máquina. Ver o comentário em install-hub.sh.
env_set_managed JARVIS_PYTHON "$SVC_PY" "$HOME/.jarvis/runner.env"
env_set_managed JARVIS_NPM "$SVC_NPM" "$HOME/.jarvis/runner.env"
echo "Serviço: arch=$SVC_ARCH  npm=${SVC_NPM:-<não encontrado>}  python=${SVC_PY:-<não encontrado, voz indisponível>}"

# O serviço tem que ser a ÚNICA instância. launchctl/systemd só substituem o que eles mesmos
# gerenciam; um `npm start` deixado num terminal segue vivo e registra com o mesmo runnerId,
# virando um zumbi que continua tailando sessões e sondando os agentes. Encerra antes.
if pkill -f 'apps/runner/src/index.ts' 2>/dev/null; then
  echo "Encerrando runner ja em execucao — o servico assume a partir de agora."
fi

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.jarvis.runner.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jarvis.runner</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$(plist_escape "$ROOT")/scripts/start-runner.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(plist_escape "$SVC_PATH")</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(plist_escape "$HOME")/.jarvis/runner.log</string>
  <key>StandardErrorPath</key><string>$(plist_escape "$HOME")/.jarvis/runner.log</string>
</dict></plist>
EOF
  # bootout/bootstrap: `load` não recarrega um plist já carregado, então uma reinstalação podia
  # manter no ar a versão anterior do plist (sem o PATH) sem nenhum aviso.
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
    # `bootstrap` retorna != 0 onde o `load` antigo retornava 0; sem este if o `set -e` mataria o
    # instalador antes do diagnóstico. Ver o mesmo bloco em install-hub.sh.
    echo "launchctl bootstrap falhou para com.jarvis.runner."
    if launchctl print-disabled "gui/$(id -u)" 2>/dev/null | grep -q '"com.jarvis.runner" => disabled'; then
      echo "  O serviço está marcado como DESABILITADO, e bootstrap não sobrepõe esse flag."
      echo "  Rode:  launchctl enable gui/$(id -u)/com.jarvis.runner   e instale de novo."
    else
      echo "  Verifique o plist ($PLIST) e ~/.jarvis/runner.log."
    fi
    exit 1
  fi
  sleep 2
  # `print` só prova que está CARREGADO. Quem falha por PATH carrega, sai 127 e é reiniciado em
  # loop — o teste antigo passava justamente no modo de falha mais comum.
  if INFO="$(launchctl print "gui/$(id -u)/com.jarvis.runner" 2>/dev/null)"; then
    if ! printf '%s' "$INFO" | grep -q 'state = running'; then
      LAST="$(printf '%s' "$INFO" | sed -n 's/^[[:space:]]*last exit code = \([0-9][0-9]*\)$/\1/p' | head -1)"
      echo "O serviço launchd carregou mas não está rodando (last exit code: ${LAST:-?})."
      [ "${LAST:-}" = "127" ] && echo "  127 = comando não encontrado: o PATH do serviço não alcança o npm. PATH gravado: $SVC_PATH"
      echo "  Últimas linhas de ~/.jarvis/runner.log:"; tail -20 "$HOME/.jarvis/runner.log" 2>/dev/null || true
      exit 1
    fi
  else
    echo "O serviço launchd não permaneceu ativo; consulte ~/.jarvis/runner.log."; exit 1
  fi
  echo "Runner instalado (launchd: com.jarvis.runner). Deve aparecer no seletor do Hub."
else
  UNIT="$HOME/.config/systemd/user/jarvis-runner.service"
  mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<EOF
[Unit]
Description=Jarvis Runner
After=network-online.target

[Service]
ExecStart=/bin/sh $ROOT/scripts/start-runner.sh
Environment="PATH=$SVC_PATH"
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now jarvis-runner.service
  sleep 2
  systemctl --user is-active --quiet jarvis-runner.service || { echo "O serviço systemd não permaneceu ativo; consulte journalctl --user -u jarvis-runner."; exit 1; }
  echo "Runner instalado (systemd --user: jarvis-runner). Deve aparecer no seletor do Hub."
  # Linger = o serviço --user sobe no BOOT sem nenhum login (o equivalente headless ao auto-login).
  if loginctl enable-linger "$USER" 2>/dev/null; then
    echo "Linger habilitado: o runner sobe após reboot mesmo SEM login."
  else
    echo "Para o runner subir após reboot SEM login, rode: sudo loginctl enable-linger $USER"
  fi
fi
