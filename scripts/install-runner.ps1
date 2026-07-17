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

# O serviço tem que ser a ÚNICA instância. -MultipleInstances IgnoreNew só impede a *task* de
# duplicar; um `npm start` deixado num terminal continua vivo e registra com o mesmo runnerId —
# vira um zumbi que segue tailando sessões e sondando os agentes (é assim que uma máquina se
# enche de sessões descartáveis). Encerra a task e qualquer runner solto antes de registrar.
try { Stop-ScheduledTask -TaskName 'JarvisRunner' -ErrorAction Stop } catch { <# nao instalada ainda #> }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'apps[\\/]runner[\\/]src[\\/]index\.ts' } |
  ForEach-Object {
    Write-Host "Encerrando runner já em execução (pid $($_.ProcessId)) — o serviço assume a partir de agora." -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

$startPs = Join-Path $root 'scripts\start-runner.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startPs`""
# -User $env:USERNAME é o que permite registrar SEM admin: um trigger AtLogOn genérico (sem -User)
# exige elevação; especificar "rode como EU MESMO" é permitido a qualquer usuário padrão. Testado
# e confirmado nesta máquina sem sessão elevada (mesmo padrão do install-autostart.ps1 do Hub).
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# RestartCount é backstop caso o supervisor (start-runner.ps1) morra; o self-heal do node
# fica no loop do launcher. IgnoreNew evita instância dupla quando o logon dispara de novo.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'JarvisRunner' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
# Confirma que a tarefa existe de fato antes de declarar sucesso — Register/Start emitem
# erros não-terminantes que escapavam do -ErrorAction Stop e faziam o script mentir "instalado".
if (-not (Get-ScheduledTask -TaskName 'JarvisRunner' -ErrorAction SilentlyContinue)) {
  Write-Host 'Falha ao registrar a tarefa JarvisRunner.' -ForegroundColor Red
  exit 1
}
Start-ScheduledTask -TaskName 'JarvisRunner'
Write-Host 'Runner instalado e iniciado (task JarvisRunner). Deve aparecer no seletor de máquina do Hub.' -ForegroundColor Green
