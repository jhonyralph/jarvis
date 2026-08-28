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

  DIREITO DE LOGON. Rodar como uma conta de usuario nao depende so da senha: o Windows exige
  SeServiceLogonRight ("Fazer logon como um servico") para aquela conta, e o sc.exe NAO concede
  esse direito - so a UI do services.msc concede junto. Sem ele o Start-Service falha com uma
  mensagem generica e o motivo real fica escondido no evento 7041 do log do Sistema. Este script
  concede o direito via LSA antes de subir o servico.

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
  $removidos = @()
  foreach ($n in @($SVC_HUB, $SVC_RUN)) { if (Get-Svc $n) { Write-Host "removendo servico $n"; Remove-Svc $n; $removidos += $n } }
  foreach ($n in @($SVC_HUB, $SVC_RUN)) {
    $t = Get-Tsk $n
    if (-not $t) { continue }
    if ($t.State -eq 'Disabled') { Enable-ScheduledTask -TaskName $n | Out-Null }
    # Reativar nao basta: remover o servico levou o processo junto, entao a tarefa tem que RODAR
    # agora. Sem isto, uma instalacao interrompida no meio (servico criado, tarefa so PARADA)
    # saia daqui sem Hub nenhum ate o proximo logon.
    if ($t.State -eq 'Disabled' -or $removidos -contains $n) {
      Start-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
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

# --------------------------------------- direito "Fazer logon como um servico"
# O sc.exe GRAVA a senha, mas NAO concede SeServiceLogonRight - so a UI do services.msc concede
# junto. Sem esse direito o SCM recusa o logon e o Start-Service falha com uma mensagem generica
# ("nao pode ser iniciado"); o motivo real so aparece no evento 7041 do log do Sistema.
# Concedido aqui via LSA (LsaAddAccountRights): cirurgico e idempotente, e nao mexe no resto da
# politica local - diferente do roundtrip export/import do secedit. Vale na hora, sem reboot.
if (-not ('JarvisLsa' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JarvisLsa {
  [StructLayout(LayoutKind.Sequential)]
  struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)]
  struct LSA_OBJECT_ATTRIBUTES {
    public int Length; public IntPtr RootDirectory; public IntPtr ObjectName;
    public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;
  }
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint LsaOpenPolicy(IntPtr system, ref LSA_OBJECT_ATTRIBUTES oa, uint access, out IntPtr policy);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint LsaAddAccountRights(IntPtr policy, byte[] sid, LSA_UNICODE_STRING[] rights, uint count);
  [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr policy);
  [DllImport("advapi32.dll")] static extern int LsaNtStatusToWinError(uint status);
  public static void Grant(byte[] sid, string right) {
    var oa = new LSA_OBJECT_ATTRIBUTES();
    oa.Length = Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES));
    IntPtr policy;
    uint st = LsaOpenPolicy(IntPtr.Zero, ref oa, 0x0010 | 0x0800, out policy);  // CREATE_ACCOUNT|LOOKUP_NAMES
    if (st != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(st));
    var r = new LSA_UNICODE_STRING[1];
    r[0].Buffer = Marshal.StringToHGlobalUni(right);
    r[0].Length = (ushort)(right.Length * 2);
    r[0].MaximumLength = (ushort)(right.Length * 2 + 2);
    try {
      st = LsaAddAccountRights(policy, sid, r, 1);
      if (st != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(st));
    } finally { Marshal.FreeHGlobal(r[0].Buffer); LsaClose(policy); }
  }
}
'@
}
try {
  $sid  = (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier])
  $sidB = New-Object byte[] $sid.BinaryLength
  $sid.GetBinaryForm($sidB, 0)
  [JarvisLsa]::Grant($sidB, 'SeServiceLogonRight')
  Write-Host "direito 'Fazer logon como um servico' concedido a $account." -ForegroundColor DarkGray
} catch {
  Write-Host "nao consegui conceder 'Fazer logon como um servico' a $account" -ForegroundColor Red
  Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'conceda a mao: secpol.msc > Politicas Locais > Atribuicao de direitos de usuario.' -ForegroundColor Yellow
  exit 1
}

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
# $ErrorActionPreference='Stop' faz um Start-Service recusado ABORTAR o script - e ai o rollback
# abaixo nunca roda, deixando voce sem Hub (tarefa ja parada, servico morto). Por isso o try.
$startErr = $null
try { Start-Service $SVC_HUB } catch { $startErr = $_ }
$ok = $false
if (-not $startErr) {
  for ($i = 0; $i -lt 60; $i++) {        # ate 120s: o boot deste Hub ja levou 94s uma vez
    Start-Sleep 2
    if (Get-NetTCPConnection -LocalPort 4577 -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
  }
}

if (-not $ok) {
  Write-Host ''
  Write-Host 'O servico NAO subiu. Desfazendo para nao te deixar sem Hub.' -ForegroundColor Red
  if ($startErr) { Write-Host "  erro: $($startErr.Exception.Message)" -ForegroundColor Red }
  # A mensagem do Start-Service e generica de proposito; o motivo do SCM esta no log do Sistema.
  try {
    Get-WinEvent -FilterHashtable @{
      LogName = 'System'; ProviderName = 'Service Control Manager'; Id = 7000, 7041
      StartTime = (Get-Date).AddMinutes(-5)
    } -ErrorAction Stop | Select-Object -First 2 | ForEach-Object {
      $motivo = (($_.Message -split '\r?\n') | Where-Object { $_.Trim() } | Select-Object -First 2) -join ' '
      Write-Host "  [SCM $($_.Id)] $motivo" -ForegroundColor DarkGray
    }
  } catch { Write-Host '  (nao consegui ler o log do Sistema)' -ForegroundColor DarkGray }
  Remove-Svc $SVC_HUB
  if ($taskHub) {
    # Se uma migracao anterior deu certo, a tarefa esta Disabled - e ai Start-ScheduledTask sozinho
    # falha e, com ErrorActionPreference='Stop', aborta o proprio rollback. Reabilita antes.
    Enable-ScheduledTask -TaskName $SVC_HUB -ErrorAction SilentlyContinue | Out-Null
    Start-ScheduledTask -TaskName $SVC_HUB -ErrorAction SilentlyContinue
    if ((Get-Tsk $SVC_HUB).State -ne 'Disabled') { Write-Host 'tarefa agendada devolvida ao ar.' -ForegroundColor Yellow }
    else { Write-Host "ATENCAO: nao devolvi a tarefa. Suba o Hub a mao: $root\scripts\start-hub.ps1" -ForegroundColor Red }
  }
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
  if ($taskRun) { Stop-ScheduledTask -TaskName $SVC_RUN -ErrorAction SilentlyContinue }
  # Mesma ordem do Hub: sobe, CONFIRMA, e so entao desativa a tarefa. Antes a tarefa era desativada
  # primeiro, e um Start-Service que falhasse abortava o script - sem servico E sem tarefa.
  $runErr = $null
  try { Start-Service $SVC_RUN } catch { $runErr = $_ }
  Start-Sleep 3
  if ($runErr -or (Get-Svc $SVC_RUN).Status -ne 'Running') {
    Write-Host 'O Runner NAO subiu. Desfazendo so o Runner (o Hub segue no ar).' -ForegroundColor Red
    if ($runErr) { Write-Host "  erro: $($runErr.Exception.Message)" -ForegroundColor Red }
    Remove-Svc $SVC_RUN
    if ($taskRun) {
      Enable-ScheduledTask -TaskName $SVC_RUN -ErrorAction SilentlyContinue | Out-Null
      Start-ScheduledTask -TaskName $SVC_RUN -ErrorAction SilentlyContinue
      Write-Host 'tarefa agendada JarvisRunner devolvida ao ar.' -ForegroundColor Yellow
    }
    Write-Host "veja $runLog" -ForegroundColor Yellow
  } else {
    Set-Service $SVC_RUN -StartupType Automatic
    if ($taskRun) { Disable-ScheduledTask -TaskName $SVC_RUN | Out-Null; Write-Host 'tarefa agendada JarvisRunner desativada (o servico assumiu).' }
  }
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
