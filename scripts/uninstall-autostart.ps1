# Remove a tarefa agendada "JarvisHub" (desliga o autostart do Hub).
if (Get-ScheduledTask -TaskName 'JarvisHub' -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName 'JarvisHub' -Confirm:$false
  Write-Host 'OK: tarefa "JarvisHub" removida.'
} else {
  Write-Host 'Tarefa "JarvisHub" nao existe — nada a remover.'
}
