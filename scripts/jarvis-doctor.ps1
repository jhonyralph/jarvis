<#
  jarvis-doctor.ps1 — pre-flight / health check for a Jarvis machine (Windows).

  Answers "is this box set up correctly?" WITHOUT changing anything: checks the runtime, the agent
  CLI, ports, config, the Hub's /health, autostart, Tailscale, and (optional) the voice deps, then
  prints PASS/WARN/FAIL with a concrete fix for each miss. Read-only; safe to run any time.

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts\jarvis-doctor.ps1
    powershell -ExecutionPolicy Bypass -File scripts\jarvis-doctor.ps1 -Role runner   # runner-box checks

  Exit code: 0 if nothing FAILED (warnings allowed), 1 if any hard check FAILED.
#>
param([ValidateSet('hub', 'runner')][string]$Role = 'hub')

$repo = Split-Path $PSScriptRoot -Parent
$jhome = if ($env:JARVIS_HOME) { $env:JARVIS_HOME } else { $env:USERPROFILE }
$jdir = Join-Path $jhome '.jarvis'
$port = if ($env:JARVIS_PORT) { [int]$env:JARVIS_PORT } else { 4577 }
$adminPort = if ($env:JARVIS_ADMIN_PORT) { [int]$env:JARVIS_ADMIN_PORT } else { 4578 }

$script:ok = 0; $script:warn = 0; $script:fail = 0
function Pass($m) { Write-Host "  [OK]   $m" -ForegroundColor Green; $script:ok++ }
function Warn($m, $fix) { Write-Host "  [WARN] $m" -ForegroundColor Yellow; if ($fix) { Write-Host "         → $fix" -ForegroundColor DarkGray }; $script:warn++ }
function Fail($m, $fix) { Write-Host "  [FAIL] $m" -ForegroundColor Red; if ($fix) { Write-Host "         → $fix" -ForegroundColor DarkGray }; $script:fail++ }
function Have($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host ''
Write-Host "Jarvis — diagnóstico de ambiente ($Role)" -ForegroundColor Cyan
Write-Host "  repo=$repo  home=$jdir  port=$port" -ForegroundColor DarkGray
Write-Host ''

# 1) Node >= 22
try {
  $nv = (& node -v) 2>$null
  if (-not $nv) { Fail 'Node.js não encontrado no PATH.' 'Instale Node >= 22 (nodejs.org) e reabra o terminal.' }
  else {
    $major = [int]($nv.TrimStart('v').Split('.')[0])
    if ($major -ge 22) { Pass "Node $nv" }
    else { Fail "Node $nv é antigo (precisa >= 22)." 'Atualize o Node para 22+ (o hub/runner roda via tsx e exige 22).' }
  }
} catch { Fail 'Node.js não encontrado no PATH.' 'Instale Node >= 22 (nodejs.org).' }

# 2) Agent CLI presente (login não dá pra checar sem gastar um turno; só presença)
$anyAgent = $false
foreach ($a in @('claude', 'codex')) { if (Have $a) { Pass "Agent CLI '$a' no PATH"; $anyAgent = $true } }
if (-not $anyAgent) { Fail 'Nenhuma CLI de agente (claude/codex) no PATH.' "Instale ao menos uma e faça login (ex.: 'claude login'). Sem isso os turnos falham com 401." }
else { Warn 'Login da CLI não é verificável aqui (não gasto um turno).' "Se os turnos derem 401, rode 'claude login' / 'codex login' nesta máquina." }

# 3) Repo é um checkout do Jarvis + dependências instaladas
if (Test-Path (Join-Path $repo 'package.json')) {
  Pass 'package.json do repo encontrado'
  if (Test-Path (Join-Path $repo 'node_modules\tsx')) { Pass 'node_modules presentes (tsx instalado)' }
  else { Fail 'node_modules ausentes (tsx não instalado).' "Rode 'npm install' na raiz do repo." }
} else { Fail "Não parece um checkout do Jarvis ($repo)." 'Rode o doctor a partir do repositório clonado.' }

# 4) Portas
$hubListen = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($Role -eq 'hub') {
  if ($hubListen) { Pass "Porta $port com o Hub escutando (pid $($hubListen.OwningProcess | Select-Object -First 1))" }
  else { Warn "Nada escutando na $port." "Suba o Hub (scripts\start-hub.ps1 via tarefa 'JarvisHub') — ou ainda não iniciou." }
  $adminListen = Get-NetTCPConnection -LocalPort $adminPort -State Listen -ErrorAction SilentlyContinue
  if ($adminListen) {
    $loopback = ($adminListen.LocalAddress -eq '127.0.0.1' -or $adminListen.LocalAddress -eq '::1')
    if ($loopback) { Pass "Admin API $adminPort restrita a loopback" }
    else { Fail "Admin API $adminPort NÃO está em loopback ($($adminListen.LocalAddress))." 'A admin API deve ser 127.0.0.1 — verifique o binding.' }
  }
}

# 5) Config em ~/.jarvis
if (Test-Path $jdir) {
  Pass "Diretório de estado $jdir"
  if (Test-Path (Join-Path $jdir 'auth.json')) {
    try { $auth = Get-Content (Join-Path $jdir 'auth.json') -Raw | ConvertFrom-Json; if ($auth.claimed) { Pass 'Auth já reivindicada (tem dono)' } else { Warn 'Auth ainda sem dono (unclaimed).' "Abra o app e pareie com o claim code (.\scripts\jarvis.ps1 claimcode)." } } catch { Warn 'auth.json ilegível.' }
  } elseif ($Role -eq 'hub') { Warn 'auth.json ausente (Hub ainda não subiu uma vez).' 'Inicie o Hub uma vez para gerar auth + claim code.' }
  if ($Role -eq 'runner') {
    if (Test-Path (Join-Path $jdir 'runner.env')) { Pass 'runner.env presente' } else { Fail 'runner.env ausente.' 'Rode scripts\install-runner.ps1 com -Hub e -Token.' }
    if ($env:JARVIS_TOKEN) { Pass 'JARVIS_TOKEN definido no ambiente' } else { Warn 'JARVIS_TOKEN não está no ambiente atual.' 'Normal se vier do runner.env no serviço; sem ele o Hub rejeita o registro.' }
  }
} else { Warn "Sem $jdir ainda." 'É criado no primeiro start do Hub/runner.' }

# 6) Hub /health (código novo — confirma que o servidor no ar tem as features atuais)
if ($Role -eq 'hub' -and $hubListen) {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
    if ($h.ok) { Pass "/health OK — uptime $([int]$h.uptime)s, runners $($h.runners)" }
    else { Warn '/health respondeu sem ok=true.' }
  } catch { Warn "/health não respondeu (404 = Hub rodando código antigo, sem essa rota)." 'Reinicie o Hub (scripts\restart-hub.ps1 -Wait) para carregar o código atual.' }
}

