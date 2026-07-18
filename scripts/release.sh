#!/usr/bin/env bash
# release.sh — cut a versioned Jarvis release (macOS / Linux).
#
# Bumps the ONE source of truth (root package.json `version`, read everywhere via @jarvis/core
# VERSION), rebuilds the offline tarball (pack.sh), and tags git — so "install v0.2.0" is
# reproducible. Requires a CLEAN tree; prints the push command, never pushes for you.
#
#   ./scripts/release.sh 0.2.0
#   ./scripts/release.sh 0.2.0 --dry-run
set -eu
VERSION="${1:-}"; DRY=0; [ "${2:-}" = "--dry-run" ] && DRY=1
REPO="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO"

case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) : ;;
  *) echo "Versão inválida '$VERSION' — use semver, ex. 0.2.0."; exit 1;;
esac
TAG="v$VERSION"

[ -n "$(git status --porcelain)" ] && { echo "Árvore de trabalho suja — commite ou descarte antes de release."; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1 && { echo "Tag $TAG já existe."; exit 1; }

CUR="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
echo "Release: ${CUR:-?} -> $VERSION  (tag $TAG)"
if [ "$DRY" -eq 1 ]; then echo "[dry-run] atualizaria package.json, rodaria pack.sh, commit + tag."; exit 0; fi

# 1) bump (primeira ocorrência de "version": no root package.json)
#    sed portátil (BSD/GNU): reescreve via arquivo temporário.
awk 'NR==1{done=0} !done && /"version"[[:space:]]*:/ { sub(/"version"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"version\": \"'"$VERSION"'\""); done=1 } { print }' package.json > package.json.tmp && mv package.json.tmp package.json

# 2) tarball offline
echo 'Gerando o tarball (pack.sh)…'
sh "$REPO/scripts/pack.sh"

# 3) commit + tag anotada
git add package.json
git commit -m "release: $TAG" >/dev/null
git tag -a "$TAG" -m "Jarvis $TAG"
echo
echo "OK: $TAG criada localmente."
echo "  Publique com:  git push && git push origin $TAG"
