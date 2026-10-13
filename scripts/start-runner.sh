#!/usr/bin/env sh
# Starts the Jarvis runner (used by launchd / systemd). Loads ~/.jarvis/runner.env.
set -a
[ -f "$HOME/.jarvis/runner.env" ] && . "$HOME/.jarvis/runner.env"
set +a
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Mesma rede de segurança do start-hub.sh: COMPLEMENTA o PATH (não substitui) para instalações
# feitas antes de o PATH entrar no plist/unit, e usa o npm absoluto quando o instalador o gravou.
PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"; export PATH
# O pin pode ter morrido: `nvm uninstall` apaga o diretório inteiro, e um caminho absoluto
# inexistente não cai no `:-npm` (a variável está setada, só aponta para o nada) — o exec
# sairia 126/127 em loop sob o supervisor. Validar antes devolve o fallback de verdade.
[ -x "${JARVIS_NPM:-}" ] || JARVIS_NPM=npm
exec "$JARVIS_NPM" --prefix "$ROOT/apps/runner" start
