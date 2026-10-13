/**
 * As pontes de voz spawnam o serviço Python UMA vez, mesmo com chamadas concorrentes.
 *
 * Por que existe: `pythonBin()` é assíncrono (sonda interpretadores), e isso pôs um `await` ENTRE o
 * guard `if (proc && ready)` e a atribuição `proc = child` dentro do ensureProc das três pontes.
 * Duas chamadas no mesmo tick passavam as duas pelo guard e spawnavam DOIS serviços: o segundo
 * sobrescrevia `proc`/`ready` e o primeiro ficava órfão — modelo carregado, RAM presa (o
 * faster-whisper large-v3-turbo são ~1,5 GB) e ninguém com referência para matá-lo até o Hub sair.
 *
 * Enquanto o ensureProc era síncrono até o spawn o bug era impossível, então nenhum teste o cobria.
 * Este cobre: duas chamadas no MESMO tick têm de resultar em UM spawn. É o cenário real do boot —
 * warmUp() dispara e uma transcrição/fala pode chegar antes de a sondagem terminar.
 *
 * Um shim faz as duas vezes: responde ao probe do resolvedor (`-c <script>`) com a linha que ele
 * espera, e responde ao spawn do serviço com `{"ready":true}`, registrando a invocação num arquivo.
 * Assim o teste não depende de nenhum Python instalado na máquina que roda a suíte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-voice-spawn-"));
const counter = join(dir, "spawns.log");
const shim = join(dir, "python3-shim");

// `-c` é o probe do resolvedor (apps/hub/src/python.ts): precisa da linha
// "executable|versão|arquitetura|módulos", com os dois módulos do núcleo para o interpretador ser
// aceito. Qualquer outro argumento é o spawn do serviço: conta e anuncia pronto.
writeFileSync(
  shim,
  `#!/bin/sh
case "$1" in
  -c) echo "${shim}|3.12.5|x86_64|piper,faster_whisper"; exit 0 ;;
esac
echo spawn >> "${counter}"
echo '{"ready":true}'
`,
);
chmodSync(shim, 0o755);
process.env.JARVIS_PYTHON = shim;

function spawnCount(): number {
  if (!existsSync(counter)) return 0;
  return readFileSync(counter, "utf8").split("\n").filter(Boolean).length;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Quantos spawns aconteceram desde `before`. Espera por CONDIÇÃO e não por um sleep fixo: o
 * primeiro caso a rodar paga também a sondagem do resolvedor e a compilação do módulo pelo tsx, o
 * que num Mac carregado passa de meio segundo — um sleep calibrado na máquina de quem escreveu
 * viraria um teste que falha em CI por motivo nenhum.
 *
 * A folga no fim é o que dá valor ao assert: o spawn duplicado do bug sai junto com o primeiro, e
 * sem esperar depois de ver UM o teste passaria por ter olhado cedo demais.
 */
async function spawnsSince(before: number, deadlineMs = 10_000): Promise<number> {
  const t0 = Date.now();
  while (spawnCount() - before < 1 && Date.now() - t0 < deadlineMs) await sleep(25);
  await sleep(250);
  return spawnCount() - before;
}

test("STT: duas chamadas concorrentes spawnam UM serviço", async () => {
  const stt = await import("./stt.js");
  const before = spawnCount();
  // As duas no MESMO tick, sem await entre elas: é exatamente a janela que o bug abria.
  stt.warmUp();
  stt.warmUp();
  assert.equal(await spawnsSince(before), 1, "o segundo spawn deixaria um serviço órfão com o modelo carregado");
});

test("TTS: duas chamadas concorrentes spawnam UM serviço", async () => {
  const tts = await import("./tts.js");
  const before = spawnCount();
  tts.warmUp();
  tts.warmUp();
  assert.equal(await spawnsSince(before), 1, "o segundo spawn deixaria um serviço órfão com o modelo carregado");
});

test("embeddings: duas chamadas concorrentes spawnam UM serviço", async () => {
  const embed = await import("./embed.js");
  const before = spawnCount();
  embed.warmUp();
  embed.warmUp();
  assert.equal(await spawnsSince(before), 1, "o segundo spawn deixaria um serviço órfão com o modelo carregado");
});

test.after(() => { rmSync(dir, { recursive: true, force: true }); });
