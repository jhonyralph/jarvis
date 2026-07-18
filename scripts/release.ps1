<#
  release.ps1 — cut a versioned Jarvis release (Windows).

  Bumps the ONE source of truth (root package.json `version`, which /health, the runner register info
  and the MCP banner all read via @jarvis/core VERSION), rebuilds the offline tarball, and tags git —
  so "install v0.2.0" is reproducible instead of "clone main from some day".

  Requires a CLEAN working tree (it only commits the version bump). Prints the push command; never
  pushes for you.

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts\release.ps1 0.2.0
    powershell -ExecutionPolicy Bypass -File scripts\release.ps1 0.2.0 -DryRun   # mostra o que faria
#>
param([Parameter(Mandatory = $true, Position = 0)][string]$Version, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

if ($Version -notmatch '^\d+\.\d+\.\d+([-.].+)?$') { Write-Host "Versão inválida '$Version' — use semver, ex. 0.2.0." -ForegroundColor Red; exit 1 }
$tag = "v$Version"

# Árvore limpa: o release só deve commitar o bump, nada mais.
if (git status --porcelain) { Write-Host 'Árvore de trabalho suja — commite ou descarte as mudanças antes de release.' -ForegroundColor Red; exit 1 }
if (git rev-parse -q --verify "refs/tags/$tag" 2>$null) { Write-Host "Tag $tag já existe." -ForegroundColor Red; exit 1 }

$pkgPath = Join-Path $repo 'package.json'
$cur = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
Write-Host "Release: $cur -> $Version  (tag $tag)" -ForegroundColor Cyan

if ($DryRun) { Write-Host '[dry-run] atualizaria package.json, rodaria pack.ps1, commit + tag.' -ForegroundColor Yellow; exit 0 }

# 1) bump da versão (regex no texto cru — preserva a formatação do JSON)
$raw = Get-Content $pkgPath -Raw
$raw = [regex]::Replace($raw, '("version"\s*:\s*")[^"]*(")', "`${1}$Version`${2}", 1)
[System.IO.File]::WriteAllText($pkgPath, $raw)

# 2) tarball offline (committed tree, sem node_modules)
Write-Host 'Gerando o tarball (pack.ps1)…' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'pack.ps1')

# 3) commit do bump + tag anotada
git add package.json
git commit -m "release: $tag" | Out-Null
git tag -a $tag -m "Jarvis $tag"
Write-Host ''
Write-Host "OK: $tag criada localmente." -ForegroundColor Green
Write-Host "  Publique com:  git push && git push origin $tag" -ForegroundColor DarkGray
