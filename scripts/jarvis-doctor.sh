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
echo

# 1) Node >= 22
if have node; then
  NV="$(node -v 2>/dev/null)"; MAJ="$(echo "$NV" | sed 's/^v//; s/\..*//')"
  if [ "${MAJ:-0}" -ge 22 ] 2>/dev/null; then pass "Node $NV"; else fail "Node $NV é antigo (precisa >= 22)." "Atualize o Node para 22+ (o hub/runner roda via tsx)."; fi
else fail "Node.js não encontrado no PATH." "Instale Node >= 22 (nodejs.org)."; fi

# 2) Agent CLI presente (login não é checável sem gastar um turno)
ANY=0
for a in claude codex; do if have "$a"; then pass "Agent CLI '$a' no PATH"; ANY=1; fi; done
if [ "$ANY" -eq 0 ]; then fail "Nenhuma CLI de agente (claude/codex) no PATH." "Instale ao menos uma e faça login (ex.: 'claude login')."; \
else warn "Login da CLI não é verificável aqui." "Se os turnos derem 401, rode 'claude login' / 'codex login' nesta máquina."; fi

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
  launchctl list 2>/dev/null | grep -q "$LSVC" && pass "launchd '$LSVC' carregado" || warn "launchd '$LSVC' não carregado." "Rode o install-*.sh para registrar o autostart."
else warn "Nem systemd nem launchd — autostart não verificável." "Você gerencia o processo manualmente."; fi

# 8) Voz (opcional; só no Hub)
if [ "$ROLE" = "hub" ]; then
  PY="${JARVIS_PYTHON:-python3}"; have "$PY" || PY=python
  if have "$PY"; then
    MODS="$($PY -c "import importlib.util as u; print(','.join(m for m in ['piper','faster_whisper','openwakeword'] if u.find_spec(m)))" 2>/dev/null)"
    [ -n "$MODS" ] && pass "Voz: Python + módulos [$MODS]" || warn "Voz: Python presente, sem piper/faster_whisper/openwakeword." "Opcional — para voz: pip install -r services/voice/requirements.txt"
  else warn "Voz: Python não encontrado." "Opcional — o Hub roda em modo texto sem voz."; fi
fi

echo
echo "${C}Resumo: $OK OK · $WARN avisos · $FAIL falhas${Z}"
if [ "$FAIL" -gt 0 ]; then echo "${R}Há falhas que bloqueiam o funcionamento — veja os -> acima.${Z}"; exit 1; \
elif [ "$WARN" -gt 0 ]; then echo "${Y}Funciona, com ressalvas.${Z}"; exit 0; \
else echo "${G}Tudo certo.${Z}"; exit 0; fi
