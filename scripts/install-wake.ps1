# Registra (ou corrige) a tarefa agendada "JarvisWake": o listener local do "Hey Jarvis".
#
# Por que este script existe (analise de 2026-10-07): a tarefa era criada a mao, so com gatilho de
# logon e `powershell -WindowStyle Hidden`. Com o Windows Terminal como terminal padrao, o console da
# tarefa vira uma JANELA visivel; fechar essa janela matou o listener e o supervisor juntos em 30/09
# ("forrtl: error (200): program aborting due to window-CLOSE event"), e nada o religou ate o proximo
# logon. RestartCount da tarefa so cobre falha AO INICIAR, nao processo que morre depois.
#
# O que muda:
#   - conhost.exe --headless: console sem janela, entao nao ha o que fechar;
#   - gatilho de repeticao a cada 5 min + IgnoreNew: se o supervisor morrer, volta em ate 5 min, e
#     enquanto ele vive o gatilho e um no-op;
#   - LogonType Interactive: o microfone e da sessao do usuario (nao roda na sessao 0 de servico).
#
# Roda como o usuario atual, sem admin. Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\install-wake.ps1          # registra e inicia
#   powershell -ExecutionPolicy Bypass -File scripts\install-wake.ps1 -NoStart # so registra
param([switch]$NoStart)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'start-wake.ps1'
$win = [Environment]::GetFolderPath('Windows')
$ps = Join-Path $win 'System32\WindowsPowerShell\v1.0\powershell.exe'
$conhost = Join-Path $win 'System32\conhost.exe'
$user = '{0}\{1}' -f [Environment]::UserDomainName, [Environment]::UserName

$action = New-ScheduledTaskAction -Execute $conhost `
  -Argument ('--headless "{0}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{1}"' -f $ps, $script)
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

# A instancia antiga (com janela) precisa sair, senao IgnoreNew mantem ela de pe.
try { Stop-ScheduledTask -TaskName 'JarvisWake' -ErrorAction Stop } catch { <# nao instalada ou parada #> }
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'wake_listener\.py' } |
  ForEach-Object { Write-Host "Encerrando listener antigo (pid $($_.ProcessId))" -ForegroundColor Yellow; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Register-ScheduledTask -TaskName 'JarvisWake' `
  -Description 'Listener local do "Hey Jarvis" (services/voice/wake_listener.py), sem janela, religado a cada 5 min se cair.' `
  -Action $action -Trigger @($atLogon, $every5) -Settings $settings -Principal $principal -Force | Out-Null
Write-Host 'OK: tarefa "JarvisWake" registrada (logon + verificacao a cada 5 min, sem janela).'

if (-not $NoStart) {
  Start-ScheduledTask -TaskName 'JarvisWake'
  Start-Sleep -Seconds 8
  $alive = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'wake_listener\.py' }
  if ($alive) { Write-Host "Listener no ar (pid $($alive.ProcessId -join ', ')). Estado do microfone: Ajustes > Voz, ou ~/.jarvis/wake.log" -ForegroundColor Green }
  else { Write-Host 'Listener ainda nao apareceu - veja ~/.jarvis/wake.log' -ForegroundColor Yellow }
}
