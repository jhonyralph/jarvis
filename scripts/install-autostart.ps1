# Registra a tarefa agendada "JarvisHub" para subir o Hub automaticamente no logon.
# Roda como o usuário atual, sem privilégios de admin, sem limite de tempo (é servidor).
$script  = Join-Path $PSScriptRoot 'start-hub.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $script)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'JarvisHub' `
  -Description 'Sobe o Jarvis Hub no logon (com warmup do token do Claude).' `
  -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null

Write-Host 'OK: tarefa "JarvisHub" registrada (gatilho: logon do usuario).'
Write-Host 'Para testar agora sem reiniciar:  Start-ScheduledTask -TaskName JarvisHub'
Write-Host 'Para remover:                      powershell -File scripts\uninstall-autostart.ps1'
