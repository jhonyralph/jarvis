<#
  diagnose-lockout.ps1 - descobre QUEM esta travando a conta que o servico JarvisHub usa.

  POR QUE EXISTE (INC-04)
  O Hub nao volta de um restart quando a conta local esta locked out. Em 19/10 e 22/10/2026 a conta
  `Jonathan` chegou a BadPasswordAttempts = 10 (o limite da politica) e o servico ficou `Stopped`.
  Sem saber de onde vieram as 10 tentativas ruins, o problema repete.

  Descartado em 22/10 SEM elevacao: nao ha credencial salva para esta maquina (`cmdkey /list`), nem
  drive mapeado, nem share fora dos administrativos, RDP esta desabilitado (fDenyTSConnections=1),
  nenhuma regra de firewall de entrada para 445/3389/5985, e as tarefas JarvisHub/JarvisWake usam
  LogonType *Interactive* - que nao guarda senha e por isso nao gera logon falho. O unico consumidor
  de senha gravada nesta maquina e o proprio servico JarvisHub.

  O que falta e justamente o que exige elevacao: o log Security. O evento 4740 nomeia a maquina que
  causou o lockout e o 4625 diz o TIPO de logon e o processo - e e o tipo que aponta o culpado:

    tipo 2  interativo (teclado da maquina)        tipo 7  desbloqueio de tela
    tipo 3  rede / SMB (vem de outra maquina)      tipo 8  rede com senha em claro
    tipo 4  tarefa agendada                        tipo 10 RDP
    tipo 5  SERVICO  -> senha gravada no SCM esta errada
    tipo 11 credencial em cache

  SOMENTE LEITURA. Nao altera conta, politica, servico nem tarefa. Guarda uma copia em
  ~/.jarvis/evidence/<data>/ seguindo a convencao do INC-01.

  Uso (PowerShell COMO ADMINISTRADOR):
    .\scripts\diagnose-lockout.ps1
    .\scripts\diagnose-lockout.ps1 -Dias 14 -Conta Jonathan
#>
param(
  [string]$Conta = $env:USERNAME,
  [int]$Dias = 7,
  [string]$StateDir
)
$ErrorActionPreference = 'Continue'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Ler o log Security exige elevacao. Abra o PowerShell como Administrador e rode de novo.' -ForegroundColor Yellow
  exit 1
}

if (-not $StateDir) { $StateDir = Join-Path $env:USERPROFILE '.jarvis' }
$evid = Join-Path $StateDir ('evidence\' + (Get-Date -Format 'yyyy-MM-dd'))
New-Item -ItemType Directory -Force $evid | Out-Null
$saida = Join-Path $evid 'lockout-diagnostico.txt'

$TIPOS = @{
  '2'='interativo (teclado)'; '3'='rede/SMB (outra maquina)'; '4'='tarefa agendada';
  '5'='SERVICO (senha gravada no SCM)'; '7'='desbloqueio de tela'; '8'='rede em claro';
  '9'='newcredentials'; '10'='RDP'; '11'='credencial em cache'
}

function Emit([string]$s) { Write-Host $s; Add-Content -Path $saida -Value $s -Encoding utf8 }
function Dados($e) {
  # Via XML: os nomes dos campos sao estaveis, ao contrario da Message, que e traduzida.
  $d = @{}
  try { foreach ($n in ([xml]$e.ToXml()).Event.EventData.Data) { $d[$n.Name] = $n.InnerText } } catch { }
  return $d
}

Emit ('===== diagnostico de lockout  conta=' + $Conta + '  janela=' + $Dias + 'd  em ' + (Get-Date -Format 'o'))
Emit ''

# ---------------------------------------------------------------- 1. estado da conta
Emit '----- 1. estado da conta'
try {
  $u = [ADSI]"WinNT://./$Conta,user"
  $flags = [int]$u.Get('UserFlags')
  Emit ('BadPasswordAttempts : ' + $u.Get('BadPasswordAttempts'))
  Emit ('UserFlags           : ' + $flags + '  (UF_LOCKOUT=' + [bool]($flags -band 0x10) +
        ' PASSWD_NOTREQD=' + [bool]($flags -band 0x20) + ' DONT_EXPIRE_PASSWD=' + [bool]($flags -band 0x10000) + ')')
  Emit ('LastLogin           : ' + $u.Get('LastLogin'))
} catch { Emit ('nao consegui ler a conta via ADSI: ' + $_.Exception.Message) }
$lk = Get-CimInstance Win32_UserAccount -Filter "Name='$Conta' AND LocalAccount=True" -ErrorAction SilentlyContinue
if ($lk) { Emit ('Win32 Lockout       : ' + $lk.Lockout + '   Disabled: ' + $lk.Disabled) }
Emit ''
Emit '----- politica de bloqueio (net accounts)'
(net accounts) | ForEach-Object { Emit ('  ' + $_) }
Emit ''

# ---------------------------------------------------------------- 2. 4740 = quem travou
Emit '----- 2. eventos 4740 (conta travada) - o campo CallerComputerName e a pista principal'
$e4740 = Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4740; StartTime=(Get-Date).AddDays(-$Dias)} -ErrorAction SilentlyContinue
if (-not $e4740) { Emit '  (nenhum - se a auditoria de "Gerenciamento de contas" estiver off, nao e gravado)' }
foreach ($e in $e4740) {
  $d = Dados $e
  Emit ('  ' + $e.TimeCreated.ToString('o') + '  alvo=' + $d['TargetUserName'] + '  origem=' + $d['CallerComputerName'])
}
Emit ''

