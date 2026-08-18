# collect-update-evidence.ps1 — snapshot READ-ONLY para diagnosticar um update travado do Jarvis.
#
# Nao altera NADA na maquina (so leitura + grava um unico txt de saida). ASCII-only de proposito para
# nao depender de BOM em PowerShell 5.1. Rode na MAQUINA QUE TRAVOU e cole a saida no chat:
#   powershell -ExecutionPolicy Bypass -File scripts\collect-update-evidence.ps1
$ErrorActionPreference = 'Continue'
$jdir  = Join-Path $env:USERPROFILE '.jarvis'
$out   = Join-Path $jdir 'update-evidence.txt'
$lines = New-Object System.Collections.Generic.List[string]
function Add-Line($s) { $lines.Add([string]$s) | Out-Null }
function Section($t) { Add-Line ''; Add-Line ('===== ' + $t + ' =====') }
function Dump-File($label, $path, $tail) {
  Section $label
  if (Test-Path -LiteralPath $path) {
    try {
      $it = Get-Item -LiteralPath $path
      Add-Line ($path + '  (' + $it.Length + ' bytes, mtime ' + $it.LastWriteTime.ToString('o') + ')')
      Get-Content -LiteralPath $path -Tail $tail -ErrorAction Stop | ForEach-Object { Add-Line $_ }
    } catch { Add-Line ('ERRO lendo ' + $path + ': ' + $_) }
  } else { Add-Line ('(nao existe: ' + $path + ')') }
}

Add-Line ('coletado em ' + (Get-Date -Format o) + ' | host ' + $env:COMPUTERNAME + ' | user ' + $env:USERNAME)

Dump-File 'runner-update.log (rabo)'  (Join-Path $jdir 'runner-update.log')  200
Dump-File 'update-result.json'        (Join-Path $jdir 'update-result.json') 200
Dump-File 'update-receipt.json'       (Join-Path $jdir 'update-receipt.json') 200
Dump-File 'runner-update.lock'        (Join-Path $jdir 'runner-update.lock')  50
Dump-File 'update-attempts.json'      (Join-Path $jdir 'update-attempts.json') 20
Dump-File 'runner.log (rabo)'         (Join-Path $jdir 'runner.log')          120
Dump-File 'hub.log (rabo)'            (Join-Path $jdir 'hub.log')             120

Section 'pasta updates/'
$updir = Join-Path $jdir 'updates'
if (Test-Path -LiteralPath $updir) {
  Get-ChildItem -LiteralPath $updir -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object { Add-Line ($_.FullName + '  ' + $_.Length + ' bytes  ' + $_.LastWriteTime.ToString('o')) }
} else { Add-Line '(nao existe)' }

Section 'scripts runner-update-*.ps1 pendentes em .jarvis'
Get-ChildItem -LiteralPath $jdir -Filter 'runner-update-*.ps1' -ErrorAction SilentlyContinue |
  ForEach-Object { Add-Line ($_.Name + '  ' + $_.LastWriteTime.ToString('o')) }

Section 'scheduled tasks Jarvis'
foreach ($t in 'JarvisRunner', 'JarvisHub', 'JarvisWake') {
  try {
    $task = Get-ScheduledTask -TaskName $t -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $t -ErrorAction SilentlyContinue
    Add-Line ($t + ' -> State=' + $task.State + ' LastRun=' + $info.LastRunTime + ' LastResult=' + $info.LastTaskResult + ' NextRun=' + $info.NextRunTime)
  } catch { Add-Line ($t + ' -> (nao registrada)') }
}

Section 'processos node/tsx/powershell do jarvis'
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'jarvis|apps\\runner|apps\\hub|start-runner|start-hub|runner-update' } |
  ForEach-Object { Add-Line ('pid=' + $_.ProcessId + ' ppid=' + $_.ParentProcessId + ' start=' + $_.CreationDate + ' :: ' + ($_.CommandLine -replace '\s+', ' ')) }

Section 'porta 4577 (hub) em listen?'
try { Get-NetTCPConnection -LocalPort 4577 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Add-Line ('4577 owner pid=' + $_.OwningProcess) } } catch {}

Section 'git no checkout'
$root = $env:JARVIS_CWD
if (-not $root -or -not (Test-Path (Join-Path $root '.git'))) { $root = (Get-Location).Path }
if (-not (Test-Path (Join-Path $root '.git'))) { $root = Split-Path $PSScriptRoot -Parent }
Add-Line ('root candidato: ' + $root)
try {
  Push-Location $root
  Add-Line ('HEAD:   ' + (& git rev-parse --short HEAD 2>&1))
  Add-Line ('branch: ' + (& git rev-parse --abbrev-ref HEAD 2>&1))
  Add-Line 'status --porcelain:'
  (& git status --porcelain 2>&1) | ForEach-Object { Add-Line ('  ' + $_) }
  Pop-Location
} catch { Add-Line ('git falhou: ' + $_) }

$lines | Set-Content -LiteralPath $out -Encoding UTF8
Write-Output ('Evidencia salva em: ' + $out)
Write-Output '----- cole tudo abaixo -----'
$lines | ForEach-Object { Write-Output $_ }
