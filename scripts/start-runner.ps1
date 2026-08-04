# Jarvis Runner launcher — tarefa agendada "JarvisRunner".
#
# SUPERVISOR: mantém o runner SEMPRE de pé. Se o node cair (crash, queda de conexão, ou
# o auto-update reiniciando pra aplicar código novo), o loop ressuscita em ~3s. Como tsx
# roda direto do source, o restart já pega o código atualizado. Paridade com o launchd
# (KeepAlive) do macOS e o systemd (Restart=always) do Linux. Log em ~/.jarvis/runner.log.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$log  = Join-Path $env:USERPROFILE '.jarvis\runner.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
# -Encoding Unicode (UTF-16LE) para casar com a saída do node por `*>>` (UTF-16LE no PS 5.1) e não
# gerar um log com encoding misto (ANSI + UTF-16) ilegível.
function Log($m) { Add-Content -Path $log -Encoding Unicode -Value ("[launcher] {0} {1}" -f (Get-Date -Format o), $m) }

# Instância única (paridade com o mutex JarvisHubSupervisor do Hub). Diferente do Hub, o runner NÃO
# abre porta, então NÃO há guarda de porta de reserva — o mutex é a ÚNICA trava. Sem ele, um 2º
# supervisor (2º logon, política de restart da task, ou handoff de update) roda em paralelo e cada um
# spawna seu runner, acumulando processos node (foi a causa dos ~13 processos / 48% de CPU na Luby).
# Local (sem Global): os lançadores rodam na sessão interativa do mesmo usuário. Fail-open: se o mutex
# não puder ser criado, seguimos SEM trava — um runner de pé, mesmo duplicado, é melhor que nenhum.
try {
  $script:RunnerMutexCreated = $false
  $script:RunnerMutex = New-Object System.Threading.Mutex($true, 'JarvisRunnerSupervisor', [ref]$script:RunnerMutexCreated)
  if (-not $script:RunnerMutexCreated) { Log 'outro supervisor de runner ja ativo (mutex) - este encerra'; return }
} catch { Log "mutex indisponivel ($($_.Exception.Message)) - seguindo sem trava de instancia" }

# garante que node/npm/CLIs resolvem, independente do PATH da tarefa
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:PATH"

