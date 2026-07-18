#!/usr/bin/env bash
# jarvis-setup.sh — guided first-run for a Jarvis HUB (macOS / Linux).
#
# Thin orchestrator over the existing pieces (does NOT reinvent OS specifics): writes hub.env, then
# delegates deps + service to install-hub.sh, waits for /health, shows the CLAIM CODE + phone hint,
# and ends with the doctor's verdict. Keeps an existing hub.env (no clobber).
#
#   ./scripts/jarvis-setup.sh
#   ./scripts/jarvis-setup.sh --agent codex --url https://meu-host --port 4577
#   ./scripts/jarvis-setup.sh --skip-start        # configure without starting
set -eu
AGENT=claude-code; URL=; PORT=4577; SKIP_START=0
while [ $# -gt 0 ]; do case "$1" in
  --agent) AGENT="$2"; shift 2;;
  --url)   URL="$2"; shift 2;;
  --port)  PORT="$2"; shift 2;;
  --skip-start) SKIP_START=1; shift;;
  *) echo "opção desconhecida: $1"; exit 2;;
esac; done

REPO="$(cd "$(dirname "$0")/.." && pwd)"
JDIR="${JARVIS_HOME:-$HOME}/.jarvis"
step() { echo; echo "==> $1"; }

echo; echo "Jarvis — setup guiado do Hub"

# 1) Node >= 22
if ! command -v node >/dev/null 2>&1; then echo "Node.js não encontrado. Instale Node >= 22 e rode de novo."; exit 1; fi
NV="$(node -v)"; MAJ="$(echo "$NV" | sed 's/^v//; s/\..*//')"
if [ "${MAJ:-0}" -lt 22 ] 2>/dev/null; then echo "Node $NV é antigo — precisa >= 22."; exit 1; fi
echo "  Node $NV"

# 2) hub.env primeiro (sem clobber) — install-hub.sh respeita um arquivo existente
step "Configuração ($JDIR/hub.env)"
mkdir -p "$JDIR"
if [ -f "$JDIR/hub.env" ]; then echo "  hub.env já existe — mantido."; else
  { echo "JARVIS_AGENT=$AGENT"; echo "JARVIS_PORT=$PORT";
    if [ -n "$URL" ]; then echo "JARVIS_PUBLIC_URL=$URL"; else echo "# JARVIS_PUBLIC_URL=https://<seu-host>  # p/ links de convite completos"; fi
  } > "$JDIR/hub.env"
  echo "  hub.env criado (agent=$AGENT, porta=$PORT)."
fi

# 3) Deps + serviço (delega ao instalador que já sabe launchd/systemd)
step "Dependências + serviço (install-hub.sh)"
sh "$REPO/scripts/install-hub.sh"

# 4) Espera o /health
if [ "$SKIP_START" -eq 0 ] && command -v curl >/dev/null 2>&1; then
  step "Aguardando o Hub responder"
  up=0; for _ in $(seq 1 20); do sleep 2; if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then up=1; break; fi; done
  [ "$up" -eq 1 ] && echo "  Hub no ar em http://localhost:$PORT" || echo "  Hub ainda não respondeu — o doctor abaixo ajuda a diagnosticar."
fi

# 5) Acesso
step "Acesso"
if [ -f "$JDIR/claim-code.txt" ]; then
  echo "  Abra http://localhost:$PORT e cole o CLAIM CODE na tela de pareamento:"
  echo "    $(tr -d '[:space:]' < "$JDIR/claim-code.txt")"
else
  echo "  Sem claim code (já reivindicado, ou o Hub não subiu ainda)."
  echo "  Para gerar um convite de dono:  ./scripts/jarvis.sh owner"
fi
echo "  Abrir no celular (Tailscale):  tailscale serve --bg http://127.0.0.1:$PORT"

# 6) Veredito final
step "Diagnóstico final"
sh "$REPO/scripts/jarvis-doctor.sh" hub || true
