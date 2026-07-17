<#
  restart-hub.ps1 - reinicia o Jarvis Hub num UNICO comando (derruba + sobe + confirma).

  Por que um script so: o Hub roda sob o supervisor start-hub.ps1 (task agendada "JarvisHub"),
  cujo loop ressuscita o node assim que ele cai - e como o tsx sobe direto do source, o restart
  ja pega o codigo novo. Matar o node e mandar o Start em passos separados abre uma janela pra
  travar entre um e outro (foi essa a dor: "para aqui e nao continua"). Aqui e atomico e ainda
  confirma que a porta 4577 voltou a escutar antes de declarar sucesso.

  Uso:  powershell -ExecutionPolicy Bypass -File scripts\restart-hub.ps1
#>
$ErrorActionPreference = 'Continue'
$port = 4577

Write-Host 'Reiniciando o Jarvis Hub...' -ForegroundColor Cyan

# 1) Derruba a instancia atual na 4577 (o processo node interno do supervisor).
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  $hubPid = $conn.OwningProcess
  Write-Host "Encerrando Hub atual (pid $hubPid) na porta $port..." -ForegroundColor Yellow
  Stop-Process -Id $hubPid -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "Nada escutando na $port - vou apenas garantir que o supervisor suba." -ForegroundColor Yellow
}

# 2) O loop supervisor (start-hub.ps1) relanca sozinho em ~3s com o source atualizado.
#    Start-ScheduledTask e so fallback caso o proprio supervisor tenha morrido; com
#    -MultipleInstances IgnoreNew a chamada e inocua quando ele ja esta de pe.
Start-Sleep -Seconds 4
$task = Get-ScheduledTask -TaskName 'JarvisHub' -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host 'Task JarvisHub nao registrada. Rode uma vez: scripts\install-autostart.ps1' -ForegroundColor Red
  exit 1
}
if ($task.State -ne 'Running') {
  Write-Host 'Supervisor nao estava rodando - iniciando a task JarvisHub.' -ForegroundColor Yellow
  Start-ScheduledTask -TaskName 'JarvisHub' -ErrorAction SilentlyContinue
}

# 3) Confirma que voltou a escutar na 4577 (espera ate ~30s) antes de dizer que subiu.
$ok = $false
foreach ($i in 1..15) {
  Start-Sleep -Seconds 2
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
}
if ($ok) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  Write-Host "Hub no ar de novo na porta $port (pid $($c.OwningProcess))." -ForegroundColor Green
} else {
  Write-Host "Hub nao voltou a escutar na $port em ~30s. Veja ~/.jarvis/hub.log." -ForegroundColor Red
  exit 1
}
