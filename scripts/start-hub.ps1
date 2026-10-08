# Jarvis Hub launcher — tarefa agendada "JarvisHub" (roda no logon).
#
# SUPERVISOR: mantém o Hub SEMPRE de pé. Se o node cair — crash, ou o auto-update
# matando a porta 4577 pra aplicar código novo — o loop ressuscita em segundos.
# Como tsx roda direto do source, o restart já pega o código atualizado. Instância
# única garantida pelo teste da porta 4577. Log em ~/.jarvis/hub.log.
# -Once: roda o corpo UMA vez e retorna, para quem supervisiona ser o SCM (serviço do Windows) em
# vez do `while($true)` daqui. Ver ops/windows-service/JarvisService.cs. Sem o parâmetro, o
# comportamento antigo (Agendador de Tarefas + laço próprio) continua idêntico.
# Sob o SCM, este launcher NUNCA sai só porque já existe um Hub/supervisor: espera o mutex ou ADOTA o
# Hub órfão que segura a porta (sair virava laço de falhas no SCM e deixava o órfão sem supervisão).
# Nos dois modos, um WATCHDOG derruba o Hub filho que parar de responder ao /health (ver abaixo).
param([switch]$Once)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent            # ...\jarvis
$hub  = Join-Path $root 'apps\hub'
$log  = Join-Path $env:USERPROFILE '.jarvis\hub.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
# -Encoding Unicode (UTF-16LE) para CASAR com a saída do node redirecionada por `*>>` (também UTF-16LE
# no PowerShell 5.1). Sem isso o Log() gravava ANSI e o hub.log virava um mix ANSI+UTF-16 ilegível.
function Log($m) { Add-Content -Path $log -Encoding Unicode -Value ("[launcher] {0} {1}" -f (Get-Date -Format o), $m) }

