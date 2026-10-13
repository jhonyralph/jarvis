#!/usr/bin/env sh
# Jarvis Hub launcher (macOS/Linux) — used by launchd/systemd.
# Optional config: ~/.jarvis/hub.env. Startup never spends an agent turn.
set -a
[ -f "$HOME/.jarvis/hub.env" ] && . "$HOME/.jarvis/hub.env"
set +a
: "${JARVIS_AGENT:=claude-code}"
: "${JARVIS_SEARCH_MODEL:=haiku}"
: "${JARVIS_AUTH:=on}"
export JARVIS_AGENT JARVIS_SEARCH_MODEL JARVIS_AUTH
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Rede de segurança para instalações FEITAS ANTES do PATH entrar no plist/unit (install-hub.sh).
# COMPLEMENTA, nunca substitui: sob launchd o PATH herdado é /usr/bin:/bin:/usr/sbin:/sbin, e o npm
# mora num destes dois prefixos (/usr/local = Intel, /opt/homebrew = Apple Silicon) ou no ~/.nvm,
# que só o JARVIS_NPM abaixo alcança.
PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"; export PATH
# npm por caminho absoluto quando o instalador soube qual é. Sem isso, um Hub sob launchd com nvm
# sai com 127 e o launchd o reinicia para sempre, com o log vazio.
# O pin pode ter morrido: `nvm uninstall` apaga o diretório inteiro, e um caminho absoluto
# inexistente não cai no `:-npm` (a variável está setada, só aponta para o nada) — o exec
# sairia 126/127 em loop sob o supervisor. Validar antes devolve o fallback de verdade.
[ -x "${JARVIS_NPM:-}" ] || JARVIS_NPM=npm
exec "$JARVIS_NPM" --prefix "$ROOT/apps/hub" start
