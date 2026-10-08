# Jarvis Wake launcher — tarefa agendada "JarvisWake".
#
# Mantém o listener local de "Hey Jarvis" de pé. O wake_listener.py usa o microfone
# desta máquina, transcreve localmente e injeta a fala no Hub via WebSocket.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$voice = Join-Path $root 'services\voice'
$log = Join-Path $env:USERPROFILE '.jarvis\wake.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { Add-Content -Path $log -Value ("[wake-launcher] {0} {1}" -f (Get-Date -Format o), $m) }

# Instancia unica: a tarefa (scripts/install-wake.ps1) dispara este launcher no logon E a cada 5 min.
# IgnoreNew so impede duplicata DA TAREFA; um start manual em paralelo abriria dois microfones.
# Fail-open: sem mutex, segue (o pior caso e o comportamento antigo).
try {
  $created = $false
  $script:WakeMutex = New-Object System.Threading.Mutex($true, 'JarvisWakeSupervisor', [ref]$created)
  if (-not $created) { Log 'outro supervisor do wake ja ativo (mutex) - este encerra'; return }
} catch { Log "mutex indisponivel ($($_.Exception.Message)) - seguindo" }

$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:PATH"

$hubEnv = Join-Path $env:USERPROFILE '.jarvis\hub.env'
if (Test-Path $hubEnv) {
  Get-Content $hubEnv | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), 'Process')
    }
  }
}

if (-not $env:JARVIS_HUB_WS) { $env:JARVIS_HUB_WS = 'ws://127.0.0.1:4577' }
if (-not $env:JARVIS_WAKE_LANG) { $env:JARVIS_WAKE_LANG = 'pt' }

Set-Location $voice
while ($true) {
  Log ("iniciando wake listener em " + $env:JARVIS_HUB_WS)
  & python.exe "$voice\wake_listener.py" *>> $log
  Log 'wake listener encerrou - reiniciando em 3s'
  Start-Sleep -Seconds 3
}
