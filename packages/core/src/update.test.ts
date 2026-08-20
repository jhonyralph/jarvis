import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autonomousUpdateAttempt, commitContains, gitErrorDetail, resolveCommit, runnerUpdateTargetDecision, runnerSelfUpdateDecision, runnerUpdateDeliveryDecision, UPDATE_MAX_DELIVERIES, updateApply, updateCheck, updatePreflight, updateRollback } from "./update.js";

const run = (cwd: string, command: string, args: string[] = []): string => String(execFileSync(command, args, { cwd, windowsHide: true, encoding: "utf8" })).trim();
const git = (cwd: string, ...args: string[]): string => run(cwd, "git", args);

test("runnerSelfUpdateDecision only auto-updates clean idle runners behind origin", () => {
  const base = { supported: true, current: "aaa", clean: true, behind: 2, ahead: 0, latest: { sha: "bbb", subject: "v2", date: "2026-07-20T00:00:00Z" } };

  assert.deepEqual(runnerSelfUpdateDecision(base), { update: true, reason: "2 commit(s) atrás de origin", targetCommit: "bbb" });
  assert.equal(runnerSelfUpdateDecision(base, { busy: true }).update, false);
  assert.equal(runnerSelfUpdateDecision(base, { updateInProgress: true }).update, false);
  assert.equal(runnerSelfUpdateDecision({ ...base, clean: false }).update, false);
  assert.equal(runnerSelfUpdateDecision({ ...base, ahead: 1 }).update, false);
  assert.equal(runnerSelfUpdateDecision({ ...base, behind: 0 }).update, false);
  assert.deepEqual(runnerSelfUpdateDecision({ ...base, latest: undefined }), { update: false, reason: "origin tem atualização, mas o commit alvo não foi resolvido", retryable: true });
  assert.deepEqual(runnerSelfUpdateDecision({ ...base, error: "fetch falhou" }), { update: false, reason: "fetch falhou", retryable: true });
});

test("updatePreflight só derruba o processo quando o update tem chance de dar certo", () => {
  const ok = { status: { supported: true, clean: true, ahead: 0 }, targetResolved: true, targetCommit: "abc1234567890" };

  assert.equal(updatePreflight(ok).proceed, true);
  // Instalação sem git: insistir é inútil — e cada tentativa custava a máquina fora do ar.
  assert.deepEqual(updatePreflight({ ...ok, status: { supported: false, clean: true, ahead: 0, error: "não é um repositório git" } }),
    { proceed: false, retryable: false, reason: "não é um repositório git" });
  // Fetch quebrado: recusa ANTES de matar o runner, e devolve o motivo real para o dono.
  assert.deepEqual(updatePreflight({ ...ok, status: { supported: true, clean: true, ahead: 0, error: "git fetch falhou: ref rejeitada" } }),
    { proceed: false, retryable: true, reason: "git fetch falhou: ref rejeitada" });
  const missing = updatePreflight({ ...ok, targetResolved: false });
  assert.equal(missing.proceed, false); assert.equal(missing.retryable, true); assert.match(missing.reason, /abc123456789.*não existe neste checkout/);
  assert.equal(updatePreflight({ ...ok, status: { supported: true, clean: false, ahead: 0 } }).proceed, false);
  assert.equal(updatePreflight({ ...ok, status: { supported: true, clean: false, ahead: 0 }, force: true }).proceed, true, "force é o consentimento explícito do dono");
  assert.equal(updatePreflight({ ...ok, status: { supported: true, clean: true, ahead: 2 } }).proceed, false);
  assert.equal(updatePreflight({ ...ok, status: { supported: true, clean: true, ahead: 2 }, force: true }).proceed, true);
});

test("updatePreflight NÃO recusa um runner limpo já no alvo (o force do Hub existe para reiniciar)", () => {
  // Invariante do handshake: git no alvo não prova que o PROCESSO subiu no código novo, então o Hub
  // re-entrega com force. Recusar aqui deixaria a máquina presa em quarentena de protocolo.
  assert.equal(updatePreflight({ status: { supported: true, clean: true, ahead: 0 }, targetResolved: true, targetCommit: "abc1234", force: true }).proceed, true);
});

