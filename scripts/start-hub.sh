#!/usr/bin/env sh
# Jarvis Hub launcher (macOS/Linux) — used by launchd/systemd. Warms the Claude token
# (only the CLI can refresh it) then runs the Hub. Optional config: ~/.jarvis/hub.env.
set -a
[ -f "$HOME/.jarvis/hub.env" ] && . "$HOME/.jarvis/hub.env"
set +a
: "${JARVIS_AGENT:=claude-code}"
: "${JARVIS_SEARCH_MODEL:=haiku}"
: "${JARVIS_AUTH:=on}"
export JARVIS_AGENT JARVIS_SEARCH_MODEL JARVIS_AUTH
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$HOME/.jarvis/oneshot"

# warm the Claude OAuth token (best-effort, time-capped) so /v1/models + agents work at boot
if command -v claude >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    ( cd "$HOME/.jarvis/oneshot" && printf 'ping' | timeout 90 claude -p --model haiku >/dev/null 2>&1 ) || true
  else
    ( cd "$HOME/.jarvis/oneshot" && printf 'ping' | claude -p --model haiku >/dev/null 2>&1 ) || true
  fi
fi

cd "$ROOT"
exec npm --prefix "$ROOT/apps/hub" start
