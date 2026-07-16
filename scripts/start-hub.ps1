# Jarvis Hub launcher — tarefa agendada "JarvisHub" (roda no logon).
#
# SUPERVISOR: mantém o Hub SEMPRE de pé. Se o node cair — crash, ou o auto-update
# matando a porta 4577 pra aplicar código novo — o loop ressuscita em segundos.
# Como tsx roda direto do source, o restart já pega o código atualizado. Instância
# única garantida pelo teste da porta 4577. Log em ~/.jarvis/hub.log.
#
# Por que o warmup: no boot o token OAuth do Claude pode estar expirado. O Hub faz um
# GET /v1/models direto e NÃO sabe renovar o token; só o CLI `claude` renova (refresh
# token). Então "aquecemos" o token com uma chamada trivial ANTES de subir o Hub.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent            # ...\jarvis
$hub  = Join-Path $root 'apps\hub'
$log  = Join-Path $env:USERPROFILE '.jarvis\hub.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { Add-Content -Path $log -Value ("[launcher] {0} {1}" -f (Get-Date -Format o), $m) }

# garante que node/npm/claude resolvem, independente do PATH da tarefa
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:PATH"

# instância única: se já há um Hub na 4577 (ex.: o logon dispara de novo com o supervisor
# já rodando), este launcher encerra em vez de duplicar.
if (Get-NetTCPConnection -LocalPort 4577 -State Listen -ErrorAction SilentlyContinue) {
  Log 'hub já rodando na 4577 — este launcher encerra (evita instância dupla)'
  return
}

# Config LOCAL opcional (gitignored) — valores pessoais/da máquina vão aqui, ex.:
#   JARVIS_PUBLIC_URL=https://<seu-host>   (para links de convite completos)
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

# aquece o token do Claude (best-effort, com teto de tempo para nunca travar o boot)
function Warm-Token {
  try {
    Log 'aquecendo token do Claude...'
    $osdir = Join-Path $env:USERPROFILE '.jarvis\oneshot'; New-Item -ItemType Directory -Force $osdir | Out-Null
    $j = Start-Job { param($d) Set-Location $d; 'ping' | & claude -p --model haiku 2>&1 } -ArgumentList $osdir
    if (Wait-Job $j -Timeout 90) { Log ('warmup ok: ' + (((Receive-Job $j) -join ' ').Trim())) }
    else { Stop-Job $j; Log 'warmup atingiu o teto de tempo (segue mesmo assim)' }
    Remove-Job $j -Force -ErrorAction SilentlyContinue
  } catch { Log "warmup falhou (segue mesmo assim): $_" }
}

Set-Location $hub
$lastWarm = [datetime]::MinValue
# Loop de supervisão: NUNCA sai. Cada iteração garante token fresco (reaquece se passou
# de 30min desde a última vez) e (re)sobe o Hub em foreground. Quando o node encerra,
# registra e reinicia após um pequeno backoff.
while ($true) {
  if (((Get-Date) - $lastWarm).TotalMinutes -ge 30) { Warm-Token; $lastWarm = Get-Date }
  Log 'iniciando hub...'
  & npm.cmd start *>> $log
  Log 'hub encerrou — reiniciando em 3s'
  Start-Sleep -Seconds 3
}
