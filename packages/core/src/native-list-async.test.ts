/**
 * A lista de sessões nativas NÃO pode travar o Hub (2026-10-28).
 *
 * Com ~30 agentes escrevendo transcripts, a releitura síncrona da lista parou o event loop do Hub por
 * 10 s+ várias vezes (stall forensics: readHead < parseClaude < listNative) e os aparelhos davam o Hub
 * como fora do ar. Agora `listNative` responde do cache na hora e a releitura roda em segundo plano.
 *
 * native.ts honra JARVIS_CLAUDE_DIR/JARVIS_CODEX_DIR/JARVIS_HOME definidos ANTES do import.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "jarvis-native-async-"));
const CLAUDE = join(HOME, "claude-projects");
const PROJ = join(CLAUDE, "C--Projetos-Synous");
mkdirSync(PROJ, { recursive: true });
mkdirSync(join(HOME, "codex-sessions"), { recursive: true });
process.env.JARVIS_CLAUDE_DIR = CLAUDE;
process.env.JARVIS_CODEX_DIR = join(HOME, "codex-sessions");
process.env.JARVIS_HOME = HOME;
process.on("exit", () => { try { rmSync(HOME, { recursive: true, force: true }); } catch { /* fixture */ } });

const { listNative, refreshNativeList, onNativeListChange } = await import("./native.js");

const session = (id: string, text: string, pad = 0): string => [
  { type: "user", cwd: "C:\\Projetos\\Synous", message: { role: "user", content: text } },
  { type: "assistant", cwd: "C:\\Projetos\\Synous", message: { role: "assistant", content: "ok " + "x".repeat(pad) } },
  { type: "ai-title", aiTitle: "Sessão " + id },
].map((r) => JSON.stringify(r)).join("\n") + "\n";

const ids = Array.from({ length: 30 }, (_, i) => `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`);
for (const id of ids) writeFileSync(join(PROJ, id + ".jsonl"), session(id, "analisa a parte " + id, 200_000));

test("a primeira chamada responde na hora (vazia) e a releitura roda em segundo plano", async () => {
  const t0 = performance.now();
  const first = listNative();
  const ms = performance.now() - t0;
  assert.deepEqual(first, [], "cache frio: nada lido ainda — e nada lido no caminho da chamada");
  assert.ok(ms < 50, `listNative não pode ler os arquivos no caminho da chamada (levou ${ms.toFixed(1)} ms)`);
  const list = await refreshNativeList();
  assert.equal(list.length, 30);
  assert.equal(listNative().length, 30, "depois da releitura, a lista vem do cache");
});

test("o event loop segue livre durante a releitura (um timer de 5 ms não atrasa muito)", async () => {
  // Muda todos os arquivos: a releitura precisa ler os 30 de novo.
  const future = new Date(Date.now() + 60_000);
  for (const id of ids) utimesSync(join(PROJ, id + ".jsonl"), future, future);
  let worst = 0, last = performance.now(), running = true;
  const tick = (): void => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; if (running) setTimeout(tick, 5); };
  setTimeout(tick, 5);
  await refreshNativeList();
  running = false;
  assert.ok(worst < 250, `o event loop ficou ${worst.toFixed(0)} ms sem rodar durante a releitura`);
});

test("quem assina é avisado quando a lista muda, e não quando continua igual", async () => {
  let calls = 0;
  const off = onNativeListChange(() => { calls++; });
  await refreshNativeList();
  assert.equal(calls, 0, "nada mudou desde a última releitura");
  const novo = "bbbbbbbb-0000-0000-0000-000000000001";
  writeFileSync(join(PROJ, novo + ".jsonl"), session(novo, "sessão nova"));
  const future = new Date(Date.now() + 120_000);
  utimesSync(join(PROJ, novo + ".jsonl"), future, future);
  const list = await refreshNativeList();
  assert.equal(calls, 1);
  assert.equal(list[0].id, "claude:" + novo, "a mais recente primeiro");
  off();
});

test("releituras simultâneas viram uma só", async () => {
  const a = refreshNativeList(), b = refreshNativeList();
  assert.equal(a, b);
  await a;
});
