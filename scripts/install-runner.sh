#!/usr/bin/env sh
# install-runner.sh — install this machine as a Jarvis runner (macOS / Linux).
#
# Run from the cloned jarvis repo. Get the hub URL + token from the Hub:
#     ./scripts/jarvis.ps1 machine -label "Meu Mac"    (or read them from the Hub UI)
#
# Uso:
#     ./scripts/install-runner.sh -h "wss://<hub>/" -t "<token>" -l "Meu Mac"
#
# Pré-requisitos: Node >= 22 e `claude login` / `codex login` nesta máquina.
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
if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  echo "Aviso: nenhum agente (claude/codex) encontrado/autenticado nesta máquina."
fi

echo "Instalando dependências (npm install)..."
( cd "$ROOT" && npm install >/dev/null )

mkdir -p "$HOME/.jarvis"
printf 'JARVIS_HUB=%s\nJARVIS_TOKEN=%s\nJARVIS_LABEL="%s"\n' "$HUB" "$TOKEN" "$LABEL" > "$HOME/.jarvis/runner.env"
chmod +x "$ROOT/scripts/start-runner.sh"

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.jarvis.runner.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jarvis.runner</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$ROOT/scripts/start-runner.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.jarvis/runner.log</string>
  <key>StandardErrorPath</key><string>$HOME/.jarvis/runner.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
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
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now jarvis-runner.service
  echo "Runner instalado (systemd --user: jarvis-runner). Deve aparecer no seletor do Hub."
  echo "Dica: rode 'loginctl enable-linger $USER' para o runner subir sem login gráfico."
fi
