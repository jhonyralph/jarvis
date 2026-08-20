/**
 * Guarda do updater DESTACADO do Windows — a única via de atualização suportada nessa plataforma.
 *
 * Existe por causa de um bug que ficou semanas em produção derrubando TODAS as máquinas Windows: os
 * helpers do script recebiam um parâmetro chamado `$Args`, que é variável AUTOMÁTICA do PowerShell.
 * O valor era descartado em silêncio, `& git @Args` virava um `git` pelado (exit 1) e o update morria
 * no primeiro comando — depois de já ter matado o runner. Sintaxe válida, parse limpo: nenhum
 * `-Command {parse}` pegaria. Só executar (ou proibir o nome) pega.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detachedWindowsRunnerUpdateScript, windowsUpdaterHeader, windowsUpdaterBody, psQuote } from "./windows-updater-script.js";

const script = detachedWindowsRunnerUpdateScript({
  requestId: "req-1", targetCommit: "abc1234", root: "C:\\Users\\x\\jarvis",
  resultFile: "C:\\Users\\x\\.jarvis\\update-result.json", receiptFile: "C:\\Users\\x\\.jarvis\\update-receipt.json",
  logFile: "C:\\Users\\x\\.jarvis\\runner-update.log", lockFile: "C:\\Users\\x\\.jarvis\\runner-update.lock",
  pid: 4242, force: false, reportUrl: "http://127.0.0.1:4577/runner-update-report", runnerId: "runner-1", token: "tok",
});

/** Automáticas do PowerShell: usar qualquer uma como nome de parâmetro descarta o argumento. */
const RESERVED = ["Args", "Input", "Error", "Host", "Matches", "PSItem", "This", "PWD", "Home"];