$envFile = Join-Path $env:USERPROFILE '.jarvis\runner.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), 'Process') }
  }
}
$stateRoot = if ($env:JARVIS_HOME) { $env:JARVIS_HOME } else { $env:USERPROFILE }
$updateLock = Join-Path $stateRoot '.jarvis\runner-update.lock'
# `npm start` aqui seria `npm.cmd`, um batch — e chamar batch faz nascer um cmd.exe intermediário
# só pra encadear o node. É um console a mais que a task precisa manter escondido; se qualquer
# elo perder o -WindowStyle Hidden, ele vira janela na cara do usuário. Chamamos o tsx direto pelo
# node (mesmo comando que o `npm start` roda: `tsx src/index.ts`), sem camada nenhuma no meio.
# Fallback pro npm se o tsx não estiver hoisted na raiz. O entrypoint vai por caminho ABSOLUTO
# (não 'src/index.ts') de propósito: é o que mantém hub e runner distinguíveis na linha de
# comando — com caminho relativo os dois viram `node tsx src/index.ts`, diferindo só no cwd, e aí
# nada que inspeciona processos (a evicção dos instaladores) consegue dizer quem é quem.
$tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
Set-Location "$root\apps\runner"
$lastUpdateWaitLog = [DateTimeOffset]::MinValue
$lastRepairAt = [DateTimeOffset]::MinValue
$quickCrashCount = 0
# UPD-01 Fase 1: boot-state.json (escrito pelo runner ao alcancar o Hub) guarda o ultimo commit que
# confirmou boot saudavel. $rolledBackFrom vive so na memoria deste supervisor: evita rollback-loop
# no mesmo commit ruim.
$bootStateFile = Join-Path $stateRoot '.jarvis\boot-state.json'
$rolledBackFrom = ''
function Get-LastGood() {
  try { return (Get-Content -Raw -LiteralPath $bootStateFile -ErrorAction Stop | ConvertFrom-Json).lastGood } catch { return $null }
}
function Rollback-To([string]$Target) {
  Log ("crash loop de codigo novo — revertendo checkout para o ultimo bom conhecido: " + $Target)
  Push-Location $root
  try {
    & git reset --hard $Target *>> $log; Log ('git reset --hard concluido (codigo ' + $LASTEXITCODE + ')')
    & git clean -fd *>> $log
    & npm.cmd ci *>> $log; Log ('npm ci pos-rollback concluido (codigo ' + $LASTEXITCODE + ')')
    & npm.cmd run update:verify --if-present *>> $log
  } catch { Log ('rollback falhou: ' + $_) } finally { Pop-Location }
}
function Repair-Dependencies([string]$Reason) {
  $script:lastRepairAt = [DateTimeOffset]::Now
  Log ("reparando dependencias: " + $Reason)
  Push-Location $root
  try {
    & npm.cmd ci *>> $log
    $installCode = $LASTEXITCODE
    Log ('npm ci concluido (codigo ' + $installCode + ')')
    if ($installCode -eq 0) {
      & npm.cmd run update:verify --if-present *>> $log
      Log ('update:verify concluido (codigo ' + $LASTEXITCODE + ')')
    }
  } catch {
    Log ('reparo de dependencias falhou: ' + $_)
  } finally {
    Pop-Location
  }
}
# Loop de supervisão: NUNCA sai. (Re)sobe o runner em foreground; quando o node encerra,
# registra e reinicia após um pequeno backoff.
while ($true) {
  if (Test-Path $updateLock) {
    try {
      $lockPid = $null
      $provisional = $false
      try {
        $lockData = Get-Content -Raw -LiteralPath $updateLock | ConvertFrom-Json
        $lockPid = [int]$lockData.pid
        $provisional = [bool]$lockData.provisional
      } catch {
        $lockPid = $null
        $provisional = $false
      }
      # Lock real nomeia o updater e pode ser limpo se o PID morreu. Lock provisório nomeia o runner
      # que está saindo durante o handoff; não limpe por PID morto antes do script externo assumir.
      $updaterDead = $false
      if ($lockPid) { $updaterDead = -not [bool](Get-Process -Id $lockPid -ErrorAction SilentlyContinue) }
      $age = ((Get-Date) - (Get-Item -LiteralPath $updateLock).LastWriteTime).TotalMinutes
      if (($provisional -and $age -gt 5) -or ((-not $provisional) -and $updaterDead) -or $age -gt 30) {
        Log ("lock de update orfao removido (pid {0} morto={1}, provisório={2}, idade {3:N1}min)" -f $lockPid, $updaterDead, $provisional, $age)
        Remove-Item -LiteralPath $updateLock -Force -ErrorAction SilentlyContinue
      } else {
        $now = [DateTimeOffset]::Now
        if (($now - $lastUpdateWaitLog).TotalSeconds -ge 60) {
          Log ("update em andamento - aguardando script externo terminar (provisório={0})" -f $provisional)
          $lastUpdateWaitLog = $now
        }
        Start-Sleep -Seconds 3
        continue
      }
    } catch {
      $now = [DateTimeOffset]::Now
      if (($now - $lastUpdateWaitLog).TotalSeconds -ge 60) {
        Log 'update em andamento - aguardando script externo terminar'
        $lastUpdateWaitLog = $now
      }
      Start-Sleep -Seconds 3
      continue
    }
  }
  $startedAt = [DateTimeOffset]::Now
  # Reaper de agentes órfãos: um turno cujo PAI (este runner) morreu segue rodando e CUSTANDO crédito —
  # nada mais o mata. Encerramos CLIs de agente cujo PAI não existe mais. Direção SEGURA: pai vivo →
  # nunca mata; o app Claude Desktop e o próprio hub/runner ficam de fora. Backstop pro caso de crash
  # duro (onde o abort por queda sustentada, no index.ts, não roda porque o processo inteiro morreu).
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='claude.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match '@openai[\\/]codex|codex[\\/]bin|[\\/]\.local[\\/]bin[\\/]claude|cursor-agent|[\\/]opencode|[\\/]cline|kiro-cli') -and
      ($_.CommandLine -notmatch 'AnthropicClaude') -and ($_.CommandLine -notmatch 'apps[\\/](hub|runner)[\\/]src') -and
      -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Log "agente orfao encerrado (pid $($_.ProcessId), pai $($_.ParentProcessId) morto)" } catch {} }
  Log 'iniciando runner...'
  if (Test-Path $tsx) { & node.exe $tsx "$root\apps\runner\src\index.ts" *>> $log }
  else {
    # tsx sumiu da raiz — o `npm start` de fallback também depende dele, então cairia no MESMO
    # crash loop de 3s pra sempre (foi o que aconteceu quando um `npm ci` in-process corrompeu o
    # node_modules). Auto-repara: roda `npm ci` na raiz UMA VEZ a cada 5 min (nunca mais rápido que
    # isso — não pode virar loop de reinstalação a cada 3s) antes de tentar `npm start`.
    $sinceRepair = ([DateTimeOffset]::Now - $lastRepairAt).TotalMinutes
    if ($sinceRepair -ge 5) {
      Repair-Dependencies 'tsx nao encontrado na raiz'
    } else {
      Log ('tsx nao encontrado na raiz - reparo tentado ha ' + [Math]::Round($sinceRepair,1) + 'min, aguardando janela de 5min - caindo pro npm')
    }
    & npm.cmd --prefix "$root\apps\runner" start *>> $log
  }
  $runtimeSec = ([DateTimeOffset]::Now - $startedAt).TotalSeconds
  if ($runtimeSec -lt 15) { $quickCrashCount += 1 } else { $quickCrashCount = 0 }
  if ($quickCrashCount -ge 3) {
    # Decisao (espelha bootRollbackDecision em apps/runner/src/boot-health.ts): um commit que NUNCA
    # confirmou boot e esta em crash loop = update ruim → reverte pro ultimo bom. Se o commit que
    # crasha JA e o ultimo bom, e corrupcao de dependencia → repara (npm ci), nao reverte.
    $cur = ''
    try { $cur = (& git -C $root rev-parse --short HEAD 2>$null) } catch {}
    $lastGood = Get-LastGood
    if ($cur -and $lastGood -and ($cur -ne $lastGood) -and ($rolledBackFrom -ne $cur)) {
      Rollback-To $lastGood
      $rolledBackFrom = $cur
    } else {
      $sinceRepair = ([DateTimeOffset]::Now - $lastRepairAt).TotalMinutes
      if ($sinceRepair -ge 5) { Repair-Dependencies ("runner encerrou rapido " + $quickCrashCount + " vezes") }
      else { Log ('runner em crash loop, mas reparo foi tentado ha ' + [Math]::Round($sinceRepair,1) + 'min') }
    }
    $quickCrashCount = 0
  }
  Log ('runner encerrou apos ' + [Math]::Round($runtimeSec,1) + 's - reiniciando em 3s')
  Start-Sleep -Seconds 3
}
