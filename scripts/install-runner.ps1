<#
  install-runner.ps1 — install this machine as a Jarvis runner (Windows).

  Run from the cloned jarvis repo. Get -Hub and -Token from the Hub:
      .\scripts\jarvis.ps1 machine -label "Este PC"

  Uso:
      .\scripts\install-runner.ps1 -Hub "wss://<hub>/" -Token "<token>" -Label "Este PC"

  Pré-requisitos nesta máquina: Node >= 22, e `claude login` / `codex login`.
#>
param(
  [Parameter(Mandatory)][string]$Hub,
  [Parameter(Mandatory)][string]$Token,
  [string]$Label = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command node -EA SilentlyContinue)) { Write-Host 'Node.js não encontrado. Instale Node >= 22 e rode de novo.' -ForegroundColor Red; exit 1 }
$hasAgent = (Get-Command claude -EA SilentlyContinue) -or (Get-Command codex -EA SilentlyContinue)
if (-not $hasAgent) { Write-Host "Aviso: nenhum agente (claude/codex) encontrado. Instale e autentique pelo menos um nesta máquina." -ForegroundColor Yellow }

Write-Host 'Instalando dependências (npm install)...'
Set-Location $root
& npm.cmd install | Out-Null

$dir = Join-Path $env:USERPROFILE '.jarvis'
New-Item -ItemType Directory -Force $dir | Out-Null
$envFile = Join-Path $dir 'runner.env'
"JARVIS_HUB=$Hub`r`nJARVIS_TOKEN=$Token`r`nJARVIS_LABEL=`"$Label`"" | Set-Content -Encoding UTF8 $envFile
Write-Host "Config gravada em $envFile"

$startPs = Join-Path $root 'scripts\start-runner.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startPs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'JarvisRunner' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'JarvisRunner'
Write-Host 'Runner instalado e iniciado (task JarvisRunner). Deve aparecer no seletor de máquina do Hub.' -ForegroundColor Green