test("nenhum parâmetro de função usa nome de variável automática do PowerShell", () => {
  const declarations = [...script.matchAll(/function\s+[\w-]+\s*\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(declarations.length >= 5, "esperava encontrar as funções helper no script gerado");
  for (const params of declarations) {
    for (const reserved of RESERVED) {
      assert.ok(
        !new RegExp(`\\$${reserved}\\b`, "i").test(params),
        `parâmetro $${reserved} é variável automática do PowerShell — o argumento chega VAZIO. Parâmetros: (${params})`,
      );
    }
  }
});

test("os helpers repassam os argumentos por splat para o executável", () => {
  // & git / & npm.cmd sem @<array> = comando pelado: foi o modo de falha real.
  for (const call of ["& $Exe @CmdArgs", "& git @CmdArgs"]) assert.ok(script.includes(call), `esperava "${call}" no script`);
  assert.match(script, /function Run-Step\(\[string\]\$Exe, \[string\[\]\]\$CmdArgs\)/);
  assert.match(script, /function Invoke-Git\(\[string\[\]\]\$CmdArgs\) \{ Run-Step "git" \$CmdArgs \}/);
});

test("um comando sem argumentos falha alto em vez de rodar o executável pelado", () => {
  assert.match(script, /bug de geração do updater/);
});

test("a mensagem de erro carrega o comando e a saída, não só o código de saída", () => {
  // "git saiu com código 1" (sem comando, sem stderr) foi o que impediu o diagnóstico por semanas.
  assert.match(script, /throw \(\$cmd \+ " saiu com código " \+ \$code \+ ": " \+ \(Detail-Of \$out\)\)/);
  assert.ok(script.includes("function Detail-Of"), "esperava o helper que resume a saída do comando");
});

test("phone-home reporta as fases fora do WebSocket, inclusive a falha", () => {
  for (const phase of ["applying", "prepared", "error", "rolled_back", "rollback_failed", "restarting"]) {
    assert.ok(script.includes(`Report "${phase}"`), `esperava Report da fase ${phase}`);
  }
});

test("o script se auto-registra no lock com o PID real antes de qualquer outra coisa", () => {
  const lockWrite = script.indexOf("pid = $PID");
  const stopRunner = script.indexOf("Stop-Process -Id $RunnerPid");
  assert.ok(lockWrite > 0 && stopRunner > 0 && lockWrite < stopRunner, "o lock com $PID real precisa vir antes de derrubar o runner");
});

test("psQuote escapa apóstrofo (caminho de usuário com aspa simples)", () => {
  assert.equal(psQuote("C:\\Users\\O'Brien\\jarvis"), "'C:\\Users\\O''Brien\\jarvis'");
});

// --- prova comportamental: só faz sentido onde o updater realmente roda ---
// (exercita git de leitura no próprio checkout; instalação por tarball não tem .git e pula)
const skipReal = process.platform !== "win32" ? "só no Windows" : !existsSync(join(process.cwd(), ".git")) ? "fora de um checkout git" : false;
test("PowerShell real: os helpers entregam os argumentos ao git", { skip: skipReal }, () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-updater-"));
  const file = join(dir, "helpers.ps1");
  try {
    // Recorta do script GERADO o prelúdio dos helpers e exercita-o com um comando git inofensivo.
    // Se um parâmetro voltar a ser automático, `git` roda pelado, sai 1, e este teste falha.
    const prelude = script.slice(script.indexOf("function Run-Step"), script.indexOf("function Dependency-Manifests-Changed"));
    const harness = [
      "$ErrorActionPreference = 'Stop'",
      "$RunnerLogFile = $env:TEMP + '\\jarvis-updater-test.log'",
      "$Log = New-Object System.Collections.Generic.List[string]",
      "function Add-Log([string]$Text) { $script:Log.Add($Text) }",
      "function Add-Progress([string]$Text) { Add-Log $Text }",
      "function Report([string]$Phase, [bool]$Ok, [string]$ErrText) { }",
      prelude,
      "$out = Git-Out @('rev-parse', '--abbrev-ref', 'HEAD')",
      "if (-not $out) { throw 'Git-Out devolveu vazio' }",
      "Invoke-Git @('status', '--porcelain')",
      "Write-Output ('OK:' + $out)",
    ].join("\n");
    writeFileSync(file, "\ufeff" + harness, "utf8");
    const out = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], {
      cwd: process.cwd(), encoding: "utf8", timeout: 60_000, windowsHide: true,
    });
    assert.match(out, /OK:\S+/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ── UPD-02: o CORPO viaja, o CABEÇALHO é da máquina ──────────────────────────────────────────── */

const ENTRADA = {
  requestId: "req-1", targetCommit: "abc1234", root: "C:/jarvis", resultFile: "C:/r.json",
  receiptFile: "C:/rec.json", logFile: "C:/log.txt", lockFile: "C:/lock.json", pid: 4242,
  // Valores DISTINGUÍVEIS de propósito: "tok" casaria com a variável `$Token` que o corpo usa — e a
  // asserção passaria a acusar o uso legítimo em vez do vazamento do valor.
  force: false, reportUrl: "http://127.0.0.1:4577/runner-update-report",
  runnerId: "MAQUINA-XYZ-9", token: "SEGREDO-XYZ-9",
};

test("o corpo não carrega NADA da máquina — é por isso que ele pode viajar", () => {
  const corpo = windowsUpdaterBody();

  // Se algum caminho, pid ou token vazasse para o corpo, o script do Hub escreveria na máquina errada
  // (ou não escreveria em lugar nenhum) — e o hash deixaria de significar "a mesma lógica".
  for (const local of ["C:/jarvis", "C:/r.json", "C:/rec.json", "C:/log.txt", "C:/lock.json", "4242", "MAQUINA-XYZ-9", "SEGREDO-XYZ-9"]) {
    assert.equal(corpo.includes(local), false, `o corpo vazou algo local: ${local}`);
  }
  // E ele é estável: dois chamados, mesmo texto — senão o hash mudaria a cada entrega.
  assert.equal(corpo, windowsUpdaterBody());
});

test("o cabeçalho carrega o que é da máquina, e o script inteiro é cabeçalho + corpo", () => {
  const cabecalho = windowsUpdaterHeader(ENTRADA);

  assert.match(cabecalho, /\$Root = 'C:\/jarvis'/);
  assert.match(cabecalho, /\$RunnerPid = 4242/);
  assert.equal(detachedWindowsRunnerUpdateScript(ENTRADA), cabecalho + windowsUpdaterBody());
});

test("o script executado se identifica: hash e origem entram no relatório", () => {
  const script = detachedWindowsRunnerUpdateScript({ ...ENTRADA, scriptSha256: "deadbeef", fromHub: true });

  assert.match(script, /\$ScriptSha = 'deadbeef'/);
  assert.match(script, /\$ScriptFromHub = \$true/);
  // Sem isso, depois da UPD-02 um "falhou" não diria QUAL updater falhou — o do Hub ou o local.
  assert.match(script, /scriptSha256 = \$ScriptSha/);
  assert.match(script, /scriptFromHub = \$ScriptFromHub/);
});

test("um corpo trocado muda o hash — que é o ponto da conferência", async () => {
  const { createHash } = await import("node:crypto");
  const sha = (t: string): string => createHash("sha256").update(t, "utf8").digest("hex");

  assert.notEqual(sha(windowsUpdaterBody()), sha(windowsUpdaterBody() + "\n# alterado"));
});
