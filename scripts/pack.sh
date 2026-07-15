#!/usr/bin/env sh
# Produce a distributable package of Jarvis WITHOUT needing a git remote.
# Copy the .tgz to the other machine, extract it, then run scripts/install-*.
# (git archive = the committed tree only — no node_modules, no .git; the target
#  runs `npm install` during install.)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/jarvis-dist.tgz}"
( cd "$ROOT" && git archive --format=tar.gz -o "$OUT" HEAD )
echo "Pacote: $OUT"
echo "Na outra máquina:  mkdir jarvis && tar -xzf jarvis-dist.tgz -C jarvis && cd jarvis"
