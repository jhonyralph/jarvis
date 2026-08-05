<#
enable-autologin.ps1 — liga o auto-login do Windows para que, após um reboot SEM alguém logar,
a sessão do usuário suba sozinha e as tarefas "AtLogOn" (JarvisHub / JarvisRunner) iniciem o
Hub/Runner sem intervenção. É o passo que falta para o serviço sobreviver a um reboot headless.

⚠  SEGURANÇA — leia antes: auto-login DESBLOQUEIA a sessão do usuário automaticamente no boot.
   Qualquer pessoa com ACESSO FÍSICO à máquina entra sem senha. Use apenas em máquina de confiança
   (ex.: servidor doméstico atrás do Tailscale). Este método grava a senha em TEXTO no registro
   (HKLM\...\Winlogon\DefaultPassword). Para armazenamento CRIPTOGRAFADO, prefira o Sysinternals
   Autologon (veja docs/runner-install.md).

Uso (como ADMINISTRADOR):
   powershell -ExecutionPolicy Bypass -File scripts\enable-autologin.ps1              # usuário atual
   powershell -ExecutionPolicy Bypass -File scripts\enable-autologin.ps1 -User Conta
   powershell -ExecutionPolicy Bypass -File scripts\enable-autologin.ps1 -Disable     # reverte
#>
param(
  [string]$User = $env:USERNAME,
  [switch]$Disable
)
$ErrorActionPreference = 'Stop'
$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

# HKLM\...\Winlogon exige elevação — falha cedo com mensagem clara em vez de um erro de acesso cru.
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Rode como Administrador (necessário para escrever em HKLM\...\Winlogon)."
}

if ($Disable) {
  Set-ItemProperty -Path $key -Name 'AutoAdminLogon' -Value '0'
  Remove-ItemProperty -Path $key -Name 'DefaultPassword' -ErrorAction SilentlyContinue
  Write-Host "Auto-login DESATIVADO — a maquina volta a exigir login no boot."
  return
}

Write-Host "AVISO: a sessao de '$User' sera desbloqueada automaticamente em todo boot." -ForegroundColor Yellow
Write-Host "       Quem tiver acesso fisico entra sem senha. Prossiga so em maquina de confianca." -ForegroundColor Yellow
# A senha vai direto para o registro do Windows; este repositorio NUNCA a grava/loga.
$sec  = Read-Host "Senha de '$User'" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

Set-ItemProperty -Path $key -Name 'AutoAdminLogon'    -Value '1'
Set-ItemProperty -Path $key -Name 'DefaultUserName'   -Value $User
Set-ItemProperty -Path $key -Name 'DefaultDomainName' -Value $env:COMPUTERNAME
Set-ItemProperty -Path $key -Name 'DefaultPassword'   -Value $plain
$plain = $null

Write-Host "Auto-login ATIVADO para '$User'."
Write-Host "No proximo boot a sessao sobe sozinha e as tarefas JarvisHub/JarvisRunner (AtLogOn) iniciam."
Write-Host "Reverter:   scripts\enable-autologin.ps1 -Disable"
Write-Host "Alternativa CRIPTOGRAFADA (recomendada): Sysinternals Autologon — docs/runner-install.md"
