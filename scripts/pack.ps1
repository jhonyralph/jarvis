# Produce a distributable package of Jarvis WITHOUT a git remote.
# Copy the .tgz to the other machine, extract it, then run scripts\install-*.
$root = Split-Path $PSScriptRoot -Parent
$out = if ($args[0]) { $args[0] } else { Join-Path $root 'jarvis-dist.tgz' }
Set-Location $root
git archive --format=tar.gz -o $out HEAD
Write-Host "Pacote: $out"
Write-Host "Na outra máquina:  mkdir jarvis; tar -xzf jarvis-dist.tgz -C jarvis; cd jarvis"
