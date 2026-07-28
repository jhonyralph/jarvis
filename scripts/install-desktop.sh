#!/usr/bin/env bash
# install-desktop.sh — instala/roda o cliente desktop (Electron) do Jarvis (macOS / Linux).
#
# O shell desktop mora em desktop/, FORA do workspace npm (toolchain própria: Electron +
# electron-builder), então ele não é instalado junto com o Hub/runner. Este script faz o ciclo
# completo: valida o ambiente, instala as dependências, confirma que o binário do Electron baixou
# de verdade e (opcional) builda o instalador ou abre o app.
#
# Uso:
#     ./scripts/install-desktop.sh
#     ./scripts/install-desktop.sh --hub https://jarvis.minha-tailnet.ts.net
#     ./scripts/install-desktop.sh --run      # instala e abre o app
#     ./scripts/install-desktop.sh --build    # instala e gera o instalador (dist/)
#     ./scripts/install-desktop.sh --force    # reinstala do zero
#
# Exit code: 0 = ok, 1 = falhou (cada falha imprime a correção concreta).
set -u

HUB_URL=""; DO_RUN=0; DO_BUILD=0; DO_FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --hub|-h) HUB_URL="${2:-}"; shift 2;;
    --run|-r) DO_RUN=1; shift;;
    --build|-b) DO_BUILD=1; shift;;
    --force|-f) DO_FORCE=1; shift;;
    *) echo "arg desconhecido: $1"; exit 1;;
  esac
done

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO/desktop"
FAILED=0
if [ -t 1 ]; then G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; D=$'\033[90m'; N=$'\033[0m'; else G=""; Y=""; R=""; C=""; D=""; N=""; fi
ok()   { printf '  %s[OK]%s   %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s[WARN]%s %s\n' "$Y" "$N" "$1"; [ -n "${2:-}" ] && printf '         %s-> %s%s\n' "$D" "$2" "$N"; return 0; }
bad()  { printf '  %s[FAIL]%s %s\n' "$R" "$N" "$1"; [ -n "${2:-}" ] && printf '         %s-> %s%s\n' "$D" "$2" "$N"; FAILED=$((FAILED+1)); }
have() { command -v "$1" >/dev/null 2>&1; }

printf '\n%sJarvis desktop (Electron) - instalação%s\n' "$C" "$N"
printf '  %srepo=%s%s\n\n' "$D" "$REPO" "$N"

# --- 1. ambiente -------------------------------------------------------------------------------
echo "Ambiente"
[ -d "$APP" ] || { bad "pasta desktop/ não encontrada em $REPO" "rode este script de dentro do repo clonado do Jarvis"; exit 1; }
ok "pasta do app: $APP"

if ! have node; then
  bad "Node.js não encontrado no PATH" "instale o Node 22+ (nodejs.org, nvm ou o gerenciador do seu SO) e reabra o terminal"
else
  NODE_V="$(node -v | sed 's/^v//')"
  NODE_MAJOR="${NODE_V%%.*}"
  if [ "$NODE_MAJOR" -lt 22 ] 2>/dev/null; then bad "Node $NODE_V é antigo (o Jarvis exige >= 22)" "atualize: nvm install 22  (ou nodejs.org)"
  else ok "Node $NODE_V"; fi
fi
have npm && ok "npm $(npm -v)" || bad "npm não encontrado no PATH" "reinstale o Node.js (o npm vem junto) e reabra o terminal"

# Linux: o Electron é um Chromium — sem estas libs de sistema ele instala mas NÃO abre, com um erro
# críptico de shared library. Avisamos ANTES, com o comando de instalação da distro.
if [ "$(uname -s)" = "Linux" ]; then
  MISSING=""
  for lib in libgtk-3.so.0 libnss3.so libatk-1.0.so.0 libgbm.so.1 libasound.so.2; do
    if ! (ldconfig -p 2>/dev/null | grep -q "$lib"); then MISSING="$MISSING $lib"; fi
  done
  if [ -n "$MISSING" ]; then
    if have apt-get;   then FIX="sudo apt-get install -y libgtk-3-0 libnss3 libatk1.0-0 libgbm1 libasound2"
    elif have dnf;     then FIX="sudo dnf install -y gtk3 nss atk mesa-libgbm alsa-lib"
    elif have pacman;  then FIX="sudo pacman -S --needed gtk3 nss atk mesa alsa-lib"
    else FIX="instale as libs do Chromium/GTK da sua distro"; fi
    warn "faltam libs de sistema do Electron:$MISSING" "$FIX"
  else
    ok "libs de sistema do Electron presentes"
  fi
fi

