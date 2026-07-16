# Registra a tarefa agendada "JarvisHub" para subir o Hub automaticamente no logon.
# Roda como o usuário atual, sem privilégios de admin, sem limite de tempo (é servidor).
$script  = Join-Path $PSScriptRoot 'start-hub.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $script)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# RestartCount é backstop caso o próprio supervisor (start-hub.ps1) morra — o self-heal
# do node fica no loop do launcher. ExecutionTimeLimit=0 porque é servidor (roda sem fim).
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 30 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

# Mesma garantia do runner: o serviço tem que ser a única instância. IgnoreNew só cobre a task;
# um `npm start` esquecido num terminal continuaria segurando a porta do Hub.
try { Stop-ScheduledTask -TaskName 'JarvisHub' -ErrorAction Stop } catch { <# nao instalada ainda #> }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'apps[\\/]hub[\\/]src[\\/]index\.ts' } |
  ForEach-Object {
    Write-Host "Encerrando hub ja em execucao (pid $($_.ProcessId)) — o servico assume a partir de agora." -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Register-ScheduledTask -TaskName 'JarvisHub' `
  -Description 'Sobe o Jarvis Hub no logon (com warmup do token do Claude).' `
  -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null

Write-Host 'OK: tarefa "JarvisHub" registrada (gatilho: logon do usuario).'
Write-Host 'Para testar agora sem reiniciar:  Start-ScheduledTask -TaskName JarvisHub'
Write-Host 'Para remover:                      powershell -File scripts\uninstall-autostart.ps1'
