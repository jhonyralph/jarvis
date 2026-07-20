<#
  install-runner.ps1 — install this machine as a Jarvis runner (Windows).

  Run from the cloned jarvis repo. Get -Hub and -Token from the Hub:
      .\scripts\jarvis.ps1 machine -label "Este PC"

  Uso:
      .\scripts\install-runner.ps1 -Hub "wss://<hub>/" -Token "<token>" -Label "Este PC"

  Pré-requisitos: Node >= 22 e ao menos uma CLI suportada/autenticada.
#>
param(
  [Parameter(Mandatory)][string]$Hub,
  [Parameter(Mandatory)][string]$Token,
  [string]$Label = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command node -EA SilentlyContinue)) { Write-Host 'Node.js nao encontrado. Instale Node >= 22 e rode de novo.' -ForegroundColor Red; exit 1 }
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 22) { Write-Host "Node.js >= 22 obrigatorio (encontrado: $(& node --version))." -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $root '.git'))) { Write-Host 'Este runner precisa ser instalado de um git clone para receber atualizacoes remotas.' -ForegroundColor Red; exit 1 }
& git -C $root remote get-url origin *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Git remote origin ausente. Configure-o antes de instalar o runner.' -ForegroundColor Red; exit 1 }
$env:GIT_TERMINAL_PROMPT = '0'
& git -C $root fetch --dry-run --quiet origin
if ($LASTEXITCODE -ne 0) { Write-Host 'O servico nao consegue acessar origin sem prompt. Corrija URL/credenciais do Git.' -ForegroundColor Red; exit 1 }
$agentCommands = @('claude','codex','gemini','cursor-agent','copilot','opencode','cline','qwen','cn','kiro-cli','agy','aider')
$hasAgent = $agentCommands | Where-Object { Get-Command $_ -EA SilentlyContinue } | Select-Object -First 1
if (-not $hasAgent) { Write-Host 'Aviso: nenhuma CLI suportada encontrada. Instale/autentique ao menos uma; veja docs/agent-parity-matrix.md.' -ForegroundColor Yellow }

Write-Host 'Instalando dependencias deterministicas e validando o checkout...'
Set-Location $root
$npmInstall = if (Test-Path (Join-Path $root 'package-lock.json')) { 'ci' } else { 'install' }
& npm.cmd $npmInstall | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "npm $npmInstall falhou." -ForegroundColor Red; exit 1 }
& npm.cmd run update:verify --if-present | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'A validacao do checkout falhou; o servico nao foi instalado.' -ForegroundColor Red; exit 1 }

$dir = Join-Path $env:USERPROFILE '.jarvis'
New-Item -ItemType Directory -Force $dir | Out-Null
$envFile = Join-Path $dir 'runner.env'
@(
  "JARVIS_HUB=$Hub"
  "JARVIS_TOKEN=$Token"
  "JARVIS_LABEL=$Label"
) | Set-Content -Encoding UTF8 $envFile
Write-Host "Config gravada em $envFile"

# O serviço tem que ser a ÚNICA instância. -MultipleInstances IgnoreNew só impede a *task* de
# duplicar; um `npm start` deixado num terminal continua vivo e registra com o mesmo runnerId —
# vira um zumbi que segue tailando sessões e sondando os agentes (é assim que uma máquina se
# enche de sessões descartáveis). Encerra a task e qualquer runner solto antes de registrar.
try { Stop-ScheduledTask -TaskName 'JarvisRunner' -ErrorAction Stop } catch { <# nao instalada ainda #> }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'apps[\\/]runner[\\/]src[\\/]index\.ts' } |
  ForEach-Object {
    Write-Host "Encerrando runner ja em execucao (pid $($_.ProcessId)) - o servico assume a partir de agora." -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

$startPs = Join-Path $root 'scripts\start-runner.ps1'
$taskArgs = @(
  '-NoProfile'
  '-WindowStyle'
  'Hidden'
  '-ExecutionPolicy'
  'Bypass'
  '-File'
  ('"{0}"' -f $startPs)
) -join ' '
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
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
Start-Sleep -Seconds 2
$task = Get-ScheduledTask -TaskName 'JarvisRunner' -ErrorAction SilentlyContinue
if (-not $task -or $task.State -ne 'Running') { Write-Host 'A tarefa foi criada, mas o supervisor do Runner nao permaneceu ativo. Consulte ~/.jarvis/runner.log.' -ForegroundColor Red; exit 1 }
Write-Host 'Runner instalado e iniciado (task JarvisRunner). Deve aparecer no seletor de maquina do Hub.' -ForegroundColor Green