test("autonomousUpdateAttempt para de insistir sozinho no mesmo alvo, e reabre em alvo novo", () => {
  const first = autonomousUpdateAttempt(undefined, "abc1234");
  assert.equal(first.allow, true); assert.equal(first.failures, 1);

  const second = autonomousUpdateAttempt({ target: "abc1234", failures: 1 }, "abc1234");
  assert.equal(second.allow, true); assert.equal(second.failures, 2);

  const blocked = autonomousUpdateAttempt({ target: "abc1234", failures: 2 }, "abc1234");
  assert.equal(blocked.allow, false); assert.match(blocked.reason, /já tentei 2x/);

  // Release nova = alvo novo: crédito renovado (o problema pode ter sido justamente o commit velho).
  const newTarget = autonomousUpdateAttempt({ target: "abc1234", failures: 9 }, "def5678");
  assert.equal(newTarget.allow, true); assert.equal(newTarget.failures, 1);
  // Registro corrompido/parcial não pode travar a máquina para sempre.
  assert.equal(autonomousUpdateAttempt({ failures: 99 } as any, "abc1234").allow, true);
});

test("gitErrorDetail prefere o stderr do git à mensagem genérica do execFile", () => {
  assert.equal(gitErrorDetail({ message: "Command failed: git fetch", stderr: "  error: cannot lock ref\n  fatal: bad\n" }),
    "error: cannot lock ref fatal: bad");
  assert.equal(gitErrorDetail({ message: "spawn git ENOENT" }), "spawn git ENOENT");
  assert.equal(gitErrorDetail(new Error("boom")), "boom");
  assert.equal(gitErrorDetail("string solta"), "string solta");
});

function writeFixture(root: string, verifyOk: boolean, marker: string): void {
  const pkg = { name: "jarvis-update-fixture", version: "1.0.0", private: true, scripts: { "update:verify": "node verify.mjs" } };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { "": { name: pkg.name, version: pkg.version } } };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock, null, 2));
  writeFileSync(join(root, "verify.mjs"), verifyOk ? "process.exit(0);\n" : "process.exit(7);\n");
  writeFileSync(join(root, "marker.txt"), marker);
}

test("git updater is repeatable, transactional and detects dirty/divergent checkouts", { timeout: 120_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "jarvis-update-"));
  const remote = join(base, "origin.git"), seed = join(base, "seed"), checkout = join(base, "runner"), priorHome = process.env.JARVIS_HOME;
  try {
    process.env.JARVIS_HOME = join(base, "state");
    mkdirSync(seed); git(base, "init", "--bare", remote); git(seed, "init", "-b", "main");
    git(seed, "config", "user.name", "Jarvis Test"); git(seed, "config", "user.email", "jarvis@example.invalid");
    writeFixture(seed, true, "v1"); git(seed, "add", "."); git(seed, "commit", "-m", "v1"); git(seed, "remote", "add", "origin", remote); git(seed, "push", "-u", "origin", "main");
    git(base, "clone", "--branch", "main", remote, checkout); git(checkout, "config", "user.name", "Jarvis Test"); git(checkout, "config", "user.email", "jarvis@example.invalid");
    const v1 = git(checkout, "rev-parse", "HEAD");
    // É disto que o preflight depende para não matar o runner por um alvo que não chegou no fetch.
    assert.equal(await resolveCommit(checkout, v1.slice(0, 7)), v1, "sha curto resolve para o completo");
    assert.equal(await resolveCommit(checkout, "0000000"), "", "commit ausente resolve vazio em vez de explodir");

    writeFixture(seed, false, "broken-v2"); git(seed, "add", "."); git(seed, "commit", "-m", "broken v2"); git(seed, "push");
    const failed = await updateApply(checkout);
    assert.equal(failed.ok, false); assert.equal(failed.rolledBack, true, failed.log);
    assert.equal(git(checkout, "rev-parse", "HEAD"), v1, "failed preparation must restore the old commit");
    assert.equal(readFileSync(join(checkout, "marker.txt"), "utf8"), "v1");

    writeFixture(seed, true, "v3"); git(seed, "add", "."); git(seed, "commit", "-m", "v3"); git(seed, "push");
    const target = git(seed, "rev-parse", "HEAD");
    const applied = await updateApply(checkout, { targetCommit: target });
    assert.equal(applied.ok, true, applied.log); assert.equal(applied.changed, true); assert.equal(applied.restartRequired, true);
    assert.equal(readFileSync(join(checkout, "marker.txt"), "utf8"), "v3");

    const repeated = await updateApply(checkout, { targetCommit: target });
    assert.equal(repeated.ok, true, repeated.log); assert.equal(repeated.changed, false, "same version repairs/verifies instead of becoming an unrepairable no-op");
    assert.equal(repeated.restartRequired, true);
    const rollback = await updateRollback(checkout);
    assert.equal(rollback.ok, true, rollback.log); assert.equal(git(checkout, "rev-parse", "HEAD"), v1, "same-version repair must preserve the prior rollback point");

    // A durable deployment target must not rot when origin advances while a runner is offline.
    // The runner first finishes exactly v3; a later untargeted update may then take v4.
    writeFixture(seed, true, "v4"); git(seed, "add", "."); git(seed, "commit", "-m", "v4"); git(seed, "push");
    const v4 = git(seed, "rev-parse", "HEAD");
    const reapplied = await updateApply(checkout, { targetCommit: target }); assert.equal(reapplied.ok, true, reapplied.log);
    assert.equal(git(checkout, "rev-parse", "HEAD"), target, "stale queued target must land on the requested commit, not the newer origin tip");
    assert.equal(readFileSync(join(checkout, "marker.txt"), "utf8"), "v3");
    const latest = await updateApply(checkout); assert.equal(latest.ok, true, latest.log);
    assert.equal(git(checkout, "rev-parse", "HEAD"), v4); assert.equal(readFileSync(join(checkout, "marker.txt"), "utf8"), "v4");

    const wrongTarget = await updateApply(checkout, { targetCommit: "0000000" });
    assert.equal(wrongTarget.ok, false); assert.equal(wrongTarget.retryable, false); assert.match(wrongTarget.log, /Hub solicitou/);

    writeFileSync(join(checkout, "dirty.txt"), "not committed");
    const dirty = await updateApply(checkout); assert.equal(dirty.ok, false); assert.equal(dirty.dirty, true);
    const forcedDirty = await updateApply(checkout, { force: true, targetCommit: v4 });
    assert.equal(forcedDirty.ok, true, forcedDirty.log);
    assert.equal(existsSync(join(checkout, "dirty.txt")), false, "force discards untracked local files on disposable runners");
    assert.equal(git(checkout, "status", "--porcelain"), "", "forced repair leaves the checkout clean");

    writeFileSync(join(checkout, "local.txt"), "local commit"); git(checkout, "add", "."); git(checkout, "commit", "-m", "local only");
    const status = await updateCheck(checkout, true); assert.equal(status.ahead, 1); assert.equal(status.behind, 0);
    const divergent = await updateApply(checkout); assert.equal(divergent.ok, false); assert.equal(divergent.dirty, true); assert.match(divergent.log, /commit\(s\) fora do alvo/);
    const forcedDivergent = await updateApply(checkout, { force: true, targetCommit: v4 });
    assert.equal(forcedDivergent.ok, true, forcedDivergent.log);
    assert.equal(git(checkout, "rev-parse", "HEAD"), v4, "force resets divergent local commits to the deployment target");
    assert.equal(existsSync(join(checkout, "local.txt")), false, "force discards files introduced only by local commits");
  } finally {
    if (priorHome === undefined) delete process.env.JARVIS_HOME; else process.env.JARVIS_HOME = priorHome;
    rmSync(base, { recursive: true, force: true });
  }
});

