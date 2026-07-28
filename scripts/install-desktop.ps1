<#
  install-desktop.ps1 — instala/roda o cliente desktop (Electron) do Jarvis no Windows.

  O shell desktop mora em desktop/, FORA do workspace npm (toolchain propria: Electron +
  electron-builder), entao ele nao e instalado junto com o Hub/runner. Este script faz o
  ciclo completo: valida o ambiente, instala as dependencias, verifica se o binario do
  Electron realmente baixou e (opcional) builda o instalador ou abre o app.

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1
    powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -HubUrl "https://jarvis.minha-tailnet.ts.net"
    powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -Run     # instala e abre o app
    powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -Build   # instala e gera o instalador (dist/)

  Exit code: 0 = ok, 1 = falhou (cada falha imprime a correcao concreta).
#>
param(
  [string]$HubUrl = "",
  [switch]$Run,
  [switch]$Build,
  [switch]$Force   # reinstala do zero (apaga node_modules do desktop)
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$app = Join-Path $repo 'desktop'
$script:fail = 0

function Ok($m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn($m, $fix) { Write-Host "  [WARN] $m" -ForegroundColor Yellow; if ($fix) { Write-Host "         -> $fix" -ForegroundColor DarkGray } }
function Bad($m, $fix) { Write-Host "  [FAIL] $m" -ForegroundColor Red; if ($fix) { Write-Host "         -> $fix" -ForegroundColor DarkGray }; $script:fail++ }
function Have($n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }

Write-Host ''
Write-Host 'Jarvis desktop (Electron) - instalacao' -ForegroundColor Cyan
Write-Host "  repo=$repo" -ForegroundColor DarkGray
Write-Host ''

# --- 1. ambiente -------------------------------------------------------------------------------
Write-Host 'Ambiente' -ForegroundColor White
if (-not (Test-Path $app)) {
  Bad "pasta desktop/ nao encontrada em $repo" 'rode este script de dentro do repo clonado do Jarvis'
  exit 1
}
Ok "pasta do app: $app"

if (-not (Have 'node')) {
  Bad 'Node.js nao encontrado no PATH' 'instale o Node 22+ em https://nodejs.org e reabra o terminal'
} else {
  $nodeV = (& node -v) -replace '^v', ''
  $major = [int]($nodeV -split '\.')[0]
  if ($major -lt 22) { Bad "Node $nodeV e antigo (o Jarvis exige >= 22)" 'atualize em https://nodejs.org' }
  else { Ok "Node $nodeV" }
}

if (-not (Have 'npm')) {
  Bad 'npm nao encontrado no PATH' 'reinstale o Node.js (o npm vem junto) e reabra o terminal'
} else {
  Ok "npm $(& npm -v)"
}

if ($script:fail -gt 0) { Write-Host ''; Write-Host 'Corrija os itens acima e rode de novo.' -ForegroundColor Red; exit 1 }

# --- 2. dependencias ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'Dependencias' -ForegroundColor White
Push-Location $app
try {
  if ($Force -and (Test-Path 'node_modules')) {
    Write-Host '  removendo node_modules (--Force)...' -ForegroundColor DarkGray
    Remove-Item -Recurse -Force 'node_modules'
  }

  # `npm ci` exige lockfile; desktop/ pode nao ter (nao faz parte do workspace). Cai para
  # `npm install`, que TAMBEM gera o package-lock.json para as proximas instalacoes serem
  # deterministicas. Nunca falha so porque o lock ainda nao existe.
  $cmd = if (Test-Path 'package-lock.json') { 'ci' } else { 'install' }
  Write-Host "  npm $cmd (pode demorar: baixa o binario do Electron ~100MB)..." -ForegroundColor DarkGray
  & npm.cmd $cmd
  if ($LASTEXITCODE -ne 0) {
    # npm ci e estrito: um lock dessincronizado do package.json aborta. O fallback resolve
    # sozinho em vez de exigir que o usuario descubra isso.
    if ($cmd -eq 'ci') {
      Warn 'npm ci falhou (lockfile dessincronizado?) - tentando npm install' ''
      & npm.cmd install
      if ($LASTEXITCODE -ne 0) { Bad "npm install falhou (codigo $LASTEXITCODE)" 'veja o erro acima; rode com -Force para reinstalar do zero' }
    } else {
      Bad "npm install falhou (codigo $LASTEXITCODE)" 'veja o erro acima; se for proxy/rede, configure npm config set proxy'
    }
  }
  if ($script:fail -eq 0) { Ok "dependencias instaladas (npm $cmd)" }

  # O postinstall do Electron baixa um binario separado; atras de proxy/firewall ele falha
  # SILENCIOSAMENTE e so quebra na hora de abrir. Verificamos de verdade.
  if ($script:fail -eq 0) {
    $probe = & node -e "try{console.log(require('electron'))}catch(e){console.log('MISSING')}" 2>$null
    if ($probe -match 'MISSING' -or -not $probe) {
      Bad 'binario do Electron nao baixou' 'rode: cd desktop; npm install electron --force  (ou configure ELECTRON_MIRROR atras de proxy)'
    } else {
      $ev = & node -e "try{console.log(require('electron/package.json').version)}catch(e){}" 2>$null
      Ok "Electron $ev pronto"
    }
  }
} finally { Pop-Location }

if ($script:fail -gt 0) { Write-Host ''; Write-Host 'Instalacao incompleta.' -ForegroundColor Red; exit 1 }

# --- 3. Hub de destino -------------------------------------------------------------------------
Write-Host ''
Write-Host 'Hub' -ForegroundColor White
if ($HubUrl) {
  [Environment]::SetEnvironmentVariable('JARVIS_APP_HUB_URL', $HubUrl, 'User')
  $env:JARVIS_APP_HUB_URL = $HubUrl
  Ok "JARVIS_APP_HUB_URL=$HubUrl (salvo para o seu usuario)"
} elseif ($env:JARVIS_APP_HUB_URL) {
  Ok "JARVIS_APP_HUB_URL=$($env:JARVIS_APP_HUB_URL) (ja definido)"
} else {
  Warn 'JARVIS_APP_HUB_URL nao definido - o app vai apontar para http://127.0.0.1:4577' 'para um Hub remoto: -HubUrl "https://<hub>.ts.net"'
}

# --- 4. build / run (opcionais) ----------------------------------------------------------------
Push-Location $app
try {
  if ($Build) {
    Write-Host ''
    Write-Host 'Build do instalador' -ForegroundColor White
    & npm.cmd run dist -- --win
    if ($LASTEXITCODE -ne 0) { Bad "electron-builder falhou (codigo $LASTEXITCODE)" 'veja o erro acima' }
    else { Ok "instalador gerado em $(Join-Path $app 'dist')" }
  }
  if ($Run -and $script:fail -eq 0) {
    Write-Host ''
    Write-Host 'Abrindo o app...' -ForegroundColor White
    & npm.cmd start
  }
} finally { Pop-Location }

Write-Host ''
if ($script:fail -gt 0) { Write-Host 'Terminou com falhas.' -ForegroundColor Red; exit 1 }
Write-Host 'Pronto.' -ForegroundColor Green
if (-not $Run) {
  Write-Host '  abrir o app:      powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -Run' -ForegroundColor DarkGray
  Write-Host '  gerar instalador: powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -Build' -ForegroundColor DarkGray
}
exit 0
