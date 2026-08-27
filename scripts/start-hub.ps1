# Jarvis Hub launcher — tarefa agendada "JarvisHub" (roda no logon).
#
# SUPERVISOR: mantém o Hub SEMPRE de pé. Se o node cair — crash, ou o auto-update
# matando a porta 4577 pra aplicar código novo — o loop ressuscita em segundos.
# Como tsx roda direto do source, o restart já pega o código atualizado. Instância
# única garantida pelo teste da porta 4577. Log em ~/.jarvis/hub.log.
# -Once: roda o corpo UMA vez e retorna, para quem supervisiona ser o SCM (serviço do Windows) em
# vez do `while($true)` daqui. Ver ops/windows-service/JarvisService.cs. Sem o parâmetro, o
# comportamento antigo (Agendador de Tarefas + laço próprio) continua idêntico.
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
  if (-not $script:HubMutexCreated) { Log 'outro supervisor ja ativo (mutex) - este encerra'; return }
} catch { Log "mutex indisponivel ($($_.Exception.Message)) - seguindo apenas com a guarda de porta" }

# garante que node/npm/CLIs resolvem, independente do PATH da tarefa
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:PATH"

# instância única: se já há um Hub na 4577 (ex.: o logon dispara de novo com o supervisor
# já rodando), este launcher encerra em vez de duplicar.
if (Get-NetTCPConnection -LocalPort 4577 -State Listen -ErrorAction SilentlyContinue) {
  Log 'hub já rodando na 4577 — este launcher encerra (evita instância dupla)'
  return
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
  if (Test-Path $tsx) { & node.exe $tsx "$root\apps\hub\src\index.ts" *>> $log }
  else { Log 'tsx nao encontrado na raiz — caindo pro npm'; & npm.cmd start *>> $log }
  if ($Once) { Log 'hub encerrou — devolvendo ao SCM'; break }
  Log 'hub encerrou — reiniciando em 3s'
  Start-Sleep -Seconds 3
} while ($true)
