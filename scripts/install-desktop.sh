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
#     ./scripts/install-desktop.sh --trust    # remove a quarentena do Jarvis.app instalado (macOS)
#
# Exit code: 0 = ok, 1 = falhou (cada falha imprime a correção concreta).
set -u

HUB_URL=""; DO_RUN=0; DO_BUILD=0; DO_FORCE=0; NO_SHORTCUT=0; DO_TRUST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --hub|-h) HUB_URL="${2:-}"; shift 2;;
    --run|-r) DO_RUN=1; shift;;
    --build|-b) DO_BUILD=1; shift;;
    --force|-f) DO_FORCE=1; shift;;
    --no-shortcut) NO_SHORTCUT=1; shift;;
    # Remover quarentena é AFROUXAR o Gatekeeper, então exige flag: nenhuma execução normal deste
    # script mexe nisso. Existe porque, sem Developer ID, a alternativa é o dono decorar um `xattr`
    # e repetir em cada versão — e porque nesta máquina o diálogo oficial de aprovação não aparece
    # (ver a seção "App instalado" no fim).
    --trust) DO_TRUST=1; shift;;
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
    # `require('electron')` só resolve o MÓDULO (um index.js que devolve o caminho do binário) —
    # passa igual se o binário não baixou, está truncado ou é de outra arquitetura. Executar o
    # binário de verdade é o único teste que distingue isso. ELECTRON_RUN_AS_NODE roda sem abrir
    # janela, então serve em máquina sem display.
    EBIN="$(node -e "process.stdout.write(require('electron'))" 2>/dev/null || true)"
    if [ -n "$EBIN" ] && ELECTRON_RUN_AS_NODE=1 "$EBIN" -e "process.exit(0)" >/dev/null 2>&1; then
      ok "Electron $(node -e "console.log(require('electron/package.json').version)" 2>/dev/null) executa neste host ($(uname -m))"
    else
      bad "o binário do Electron existe mas NÃO executa neste host ($(uname -m))" \
          "normalmente é binário de outra arquitetura ou download corrompido: cd desktop && rm -rf node_modules/electron/dist && npm install electron --force"
    fi
  else
    bad "binário do Electron não baixou" "rode: cd desktop && npm install electron --force  (ou defina ELECTRON_MIRROR atrás de proxy)"
  fi
fi

[ "$FAILED" -gt 0 ] && { printf '\n%sInstalação incompleta.%s\n' "$R" "$N"; exit 1; }

# --- 3. Hub de destino -------------------------------------------------------------------------
printf '\nHub\n'
if [ -n "$HUB_URL" ]; then
  # Valida/normaliza com a MESMA regra do app (desktop/src/shared/hub-url.js) em vez de
  # reimplementar: "jarvis.ts.net" ganha http://, ws:// vira http://, barra final some, esquema
  # inválido é recusado AQUI — antes de ser persistido no rc e quebrar só ao abrir o app.
  if ! NORMALIZED="$(node "$REPO/desktop/src/shared/hub-url.js" "$HUB_URL" 2>&1)"; then
    bad "--hub inválida: $NORMALIZED" "use algo como --hub https://jarvis.sua-tailnet.ts.net"
    printf '\n%sInstalação incompleta.%s\n' "$R" "$N"; exit 1
  fi
  [ "$NORMALIZED" != "$HUB_URL" ] && ok "URL normalizada: '$HUB_URL' -> $NORMALIZED"
  HUB_URL="$NORMALIZED"
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

# --- 4. atalho no lançador do SO ----------------------------------------------------------------
# Instalar e depois ter que abrir "na mão" (npm start) é ruim: o app tem que ficar encontrável na
# busca do sistema como qualquer outro. O atalho aponta para ESTE checkout, então continua rodando o
# código atual — sem reempacotar a cada mudança. (macOS: .app em ~/Applications, indexado pelo
# Spotlight; Linux: .desktop em ~/.local/share/applications.)
printf '\nAtalho\n'
if [ "$NO_SHORTCUT" -eq 0 ]; then
  if node "$APP/scripts/make-shortcut.mjs"; then
    case "$(uname -s)" in
      Darwin) ok "atalho em ~/Applications (Spotlight: ⌘+espaço -> \"Jarvis\")";;
      *) ok "entrada no menu de aplicativos (busque por \"Jarvis\")";;
    esac
  else
    warn "não consegui criar o atalho" "crie manualmente com: cd desktop && npm run shortcut"
  fi