# Instancia unica DURA: um mutex nomeado garante UM supervisor mesmo que a task JarvisHub e um
# restart-hub disparem start-hub.ps1 quase juntos. A guarda por porta (abaixo) tem uma janela de
# corrida de ~3s durante o restart (a porta 4577 fica livre) pela qual um 2o supervisor passava e
# entrava no loop, criando dois supervisores brigando pela porta. O mutex fecha essa janela.
# Local (sem prefixo Global) porque os dois lancadores rodam na sessao interativa do mesmo usuario;
# Global exigiria SeCreateGlobalPrivilege e poderia falhar. Fail-open: se o mutex nao puder ser
# criado por qualquer motivo, seguimos SEM trava (a porta ainda protege) e NUNCA bloqueamos o Hub.
try {
  $script:HubMutexCreated = $false
  $script:HubMutex = New-Object System.Threading.Mutex($true, 'JarvisHubSupervisor', [ref]$script:HubMutexCreated)
  if (-not $script:HubMutexCreated) {
    if (-not $Once) { Log 'outro supervisor ja ativo (mutex) - este encerra'; return }
    # Sob o SCM, SAIR aqui e o pior caminho: o host converte a saida em falha, o SCM religa em segundos
    # e o ciclo se repete para sempre (86 falhas em 23 min em 2026-10-07), enquanto o Hub em pe fica
    # sem ninguem que o religue. Esperar o outro supervisor terminar mantem o servico "Running" e, quando
    # ele sai (o mutex e liberado ou abandonado), este assume.
    Log 'outro supervisor ja ativo (mutex) - aguardando ele terminar para assumir'
    try { [void]$script:HubMutex.WaitOne() } catch { <# AbandonedMutexException: o dono morreu; a posse e nossa #> }
    Log 'mutex liberado - este supervisor assume'
  }
} catch { Log "mutex indisponivel ($($_.Exception.Message)) - seguindo apenas com a guarda de porta" }

# Saude do Hub pelo /health (loopback). Responder exige o event loop livre: processo vivo que nao
# responde e Hub morto para quem usa. -UseBasicParsing: sem o motor do IE (indisponivel na sessao 0).
function Test-HubHealth([int]$TimeoutSec = 10) {
  try { return ((Invoke-WebRequest -Uri 'http://127.0.0.1:4577/health' -UseBasicParsing -TimeoutSec $TimeoutSec).StatusCode -eq 200) } catch { return $false }
}

# garante que node/npm/CLIs resolvem, independente do PATH da tarefa
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:PATH"

# instância única: se já há um Hub na 4577 (ex.: o logon dispara de novo com o supervisor
# já rodando), este launcher encerra em vez de duplicar.
$held = Get-NetTCPConnection -LocalPort 4577 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($held -and -not $Once) {
  Log 'hub já rodando na 4577 — este launcher encerra (evita instância dupla)'
  return
}
if ($held) {
  # ADOCAO (so sob o SCM). Um Hub segurando a porta sem este supervisor e um orfao: o anterior morreu e
  # o node ficou (ou o Stop ainda nao terminou de derrubar a arvore). Sair aqui gerava o laco de falhas
  # do SCM e deixava esse Hub sem supervisao. Em vez disso: vigia o dono da porta ate ele sair; se ele
  # parar de responder por ~2 min, encerra a arvore dele. Depois segue e sobe um Hub novo.
  $adopted = $held.OwningProcess; $fails = 0
  Log "hub ja rodando na 4577 (pid $adopted) sem supervisor - adotando ate ele sair"
  while (Get-Process -Id $adopted -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 15
    if (Test-HubHealth) { $fails = 0; continue }
    $fails++
    if ($fails -ge 8) {
      Log "hub adotado (pid $adopted) sem responder ha ~2 min - encerrando a arvore dele"
      & taskkill.exe /PID $adopted /T /F 2>&1 | Out-Null
      Start-Sleep -Seconds 3
    }
  }
  Log "hub adotado (pid $adopted) saiu - subindo um novo"
}

# WATCHDOG do Hub que ESTE launcher sobe. O SCM (e o laco abaixo) so reagem quando o processo SAI; um
# Hub vivo mas travado (event loop preso, como no incidente de 2026-08-28) ou um boot que nunca abre a
# porta ficavam assim para sempre. Roda num runspace deste mesmo processo (morre junto com ele: um job
# separado poderia sobreviver e matar o Hub SEGUINTE). Ao desistir, mata a arvore do node filho deste
# launcher; o `& node.exe` abaixo retorna e o caminho normal de reinicio assume.
# Log proprio (UTF-8): o hub.log fica travado pelo `*>>` enquanto o node roda.
# Desligar: JARVIS_HUB_WATCHDOG=0 no hub.env. Limites: boot ate 15 min (ja medimos 190 s); depois de
# no ar, 8 falhas seguidas do /health a cada 15 s (~2 min sem resposta).
function Start-HubWatchdog {
  $wdLog = Join-Path $env:USERPROFILE '.jarvis\hub-watchdog.log'
  $ps = [PowerShell]::Create()
  [void]$ps.AddScript({
    param($LauncherPid, $WdLog, $GraceSec, $IntervalSec, $MaxFails)
    function W($m) { try { Add-Content -Path $WdLog -Encoding UTF8 -Value ("[watchdog] {0} {1}" -f (Get-Date -Format o), $m) } catch {} }
    function Healthy { try { return ((Invoke-WebRequest -Uri 'http://127.0.0.1:4577/health' -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) } catch { return $false } }
    $t0 = Get-Date; $up = $false; $fails = 0
    while ($true) {
      Start-Sleep -Seconds $IntervalSec
      if (Healthy) {
        if (-not $up) { W ("hub respondeu ao /health {0:N0} s apos o inicio" -f ((Get-Date) - $t0).TotalSeconds) }
        $up = $true; $fails = 0; continue
      }
      if (-not $up) {
        if (((Get-Date) - $t0).TotalSeconds -lt $GraceSec) { continue }
        W "hub nao respondeu em $GraceSec s desde o inicio - boot travado"
      } else {
        $fails++
        if ($fails -lt $MaxFails) { W "health falhou ($fails/$MaxFails)"; continue }
        W ("hub sem responder ha ~{0} s" -f ($fails * $IntervalSec))
      }
      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$LauncherPid AND Name='node.exe'" -ErrorAction SilentlyContinue
      foreach ($k in $kids) { W "encerrando a arvore do node $($k.ProcessId) para o supervisor religar"; & taskkill.exe /PID $k.ProcessId /T /F 2>&1 | Out-Null }
      return
    }
  }).AddArgument($PID).AddArgument($wdLog).AddArgument(900).AddArgument(15).AddArgument(8)
  [void]$ps.BeginInvoke()
  return $ps
}

# Config LOCAL opcional (gitignored) — valores pessoais/da máquina vão aqui, ex.:
#   JARVIS_PUBLIC_URL=https://<seu-host>   (para links de convite completos)
#   OPENAI_API_KEY=sk-...                  (habilita as vozes na nuvem)
# RELIDO A CADA (re)subida do node (ver o loop abaixo): assim uma mudança no hub.env passa a
# valer no próximo restart do Hub — sem precisar matar este supervisor. Antes era lido só aqui,
# então uma chave adicionada depois do supervisor subir nunca chegava ao processo.
function Import-HubEnv {
  $hubEnv = Join-Path $env:USERPROFILE '.jarvis\hub.env'
  if (Test-Path $hubEnv) {
    Get-Content $hubEnv | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), 'Process') } }
  }
  # padrões do Hub (não sobrescreve o que veio do hub.env)
  if (-not $env:JARVIS_AGENT)        { $env:JARVIS_AGENT = 'claude-code' }
  if (-not $env:JARVIS_VOICE)        { $env:JARVIS_VOICE = 'pt_BR-faber-medium' }
  if (-not $env:JARVIS_SEARCH_MODEL) { $env:JARVIS_SEARCH_MODEL = 'haiku' }
  # Auth por pareamento LIGADA (padrão). 1º dispositivo reivindica com o claim-code
  # (log + ~/.jarvis/claim-code.txt). Emergência (rede privada): defina JARVIS_AUTH=off no hub.env.
  if (-not $env:JARVIS_AUTH)         { $env:JARVIS_AUTH = 'on' }
  $env:JARVIS_CWD = $root
}

