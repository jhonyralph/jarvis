#!/usr/bin/env bash
# jarvis-doctor.sh — pre-flight / health check for a Jarvis machine (macOS / Linux).
#
# Answers "is this box set up correctly?" WITHOUT changing anything: runtime, agent CLI, deps, port,
# config, the Hub's /health, autostart, Tailscale and (optional) voice deps — printing PASS/WARN/FAIL
# with a concrete fix for each miss. Read-only; safe any time.
#
#   ./scripts/jarvis-doctor.sh            # hub checks (default)
#   ./scripts/jarvis-doctor.sh runner     # runner-box checks
#
# Exit 0 if nothing FAILED (warnings allowed), 1 if any hard check FAILED.
set -u
ROLE="${1:-hub}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
JHOME="${JARVIS_HOME:-$HOME}"
JDIR="$JHOME/.jarvis"
PORT="${JARVIS_PORT:-4577}"
ADMIN_PORT="${JARVIS_ADMIN_PORT:-4578}"

OK=0; WARN=0; FAIL=0
if [ -t 1 ]; then G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[90m'; C=$'\033[36m'; Z=$'\033[0m'; else G=; Y=; R=; D=; C=; Z=; fi
pass() { echo "  ${G}[OK]${Z}   $1"; OK=$((OK+1)); }
warn() { echo "  ${Y}[WARN]${Z} $1"; [ -n "${2:-}" ] && echo "         ${D}-> $2${Z}"; WARN=$((WARN+1)); }
fail() { echo "  ${R}[FAIL]${Z} $1"; [ -n "${2:-}" ] && echo "         ${D}-> $2${Z}"; FAIL=$((FAIL+1)); }
have() { command -v "$1" >/dev/null 2>&1; }

echo
echo "${C}Jarvis — diagnóstico de ambiente ($ROLE)${Z}"
echo "${D}  repo=$REPO  home=$JDIR  port=$PORT${Z}"
# Plataforma e ARQUITETURA no cabeçalho. Não é enfeite: metade dos problemas de Mac depende de
# x86_64 vs arm64 (prefixo do brew, teto de wheels do Python, arquitetura do .app), e até aqui o
# diagnóstico não dizia em qual das duas máquinas estava rodando.
HOST_ARCH="$(uname -m)"
if [ "$(uname -s)" = "Darwin" ]; then
  echo "${D}  macOS $(sw_vers -productVersion 2>/dev/null) ($HOST_ARCH)  node $(node -p process.arch 2>/dev/null || echo '?')${Z}"
else
  echo "${D}  $(uname -s) $HOST_ARCH  node $(node -p process.arch 2>/dev/null || echo '?')${Z}"
fi
echo

# 0) macOS: versão do SO e arquitetura do Node vs do host
if [ "$(uname -s)" = "Darwin" ]; then
  OSV="$(sw_vers -productVersion 2>/dev/null || echo 0)"; OSMAJ="${OSV%%.*}"
  if [ "${OSMAJ:-0}" -lt 11 ] 2>/dev/null; then
    fail "macOS $OSV ($HOST_ARCH) está abaixo do piso suportado." "O cliente desktop (Electron 34) exige macOS 11 Big Sur+. Esta máquina pode servir como Hub/runner via terminal, mas não roda o app empacotado."
  elif [ "${OSMAJ:-0}" -lt 13 ] 2>/dev/null; then
    warn "macOS $OSV ($HOST_ARCH): abaixo de 13, as wheels x86_64 do onnxruntime param na 1.19.2." "A voz funciona, com uma versão antiga do runtime de wake word. Atualizar o SO destrava a 1.23.x."
  else
    pass "macOS $OSV ($HOST_ARCH)"
  fi
  # Node emulado é causa clássica de "instalei a wheel errada": o pip/npm seguem o processo, não o
  # host. Num Mac Intel a chave sysctl.proc_translated não existe — por isso o teste é a divergência.
  NODE_ARCH="$(node -p process.arch 2>/dev/null || echo '?')"
  case "$HOST_ARCH:$NODE_ARCH" in
    arm64:x64)   warn "Node x64 num host arm64 — está rodando sob Rosetta." "Instale o Node nativo arm64 (nvm install 22 num terminal nativo); as deps nativas seguem a arquitetura do PROCESSO.";;
    x86_64:arm64) warn "Node arm64 reportado num host x86_64 — combinação inesperada." "Confira a instalação do Node.";;
  esac
fi

# 1) Node >= 22
if have node; then
  NV="$(node -v 2>/dev/null)"; MAJ="$(echo "$NV" | sed 's/^v//; s/\..*//')"
  if [ "${MAJ:-0}" -ge 22 ] 2>/dev/null; then pass "Node $NV"; else fail "Node $NV é antigo (precisa >= 22)." "Atualize o Node para 22+ (o hub/runner roda via tsx)."; fi
else fail "Node.js não encontrado no PATH." "Instale Node >= 22 (nodejs.org)."; fi

# 2) CLIs: presence/version is read-only. Tier is the adapter certification state.
ANY=0
for entry in 'claude:claude-code:complete' 'codex:codex:limited' 'gemini:gemini:unverified' 'cursor-agent:cursor:unverified' 'copilot:copilot:unverified' 'opencode:opencode:unverified' 'cline:cline:unverified' 'qwen:qwen:unverified' 'cn:continue:limited' 'kiro-cli:kiro:limited' 'agy:antigravity:limited' 'aider:aider:limited'; do
  cmd=${entry%%:*}; rest=${entry#*:}; id=${rest%%:*}; tier=${entry##*:}
  if have "$cmd"; then ver=$("$cmd" --version 2>&1 | head -n 1); pass "Agent '$id' [$tier] — $cmd $ver"; ANY=1; fi
done
if [ "$ANY" -eq 0 ]; then fail "Nenhuma CLI de agente suportada no PATH." "Instale e autentique ao menos uma; veja docs/agent-parity-matrix.md."; \
else warn "Presença/versão não prova autenticação nem paridade." "Rode npm run agents:report e um probe real antes de promover unverified/limited."; fi
case "${JARVIS_AGENT_PERMISSION_MODE:-full-access}" in provider-default|provider_default) pass "Política de ferramentas: provider-default";; *) warn "Política de ferramentas: full-access — agentes podem executar código com acesso total." "Use JARVIS_AGENT_PERMISSION_MODE=provider-default para aprovações/sandbox do provedor.";; esac