else
  ok "atalho ignorado (--no-shortcut)"
fi

# --- 5. build / run (opcionais) ----------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ]; then
  printf '\nBuild do instalador\n'
  case "$(uname -s)" in Darwin) TARGET="--mac";; *) TARGET="--linux";; esac
  # Arquitetura EXPLÍCITA e dita na tela. Antes o electron-builder empacotava o `process.arch` do
  # Node por default e o script nunca dizia qual tinha gerado — num parque com Mac Intel e Apple
  # Silicon lado a lado, dois DMGs com o mesmo nome e arquiteturas diferentes é um jeito caro de
  # descobrir o problema. `DESKTOP_ARCH=both` gera as duas (baixa dois binários do Electron).
  BUILD_ARCH="${DESKTOP_ARCH:-}"
  if [ -z "$BUILD_ARCH" ]; then
    case "$(uname -m)" in
      arm64|aarch64) BUILD_ARCH="arm64";;
      x86_64|amd64)  BUILD_ARCH="x64";;
      *)             BUILD_ARCH="";;   # arquitetura exótica: deixa o default do electron-builder decidir
    esac
  fi
  case "$BUILD_ARCH" in
    both) ARCH_FLAGS="--x64 --arm64";;
    "")   ARCH_FLAGS="";;
    *)    ARCH_FLAGS="--$BUILD_ARCH";;
  esac
  printf '  %sarquitetura: %s (host %s)%s\n' "$D" "${BUILD_ARCH:-default do electron-builder}" "$(uname -m)" "$N"
  # shellcheck disable=SC2086 # ARCH_FLAGS são dois flags separados de propósito
  if npm run dist -- "$TARGET" $ARCH_FLAGS; then
    ok "instalador gerado em $APP/dist"
    ls -1 "$APP/dist" 2>/dev/null | grep -Ei '\.(dmg|zip|appimage|deb)$' | sed 's/^/    /' || true
  else
    bad "electron-builder falhou" "veja o erro acima"
  fi
fi

if [ "$DO_RUN" -eq 1 ] && [ "$FAILED" -eq 0 ]; then
  printf '\nAbrindo o app...\n'
  npm start
fi

