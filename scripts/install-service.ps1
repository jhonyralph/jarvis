<#
  install-service.ps1 - instala o Hub (e o Runner) como SERVICO DO WINDOWS de verdade.

  POR QUE
  O Linux (systemd --user) e o macOS (launchd) deste repo ja usam o gerenciador de servicos do
  sistema. So o Windows ficava no Agendador de Tarefas com um while($true) em PowerShell fazendo de
  supervisor - e isso custava tres coisas:
    . janela de console visivel (o Agendador roda na sessao do usuario e ALOCA console; o Windows
      Terminal, sendo o terminal padrao, hospeda esse console numa janela que -WindowStyle Hidden
      nao controla). Servico roda na sessao 0: janela nao existe por construcao;
    . Stop-ScheduledTask nao parava o Hub - o supervisor sobrevivia e relancava o processo;
    . reinicio-em-falha artesanal, quando o SCM ja oferece isso pronto.
  Depois disto: services.msc, Start-Service/Stop-Service, tipo de inicializacao e recuperacao
  automatica - tudo pelo mecanismo padrao do sistema.

  SEM DOWNLOAD. Os instaladores do Jarvis sao offline por decisao. O host do servico e compilado
  aqui, na hora, pelo compilador que ja vem no .NET Framework, a partir de
  ops/windows-service/JarvisService.cs (auditavel).

  MIGRACAO SEGURA. Nunca te deixa sem Hub: cria o servico como Manual, para a tarefa, sobe o
  servico, CONFIRMA pela porta 4577 e so entao promove para Automatico e desativa a tarefa. Se a
  confirmacao falhar, desfaz tudo e devolve a tarefa ao ar.

  Uso (PowerShell COMO ADMINISTRADOR):
    .\scripts\install-service.ps1              # Hub
    .\scripts\install-service.ps1 -Runner      # Hub + Runner
    .\scripts\install-service.ps1 -Uninstall   # volta para o Agendador de Tarefas
#>
param([switch]$Runner, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Criar servico exige elevacao. Abra o PowerShell como Administrador e rode de novo.' -ForegroundColor Yellow
  exit 1
}

$root    = Split-Path $PSScriptRoot -Parent
$binDir  = Join-Path $env:USERPROFILE '.jarvis\bin'
$hostExe = Join-Path $binDir 'JarvisService.exe'
$hubLog  = Join-Path $env:USERPROFILE '.jarvis\hub.log'
$runLog  = Join-Path $env:USERPROFILE '.jarvis\runner.log'
$SVC_HUB = 'JarvisHub'
$SVC_RUN = 'JarvisRunner'    # mesmos nomes das tarefas: servico e tarefa nunca coexistem

function Get-Svc([string]$n) { Get-Service -Name $n -ErrorAction SilentlyContinue }
function Get-Tsk([string]$n) { Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue }
function Remove-Svc([string]$n) {
  if (Get-Svc $n) { Stop-Service $n -Force -ErrorAction SilentlyContinue; & sc.exe delete $n | Out-Null; Start-Sleep 2 }
}

# ---------------------------------------------------------------- desinstalar
if ($Uninstall) {
  foreach ($n in @($SVC_HUB, $SVC_RUN)) { if (Get-Svc $n) { Write-Host "removendo servico $n"; Remove-Svc $n } }
  foreach ($n in @($SVC_HUB, $SVC_RUN)) {
    $t = Get-Tsk $n
    if ($t -and $t.State -eq 'Disabled') {
      Enable-ScheduledTask -TaskName $n | Out-Null
      Start-ScheduledTask -TaskName $n
      Write-Host "tarefa $n reativada"
    }
  }
  Write-Host 'Voltou para o Agendador de Tarefas.' -ForegroundColor Green
  exit 0
}