# 3) Repo + deps
if [ -f "$REPO/package.json" ]; then
  pass "package.json do repo encontrado"
  if [ -d "$REPO/node_modules/tsx" ]; then pass "node_modules presentes (tsx instalado)"; else fail "node_modules ausentes (tsx não instalado)." "Rode 'npm install' na raiz do repo."; fi
else fail "Não parece um checkout do Jarvis ($REPO)." "Rode o doctor a partir do repositório clonado."; fi

# 4) Porta + /health (curl cobre 'está no ar' e 'tem a rota nova')
port_listen() { if have lsof; then lsof -iTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1; elif have ss; then ss -ltn 2>/dev/null | grep -q ":$1 "; else return 2; fi; }
if [ "$ROLE" = "hub" ]; then
  if have curl; then
    if H="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null)"; then
      echo "$H" | grep -q '"ok":true' && pass "/health OK ($H)" || warn "/health respondeu sem ok=true: $H"
    else
      if port_listen "$PORT"; then warn "Porta $PORT escutando mas /health não respondeu (404 = código antigo)." "Reinicie o Hub para carregar o código atual."; \
      else warn "Nada respondendo na $PORT." "Suba o Hub (scripts/start-hub.sh via serviço)."; fi
    fi
  else warn "curl ausente — não checei /health." "Instale curl para o doctor validar o Hub."; fi
fi

# 5) Config
if [ -d "$JDIR" ]; then
  pass "Diretório de estado $JDIR"
  if [ -f "$JDIR/auth.json" ]; then
    if grep -q '"claimed":[[:space:]]*true' "$JDIR/auth.json" 2>/dev/null; then pass "Auth já reivindicada (tem dono)"; else warn "Auth ainda sem dono (unclaimed)." "Pareie no app com o claim code (./scripts/jarvis.sh claimcode)."; fi
  elif [ "$ROLE" = "hub" ]; then warn "auth.json ausente (Hub ainda não subiu)." "Inicie o Hub uma vez para gerar auth + claim code."; fi
  if [ "$ROLE" = "runner" ]; then
    [ -f "$JDIR/runner.env" ] && pass "runner.env presente" || fail "runner.env ausente." "Rode scripts/install-runner.sh -h <hub> -t <token>."
    [ -n "${JARVIS_TOKEN:-}" ] && pass "JARVIS_TOKEN no ambiente" || warn "JARVIS_TOKEN fora do ambiente atual." "Normal se vier do runner.env no serviço; sem ele o Hub rejeita o registro."
  fi
else warn "Sem $JDIR ainda." "É criado no primeiro start do Hub/runner."; fi

# 6) Tailscale
if have tailscale; then tailscale status >/dev/null 2>&1 && pass "Tailscale ativo" || warn "Tailscale instalado mas sem status." "Rode 'tailscale up'."; \
else warn "Tailscale não encontrado." "Recomendado para acesso remoto seguro; LAN/local funciona sem."; fi

# 7) Autostart (systemd --user ou launchd)
SVC=$([ "$ROLE" = "hub" ] && echo "jarvis-hub" || echo "jarvis-runner")
LSVC=$([ "$ROLE" = "hub" ] && echo "com.jarvis.hub" || echo "com.jarvis.runner")
if have systemctl; then
  if systemctl --user is-active "$SVC" >/dev/null 2>&1; then pass "Serviço systemd '$SVC' ativo"; \
  elif systemctl --user list-unit-files 2>/dev/null | grep -q "$SVC"; then warn "Serviço '$SVC' registrado mas inativo." "systemctl --user start $SVC (e 'loginctl enable-linger' p/ sobreviver logout)."; \
  else warn "Serviço de autostart '$SVC' não registrado." "Rode scripts/install-hub.sh (hub) / install-runner.sh (runner)."; fi