/* ── Disjuntor da ENTREGA do Hub ──────────────────────────────────────────────────────────────────
   Caso real (20/08): a Luby ficou no commit alvo, o updater rodava até o fim, mas o runner não subia
   depois (dependência quebrada) — então `update_done` nunca chegava, o registro ficava em `sent`, e a
   cada reconexão o Hub entregava outra vez. 33 ciclos de ~20s, derrubando a máquina em cada um, sem
   ninguém ser avisado. Contar FALHAS não pegaria: cada ciclo "deu certo". */

test("entregar é normal até o teto — e o motivo diz em que passo está", () => {
  const primeira = runnerUpdateDeliveryDecision({ deliveries: 0 });
  assert.equal(primeira.deliver, true);
  assert.match(primeira.reason, /entrega 1 de 5/);

  const ultima = runnerUpdateDeliveryDecision({ deliveries: UPDATE_MAX_DELIVERIES - 1 });
  assert.equal(ultima.deliver, true, "a última ainda vai");
});

test("no teto, o Hub PARA de reenviar em vez de derrubar a máquina em círculo", () => {
  const estourou = runnerUpdateDeliveryDecision({ deliveries: UPDATE_MAX_DELIVERIES });

  assert.equal(estourou.deliver, false);
  assert.equal(estourou.stalled, true);
  // O motivo tem de dizer o que aconteceu, não só "bloqueado": é ele que aparece no painel.
  assert.match(estourou.reason, /5×/);
  assert.match(estourou.reason, /círculo/);
});

test("zerar o contador reabre o disjuntor — é a única saída, e é decisão do dono", () => {
  // Sem esta saída, uma máquina que estourou o teto ficaria impedida de atualizar para sempre,
  // inclusive depois de consertada. Quem zera é o Hub quando o dono enfileira forçado.
  assert.equal(runnerUpdateDeliveryDecision({ deliveries: 0 }).deliver, true);
  assert.equal(runnerUpdateDeliveryDecision({ deliveries: 0 }).stalled, false);
});

