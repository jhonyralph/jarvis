/**
 * O updater DESTACADO do Windows, como texto de script PowerShell.
 *
 * Vive num módulo próprio (e sem efeito colateral no import) por um motivo caro: este script é a
 * ÚNICA via de atualização suportada no Windows — o caminho in-process é recusado de propósito lá
 * (um `npm ci` com o runner vivo destrói o node_modules) — e, mesmo assim, ele nunca teve teste.
 * Ficou ~2 semanas quebrado em TODAS as máquinas Windows por um erro que um teste de 3 linhas pega:
 * um parâmetro chamado `$Args`. Ver o comentário de Run-Step abaixo e windows-updater-script.test.ts.
 */
export function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

export interface WindowsUpdaterInput {
  requestId: string; targetCommit: string; root: string; resultFile: string; receiptFile: string;
  logFile: string; lockFile: string; pid: number; force: boolean; reportUrl: string; runnerId: string; token: string;
  /** UPD-02 — hash do CORPO que está sendo executado, e se ele veio do Hub. Vai no relatório de cada
   *  fase: sem isso, "falhou" não diz QUAL updater falhou, e é a primeira pergunta depois desta fatia. */
  scriptSha256?: string;
  fromHub?: boolean;
}

/**
 * UPD-02 — o script destacado é montado em DUAS partes, e a divisão não é estética:
 *
 *  • CABEÇALHO: caminhos, pid e token DAQUELA máquina. Só ela sabe — o Hub não conhece o `root`
 *    dela, nem o pid do processo que vai morrer. Sempre gerado localmente.
 *  • CORPO: a lógica (fetch, reset, npm ci, restart, relatório). É aqui que mora qualquer defeito —
 *    e era isto que ficava incorrigível quando a máquina em código velho gerava o próprio script.
 *
 * O Hub entrega o CORPO, com hash. É a menor parte que resolve a armadilha inteira: a máquina segue
 * dona do que é dela, e o que quebra passa a ser substituível de fora.
 */
export function windowsUpdaterHeader(input: WindowsUpdaterInput): string {
  return `
$ErrorActionPreference = 'Stop'
$Root = ${psQuote(input.root)}
$RequestId = ${psQuote(input.requestId)}
$Target = ${psQuote(input.targetCommit)}
$ResultFile = ${psQuote(input.resultFile)}
$ReceiptFile = ${psQuote(input.receiptFile)}
$RunnerLogFile = ${psQuote(input.logFile)}
$LockFile = ${psQuote(input.lockFile)}
$RunnerPid = ${input.pid}
$Force = ${input.force ? "$true" : "$false"}
$ReportUrl = ${psQuote(input.reportUrl)}
$RunnerId = ${psQuote(input.runnerId)}
$Token = ${psQuote(input.token)}
$TaskName = 'JarvisRunner'
$ScriptSha = ${psQuote(input.scriptSha256 || "")}
$ScriptFromHub = ${input.fromHub ? "$true" : "$false"}
`;
}

/** O script inteiro: cabeçalho local + corpo (o recebido do Hub, quando houver). */
export function detachedWindowsRunnerUpdateScript(input: WindowsUpdaterInput, body = windowsUpdaterBody()): string {
  return windowsUpdaterHeader(input) + body;
}