# --- 6. macOS: o app JA INSTALADO consegue abrir? ----------------------------------------------
#
# Isto não é sobre o build acima: é sobre o .app que veio do DMG e está em /Applications. Como o
# projeto ainda não tem Developer ID, esse app é NÃO ASSINADO e chega do navegador com o xattr
# `com.apple.quarantine`. O caminho documentado é liberar em Ajustes → Privacidade e Segurança.
#
# Só que esse caminho pode não existir na máquina. Visto em 2026-10-13 num MacBook Pro Intel
# (macOS 15.8.1): o `CoreServicesUIAgent` — o processo que DESENHA o diálogo "não foi possível
# verificar o desenvolvedor" — crashava com SIGSEGV dentro do LocalAuthentication
# (`LAContext _evaluatePolicy`, dois crash reports idênticos). Sem o diálogo ninguém aprova nada: o
# `open` devolve `-128` (cancelado), o ícone pula um tempo e o app nunca abre. Nada no produto
# dizia isso, e a doc só mandava usar o diálogo que não aparecia.
#
# Diagnóstico, não conserto: remover a quarentena é afrouxar uma proteção do SO, então o comando
# fica impresso para a pessoa decidir — não é o instalador que executa.
if [ "$(uname -s)" = "Darwin" ]; then
  printf '\nApp instalado (macOS)\n'
  # O ATALHO que este próprio script cria em ~/Applications/Jarvis.app é um .app cujo executável é
  # um script de shell que chama o Electron do repo — não é o app empacotado. Confundir os dois faria
  # o `lipo` falhar e o instalador avisar sobre um problema inexistente em toda máquina de
  # desenvolvimento. Por isso o candidato só vale se o executável for Mach-O de verdade, que é
  # exatamente o que `lipo -archs` responde.
  INSTALLED=""; IARCH=""
  for cand in "/Applications/Jarvis.app" "$HOME/Applications/Jarvis.app"; do
    [ -d "$cand" ] || continue
    A="$(lipo -archs "$cand/Contents/MacOS/Jarvis" 2>/dev/null || true)"
    [ -n "$A" ] && { INSTALLED="$cand"; IARCH="$A"; break; }
  done
  if [ -z "$INSTALLED" ]; then
    printf '  %s[--]   nenhum Jarvis.app empacotado instalado — nada a verificar (o atalho do modo dev não conta)%s\n' "$D" "$N"
  else
    # Arquitetura primeiro: um .app arm64 num Mac Intel não abre de jeito nenhum (o Rosetta traduz
    # x86_64 para arm64, nunca o contrário) e o sintoma é idêntico ao da quarentena.
    case " $IARCH " in
      *" $(uname -m) "*) ok "Jarvis.app instalado é $IARCH, igual ao host ($(uname -m))" ;;
      *) bad "Jarvis.app instalado é $IARCH, mas este host é $(uname -m)" \
             "baixe o DMG com o sufixo certo: Jarvis-<versão>-$(if [ "$(uname -m)" = "arm64" ]; then echo arm64; else echo x64; fi).dmg" ;;
    esac
    QUAR="$(xattr -p com.apple.quarantine "$INSTALLED" 2>/dev/null || true)"
    SIGNED=0; codesign -dv "$INSTALLED" >/dev/null 2>&1 && SIGNED=1
    if [ "$SIGNED" -eq 1 ]; then
      ok "Jarvis.app está assinado — o Gatekeeper não bloqueia a abertura"
    elif [ -z "$QUAR" ]; then
      ok "Jarvis.app sem quarentena — abre direto (não é assinado, então a atualização segue manual)"
    elif [ "$DO_TRUST" -eq 1 ]; then
      # Só aqui, e só com --trust. O que isto faz, em uma frase: diz ao macOS que VOCÊ confia neste
      # bundle, dispensando a aprovação do Gatekeeper que, sem assinatura, ele exigiria em cada
      # versão nova. Não torna o app assinado e não muda mais nada no sistema.
      if xattr -dr com.apple.quarantine "$INSTALLED" 2>/dev/null; then
        ok "quarentena removida de $INSTALLED (--trust) — o app abre a partir de agora"
        printf '  %sprecisa repetir a cada versao nova baixada; o conserto definitivo e assinar com Developer ID%s\n' "$D" "$N"
      else
        bad "nao consegui remover a quarentena de $INSTALLED" "rode manualmente: xattr -dr com.apple.quarantine '$INSTALLED'"
      fi
    else
      warn "Jarvis.app está em QUARENTENA e não é assinado — é isto que faz o ícone pular sem abrir." \
           "libere em Ajustes → Privacidade e Segurança → 'Abrir mesmo assim'. Se esse diálogo NUNCA aparecer (o CoreServicesUIAgent pode crashar nesta máquina), rode de novo com --trust, que remove a quarentena deste bundle."
    fi
    # Onde olhar quando algo der errado. O app passou a gravar JSONL aqui (desktop/src/shared/logger.js).
    printf '  %slog do app: ~/Library/Logs/jarvis-desktop/ (empacotado E npm start — o nome vem do package.json, nao do productName)%s\n' "$D" "$N"
  fi
fi

printf '\n'
[ "$FAILED" -gt 0 ] && { printf '%sTerminou com falhas.%s\n' "$R" "$N"; exit 1; }
printf '%sPronto.%s\n' "$G" "$N"
if [ "$DO_RUN" -eq 0 ]; then
  printf '  %sabrir o app:      ./scripts/install-desktop.sh --run%s\n' "$D" "$N"
  printf '  %sgerar instalador: ./scripts/install-desktop.sh --build        (arquitetura deste host: %s)%s\n' "$D" "$(uname -m)" "$N"
  printf '  %s                  DESKTOP_ARCH=both ./scripts/install-desktop.sh --build   (x64 + arm64)%s\n' "$D" "$N"
fi
exit 0
