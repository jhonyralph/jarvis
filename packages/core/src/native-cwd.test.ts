/**
 * De qual PROJETO é uma sessão nativa quando o `cwd` muda no meio do arquivo.
 *
 * O bug real: a lista mostrava o título mais recente (que vem do FIM do arquivo) ao lado do projeto
 * mais antigo (que vinha do INÍCIO) — uma sessão retomada em `pallium-app` aparecia como sendo de
 * `PriorityCustomer`. E o mesmo `cwd` é o que retoma a sessão e o que resolve a fonte de tarefas,
 * então o estrago passava de rótulo errado para trabalho na pasta errada.
 *
 * native.ts lê ~/.claude por padrão e honra JARVIS_CLAUDE_DIR/JARVIS_CODEX_DIR/JARVIS_HOME quando
 * definidos ANTES do import (node --test roda cada arquivo no seu próprio processo).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "jarvis-cwd-"));
const CLAUDE = join(HOME, "claude-projects");
const CODEX = join(HOME, "codex-sessions");
mkdirSync(join(CLAUDE, "C--Luby-PriorityCustomer"), { recursive: true });
mkdirSync(join(CLAUDE, "C--Luby-ia-framework"), { recursive: true });
mkdirSync(join(CODEX, "2026", "08", "20"), { recursive: true });
process.env.JARVIS_CLAUDE_DIR = CLAUDE;
process.env.JARVIS_CODEX_DIR = CODEX;
process.env.JARVIS_HOME = HOME;

const { listNative, nativeInfo, resolveNativeCwd } = await import("./native.js");

const jsonl = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const turn = (cwd: string, text: string, i: number) => ([
  { type: "user", uuid: `u${i}`, timestamp: "2026-08-20T12:00:00Z", cwd, message: { role: "user", content: text } },
  { type: "assistant", uuid: `a${i}`, parentUuid: `u${i}`, timestamp: "2026-08-20T12:00:01Z", cwd, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
]);

// O caso relatado: nasceu num projeto, foi retomada em OUTRO, e o arquivo continua no diretório de
// origem (o Claude Code arquiva pela pasta de nascimento).
const MUDOU = "05dc636c-aab1-4604-a14a-9d7e4dd2bf2c";
writeFileSync(join(CLAUDE, "C--Luby-PriorityCustomer", `${MUDOU}.jsonl`), jsonl([
  ...turn("C:\\Luby\\PriorityCustomer", "começo aqui", 1),
  ...turn("C:\\Luby\\pallium-app", "agora estou no pallium", 2),
  ...turn("C:\\Luby\\pallium-app", "seguimos no pallium", 3),
  { type: "ai-title", aiTitle: "Ajustes no fluxo de assinatura do pallium-app" },
]));

// Navegou para uma SUBPASTA do mesmo projeto: continua sendo o mesmo projeto.
const SUBPASTA = "41b0740b-1111-2222-3333-444444444444";
writeFileSync(join(CLAUDE, "C--Luby-ia-framework", `${SUBPASTA}.jsonl`), jsonl([
  ...turn("C:\\Luby\\ia-framework", "vamos começar", 1),
  ...turn("C:\\Luby\\ia-framework\\cli", "entrei na cli", 2),
  { type: "ai-title", aiTitle: "Comandos do CLI do ia-framework" },
]));

// Sessão que nunca saiu do lugar: o comportamento antigo tem que continuar igual.
const PARADA = "99999999-aaaa-bbbb-cccc-dddddddddddd";
writeFileSync(join(CLAUDE, "C--Luby-ia-framework", `${PARADA}.jsonl`), jsonl([
  ...turn("C:\\Luby\\ia-framework", "tudo aqui mesmo", 1),
  { type: "ai-title", aiTitle: "Sessão que ficou no mesmo projeto" },
]));

const CODEX_ID = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";
writeFileSync(join(CODEX, "2026", "08", "20", `rollout-2026-08-20T12-00-00-${CODEX_ID}.jsonl`), jsonl([
  { type: "session_meta", payload: { session_id: CODEX_ID, cwd: "C:\\Luby\\PriorityCustomer", title: "sessão do codex" } },
  { type: "response_item", timestamp: "2026-08-20T12:00:00Z", payload: { type: "message", role: "user", content: "oi" } },
  { type: "turn_context", payload: { cwd: "C:\\Luby\\pallium-app" } },
]));

process.on("exit", () => { try { rmSync(HOME, { recursive: true, force: true }); } catch { /* fixture descartável */ } });