[ "$FAILED" -gt 0 ] && { printf '\n%sCorrija os itens acima e rode de novo.%s\n' "$R" "$N"; exit 1; }

# --- 2. dependências ---------------------------------------------------------------------------
printf '\nDependências\n'
cd "$APP" || exit 1
if [ "$DO_FORCE" -eq 1 ] && [ -d node_modules ]; then
  printf '  %sremovendo node_modules (--force)...%s\n' "$D" "$N"; rm -rf node_modules
fi

# `npm ci` exige lockfile; desktop/ pode não ter (não faz parte do workspace). Cai para
# `npm install`, que TAMBÉM gera o package-lock.json para as próximas instalações serem
# determinísticas. Nunca falha só porque o lock ainda não existe.
if [ -f package-lock.json ]; then CMD="ci"; else CMD="install"; fi
printf '  %snpm %s (pode demorar: baixa o binário do Electron ~100MB)...%s\n' "$D" "$CMD" "$N"
if ! npm "$CMD"; then
  if [ "$CMD" = "ci" ]; then
    warn "npm ci falhou (lockfile dessincronizado?) - tentando npm install"
    npm install || bad "npm install falhou" "veja o erro acima; rode com --force para reinstalar do zero"
  else
    bad "npm install falhou" "veja o erro acima; se for proxy/rede, configure npm config set proxy"
  fi
fi
[ "$FAILED" -eq 0 ] && ok "dependências instaladas (npm $CMD)"

# O postinstall do Electron baixa um binário separado; atrás de proxy/firewall ele falha
# SILENCIOSAMENTE e só quebra na hora de abrir. Verificamos de verdade.
if [ "$FAILED" -eq 0 ]; then
  if node -e "require('electron')" >/dev/null 2>&1; then
    ok "Electron $(node -e "console.log(require('electron/package.json').version)" 2>/dev/null) pronto"
  else
    bad "binário do Electron não baixou" "rode: cd desktop && npm install electron --force  (ou defina ELECTRON_MIRROR atrás de proxy)"
  fi
fi

[ "$FAILED" -gt 0 ] && { printf '\n%sInstalação incompleta.%s\n' "$R" "$N"; exit 1; }

# --- 3. Hub de destino -------------------------------------------------------------------------
printf '\nHub\n'
if [ -n "$HUB_URL" ]; then
  export JARVIS_APP_HUB_URL="$HUB_URL"
  # persiste no shell rc do usuário (idempotente: substitui a linha anterior se já existir)
  RC="$HOME/.zshrc"; [ -n "${BASH_VERSION:-}" ] && [ -f "$HOME/.bashrc" ] && RC="$HOME/.bashrc"
  if [ -w "$(dirname "$RC")" ]; then
    touch "$RC"
    grep -v '^export JARVIS_APP_HUB_URL=' "$RC" > "$RC.tmp" 2>/dev/null || true
    printf 'export JARVIS_APP_HUB_URL=%s\n' "$HUB_URL" >> "$RC.tmp"
    mv "$RC.tmp" "$RC"
    ok "JARVIS_APP_HUB_URL=$HUB_URL (salvo em $RC)"
  else
    ok "JARVIS_APP_HUB_URL=$HUB_URL (só nesta sessão)"
  fi
elif [ -n "${JARVIS_APP_HUB_URL:-}" ]; then
  ok "JARVIS_APP_HUB_URL=$JARVIS_APP_HUB_URL (já definido)"
else
  warn "JARVIS_APP_HUB_URL não definido - o app vai apontar para http://127.0.0.1:4577" "para um Hub remoto: --hub https://<hub>.ts.net"
fi

# --- 4. build / run (opcionais) ----------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ]; then
  printf '\nBuild do instalador\n'
  case "$(uname -s)" in Darwin) TARGET="--mac";; *) TARGET="--linux";; esac
  if npm run dist -- "$TARGET"; then ok "instalador gerado em $APP/dist"; else bad "electron-builder falhou" "veja o erro acima"; fi
fi

if [ "$DO_RUN" -eq 1 ] && [ "$FAILED" -eq 0 ]; then
  printf '\nAbrindo o app...\n'
  npm start
fi

printf '\n'
[ "$FAILED" -gt 0 ] && { printf '%sTerminou com falhas.%s\n' "$R" "$N"; exit 1; }
printf '%sPronto.%s\n' "$G" "$N"
if [ "$DO_RUN" -eq 0 ]; then
  printf '  %sabrir o app:      ./scripts/install-desktop.sh --run%s\n' "$D" "$N"
  printf '  %sgerar instalador: ./scripts/install-desktop.sh --build%s\n' "$D" "$N"
fi
exit 0
