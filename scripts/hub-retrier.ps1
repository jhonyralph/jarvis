<#
  hub-retrier.ps1 - religa o servico JarvisHub quando o SCM ja desistiu.

  POR QUE EXISTE
  O JarvisHub roda como `.\Jonathan` com a senha gravada no SCM. Se a conta local estiver
  LOCKED OUT, todo start falha com os eventos 1069 + 1909 (ERROR_ACCOUNT_LOCKED_OUT) e o Hub
  simplesmente nao volta. Foi o que derrubou a maquina em 19/10 e em 22/10/2026 (INC-04).

  E o SCM nao se cura disso: as acoes de falha (restart 5 s / 10 s / 30 s) so disparam quando um
  servico que ESTAVA RODANDO termina - um start que falha por logon nao re-arma a cadeia. Na pratica
  as tentativas se esgotam em ~2 min, tudo DENTRO da janela de 10 min do lockout, e o servico fica
  `Stopped` indefinidamente ate alguem subir na mao.

  A SAIDA e um retrier EXTERNO, que nao dependa daquela conta: esta tarefa roda como
  NT AUTHORITY\SYSTEM (sem senha, logo imune ao lockout) e a cada poucos minutos da um
  `Start-Service`. Quando a duracao do lockout expira, o start seguinte pega e o Hub volta sozinho.

  O watchdog que ja existe NAO cobre este caso: ele vive dentro da arvore do proprio Hub, entao
  quando o servico nao sobe nao existe watchdog nenhum para reclamar.

  PRINCIPIOS DE DESENHO (por que ele nao atrapalha)
  . So age quando o servico esta `Stopped`. Nunca sonda a porta 4577: o boot do Hub leva de 85 a
    190 s com a porta fechada (INC-01, INC-04), e sondar porta daria "esta morto" durante um boot
    perfeitamente normal. `StartPending`/`Running` = nao mexe.
  . Respeita decisao de quem opera: `StartType` em Disabled ou Manual = nao mexe. Um reinicio
    normal (bandeja, update) termina em segundos, bem antes do proximo tique, entao o retrier nem
    chega a ver.
  . Teto de tentativas por hora, para nao mascarar um Hub em laco de crash: estourado o teto, ele
    registra e para de insistir.
  . Marcador de manutencao: se existir <StateDir>\hub-retrier-off, ele nao faz nada.

  Nao e chamado na mao - quem registra e `install-hub-retrier.ps1`, que passa -StateDir porque
  SYSTEM tem outro %USERPROFILE% e nao acharia o ~/.jarvis do usuario.
#>
param(
  [Parameter(Mandatory = $true)][string]$StateDir,
  [string]$ServiceName = 'JarvisHub',
  [int]$MaxPorHora = 5
)
$ErrorActionPreference = 'Stop'

$log       = Join-Path $StateDir 'hub-retrier.log'
$histStore = Join-Path $StateDir 'hub-retrier-state.json'
$pausa     = Join-Path $StateDir 'hub-retrier-off'

function Write-Log([string]$msg) {
  $linha = '[retrier] ' + (Get-Date -Format 'o') + ' ' + $msg
  try { Add-Content -Path $log -Value $linha -Encoding utf8 } catch { }
}

# Marcador de manutencao vence tudo: quem parou de proposito nao quer briga.
if (Test-Path $pausa) { exit 0 }

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Write-Log "servico $ServiceName nao existe - nada a fazer"; exit 0 }

# Running, StartPending, StopPending... qualquer coisa diferente de Stopped nao e problema nosso.
# Em especial: durante os ~166 s de boot o servico ja esta Running e a porta ainda fechada.
if ($svc.Status -ne 'Stopped') { exit 0 }

# Quem escolheu Manual/Disabled escolheu subir na mao.
$modo = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").StartMode
if ($modo -ne 'Auto') { Write-Log "servico Stopped mas StartMode=$modo - respeitando, nao subo"; exit 0 }

# ---------------------------------------------------------------- teto por hora
# Sem teto, um Hub que sobe e morre em 10 s viraria um laco de start eterno e o retrier esconderia
# o problema de verdade em vez de expor.
$agora  = Get-Date
$tentat = @()
if (Test-Path $histStore) {
  try {
    $raw = Get-Content $histStore -Raw -ErrorAction Stop | ConvertFrom-Json
    if ($raw.tentativas) { $tentat = @($raw.tentativas | ForEach-Object { [datetime]$_ }) }
  } catch { $tentat = @() }   # estado corrompido nao pode impedir a recuperacao
}
$tentat = @($tentat | Where-Object { $_ -gt $agora.AddHours(-1) })

if ($tentat.Count -ge $MaxPorHora) {
  Write-Log "$($tentat.Count) tentativas na ultima hora (teto $MaxPorHora) - desistindo; o Hub pode estar em laco de crash"
  exit 0
}

# ---------------------------------------------------------------- subir
$tentat += $agora
try {
  @{ tentativas = @($tentat | ForEach-Object { $_.ToString('o') }) } | ConvertTo-Json -Compress |
    Set-Content -Path $histStore -Encoding utf8
} catch { }   # nao conseguir gravar o historico nao justifica deixar o Hub no chao

Write-Log "servico Stopped com StartMode=Auto - tentando subir (tentativa $($tentat.Count)/$MaxPorHora nesta hora)"
try {
  Start-Service -Name $ServiceName -ErrorAction Stop
  Write-Log 'Start-Service OK - o Hub ainda leva ate ~190 s para responder /health'
} catch {
  # Caso tipico: 1909 ERROR_ACCOUNT_LOCKED_OUT. Nao e erro do retrier - e para isso que ele existe;
  # o proximo tique tenta de novo e, passada a duracao do lockout, pega.
  Write-Log ('Start-Service falhou: ' + $_.Exception.Message)
}
