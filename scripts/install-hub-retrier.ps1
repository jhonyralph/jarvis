<#
  install-hub-retrier.ps1 - registra o retrier EXTERNO do Hub como tarefa do SYSTEM.

  O PROBLEMA (INC-04, 19/10 e 22/10/2026)
  O servico JarvisHub roda como `.\Jonathan` com a senha gravada no SCM. Quando a conta local fica
  LOCKED OUT, todo start falha (eventos 1069 + 1909 = ERROR_ACCOUNT_LOCKED_OUT) e o SCM desiste em
  ~2 min - tudo dentro da janela de 10 min do lockout. O servico fica `Stopped` e o Hub nao volta
  ate alguem subir na mao. O watchdog interno nao salva: ele vive dentro da arvore do Hub.

  A CORRECAO
  Uma tarefa agendada que NAO dependa daquela conta. Esta roda como NT AUTHORITY\SYSTEM
  (LogonType ServiceAccount: sem senha gravada, logo imune ao lockout) e chama `hub-retrier.ps1`
  a cada -IntervaloMin minutos. Passada a duracao do lockout, o start seguinte pega sozinho.

  POR QUE SYSTEM E NAO O USUARIO. Uma tarefa rodando *como* Jonathan tambem nao roda com a conta
  travada - seria o mesmo buraco. E SYSTEM pode dar Start-Service sem depender do ACL do servico.

  POR QUE UM INTERVALO DE 3 MIN. A duracao do lockout aqui e de 10 min (`net accounts`), entao
  qualquer intervalo abaixo disso garante que uma tentativa caia depois da expiracao. 3 min deixa
  margem e ainda e MAIOR que um reinicio normal do Hub, que termina em segundos - assim o retrier
  nunca disputa com a bandeja nem com o update.

  Toda a logica de quando agir (e de quando NAO agir) vive no hub-retrier.ps1, de proposito: da
  para corrigir o comportamento editando um arquivo, sem reinstalar a tarefa.

  Uso (PowerShell COMO ADMINISTRADOR):
    .\scripts\install-hub-retrier.ps1              # instala / reinstala
    .\scripts\install-hub-retrier.ps1 -Uninstall   # remove
#>
param(
  [switch]$Uninstall,
  [int]$IntervaloMin = 3,
  [string]$StateDir,
  [string]$TaskName = 'JarvisHubRetrier'
)
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Registrar tarefa do SYSTEM exige elevacao. Abra o PowerShell como Administrador e rode de novo.' -ForegroundColor Yellow
  exit 1
}

# ---------------------------------------------------------------- desinstalar
if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "tarefa $TaskName removida." -ForegroundColor Green
  } else {
    Write-Host "tarefa $TaskName nao estava registrada."
  }
  Write-Host 'ATENCAO: sem o retrier, um lockout da conta deixa o Hub no chao ate alguem subir na mao.' -ForegroundColor Yellow
  exit 0
}

# ---------------------------------------------------------------- caminhos
if (-not $StateDir) { $StateDir = Join-Path $env:USERPROFILE '.jarvis' }
$worker = Join-Path $PSScriptRoot 'hub-retrier.ps1'
$pwsh   = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path $worker))   { Write-Host "nao achei o worker em $worker" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $StateDir)) { Write-Host "nao achei o diretorio de estado em $StateDir" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $pwsh))     { Write-Host "nao achei o powershell.exe em $pwsh" -ForegroundColor Red; exit 1 }

Write-Host "worker    : $worker"
Write-Host "StateDir  : $StateDir"
Write-Host "intervalo : $IntervaloMin min"

# ---------------------------------------------------------------- montar a tarefa
$arg = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -StateDir "{1}"' -f $worker, $StateDir
$act = New-ScheduledTaskAction -Execute $pwsh -Argument $arg

# Dois gatilhos: um pega o boot da maquina, o outro cobre a maquina ja ligada. Sem o AtStartup, um
# lockout que atravessasse um reboot ficaria sem ninguem para religar o Hub.
$gBoot = New-ScheduledTaskTrigger -AtStartup
$intervalo = New-TimeSpan -Minutes $IntervaloMin
try {
  # MaxValue = "indefinidamente" no Agendador. Algumas builds recusam, por isso o fallback.
  $gLoop = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
             -RepetitionInterval $intervalo -RepetitionDuration ([TimeSpan]::MaxValue)
} catch {
  Write-Host 'esta build recusou duracao indefinida - usando 3650 dias' -ForegroundColor Yellow
  $gLoop = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
             -RepetitionInterval $intervalo -RepetitionDuration (New-TimeSpan -Days 3650)
}

$prin = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest

# IgnoreNew: se um tique demorar, o seguinte nao empilha outra instancia em cima.
# ExecutionTimeLimit: um Start-Service pendurado nao pode travar a tarefa para sempre.
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
         -StartWhenAvailable -MultipleInstances IgnoreNew `
         -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "tarefa $TaskName ja existia - substituindo"
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger @($gBoot, $gLoop) `
  -Principal $prin -Settings $set `
  -Description 'Jarvis - religa o servico JarvisHub quando o SCM desiste (tipicamente lockout da conta; INC-04).' | Out-Null

# ---------------------------------------------------------------- confirmar
$t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $t) { Write-Host 'a tarefa nao apareceu depois de registrada' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host "tarefa $TaskName registrada." -ForegroundColor Green
Write-Host ("  conta     : " + $t.Principal.UserId + " (" + $t.Principal.LogonType + ")")
Write-Host ("  estado    : " + $t.State)
Write-Host ("  gatilhos  : " + $t.Triggers.Count)
Write-Host ''
Write-Host "log         : $(Join-Path $StateDir 'hub-retrier.log')"
Write-Host "pausar      : crie $(Join-Path $StateDir 'hub-retrier-off')  (e apague para religar)"
