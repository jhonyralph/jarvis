<#
  jarvis-setup.ps1 — guided first-run for a Jarvis HUB (Windows).

  A thin orchestrator over the pieces that already exist (it does NOT reinvent OS specifics):
    deps (npm install) -> hub.env -> autostart service (install-autostart.ps1) -> start -> wait
    for /health -> show the CLAIM CODE + phone instructions -> final doctor verdict.

  Idempotent: keeps an existing hub.env, and re-registering the service will restart a running Hub.

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts\jarvis-setup.ps1
    powershell -ExecutionPolicy Bypass -File scripts\jarvis-setup.ps1 -Agent codex -PublicUrl https://meu-host -Port 4577
    powershell -ExecutionPolicy Bypass -File scripts\jarvis-setup.ps1 -SkipStart   # configura sem subir
#>
param(
  [string]$Agent = 'claude-code',
  [string]$PublicUrl = '',
  [int]$Port = 4577,
  [switch]$SkipStart
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$jdir = Join-Path $env:USERPROFILE '.jarvis'
function Step($m) { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }

Write-Host ''
Write-Host 'Jarvis — setup guiado do Hub (Windows)' -ForegroundColor Cyan

# 1) Node (checagem rápida; o doctor no fim detalha o resto)
$nv = try { (& node -v) 2>$null } catch { $null }
if (-not $nv) { Write-Host 'Node.js não encontrado. Instale Node >= 22 (nodejs.org) e rode de novo.' -ForegroundColor Red; exit 1 }
if ([int]($nv.TrimStart('v').Split('.')[0]) -lt 22) { Write-Host "Node $nv é antigo — precisa >= 22." -ForegroundColor Red; exit 1 }
Write-Host "  Node $nv" -ForegroundColor DarkGray

# 2) Dependências
Step 'Dependências (npm install)'
if (Test-Path (Join-Path $repo 'node_modules\tsx')) { Write-Host '  já instaladas.' -ForegroundColor DarkGray }
else { Push-Location $repo; try { & npm install } finally { Pop-Location } }

# 3) hub.env (sem clobber; sem BOM para o parser do start-hub.ps1)
Step 'Configuração (~/.jarvis/hub.env)'
New-Item -ItemType Directory -Force -Path $jdir | Out-Null
$hubEnv = Join-Path $jdir 'hub.env'
if (Test-Path $hubEnv) { Write-Host '  hub.env já existe — mantido (edite à mão se quiser).' -ForegroundColor DarkGray }
else {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("JARVIS_AGENT=$Agent"); $lines.Add("JARVIS_PORT=$Port"); $lines.Add('JARVIS_AGENT_PERMISSION_MODE=full-access')
  if ($PublicUrl) { $lines.Add("JARVIS_PUBLIC_URL=$PublicUrl") } else { $lines.Add('# JARVIS_PUBLIC_URL=https://<seu-host>  # p/ links de convite completos') }
  [System.IO.File]::WriteAllLines($hubEnv, $lines)
  Write-Host "  hub.env criado (agent=$Agent, porta=$Port)." -ForegroundColor Green
}

# 4) Autostart (delega ao script que já sabe registrar a Task corretamente)
Step 'Serviço de autostart (JarvisHub)'
& (Join-Path $PSScriptRoot 'install-autostart.ps1')

# 5) Sobe + espera o /health
if (-not $SkipStart) {
  Step 'Subindo o Hub'
  Start-ScheduledTask -TaskName 'JarvisHub' -ErrorAction SilentlyContinue
  $up = $false
  for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 2; try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3).ok) { $up = $true; break } } catch { } }
  if ($up) { Write-Host "  Hub no ar em http://localhost:$Port" -ForegroundColor Green }
  else { Write-Host '  Hub ainda não respondeu — veja ~/.jarvis/hub.log (o doctor abaixo ajuda).' -ForegroundColor Yellow }
}

# 6) Acesso: claim code (1º pareamento) + instrução de celular
Step 'Acesso'
$claimFile = Join-Path $jdir 'claim-code.txt'
if (Test-Path $claimFile) {
  $code = (Get-Content $claimFile -Raw).Trim()
  Write-Host "  Abra http://localhost:$Port e cole o CLAIM CODE na tela de pareamento:" -ForegroundColor Cyan
  Write-Host "    $code" -ForegroundColor White
} else {
  Write-Host '  Sem claim code (já reivindicado, ou o Hub não subiu ainda).' -ForegroundColor DarkGray
  Write-Host '  Para gerar um convite de dono:  .\scripts\jarvis.ps1 owner' -ForegroundColor DarkGray
}
Write-Host "  Abrir no celular (Tailscale):  tailscale serve --bg http://127.0.0.1:$Port" -ForegroundColor DarkGray

# 7) Veredito final
Step 'Diagnóstico final'
& (Join-Path $PSScriptRoot 'jarvis-doctor.ps1')