# ---------------------------------------------------------------- 3. 4625 = logons falhos
Emit '----- 3. eventos 4625 (logon falhou) agrupados por tipo + processo + origem'
$e4625 = @(Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4625; StartTime=(Get-Date).AddDays(-$Dias)} -ErrorAction SilentlyContinue |
  Where-Object { (Dados $_)['TargetUserName'] -eq $Conta })
if ($e4625.Count -eq 0) { Emit '  (nenhum para esta conta na janela - veja a auditoria de "Logon/Logoff")' }
$e4625 | ForEach-Object {
  $d = Dados $_
  $t = [string]$d['LogonType']
  [pscustomobject]@{
    Tipo      = $t + ' = ' + $(if ($TIPOS.ContainsKey($t)) { $TIPOS[$t] } else { '?' })
    Processo  = $d['ProcessName']
    Origem    = $(if ($d['WorkstationName']) { $d['WorkstationName'] } else { $d['IpAddress'] })
    Status    = $d['Status'] + '/' + $d['SubStatus']
  }
} | Group-Object Tipo, Processo, Origem | Sort-Object Count -Descending | ForEach-Object {
  $r = $_.Group[0]
  Emit ('  ' + $_.Count.ToString().PadLeft(4) + 'x  tipo=' + $r.Tipo + '  proc=' + $r.Processo + '  origem=' + $r.Origem + '  status=' + $r.Status)
}
Emit ''

# ---------------------------------------------------------------- 4. 4776 = validacao NTLM
Emit '----- 4. eventos 4776 (validacao de credencial) com erro, por workstation'
$e4776 = @(Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4776; StartTime=(Get-Date).AddDays(-$Dias)} -ErrorAction SilentlyContinue |
  Where-Object { $d = Dados $_; $d['TargetUserName'] -eq $Conta -and $d['Status'] -ne '0x0' })
if ($e4776.Count -eq 0) { Emit '  (nenhum com erro)' }
$e4776 | ForEach-Object { $d = Dados $_; [pscustomobject]@{ W = $d['Workstation']; S = $d['Status'] } } |
  Group-Object W, S | Sort-Object Count -Descending | ForEach-Object {
    Emit ('  ' + $_.Count.ToString().PadLeft(4) + 'x  workstation=' + $_.Group[0].W + '  status=' + $_.Group[0].S)
  }
Emit ''

# ---------------------------------------------------------------- 5. SCM
Emit '----- 5. Service Control Manager, linhas do Jarvis (1069 = logon falhou, 1909 = conta travada)'
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'; StartTime=(Get-Date).AddDays(-$Dias)} -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'Jarvis' } | Select-Object -First 40 | ForEach-Object {
    Emit ('  ' + $_.TimeCreated.ToString('o') + '  id=' + $_.Id + '  ' + (($_.Message -split "`r?`n")[0]))
  }
Emit ''
Emit ('===== copia salva em ' + $saida)
