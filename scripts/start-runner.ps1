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
function Log($m) { Add-Content -Path $log -Value ("[launcher] {0} {1}" -f (Get-Date -Format o), $m) }

# garante que node/npm/claude resolvem, independente do PATH da tarefa
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:PATH"

$envFile = Join-Path $env:USERPROFILE '.jarvis\runner.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), 'Process') }
  }
}
Set-Location $root
# Loop de supervisão: NUNCA sai. (Re)sobe o runner em foreground; quando o node encerra,
# registra e reinicia após um pequeno backoff.
while ($true) {
  Log 'iniciando runner...'
  & npm.cmd --prefix "$root\apps\runner" start *>> $log
  Log 'runner encerrou — reiniciando em 3s'
  Start-Sleep -Seconds 3
}