test("o teto é configurável e nunca cai abaixo de uma entrega", () => {
  assert.equal(runnerUpdateDeliveryDecision({ deliveries: 1, max: 2 }).deliver, true);
  assert.equal(runnerUpdateDeliveryDecision({ deliveries: 2, max: 2 }).deliver, false);
  // max 0 significaria "nunca entregar" — um pedido que nasce morto, sem sinal nenhum para o dono.
  assert.equal(runnerUpdateDeliveryDecision({ deliveries: 0, max: 0 }).deliver, true);
});

test("contador ausente ou inválido conta como zero, e não trava a primeira entrega", () => {
  assert.equal(runnerUpdateDeliveryDecision({}).deliver, true);
  assert.equal(runnerUpdateDeliveryDecision({ deliveries: -3 }).deliver, true);
  assert.equal(runnerUpdateDeliveryDecision({ deliveries: Number.NaN }).deliver, true);
});

/* ── O Hub nao pode mandar uma maquina ANDAR PARA TRAS ────────────────────────────────────────────
   Caso real (20/08): o Hub em 911b9e9 pediu 84 vezes que a Luby fosse para 911b9e9 enquanto ela ja
   estava em 9f2697c — um commit mais novo. O updater dela recusa ("checkout possui 1 commit(s) fora
   do alvo solicitado"), faz rollback, e o ciclo recomeca; o rollback de um deles ainda estourou
   ENOTEMPTY no npm ci. Ela so consegue reclamar DEPOIS de ter sido derrubada — quem podia responder
   antes era o Hub, que tem o repositorio. */

test("commitContains responde sobre o histórico — e diz 'não sei' em vez de chutar", async () => {
  const base = mkdtempSync(join(tmpdir(), "jarvis-ancestor-"));
  const repo = join(base, "repo");
  try {
    mkdirSync(repo); git(repo, "init", "-b", "main");
    git(repo, "config", "user.name", "Jarvis Test"); git(repo, "config", "user.email", "jarvis@example.invalid");
    writeFileSync(join(repo, "a.txt"), "1"); git(repo, "add", "."); git(repo, "commit", "-m", "c1");
    const c1 = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "a.txt"), "2"); git(repo, "add", "."); git(repo, "commit", "-m", "c2");
    const c2 = git(repo, "rev-parse", "HEAD");

    assert.equal(await commitContains(repo, c1, c2), true, "c2 veio depois de c1");
    assert.equal(await commitContains(repo, c2, c1), false, "e o contrário não é verdade");
    assert.equal(await commitContains(repo, c1, c1), true, "um commit contém a si mesmo");
    // O caso que importa: afirmar "não contém" sobre um commit que este checkout NÃO TEM seria
    // inventar um fato — e o Hub decidiria bloquear a atualização em cima dessa invenção.
    assert.equal(await commitContains(repo, c1, "9".repeat(40)), null);
    assert.equal(await commitContains(repo, "9".repeat(40), c2), null);
    assert.equal(await commitContains(repo, c1, "não-é-um-commit"), null);
  } finally { try { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows solta os handles do git com atraso */ } }
});

test("máquina à frente do alvo: o Hub não entrega o retrocesso", () => {
  const limpa = runnerUpdateTargetDecision({ runnerHasTarget: true, clean: true, protocolMatches: true });
  assert.equal(limpa.deliver, false);
  assert.equal(limpa.clear, true, "ela TEM o código que o pedido existia para levar — o pedido acabou");

  const suja = runnerUpdateTargetDecision({ runnerHasTarget: true, clean: false, protocolMatches: true });
  assert.equal(suja.deliver, false, "entregar só produziria a recusa do updater e mais um rollback");
  assert.equal(suja.clear, false, "mas não se declara verificada uma máquina com trabalho local solto");
  assert.match(suja.reason, /alterações locais/);

  const protocolo = runnerUpdateTargetDecision({ runnerHasTarget: true, clean: true, protocolMatches: false });
  assert.equal(protocolo.deliver, false);
  assert.equal(protocolo.clear, false, "protocolo divergente segue sendo pendência real, mesmo com o código lá");
});

test("não saber onde a máquina está sai pelo caminho de hoje, não pelo bloqueio", () => {
  // Travar por desconhecimento deixaria sem atualização justamente a máquina que está num commit
  // que este checkout ainda não buscou — trocaria um loop visível por uma máquina esquecida.
  assert.equal(runnerUpdateTargetDecision({ runnerHasTarget: null, clean: true, protocolMatches: true }).deliver, true);
  assert.equal(runnerUpdateTargetDecision({ runnerHasTarget: false, clean: true, protocolMatches: true }).deliver, true);
  assert.equal(runnerUpdateTargetDecision({ runnerHasTarget: null, clean: false, protocolMatches: false }).clear, false);
});
