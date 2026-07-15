<#
  jarvis.ps1 — host-side recovery/admin for Jarvis auth (loopback only).

  Talks to the Hub's admin API on 127.0.0.1 (never exposed to the network), so it
  works even when NO device is logged in — the answer to "how do I generate a code
  if I have no devices?". You must run it ON the host machine.

  Uso:
    .\scripts\jarvis.ps1 owner            # gera convite de DONO (recuperar acesso)
    .\scripts\jarvis.ps1 invite           # gera convite de MEMBRO
    .\scripts\jarvis.ps1 invite -ttl 3600 # convite de membro válido por 1h
    .\scripts\jarvis.ps1 status           # dispositivos + convites pendentes
    .\scripts\jarvis.ps1 claimcode        # mostra o código de claim (se ainda sem dono)
    .\scripts\jarvis.ps1 revoke -deviceId <id>
    .\scripts\jarvis.ps1 revoke-all       # revoga TODOS os dispositivos (reset)
#>
param(
  [Parameter(Position = 0)][string]$cmd = 'status',
  [int]$ttl = 86400,
  [string]$deviceId = ''
)
$port = if ($env:JARVIS_ADMIN_PORT) { $env:JARVIS_ADMIN_PORT } else { 4578 }
$base = "http://127.0.0.1:$port"

function Show-Invite($r) {
  Write-Host ''
  Write-Host '  Código do convite:' -ForegroundColor Cyan
  Write-Host "    $($r.code)" -ForegroundColor White
  if ($r.link) {
    Write-Host '  Link (abra no dispositivo novo):' -ForegroundColor Cyan
    Write-Host "    $($r.link)" -ForegroundColor White
  }
  Write-Host ''
  Write-Host '  No app: recarregue e cole o código na tela de pareamento.' -ForegroundColor DarkGray
}

try {
  switch ($cmd) {
    'owner'      { Show-Invite (Invoke-RestMethod -Method Post "$base/admin/invite" -Body (@{ role = 'owner'; ttlSec = $ttl } | ConvertTo-Json) -ContentType 'application/json') }
    'invite'     { Show-Invite (Invoke-RestMethod -Method Post "$base/admin/invite" -Body (@{ role = 'member'; ttlSec = $ttl } | ConvertTo-Json) -ContentType 'application/json') }
    'status'     { Invoke-RestMethod "$base/admin/status" | ConvertTo-Json -Depth 6 }
    'claimcode'  { $r = Invoke-RestMethod "$base/admin/claimcode"; if ($r.claimed) { Write-Host 'Já reivindicado. Use "owner" para gerar um convite de dono.' } else { Write-Host "Claim code: $($r.code)" -ForegroundColor Cyan } }
    'revoke'     { if (-not $deviceId) { Write-Host 'Informe -deviceId <id> (veja em status).' -ForegroundColor Yellow } else { Invoke-RestMethod -Method Post "$base/admin/revoke" -Body (@{ deviceId = $deviceId } | ConvertTo-Json) -ContentType 'application/json' | ConvertTo-Json } }
    'revoke-all' { Invoke-RestMethod -Method Post "$base/admin/revoke-all" | ConvertTo-Json }
    default      { Write-Host "Comando desconhecido: $cmd. Use owner|invite|status|claimcode|revoke|revoke-all." -ForegroundColor Yellow }
  }
} catch {
  Write-Host "Falha ao falar com o Hub em $base — o Jarvis está rodando?" -ForegroundColor Red
  Write-Host "  ($($_.Exception.Message))" -ForegroundColor DarkGray
}
