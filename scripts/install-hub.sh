#!/usr/bin/env sh
# install-hub.sh — make THIS machine the Jarvis Hub (macOS/Linux). ONE Hub per setup:
# it serves the UI, stores everything locally, and accepts runners. Secondary machines
# use install-runner.sh instead.
#
# Prereqs: Node >= 22 and at least one supported/authenticated agent CLI.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "Node.js >= 22 requerido. Instale e rode de novo."; exit 1; }
HAS_AGENT=0
for cmd in claude codex gemini cursor-agent copilot opencode cline qwen cn kiro-cli agy aider; do command -v "$cmd" >/dev/null 2>&1 && HAS_AGENT=1; done
[ "$HAS_AGENT" -eq 1 ] || echo "Aviso: nenhuma CLI suportada encontrada — o Hub sobe, mas sem IA até instalar/autenticar uma."

echo "Instalando dependências (npm install)..."
( cd "$ROOT" && npm install >/dev/null )
chmod +x "$ROOT/scripts/start-hub.sh" "$ROOT/scripts/jarvis.sh" 2>/dev/null || true

mkdir -p "$HOME/.jarvis"
[ -f "$HOME/.jarvis/hub.env" ] || cat > "$HOME/.jarvis/hub.env" <<EOF
JARVIS_AGENT=claude-code
JARVIS_AUTH=on
JARVIS_SEARCH_MODEL=haiku
JARVIS_AGENT_PERMISSION_MODE=full-access
# JARVIS_PUBLIC_URL=https://<seu-host>   # para links de convite completos
# JARVIS_REQUIRE_TLS=on JARVIS_TRUST_PROXY=on   # se expor publicamente atrás de proxy TLS
EOF

# Resolve o toolchain do SERVIÇO (PATH, npm e python absolutos). Ver scripts/service-env.sh para o
# motivo: o launchd entrega PATH=/usr/bin:/bin:/usr/sbin:/sbin e o prefixo do brew muda com a
# arquitetura do Mac. Tem de rodar DEPOIS do npm install (usa node_modules para resolver o python).
. "$ROOT/scripts/service-env.sh"
# `env_set_managed` (e não `env_set_once`): estes dois são caminhos ABSOLUTOS derivados desta
# máquina, não preferências do dono. Um JARVIS_NPM apontando para um Node que o nvm removeu deixa o
# serviço saindo 126/127 em loop, e um pin que nunca se atualiza faz reinstalar NÃO consertar — o
# instalador imprimia o npm novo na tela e seguia gravado o antigo.
env_set_managed JARVIS_PYTHON "$SVC_PY" "$HOME/.jarvis/hub.env"
env_set_managed JARVIS_NPM "$SVC_NPM" "$HOME/.jarvis/hub.env"
echo "Serviço: arch=$SVC_ARCH  npm=${SVC_NPM:-<não encontrado>}  python=${SVC_PY:-<não encontrado, voz indisponível>}"

# Mesma garantia do runner: o serviço tem que ser a única instância. launchctl/systemd só
# substituem o que gerenciam; um `npm start` esquecido num terminal seguiria segurando a porta.
if pkill -f 'apps/hub/src/index.ts' 2>/dev/null; then
  echo "Encerrando hub ja em execucao — o servico assume a partir de agora."
fi

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.jarvis.hub.plist"; mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jarvis.hub</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$(plist_escape "$ROOT")/scripts/start-hub.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(plist_escape "$SVC_PATH")</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(plist_escape "$HOME")/.jarvis/hub.log</string>
  <key>StandardErrorPath</key><string>$(plist_escape "$HOME")/.jarvis/hub.log</string>
</dict></plist>
EOF
  # bootout/bootstrap em vez de unload/load: as formas antigas estão obsoletas desde o macOS 10.11,
  # e `load` falha silenciosamente num plist já carregado — então uma reinstalação podia deixar no ar
  # a versão ANTERIOR do plist (sem o PATH, no caso) sem avisar.
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
    # Diferente do `launchctl load`, que retornava 0 mesmo falhando, o `bootstrap` retorna != 0 —
    # e com `set -e` isso mataria o instalador ANTES do diagnóstico abaixo. Pior: o jarvis-setup.sh
    # chama este script sem `|| true`, então o setup guiado morria sem chegar ao claim code.
    echo "launchctl bootstrap falhou para com.jarvis.hub."
    if launchctl print-disabled "gui/$(id -u)" 2>/dev/null | grep -q '"com.jarvis.hub" => disabled'; then
      echo "  O serviço está marcado como DESABILITADO, e bootstrap não sobrepõe esse flag."
      echo "  Rode:  launchctl enable gui/$(id -u)/com.jarvis.hub   e instale de novo."
    else
      echo "  Verifique o plist ($PLIST) e ~/.jarvis/hub.log."
    fi
    exit 1
  fi
  # Verificação que só o runner tinha. Sem ela a falha mais comum — serviço sai 127 porque não achou
  # o npm — termina com "Hub instalado" na tela e nada funcionando.
  sleep 2
  if INFO="$(launchctl print "gui/$(id -u)/com.jarvis.hub" 2>/dev/null)"; then
    if printf '%s' "$INFO" | grep -q 'state = running'; then
      echo "Hub instalado (launchd: com.jarvis.hub) na porta 4577."
    else
      LAST="$(printf '%s' "$INFO" | sed -n 's/^[[:space:]]*last exit code = \([0-9][0-9]*\)$/\1/p' | head -1)"
      echo "O serviço launchd carregou mas não está rodando (last exit code: ${LAST:-?})."
      [ "${LAST:-}" = "127" ] && echo "  127 = comando não encontrado: o PATH do serviço não alcança o npm. PATH gravado: $SVC_PATH"
      echo "  Últimas linhas de ~/.jarvis/hub.log:"; tail -20 "$HOME/.jarvis/hub.log" 2>/dev/null || true
      exit 1
    fi
  else
    echo "O serviço launchd não permaneceu carregado; consulte ~/.jarvis/hub.log."; exit 1
  fi
else
  UNIT="$HOME/.config/systemd/user/jarvis-hub.service"; mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<EOF
[Unit]
Description=Jarvis Hub
After=network-online.target

[Service]
ExecStart=/bin/sh $ROOT/scripts/start-hub.sh
Environment="PATH=$SVC_PATH"
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now jarvis-hub.service
  echo "Hub instalado (systemd --user: jarvis-hub) na porta 4577."
  # Linger = o serviço --user sobe no BOOT sem nenhum login (equivalente headless ao auto-login).
  if loginctl enable-linger "$USER" 2>/dev/null; then
    echo "Linger habilitado: o Hub sobe após reboot mesmo SEM login."
  else
    echo "Para o Hub subir após reboot SEM login, rode: sudo loginctl enable-linger $USER"
  fi
fi
echo ""
echo "PRIMEIRO ACESSO (nenhum dispositivo logado ainda):"
echo "  o claim-code está em ~/.jarvis/claim-code.txt  (ou: ./scripts/jarvis.sh claimcode)"
echo "  abra a UI, e cole esse código para virar o DONO."
