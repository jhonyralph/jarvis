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
exec npm --prefix "$ROOT/apps/hub" start