# 7) Tailscale (transporte assumido, mas opcional/operador)
if (Have 'tailscale') {
  try { $ts = (& tailscale status 2>$null); if ($ts) { Pass 'Tailscale ativo' } else { Warn 'Tailscale instalado mas sem status.' "Rode 'tailscale up'." } } catch { Warn 'Tailscale presente mas não respondeu.' }
} else { Warn 'Tailscale não encontrado.' 'Recomendado para acesso remoto seguro (a rede assumida). LAN/local funciona sem.' }

# 8) Autostart (tarefa agendada)
$taskName = if ($Role -eq 'hub') { 'JarvisHub' } else { 'JarvisRunner' }
try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) { if ($task.State -eq 'Running') { Pass "Tarefa '$taskName' registrada e rodando" } else { Warn "Tarefa '$taskName' registrada mas '$($task.State)'." "Start-ScheduledTask $taskName" } }
  else { Warn "Tarefa de autostart '$taskName' não registrada." 'Rode scripts\install-autostart.ps1 (hub) ou install-runner.ps1 (runner).' }
} catch { Warn "Não consegui checar a tarefa '$taskName'." }

# 9) Voz (opcional; só no Hub)
if ($Role -eq 'hub') {
  $py = if ($env:JARVIS_PYTHON) { $env:JARVIS_PYTHON } else { 'python' }
  if (Have $py) {
    $mods = & $py -c "import importlib.util as u; print(','.join(m for m in ['piper','faster_whisper','openwakeword'] if u.find_spec(m)))" 2>$null
    if ($mods) { Pass "Voz: Python + módulos [$mods]" }
    else { Warn 'Voz: Python presente, mas piper/faster_whisper/openwakeword ausentes.' 'Opcional — para voz: pip install -r services/voice/requirements.txt' }
  } else { Warn 'Voz: Python não encontrado.' 'Opcional — o Hub roda em modo texto sem voz.' }
}

Write-Host ''
Write-Host "Resumo: $script:ok OK · $script:warn avisos · $script:fail falhas" -ForegroundColor Cyan
if ($script:fail -gt 0) { Write-Host 'Há falhas que bloqueiam o funcionamento — veja os → acima.' -ForegroundColor Red; exit 1 }
elseif ($script:warn -gt 0) { Write-Host 'Funciona, com ressalvas (avisos acima).' -ForegroundColor Yellow; exit 0 }
else { Write-Host 'Tudo certo.' -ForegroundColor Green; exit 0 }