const porId = (id: string) => listNative(50).find((s) => s.id === id);

/* ── a regra pura ─────────────────────────────────────────────────────────────────────────────── */

test("resolveNativeCwd: retomada em outro projeto muda o projeto; subpasta não", () => {
  assert.equal(resolveNativeCwd("C:\\Luby\\PriorityCustomer", "C:\\Luby\\pallium-app"), "C:\\Luby\\pallium-app");
  assert.equal(resolveNativeCwd("C:\\Luby\\ia-framework", "C:\\Luby\\ia-framework\\cli"), "C:\\Luby\\ia-framework",
    "subpasta é o MESMO projeto — trocar aqui partiria o grupo da lista em dois");
  assert.equal(resolveNativeCwd("/repo", "/repo/pacotes/core"), "/repo");
  assert.equal(resolveNativeCwd("/repo", "/repo"), "/repo");
});

test("resolveNativeCwd: barra e caixa não inventam projeto diferente", () => {
  assert.equal(resolveNativeCwd("C:/Luby/app", "C:\\Luby\\app\\src"), "C:/Luby/app", "separador diferente é o mesmo caminho");
  assert.equal(resolveNativeCwd("C:\\Luby\\app\\", "C:\\Luby\\app"), "C:\\Luby\\app\\", "barra no fim não é outro projeto");
  // Prefixo de NOME não é prefixo de CAMINHO: "app-v2" não está dentro de "app".
  assert.equal(resolveNativeCwd("C:\\Luby\\app", "C:\\Luby\\app-v2"), "C:\\Luby\\app-v2");
});

test("resolveNativeCwd: quando só um lado existe, ele responde", () => {
  assert.equal(resolveNativeCwd("", "C:\\Luby\\pallium-app"), "C:\\Luby\\pallium-app");
  assert.equal(resolveNativeCwd("C:\\Luby\\app", ""), "C:\\Luby\\app");
  assert.equal(resolveNativeCwd("", ""), "");
});

/* ── o arquivo de verdade ─────────────────────────────────────────────────────────────────────── */

test("sessão retomada em outro projeto é listada no projeto ATUAL, não no de nascimento", () => {
  const s = porId("claude:" + MUDOU)!;
  assert.ok(s, "a sessão precisa aparecer na listagem");
  assert.equal(s.cwd, "C:\\Luby\\pallium-app");
  // O sintoma era este: título do trabalho novo ao lado do projeto velho.
  assert.match(s.title, /pallium-app/i);
});

test("o cwd de RETOMAR a sessão é o mesmo que a lista mostra — senão o trabalho vai para a pasta errada", () => {
  assert.equal(nativeInfo("claude:" + MUDOU)?.cwd, "C:\\Luby\\pallium-app");
  assert.equal(nativeInfo("claude:" + MUDOU)?.cwd, porId("claude:" + MUDOU)!.cwd,
    "listagem e retomada não podem discordar: uma delas estaria mentindo sobre o projeto");
});

test("navegar para subpasta NÃO cria um segundo projeto na lista", () => {
  assert.equal(porId("claude:" + SUBPASTA)!.cwd, "C:\\Luby\\ia-framework");
});

test("sessão que nunca mudou de pasta continua exatamente como era", () => {
  assert.equal(porId("claude:" + PARADA)!.cwd, "C:\\Luby\\ia-framework");
});

/* ── codex ────────────────────────────────────────────────────────────────────────────────────── */

test("codex: retomada em outro projeto também muda o projeto", () => {
  const s = listNative(50).find((x) => x.id === "codex:" + CODEX_ID);
  assert.ok(s, "a sessão do codex precisa aparecer");
  assert.equal(s!.cwd, "C:\\Luby\\pallium-app");
});