# ------------------------------------------------------- compilar o host (offline)
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { Write-Host "compilador do .NET Framework nao encontrado em $csc" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force $binDir | Out-Null
$src = Join-Path $root 'ops\windows-service\JarvisService.cs'
Write-Host 'compilando o host do servico...'
& $csc /nologo /target:exe /platform:anycpu /optimize+ /out:"$hostExe" /reference:System.ServiceProcess.dll "$src"
if (-not (Test-Path $hostExe)) { Write-Host 'falhou ao compilar o host' -ForegroundColor Red; exit 1 }

# ------------------------------------------------------- credencial da conta
# O servico precisa rodar COMO VOCE: senao perde ~/.claude, credenciais do git, PATH e o perfil todo.
# O Windows exige que a senha seja gravada pelo SCM na criacao - e uma vez so.
$account = "$env:USERDOMAIN\$env:USERNAME"
Write-Host ''
Write-Host "O servico vai rodar como $account (necessario para as credenciais e o perfil)." -ForegroundColor Cyan
$sec = Read-Host "Senha do Windows de $account" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $plain) { Write-Host 'senha vazia - abortado' -ForegroundColor Red; exit 1 }

$ps = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"

function New-JarvisService([string]$name, [string]$script, [string]$log, [string]$display) {
  Remove-Svc $name
  $q = [char]34
  $bin = "$q$hostExe$q $name $q$ps$q $q$root$q $q$log$q -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $q$root\scripts\$script$q -Once"
  & sc.exe create $name binPath= $bin obj= $account password= $plain start= demand DisplayName= $display | Out-Null
  if (-not (Get-Svc $name)) { throw "nao consegui criar o servico $name" }
  & sc.exe description $name "Jarvis - mantido pelo SCM; substitui a tarefa agendada de mesmo nome." | Out-Null
  # Recuperacao automatica: e isto que aposenta o while($true) do supervisor.
  & sc.exe failure $name reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
  & sc.exe failureflag $name 1 | Out-Null
}

Write-Host ''
Write-Host "criando servico $SVC_HUB (Manual por enquanto)..."
New-JarvisService $SVC_HUB 'start-hub.ps1' $hubLog 'Jarvis Hub'

# ------------------------------------------------------- migracao verificada
$taskHub = Get-Tsk $SVC_HUB
if ($taskHub) { Write-Host 'parando a tarefa agendada e o supervisor...'; Stop-ScheduledTask -TaskName $SVC_HUB -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'start-hub\.ps1' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$conn = Get-NetTCPConnection -LocalPort 4577 -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep 3

Write-Host 'subindo o servico e confirmando na porta 4577...'
Start-Service $SVC_HUB
$ok = $false
for ($i = 0; $i -lt 60; $i++) {          # ate 120s: o boot deste Hub ja levou 94s uma vez
  Start-Sleep 2
  if (Get-NetTCPConnection -LocalPort 4577 -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
}

if (-not $ok) {
  Write-Host ''
  Write-Host 'O servico NAO subiu. Desfazendo para nao te deixar sem Hub.' -ForegroundColor Red
  Remove-Svc $SVC_HUB
  if ($taskHub) { Start-ScheduledTask -TaskName $SVC_HUB; Write-Host 'tarefa agendada devolvida ao ar.' -ForegroundColor Yellow }
  Write-Host "veja $hubLog" -ForegroundColor Yellow
  exit 1
}

Set-Service $SVC_HUB -StartupType Automatic
if ($taskHub) { Disable-ScheduledTask -TaskName $SVC_HUB | Out-Null; Write-Host 'tarefa agendada JarvisHub desativada (o servico assumiu).' }

if ($Runner) {
  Write-Host ''
  Write-Host "criando servico $SVC_RUN..."
  New-JarvisService $SVC_RUN 'start-runner.ps1' $runLog 'Jarvis Runner'
  $taskRun = Get-Tsk $SVC_RUN
  if ($taskRun) { Stop-ScheduledTask -TaskName $SVC_RUN -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName $SVC_RUN | Out-Null }
  Set-Service $SVC_RUN -StartupType Automatic
  Start-Service $SVC_RUN
}

$plain = $null
Write-Host ''
Write-Host 'Pronto. O Hub agora e um servico do Windows.' -ForegroundColor Green
Write-Host '  services.msc          -> Jarvis Hub'
Write-Host '  Stop-Service  JarvisHub'
Write-Host '  Start-Service JarvisHub'
Write-Host '  Set-Service   JarvisHub -StartupType Manual   # nao subir com o sistema'
Write-Host ''
Write-Host 'Para voltar atras:  .\scripts\install-service.ps1 -Uninstall' -ForegroundColor DarkGray
