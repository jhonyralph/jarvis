# Jarvis Hub launcher — usado pela tarefa agendada "JarvisHub" (roda no logon).
#
# Por que existe: no boot o token OAuth do Claude pode estar expirado. O Hub faz um
# GET /v1/models direto e NÃO sabe renovar o token; só o CLI `claude` renova (via
# refresh token). Então aqui a gente "aquece" o token com uma chamada trivial do CLI
# ANTES de subir o Hub — assim a lista de modelos vem completa e as chamadas de
# agente já saem funcionando. Instância única; log em ~/.jarvis/hub.log.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent            # ...\jarvis
$hub  = Join-Path $root 'apps\hub'
$log  = Join-Path $env:USERPROFILE '.jarvis\hub.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { Add-Content -Path $log -Value ("[launcher] {0} {1}" -f (Get-Date -Format o), $m) }

# garante que node/npm/claude resolvem, independente do PATH da tarefa
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:PATH"

if (Get-NetTCPConnection -LocalPort 4577 -State Listen -ErrorAction SilentlyContinue) {
  Log 'hub já rodando na 4577 — nada a fazer'
  return
}

# configuração padrão do Hub (ajuste aqui se quiser outro agente/voz)
$env:JARVIS_AGENT        = 'claude-code'
$env:JARVIS_VOICE        = 'pt_BR-faber-medium'
$env:JARVIS_CWD          = $root
$env:JARVIS_SEARCH_MODEL = 'haiku'
# Autenticação por pareamento de dispositivo LIGADA (padrão). O primeiro dispositivo
# reivindica o dono com o claim-code que aparece no log e em ~/.jarvis/claim-code.txt.
# Para desligar em emergência (rede privada): $env:JARVIS_AUTH = 'off'
$env:JARVIS_AUTH         = 'on'

# aquece o token do Claude (best-effort, com teto de tempo para nunca travar o boot)
try {
  Log 'aquecendo token do Claude...'
  $osdir = Join-Path $env:USERPROFILE '.jarvis\oneshot'; New-Item -ItemType Directory -Force $osdir | Out-Null
  $j = Start-Job { param($d) Set-Location $d; 'ping' | & claude -p --model haiku 2>&1 } -ArgumentList $osdir
  if (Wait-Job $j -Timeout 90) { Log ('warmup ok: ' + (((Receive-Job $j) -join ' ').Trim())) }
  else { Stop-Job $j; Log 'warmup atingiu o teto de tempo (segue mesmo assim)' }
  Remove-Job $j -Force -ErrorAction SilentlyContinue
} catch { Log "warmup falhou (segue mesmo assim): $_" }

Log 'iniciando hub...'
Set-Location $hub
& npm.cmd start *>> $log
Log 'hub encerrou'
