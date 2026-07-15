#!/usr/bin/env sh
# install-hub.sh — make THIS machine the Jarvis Hub (macOS/Linux). ONE Hub per setup:
# it serves the UI, stores everything locally, and accepts runners. Secondary machines
# use install-runner.sh instead.
#
# Prereqs: Node >= 22, and `claude login` / `codex login` on this machine.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "Node.js >= 22 requerido. Instale e rode de novo."; exit 1; }
if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  echo "Aviso: nenhum agente (claude/codex) encontrado/autenticado — o Hub sobe, mas sem IA até logar um."
fi

echo "Instalando dependências (npm install)..."
( cd "$ROOT" && npm install >/dev/null )
chmod +x "$ROOT/scripts/start-hub.sh" "$ROOT/scripts/jarvis.sh" 2>/dev/null || true

mkdir -p "$HOME/.jarvis"
[ -f "$HOME/.jarvis/hub.env" ] || cat > "$HOME/.jarvis/hub.env" <<EOF
JARVIS_AGENT=claude-code
JARVIS_AUTH=on
JARVIS_SEARCH_MODEL=haiku
# JARVIS_PUBLIC_URL=https://<seu-host>   # para links de convite completos
# JARVIS_REQUIRE_TLS=on JARVIS_TRUST_PROXY=on   # se expor publicamente atrás de proxy TLS
EOF

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.jarvis.hub.plist"; mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jarvis.hub</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$ROOT/scripts/start-hub.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.jarvis/hub.log</string>
  <key>StandardErrorPath</key><string>$HOME/.jarvis/hub.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "Hub instalado (launchd: com.jarvis.hub) na porta 4577."
else
  UNIT="$HOME/.config/systemd/user/jarvis-hub.service"; mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<EOF
[Unit]
Description=Jarvis Hub
After=network-online.target

[Service]
ExecStart=/bin/sh $ROOT/scripts/start-hub.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now jarvis-hub.service
  echo "Hub instalado (systemd --user: jarvis-hub) na porta 4577."
  echo "Dica: 'loginctl enable-linger $USER' para subir sem login gráfico."
fi
echo ""
echo "PRIMEIRO ACESSO (nenhum dispositivo logado ainda):"
echo "  o claim-code está em ~/.jarvis/claim-code.txt  (ou: ./scripts/jarvis.sh claimcode)"
echo "  abra a UI, e cole esse código para virar o DONO."
