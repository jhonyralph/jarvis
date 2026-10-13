<#
  install-voice.ps1 — instala a stack de voz local (TTS, STT, wake word, identificação de voz e
  memória semântica) no Windows. Par do scripts/install-voice.sh.

  Existe pelo mesmo motivo do par unix: até aqui NÃO havia script que rodasse o pip — a instrução
  era um `pip install -r` solto na documentação. Aqui o teto é só o de versão de Python (3.10-3.13);
  o teto de ARQUITETURA que motivou tudo isso é exclusivo do Mac Intel, onde o torch parou na 2.2.2.

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts\install-voice.ps1
    powershell -ExecutionPolicy Bypass -File scripts\install-voice.ps1 -CoreOnly
#>
param(
  [switch]$CoreOnly
)
# O run.mjs/README anunciam `npm run install:voice -- --core` para os TRÊS sistemas, e o PowerShell
# não casa `--core` com um [switch]. Sem isto a flag documentada era ignorada em silêncio no
# Windows: o script instalava a stack inteira achando que o usuário não tinha pedido --core.
if ($args -contains '--core' -or $args -contains '--core-only') { $CoreOnly = $true }
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

# No Windows o `python3` é o stub da Microsoft Store (abre a loja em vez de rodar), por isso
# `python` vem primeiro — é o inverso do unix, e o mesmo critério do apps/hub/src/python.ts.
$py = $env:JARVIS_PYTHON
if (-not $py) {
  foreach ($c in @('python', 'python3', 'py')) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break }
  }
}
if (-not $py) { Write-Host 'Python nao encontrado. Instale o Python 3.12 e rode de novo.' -ForegroundColor Red; exit 1 }

$pyv = & $py -c 'import sys; print("%d.%d" % sys.version_info[:2])'
$pyarch = & $py -c 'import platform; print(platform.machine())'
Write-Host "Python: $py  (versao $pyv, arquitetura $pyarch)"
$parts = $pyv.Split('.')
$maj = [int]$parts[0]; $min = [int]$parts[1]

if ($maj -ne 3 -or $min -lt 10) {
  Write-Host "ERRO: Python 3.10+ obrigatorio (encontrado $pyv)." -ForegroundColor Red; exit 1
}
# Nao ha teto superior no Windows. Verificado resolvendo contra o PyPI com
# `--platform win_amd64 --python-version 3.14`: resolve, com onnxruntime 1.31.0. O teto que existe
# e exclusivo do Mac Intel (torch parou na 2.2.2 para x86_64) e de Linux (tflite-runtime para no
# cp311) - ver scripts/install-voice.sh. Barrar 3.14 aqui bloqueava maquina que funciona.

$req = Join-Path $repo 'services\voice\requirements.txt'
$voiceid = Join-Path $repo 'services\voice\requirements-voiceid.txt'

# Cada pip e conferido na hora. $ErrorActionPreference='Stop' NAO aborta em comando nativo que sai
# != 0 ($PSNativeCommandUseErrorActionPreference e $false por default, inclusive no PS 5.1 que o
# run.mjs invoca), e $LASTEXITCODE guarda so o ULTIMO comando. Como o segundo pip e
# `--no-deps resemblyzer`, que nao resolve nada e sai 0 sozinho, uma falha do pip principal
# terminava com "Reinicie o Hub" na tela e a stack pela metade.
function Invoke-Pip {
  param([string[]]$PipArgs, [string]$What)
  & $py -m pip @PipArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Host "pip falhou em: $What" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

Write-Host 'Instalando...' -ForegroundColor Cyan
if ($CoreOnly) {
  Invoke-Pip @('install','--upgrade','-r',$req) 'nucleo (TTS/STT/wake word)'
} else {
  # Uma invocacao com os dois arquivos: em duas, o scipy fica compilado contra um numpy diferente
  # do que acaba instalado (ver o comentario em requirements-voiceid.txt).
  Invoke-Pip @('install','--upgrade','-r',$req,'-r',$voiceid) 'nucleo + identificacao de voz'
  # resemblyzer com --no-deps: a dist `webrtcvad` nao tem wheel nenhuma e compila C. O fork
  # webrtcvad-wheels, instalado acima, expoe o mesmo modulo.
  Invoke-Pip @('install','--no-deps','resemblyzer>=0.1.4') 'resemblyzer (--no-deps)'
}

Write-Host ''
Write-Host 'Baixando as vozes do Piper em ~/.jarvis/voices...' -ForegroundColor Cyan
& $py -m piper.download_voices en_GB-alan-medium pt_BR-faber-medium
if ($LASTEXITCODE -ne 0) { Write-Host "  (falhou - rode depois: $py -m piper.download_voices pt_BR-faber-medium)" }

Write-Host ''
Write-Host 'Verificando o que ficou instalado:' -ForegroundColor Cyan
Push-Location $repo
try { & node --import tsx apps/hub/src/python.ts } catch { } finally { Pop-Location }

Write-Host ''
Write-Host 'Reinicie o Hub para ele pegar o interpretador: npm run restart:hub'
