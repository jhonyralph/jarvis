/**
 * Busca e abertura de sessão nativa sem prender o Hub (2026-10-30).
 *
 * Uma busca travou o Hub por 61 s (pilha da trava: searchManaged → store.history e searchNative →
 * cachedParse) e abrir uma sessão nativa grande, 10–16 s (nativeHistory). As versões assíncronas
 * precisam dar EXATAMENTE o mesmo resultado das síncronas que substituem.
 *
 * native.ts honra JARVIS_CLAUDE_DIR/JARVIS_CODEX_DIR/JARVIS_HOME definidos ANTES do import.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "jarvis-native-search-"));
const CLAUDE = join(HOME, "claude-projects");
const PROJ = join(CLAUDE, "C--Projetos-Synous");
const CODEX = join(HOME, "codex-sessions", "2026", "10", "30");
mkdirSync(PROJ, { recursive: true });
mkdirSync(CODEX, { recursive: true });
process.env.JARVIS_CLAUDE_DIR = CLAUDE;
process.env.JARVIS_CODEX_DIR = join(HOME, "codex-sessions");
process.env.JARVIS_HOME = HOME;
process.on("exit", () => { try { rmSync(HOME, { recursive: true, force: true }); } catch { /* fixture */ } });

const { searchNative, searchNativeAsync, nativeHistory, nativeHistoryAsync } = await import("./native.js");
const { Store } = await import("./store.js");

const claudeSession = (id: string, ask: string, answer: string): string => [
  { type: "user", cwd: "C:\\Projetos\\Synous", timestamp: "2026-10-30T10:00:00Z", message: { role: "user", content: ask } },
  { type: "assistant", cwd: "C:\\Projetos\\Synous", timestamp: "2026-10-30T10:00:05Z", message: { role: "assistant", content: [{ type: "text", text: answer }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } },
  { type: "ai-title", aiTitle: "Sessão " + id.slice(-4) },
].map((r) => JSON.stringify(r)).join("\n") + "\n";

const ids = Array.from({ length: 12 }, (_, i) => `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, "0")}`);
ids.forEach((id, i) => writeFileSync(join(PROJ, id + ".jsonl"), claudeSession(id, i % 3 === 0 ? "revisar o relatório de vendas" : "consertar o login", "feito, rodei os testes do relatório")));
const codexId = "cccccccc-0000-0000-0000-000000000001";
writeFileSync(join(CODEX, `rollout-2026-10-30T10-00-00-${codexId}.jsonl`), [
  { type: "session_meta", payload: { id: codexId, cwd: "C:\\Projetos\\Synous" } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "relatório de vendas no codex" }] } },
  { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "pronto" }] } },
].map((r) => JSON.stringify(r)).join("\n") + "\n");

const norm = (hits: Array<{ id: string; snippet: string; where: string }>) => hits.map((h) => `${h.id}|${h.where}|${h.snippet}`).sort();

test("busca nativa assíncrona acha exatamente o mesmo que a síncrona", async () => {
  for (const q of ["relatório vendas", "login", "inexistente-xyz", "SESSÃO"]) {
    assert.deepEqual(norm(await searchNativeAsync(q, 40)), norm(searchNative(q, 40)), q);
  }
  assert.ok((await searchNativeAsync("relatório vendas", 40)).length >= 4, "acha as sessões claude e a do codex");
});

test("busca cancelada para no meio sem erro", async () => {
  assert.deepEqual(await searchNativeAsync("relatório", 40, { aborted: true }), []);
});

test("histórico nativo assíncrono = síncrono, e a leitura síncrona seguinte sai do cache", async () => {
  for (const id of [`claude:${ids[0]}`, `codex:${codexId}`]) {
    const a = await nativeHistoryAsync(id);
    assert.ok(a && a.messages.length >= 2, id);
    assert.deepEqual(nativeHistory(id), a, id);
  }
  assert.equal(await nativeHistoryAsync("claude:nao-existe-0000"), null);
});

test("histórico nativo percebe o transcript que cresceu (não serve cache velho)", async () => {
  const id = ids[1], file = join(PROJ, id + ".jsonl");
  const before = (await nativeHistoryAsync(`claude:${id}`))!.messages.length;
  appendFileSync(file, JSON.stringify({ type: "user", cwd: "C:\\Projetos\\Synous", timestamp: "2026-10-30T11:00:00Z", message: { role: "user", content: "mais uma pergunta" } }) + "\n");
  const after = (await nativeHistoryAsync(`claude:${id}`))!.messages.length;
  assert.equal(after, before + 1);
});

test("texto de busca das sessões gerenciadas: sem carregar o histórico, e acompanha mensagem nova", async () => {
  const dir = mkdtempSync(join(HOME, "store-"));
  const seed = new Store({ agent: "mock", cwd: "/w" }, dir);
  seed.add("s1", { role: "user", text: "revisar relatório", ts: 1 });
  seed.add("s1", { role: "assistant", text: "feito", ts: 2 });
  const s = new Store({ agent: "mock", cwd: "/w" }, dir);
  assert.equal(await s.searchText("s1"), "revisar relatório\nfeito");
  assert.equal(s.isLoaded("s1"), false, "a busca não deixa o histórico preso na memória");
  assert.deepEqual(await s.lastTurnTexts("s1"), { lastUser: "revisar relatório", lastAssistant: "feito" });
  assert.equal(s.messageCount("s1"), 2);
  assert.equal(s.isLoaded("s1"), false);
  s.add("s1", { role: "user", text: "e o financeiro?", ts: 3 });
  assert.match(await s.searchText("s1"), /financeiro/, "mensagem nova entra na busca");
  assert.equal(await s.searchText("nao-existe"), "");
});
