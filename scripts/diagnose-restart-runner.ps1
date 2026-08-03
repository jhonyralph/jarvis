<#
  diagnose-restart-runner.ps1 — Passos 1→2 do playbook de recuperação do runner (ex.: Luby).

  Roda NA MÁQUINA DO RUNNER (não no Hub). Mostra o estado atual + as últimas linhas do log
  (Passo 1 — diagnóstico), depois faz o restart padrão da tarefa "JarvisRunner" (Passo 2):
  para a tarefa, garante que nenhum node.exe do runner ficou órfão, sobe de novo e imprime
  o log fresco. Não mexe em lock de update nem em node_modules — se o log indicar isso
  ("update em andamento" ou "tsx nao encontrado"), o script avisa e para (Passos 3/4 são
  manuais, ver runner-update-incident).

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts\diagnose-restart-runner.ps1
#>
$ErrorActionPreference = 'Continue'
$log = Join-Path $env:USERPROFILE '.jarvis\runner.log'
$lockFile = Join-Path (if ($env:JARVIS_HOME) { $env:JARVIS_HOME } else { $env:USERPROFILE }) '.jarvis\runner-update.lock'

function Show-LogTail([int]$n = 30) {
  if (Test-Path $log) { Get-Content -LiteralPath $log -Tail $n }
  else { Write-Host "(sem runner.log em $log ainda)" -ForegroundColor DarkGray }
}

Write-Host "== Passo 1: diagnóstico ==" -ForegroundColor Cyan
$task = Get-ScheduledTask -TaskName 'JarvisRunner' -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "Tarefa 'JarvisRunner' não encontrada — precisa instalar com scripts\install-runner.ps1 (não este script)." -ForegroundColor Red
  exit 1
}
Write-Host ("Estado da tarefa: {0}" -f $task.State)
Write-Host "--- últimas 30 linhas do runner.log ---"
Show-LogTail 30

if (Test-Path $lockFile) {
  Write-Host "`nAVISO: existe runner-update.lock — um update pode estar em andamento." -ForegroundColor Yellow
  Write-Host "Este script NÃO mexe no lock. Se o log acima mostrar 'update em andamento' preso, isso é o Passo 3 (manual):" -ForegroundColor Yellow
  Write-Host "  Remove-Item `"$lockFile`" -Force" -ForegroundColor Yellow
  Write-Host "Interrompendo aqui para não mascarar o problema." -ForegroundColor Yellow
  exit 1
}
if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'tsx nao encontrado' -SimpleMatch -Quiet -ErrorAction SilentlyContinue)) {
  Write-Host "`nAVISO: log recente menciona 'tsx nao encontrado' — pode ser node_modules corrompido (Passo 4, manual):" -ForegroundColor Yellow
  Write-Host "  Stop-ScheduledTask -TaskName JarvisRunner; cd <pasta do repo>; npm ci; Start-ScheduledTask -TaskName JarvisRunner" -ForegroundColor Yellow
  Write-Host "Seguindo mesmo assim com o restart padrão (Passo 2) — se persistir, rode o Passo 4 manualmente." -ForegroundColor Yellow
}

Write-Host "`n== Passo 2: restart padrão ==" -ForegroundColor Cyan
Stop-ScheduledTask -TaskName 'JarvisRunner' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'apps\\runner\\src\\index\.ts' } |
  ForEach-Object {
    Write-Host ("Encerrando node.exe órfão do runner (pid {0})" -f $_.ProcessId)
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName 'JarvisRunner'
Write-Host "Tarefa disparada. Aguardando ~8s para o runner subir e registrar..." -ForegroundColor DarkGray
Start-Sleep -Seconds 8

Write-Host "`n== resultado ==" -ForegroundColor Cyan
$task2 = Get-ScheduledTask -TaskName 'JarvisRunner' -ErrorAction SilentlyContinue
Write-Host ("Estado da tarefa: {0}" -f $task2.State)
Write-Host "--- últimas 20 linhas do runner.log (pós-restart) ---"
Show-LogTail 20
Write-Host "`nCole esta saída completa se a Luby ainda não aparecer online no Hub." -ForegroundColor Cyan
