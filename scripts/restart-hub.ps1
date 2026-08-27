<#
  restart-hub.ps1 — reinicia o Jarvis Hub de forma À PROVA DE "morrer na praia".

  O problema: rodar o restart de forma síncrona trava a chamada ~30s (derruba + espera + confirma).
  Se quem chamou for interrompido nesse meio, a AÇÃO até completa — o supervisor start-hub.ps1
  (loop while($true), task "JarvisHub") relança o node sozinho em ~3s com o source novo — mas a
  CONFIRMAÇÃO se perde e ninguém sabe se subiu ("está rodando ou morreu?").

  A solução: o script se DESTACA. A chamada normal dispara um worker OCULTO e retorna na hora;
  o worker faz derruba+espera+confirma e grava o resultado em ~/.jarvis/restart-status.txt.
  Assim o desfecho é SEMPRE recuperável (basta ler o arquivo + checar a porta 4577), mesmo que o
  chamador morra. Um único comando ainda derruba E garante o start (o supervisor cuida do start).

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts\restart-hub.ps1          # dispara e volta na hora
    powershell -ExecutionPolicy Bypass -File scripts\restart-hub.ps1 -Wait    # bloqueia até subir (~ até 40s)
    Get-Content ~/.jarvis/restart-status.txt                                  # ver o desfecho a qualquer momento
#>
param([switch]$Worker, [switch]$Wait)
$ErrorActionPreference = 'Continue'
$port = 4577
$status = Join-Path $env:USERPROFILE '.jarvis\restart-status.txt'

if (-not $Worker) {
  # Dispara o worker DESTACADO (janela oculta) e retorna já — não morre junto com o chamador.
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Worker'
  ) | Out-Null
  Write-Host "Restart disparado em background. Desfecho em: $status" -ForegroundColor Cyan
  Write-Host "  (acompanhe: Get-Content `"$status`")" -ForegroundColor DarkGray
  if ($Wait) {
    for ($i = 0; $i -lt 22; $i++) {
      Start-Sleep -Seconds 2
      if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
    }
    Get-Content $status -ErrorAction SilentlyContinue | Write-Host
  }
  exit 0
}

# ---------- worker (destacado; roda mesmo que o chamador tenha morrido) ----------
function Set-Status([string]$s) {
  try { "$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))  $s" | Set-Content -Encoding UTF8 -Path $status } catch { }
}

Set-Status 'iniciando: derrubando o Hub atual na porta 4577...'
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }

# STT órfão: o Python (whisper_service) é filho do node do hub; matar o node com -Force NÃO mata o
# filho no Windows, e ele fica segurando ~1.5GB do modelo. Encerra o órfão (o novo hub sobe o seu).
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'whisper_service|piper_service|embed_service|voice_cli' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Garante que HÁ um supervisor de pé para religar o node. Ordem de preferência:
#   1) um supervisor start-hub.ps1 já vivo → ele relança sozinho, nada a fazer;
#   2) a task agendada JarvisHub existe → dispara ela;
#   3) nenhum dos dois → sobe o supervisor start-hub.ps1 DIRETO (destacado).
# Antes, task ausente => 'FALHOU' + exit SEM religar: o restart MATAVA o Hub e ninguém o trazia de
# volta (foi exatamente o que derrubou a aplicação — a task JarvisHub não está registrada nesta
# máquina, só a JarvisWake). Agora o restart nunca deixa o Hub caído.
Start-Sleep -Seconds 3
$supAlive = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'start-hub\.ps1' } | Select-Object -First 1
$task = Get-ScheduledTask -TaskName 'JarvisHub' -ErrorAction SilentlyContinue
if ($supAlive) {
  Set-Status "supervisor start-hub.ps1 vivo (pid $($supAlive.ProcessId)) — ele relança o Hub"
} elseif ($task) {
  if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName 'JarvisHub' -ErrorAction SilentlyContinue }
} else {
  $startHub = Join-Path $PSScriptRoot 'start-hub.ps1'
  if (Test-Path $startHub) {
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$startHub) | Out-Null
    Set-Status 'task JarvisHub ausente — supervisor start-hub.ps1 iniciado direto (destacado)'
  } else {
    Set-Status 'FALHOU: nem task JarvisHub nem scripts\start-hub.ps1 encontrados'; exit 1
  }
}

Set-Status 'aguardando o Hub voltar a escutar na 4577...'
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
}
if ($ok) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  Set-Status "OK: Hub no ar na porta $port (pid $($c.OwningProcess))"
} else {
  Set-Status "FALHOU: Hub nao voltou a escutar na $port em ~40s. Veja ~/.jarvis/hub.log"
}