/** A LÓGICA do updater — sem nada específico de máquina, para poder viajar e ser conferida por hash. */
export function windowsUpdaterBody(): string {
  return `
$Log = New-Object System.Collections.Generic.List[string]

function Add-Log([string]$Text) { $script:Log.Add($Text) }
function Add-Progress([string]$Text) {
  Add-Log $Text
  try { Add-Content -Path $RunnerLogFile -Value ("[updater] {0} {1}" -f (Get-Date -Format o), $Text) } catch {}
}
# UPD-01 Fase 2: dispara o desfecho de cada fase para o Hub por HTTP, FORA do WebSocket do runner —
# assim, mesmo que este updater derrube o runner e ele nunca reconecte para mandar update_done, o
# dono fica sabendo ONDE e POR QUE falhou. Best-effort e com timeout curto: NUNCA trava o update
# (se o Hub estiver inalcançável, o próprio update é a prioridade).
function Report([string]$Phase, [bool]$Ok, [string]$ErrText) {
  if (-not $ReportUrl) { return }
  try {
    $tail = (@($Log.ToArray() | Select-Object -Last 25) -join "\`n")
    $payload = @{ runnerId = $RunnerId; requestId = $RequestId; token = $Token; targetCommit = $Target; phase = $Phase; ok = $Ok; error = $ErrText; logTail = $tail; scriptSha256 = $ScriptSha; scriptFromHub = $ScriptFromHub } | ConvertTo-Json -Depth 3 -Compress
    # Corpo em BYTES UTF-8: com string, o Windows PowerShell 5.1 serializa em Latin-1 e o relatório
    # chega ao Hub com acento quebrado ("código" vira "c?digo") — justo na única frase que
    # explica por que a máquina não atualizou.
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    Invoke-RestMethod -Uri $ReportUrl -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 4 | Out-Null
  } catch {}
}
# NÃO nomear o parâmetro "$Args": \$args é variável AUTOMÁTICA do PowerShell (os argumentos não
# ligados a parâmetros). Declarar um parâmetro com esse nome é sintaticamente válido — e o valor
# passado é DESCARTADO em silêncio: dentro da função, \$Args vem VAZIO (reproduzido em PS 5.1 e 7).
# Efeito: "& git @Args" virava um "git" pelado, que imprime o uso e sai com CÓDIGO 1 — ou seja, TODO
# update no Windows morria no primeiro comando git, DEPOIS de já ter derrubado o runner, com a
# mensagem inútil "git saiu com código 1". Foi o que manteve as máquinas Windows sem atualizar (e
# piscando online/offline) por semanas. Qualquer nome que não seja automático serve; guardado por
# teste em windows-updater-script.test.ts.
function Run-Step([string]$Exe, [string[]]$CmdArgs) {
  if (-not $CmdArgs -or $CmdArgs.Count -eq 0) { throw ("bug de geração do updater: " + $Exe + " sem argumentos") }
  $cmd = $Exe + " " + ($CmdArgs -join " ")
  Add-Progress ("> " + $cmd)
  $out = & $Exe @CmdArgs 2>&1
  $code = $LASTEXITCODE
  foreach ($line in $out) { Add-Log ([string]$line) }
  if ($code -ne 0) {
    Add-Progress ("falhou: " + $cmd + " (codigo " + $code + ")")
    # A mensagem carrega o comando E a saída: é ela que vai no phone-home (Report) e no update-result,
    # e sem isso o dono só recebe "saiu com código 1" — o que já custou semanas de diagnóstico cego.
    throw ($cmd + " saiu com código " + $code + ": " + (Detail-Of $out))
  }
  Add-Progress ("ok: " + $cmd)
}
# Últimas linhas úteis da saída de um comando, para caber numa mensagem de erro.
function Detail-Of($Output) {
  $lines = @($Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  if ($lines.Count -eq 0) { return "(sem saída)" }
  return ((@($lines | Select-Object -Last 4)) -join " / ")
}
# NÃO nomear esta função "Git": no PowerShell a resolução de comando é Alias>Função>Cmdlet>Aplicação,
# então uma função chamada Git SOMBREIA o git.exe. Run-Step faz "& \$Exe" com \$Exe="git" → cairia na
# própria função → recursão infinita → ScriptCallDepthException ("estouro de profundidade da chamada"),
# que foi o que derrubou o update do runner. Com o nome Invoke-Git, "git"/"& git" resolvem o executável.
function Invoke-Git([string[]]$CmdArgs) { Run-Step "git" $CmdArgs }
function Npm([string[]]$CmdArgs) { Run-Step "npm.cmd" $CmdArgs }
function Git-Out([string[]]$CmdArgs) {
  if (-not $CmdArgs -or $CmdArgs.Count -eq 0) { throw "bug de geração do updater: git sem argumentos" }
  $out = & git @CmdArgs 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0) { foreach ($line in $out) { Add-Log ([string]$line) }; throw ("git " + ($CmdArgs -join " ") + " saiu com código " + $code + ": " + (Detail-Of $out)) }
  return (($out | Out-String).Trim())
}
function Dependency-Manifests-Changed([string]$From, [string]$To) {
  $files = & git diff --name-only $From $To -- package.json package-lock.json npm-shrinkwrap.json 'apps/*/package.json' 'packages/*/package.json'
  if ($LASTEXITCODE -ne 0) { return $true }
  return [bool]($files | Where-Object { $_ })
}
function Verify-Or-Repair([bool]$DepsChanged) {
  if (-not $DepsChanged) {
    try { Npm @("run", "update:verify", "--if-present"); return } catch { Add-Log ("verificação inicial falhou; tentando npm ci: " + $_) }
  }
  Npm @("ci")
  Npm @("run", "update:verify", "--if-present")
}
function Write-Result([bool]$Ok, [bool]$RolledBack, [string]$Current) {
  $lines = @($Log.ToArray())
  if ($lines.Count -gt 240) {
    $head = @($lines | Select-Object -First 80)
    $tail = @($lines | Select-Object -Last 160)
    $lines = @($head + ("... log truncado: " + $lines.Count + " linhas; mantendo início e fim ...") + $tail)
  }
  $obj = [ordered]@{
    requestId = $RequestId
    ok = $Ok
    rolledBack = $RolledBack
    current = $Current
    targetCommit = $Target
    restartRequired = $true
    preparedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    log = ($lines -join "\`n")
  }
  $dir = Split-Path -Parent $ResultFile
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $obj | ConvertTo-Json -Depth 5 | Set-Content -Path $ResultFile -Encoding UTF8
}
function Start-Runner() {
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($task.State -eq "Running") {
      Add-Progress ("scheduled task ja esta em execucao: " + $TaskName)
      return
    }
  } catch {
    Add-Progress ("consulta da scheduled task falhou; tentando iniciar: " + $_)
  }
  try {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    Add-Progress ("scheduled task iniciado: " + $TaskName)
  } catch {
    Add-Progress ("Start-ScheduledTask falhou; fallback npm start: " + $_)
    Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory (Join-Path $Root "apps\\runner") -WindowStyle Hidden | Out-Null
  }
}

$previous = ""
$current = ""
$rolledBack = $false
try {
  # Registra o PID REAL deste script (não o pid que o Node capturou do spawn, que se torna
  # incorreto assim que trocamos para "cmd /c start /b" — cmd.exe encerra quase na hora,
  # deixando o launcher achar o updater morto e destravar o lock com o update ainda rodando).
  # Best-effort: se falhar, o Node já escreveu um pid provisório antes de spawnar.
  try { [ordered]@{ requestId = $RequestId; targetCommit = $Target; pid = $PID; provisional = $false; phase = "running"; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json | Set-Content -Path $LockFile -Encoding UTF8 } catch {}
  Report "applying" $true ""
  Add-Progress "parando runner antes do upgrade"
  # The launcher is the scheduled task. Keep it alive: the update lock makes it wait while this
  # detached updater owns the checkout. Stopping the task here can also terminate this script and
  # leave a stale runner-update.lock behind.
  try { Stop-Process -Id $RunnerPid -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Seconds 2
  Set-Location $Root
  try { & git config --global --add safe.directory $Root 2>$null } catch {}
  $branch = Git-Out @("rev-parse", "--abbrev-ref", "HEAD")
  Invoke-Git @("fetch", "--quiet", "--tags", "origin", $branch)
  $desired = Git-Out @("rev-parse", ($Target + "^{commit}"))
  $previous = Git-Out @("rev-parse", "HEAD")
  $depsChanged = Dependency-Manifests-Changed $previous $desired
  if ($Force) {
    Invoke-Git @("reset", "--hard", $desired)
    Invoke-Git @("clean", "-fd")
  } else {
    $dirty = Git-Out @("status", "--porcelain")
    if ($dirty) { throw "checkout com alterações locais; update sem force recusado" }
    $counts = Git-Out @("rev-list", "--left-right", "--count", ("HEAD..." + $desired))
    $ahead = [int](($counts -split "\\s+")[0])
    if ($ahead -gt 0) { throw ("checkout possui " + $ahead + " commit(s) locais fora do alvo") }
    Invoke-Git @("merge", "--ff-only", $desired)
  }
  Verify-Or-Repair $depsChanged
  $current = Git-Out @("rev-parse", "--short", "HEAD")
  $receipt = [ordered]@{ requestId = $RequestId; targetCommit = $Target; current = $current; preparedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -Path $ReceiptFile -Encoding UTF8
  Write-Result $true $false $current
  Report "prepared" $true ""
} catch {
  $errText = "$_"
  Add-Progress ("ERRO na preparação: " + $errText)
  Report "error" $false $errText
  if ($previous) {
    try {
      Set-Location $Root
      Invoke-Git @("reset", "--hard", $previous)
      Invoke-Git @("clean", "-fd")
      Npm @("ci")
      Npm @("run", "update:verify", "--if-present")
      $rolledBack = $true
      Add-Progress "rollback automático concluído"
      Report "rolled_back" $false $errText
    } catch {
      Add-Progress ("ERRO também no rollback: " + $_)
      Report "rollback_failed" $false ("prep: " + $errText + " | rollback: " + $_)
    }
  }
  try { $current = Git-Out @("rev-parse", "--short", "HEAD") } catch { $current = "" }
  Write-Result $false $rolledBack $current
} finally {
  try { Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue } catch {}
  Report "restarting" $true ""
  Start-Runner
  try { if ($PSCommandPath) { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue } } catch {}
}
`;
}
