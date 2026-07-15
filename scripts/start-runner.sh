#!/usr/bin/env sh
# Starts the Jarvis runner (used by launchd / systemd). Loads ~/.jarvis/runner.env.
set -a
[ -f "$HOME/.jarvis/runner.env" ] && . "$HOME/.jarvis/runner.env"
set +a
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec npm --prefix "$ROOT/apps/runner" start
