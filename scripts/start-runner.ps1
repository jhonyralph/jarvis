# Starts the Jarvis runner (used by the JarvisRunner scheduled task). Loads
# ~/.jarvis/runner.env (JARVIS_HUB / JARVIS_TOKEN / JARVIS_LABEL) and runs the runner.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $env:USERPROFILE '.jarvis\runner.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), 'Process') }
  }
}
Set-Location $root
& npm.cmd --prefix "$root\apps\runner" start