Set-Location $hub
# Chama o tsx direto pelo node em vez de `npm.cmd start`: npm no Windows é batch, e batch faz
# nascer um cmd.exe intermediário — um console a mais pra manter escondido, por nada. Fallback
# pro npm se o tsx não estiver hoisted na raiz.
$tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
# Loop de supervisão: NUNCA sai. Cada iteração (re)sobe o Hub em foreground. Quando o node encerra,
# registra e reinicia após um pequeno backoff. Com -Once o laço dá UMA volta: quem religa é o SCM.
do {
  Import-HubEnv   # relê hub.env a cada subida → mudanças de env valem no próximo restart
  # Limpa STT órfão da instância anterior: o node é morto com -Force (no restart) e o Windows NÃO
  # mata o filho Python (whisper_service), que fica segurando ~1.5GB do modelo. Sem isso, cada
  # restart deixa um órfão e a RAM enche. Rodar aqui garante um único STT por subida.
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'whisper_service|piper_service|embed_service|voice_cli' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Log "STT orfao encerrado (pid $($_.ProcessId))" } catch {} }
  # Reaper de agentes órfãos: um turno cujo processo PAI (o Hub) morreu segue rodando e CUSTANDO crédito
  # — o abort só dispara com o pai vivo, e nada mais o mata (foi o codex de 3 dias achado na análise).
  # Encerramos CLIs de agente (codex/claude/etc.) cujo PAI não existe mais. Direção SEGURA: pai vivo →
  # nunca mata; o app Claude Desktop (AnthropicClaude) e o próprio hub/runner ficam de fora.
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='claude.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match '@openai[\\/]codex|codex[\\/]bin|[\\/]\.local[\\/]bin[\\/]claude|cursor-agent|[\\/]opencode|[\\/]cline|kiro-cli') -and
      ($_.CommandLine -notmatch 'AnthropicClaude') -and ($_.CommandLine -notmatch 'apps[\\/](hub|runner)[\\/]src') -and
      -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Log "agente orfao encerrado (pid $($_.ProcessId), pai $($_.ParentProcessId) morto)" } catch {} }
  Log 'iniciando hub...'
  # NÃO usar `2>&1 | Out-File`: piparo stdout do node por um pipeline do PowerShell TRAVA o Hub no
  # boot — o Out-File não drena o pipe a tempo, o buffer (~64KB) enche e o node bloqueia numa escrita
  # síncrona ANTES de bindar a 4577 (o processo sobe, mas nunca escuta; foi o que derrubou o restart).
  # `*>>` redireciona DIRETO pro arquivo, sem pipeline: o Hub sobe. O log sai em UTF-16LE (feio, mas
  # funcional — para ler, decodifique). UTF-8 no log precisa de uma via que NÃO passe por pipeline do
  # PS (ex.: um logger próprio do app gravando UTF-8), sem reintroduzir esse travamento.
  $watchdog = $null
  if ($env:JARVIS_HUB_WATCHDOG -ne '0') { try { $watchdog = Start-HubWatchdog } catch { Log "watchdog indisponivel: $($_.Exception.Message)" } }
  if (Test-Path $tsx) { & node.exe $tsx "$root\apps\hub\src\index.ts" *>> $log }
  else { Log 'tsx nao encontrado na raiz — caindo pro npm'; & npm.cmd start *>> $log }
  $nodeExit = $LASTEXITCODE
  if ($watchdog) { try { $watchdog.Stop(); $watchdog.Dispose() } catch {} }
  if ($Once) { Log "hub encerrou (codigo $nodeExit) — devolvendo ao SCM"; break }
  Log 'hub encerrou — reiniciando em 3s'
  Start-Sleep -Seconds 3
} while ($true)