elif have launchctl; then
  # `launchctl list | grep` só prova que o serviço está CARREGADO. O modo de falha mais comum num
  # Mac é justamente carregar e morrer: o LaunchAgent recebe PATH=/usr/bin:/bin:/usr/sbin:/sbin, não
  # encontra o npm, sai 127 e o launchd o reinicia para sempre — e o teste antigo dava PASS nisso.
  # `launchctl print` traz o estado real e o último código de saída.
  LOG="$JDIR/$([ "$ROLE" = "hub" ] && echo hub.log || echo runner.log)"
  if LINFO="$(launchctl print "gui/$(id -u)/$LSVC" 2>/dev/null)"; then
    LPID="$(printf '%s' "$LINFO" | sed -n 's/^[[:space:]]*pid = \([0-9][0-9]*\)$/\1/p' | head -1)"
    LLAST="$(printf '%s' "$LINFO" | sed -n 's/^[[:space:]]*last exit code = \([0-9][0-9]*\)$/\1/p' | head -1)"
    if [ -n "$LPID" ]; then pass "launchd '$LSVC' rodando (pid $LPID)"
    elif [ "${LLAST:-}" = "127" ]; then
      fail "launchd '$LSVC' carregado mas saindo com 127 (comando não encontrado)." "O LaunchAgent não herda seu PATH. Reinstale com scripts/install-hub.sh (ou install-runner.sh), que agora grava EnvironmentVariables>PATH no plist incluindo o diretório do npm — neste host seria $(dirname "$(command -v npm 2>/dev/null || echo /usr/local/bin/npm)")."
    else warn "launchd '$LSVC' carregado, sem processo (last exit ${LLAST:-?})." "Veja $LOG."; fi
  else warn "launchd '$LSVC' não carregado." "Rode o install-*.sh para registrar o autostart."; fi
else warn "Nem systemd nem launchd — autostart não verificável." "Você gerencia o processo manualmente."; fi

# 8) Voz (opcional; só no Hub)
#
# Reescrito porque a versão anterior dava PASS numa voz quebrada: ela checava `python3` enquanto o
# Hub spawnava `python` (que não existe em macOS), usava find_spec num interpretador que podia não
# ser o do Hub, e tratava o núcleo e os opcionais como uma coisa só. Agora quem resolve é o MESMO
# código do Hub (apps/hub/src/python.ts), para instalador, runtime e diagnóstico nunca divergirem.
if [ "$ROLE" = "hub" ]; then
  if have node && [ -d "$REPO/node_modules/tsx" ]; then
    PYOUT="$(cd "$REPO" && node --import tsx apps/hub/src/python.ts 2>/dev/null)"; PYRC=$?
    PYLINE="$(printf '%s\n' "$PYOUT" | sed -n 1p)"
    PYHINT="$(printf '%s\n' "$PYOUT" | sed -n 2p)"
    if [ -z "$PYLINE" ]; then
      warn "Voz: não consegui resolver o interpretador Python." "Opcional — o Hub roda em modo texto sem voz. Para habilitar: npm run install:voice"
    elif [ "$PYRC" -eq 0 ]; then
      pass "Voz: $PYLINE"
      # Núcleo ok mas algum opcional faltando (o caso do Mac Intel sem torch) é WARN, nunca FAIL:
      # qualquer FAIL faz o doctor sair 1, e voz é explicitamente opcional.
      [ -n "$PYHINT" ] && warn "Voz (parcial): $PYHINT" "npm run install:voice"
    else
      warn "Voz indisponível: $PYLINE" "${PYHINT:-npm run install:voice}"
    fi
    # O Hub lê JARVIS_PYTHON de ~/.jarvis/hub.env (start-hub.sh exporta com `set -a`). Sem essa
    # linha, um Hub sob launchd pode resolver um interpretador diferente do que o doctor viu aqui,
    # porque o PATH dos dois é diferente.
    if [ -f "$JDIR/hub.env" ] && ! grep -q '^[[:space:]]*JARVIS_PYTHON=' "$JDIR/hub.env" 2>/dev/null; then
      warn "JARVIS_PYTHON não está fixado em $JDIR/hub.env." "Sob launchd o PATH é pobre e o Hub pode achar outro Python. Rode npm run install:voice (grava a linha) ou adicione-a à mão."
    fi
  else
    # Sem node_modules não há como usar o resolvedor; faz o mínimo sem fingir diagnóstico.
    warn "Voz: não verificada (node_modules ausentes)." "Rode 'npm install' e depois o doctor de novo."
  fi
fi

echo
echo "${C}Resumo: $OK OK · $WARN avisos · $FAIL falhas${Z}"
if [ "$FAIL" -gt 0 ]; then echo "${R}Há falhas que bloqueiam o funcionamento — veja os -> acima.${Z}"; exit 1; \
elif [ "$WARN" -gt 0 ]; then echo "${Y}Funciona, com ressalvas.${Z}"; exit 0; \
else echo "${G}Tudo certo.${Z}"; exit 0; fi
