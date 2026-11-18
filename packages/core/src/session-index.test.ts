/**
 * Busca entre sessões com índice FTS5 (2026-11-16): regras da consulta + a worker de verdade sobre
 * transcripts de exemplo (gerenciada, Claude e Codex), incluindo o que NÃO pode aparecer (subagente,
 * texto injetado, sessão oculta) e o caminho incremental (append, reescrita, arquivo apagado).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFtsQuery, foldText, parseSearchQuery, sessionScore, stripSearchMarks, titleMatches, SEARCH_MARK_END, SEARCH_MARK_START } from "./session-index-query.js";

// A suíte desliga o índice (scripts/test.env) para os Hubs de e2e não indexarem a máquina; aqui é o teste dele.
delete process.env.JARVIS_SESSION_INDEX;

test("consulta: palavras viram prefixo obrigatório, aspas viram frase, operadores do FTS5 ficam inertes", () => {
  assert.equal(buildFtsQuery("Refat sessão"), '"refat"* AND "sessao"*');
  assert.equal(buildFtsQuery('"fila travada" deploy'), '"fila travada" AND "deploy"*');
  assert.equal(buildFtsQuery("PRI-16"), '"pri-16"*');
  assert.equal(buildFtsQuery('a OR b NOT c ( ) : ^ *'), '"or"* AND "not"*', "operadores viram palavras comuns; 1 letra e pontuação saem");
  assert.equal(buildFtsQuery('diz "ola'), '"diz"* AND "ola"*', "aspa sem par não quebra a sintaxe");
  assert.equal(buildFtsQuery('ab"cd'), '"ab"* AND "cd"*', "aspa no meio da palavra só separa");
  assert.equal(buildFtsQuery("a"), null, "1 letra não vira busca (no índice real levava 4 s e não filtrava nada)");
  assert.equal(buildFtsQuery("c#"), null);
  assert.equal(buildFtsQuery("   "), null);
  assert.equal(buildFtsQuery("-- ..."), null);
});

test("título casa sem acento e sem caixa, com todas as partes", () => {
  const p = parseSearchQuery('busca "entre sessoes"');
  assert.deepEqual(p, { terms: ["busca"], phrases: ["entre sessoes"] });
  assert.equal(titleMatches("Busca ENTRE Sessões lenta", p), true);
  assert.equal(titleMatches("Busca lenta", p), false);
  assert.equal(foldText("Ação Ñ"), "acao n");
  assert.equal(stripSearchMarks(`a ${SEARCH_MARK_START}b${SEARCH_MARK_END} c`), "a b c");
});

test("nota: relevância manda; recência desempata sem enterrar sessão antiga muito melhor", () => {
  const now = Date.now(), day = 86_400_000;
  assert.ok(sessionScore(-5, 1, now, now) > sessionScore(-5, 1, now - 200 * day, now), "mesma relevância: a recente vence");
  assert.ok(sessionScore(-12, 1, now - 200 * day, now) > sessionScore(-5, 1, now, now), "muito mais relevante vence mesmo antiga");
  assert.ok(sessionScore(-5, 10, now, now) > sessionScore(-5, 1, now, now), "mais trechos ajudam");
});

// ------------------------------------------------------------------ worker de verdade
function line(o: unknown): string { return JSON.stringify(o) + "\n"; }

function fixture(): { root: string; managedDir: string; claudeDir: string; codexDir: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-sidx-"));
  const managedDir = join(root, "managed"), claudeDir = join(root, "claude"), codexDir = join(root, "codex");
  mkdirSync(managedDir, { recursive: true });
  mkdirSync(join(claudeDir, "C--proj-alfa"), { recursive: true });
  mkdirSync(join(codexDir, "2026", "11", "16"), { recursive: true });
  // Gerenciadas: m1 visível, m2 oculta (não vem nos metadados).
  writeFileSync(join(managedDir, "m1.jsonl"),
    line({ role: "user", text: "Precisamos da refatoração da sessão de pagamentos", ts: 1 }) +
    line({ role: "assistant", text: "Feito. Ticket PRI-16 atualizado com a evidência.", ts: 2 }));
  writeFileSync(join(managedDir, "m2.jsonl"), line({ role: "user", text: "segredo oculto pagamentos", ts: 1 }));
  // Claude: conversa normal + texto injetado + arquivo só de subagente.
  writeFileSync(join(claudeDir, "C--proj-alfa", "c1.jsonl"),
    line({ type: "user", cwd: "C:\\proj\\alfa", timestamp: "2026-11-01T10:00:00Z", message: { content: "Como configuro o webhook da Twilio a2p?" } }) +
    line({ type: "user", cwd: "C:\\proj\\alfa", message: { content: "<system-reminder>palavrainjetada</system-reminder>" } }) +
    line({ type: "assistant", cwd: "C:\\proj\\alfa", message: { content: [{ type: "text", text: "Use a URL do webhook. <system-reminder>outrainjetada</system-reminder>" }, { type: "tool_use", name: "x" }] } }) +
    line({ type: "ai-title", aiTitle: "Webhook Twilio" }));
  writeFileSync(join(claudeDir, "C--proj-alfa", "side.jsonl"),
    line({ type: "user", isSidechain: true, cwd: "C:\\proj\\alfa", message: { content: "subagente webhook" } }));
  // Codex: sessão normal + subagente.
  writeFileSync(join(codexDir, "2026", "11", "16", "rollout-2026-11-16T10-00-00-11111111-2222-3333-4444-555555555555.jsonl"),
    line({ type: "session_meta", payload: { session_id: "11111111-2222-3333-4444-555555555555", cwd: "C:\\proj\\beta" } }) +
    line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "migrar banco para postgres" }] } }) +
    line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Migração do banco concluída." }] } }));
  writeFileSync(join(codexDir, "2026", "11", "16", "rollout-2026-11-16T11-00-00-99999999-2222-3333-4444-555555555555.jsonl"),
    line({ type: "session_meta", payload: { session_id: "99999999-2222-3333-4444-555555555555", cwd: "C:\\proj\\beta", thread_source: "subagent" } }) +
    line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "postgres do subagente" }] } }));
  return { root, managedDir, claudeDir, codexDir, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Espera uma sincronização que COMEÇOU depois de `at` terminar — uma iniciada antes da mudança não a vê. */
async function syncedAfter(idx: { status(): { lastSyncStartedAt?: number; lastSyncAt: number; building: boolean } }, at: number): Promise<void> {
  await until(() => { const s = idx.status(); return (s.lastSyncStartedAt || 0) > at && s.lastSyncAt >= (s.lastSyncStartedAt || 0) && !s.building; });
}

async function until(cond: () => boolean, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("tempo esgotado esperando o índice");
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("índice: acha por conteúdo/título nos três tipos, respeita exclusões, filtros e atualização incremental", async (t) => {
  const { sessionIndexSupported, SessionIndex, toSessionSearchHits } = await import("./session-index.js");
  if (!sessionIndexSupported()) { t.skip("better-sqlite3 não instalado nesta máquina (dependência opcional)"); return; }
  const fx = fixture();
  // A worker lê estas variáveis ao carregar native.ts — valem para ela, não para o resto do processo.
  const prevClaude = process.env.JARVIS_CLAUDE_DIR, prevCodex = process.env.JARVIS_CODEX_DIR;
  process.env.JARVIS_CLAUDE_DIR = fx.claudeDir;
  process.env.JARVIS_CODEX_DIR = fx.codexDir;
  const meta = [{ key: "m1", agent: "claude-code", cwd: "C:\\proj\\alfa", title: "Plano de pagamentos", updatedAt: Date.now() }];
  const idx = new SessionIndex({ managedDir: fx.managedDir, managedMeta: () => meta, dbPath: join(fx.root, "idx", "s.db"), startDelayMs: 60_000, resyncMs: 600_000 });
  try {
    assert.equal(await idx.search("pagamentos"), null, "antes da 1ª montagem completa o índice não responde (busca antiga assume)");
    idx.requestSync(true);
    await until(() => idx.status().ready && !idx.status().building);
    const keys = async (q: string, f = {}): Promise<string[]> => ((await idx.search(q, f))?.hits || []).map((h) => h.key).sort();

    assert.deepEqual(await keys("sessao"), ["m1"], "sem acento acha 'sessão'");
    assert.deepEqual(await keys("refat"), ["m1"], "prefixo acha 'refatoração'");
    assert.deepEqual(await keys("PRI-16"), ["m1"]);
    assert.deepEqual(await keys('"ticket pri"'), ["m1"], "frase exata");
    assert.deepEqual(await keys("pagamentos"), ["m1"], "sessão oculta (fora dos metadados) não aparece");
    assert.deepEqual(await keys("webhook"), ["claude:c1"], "transcript só de subagente não aparece");
    assert.deepEqual(await keys("palavrainjetada"), [], "mensagem injetada não é indexada");
    assert.deepEqual(await keys("outrainjetada"), [], "bloco <system-reminder> sai do texto");
    assert.deepEqual(await keys("postgres"), ["codex:11111111-2222-3333-4444-555555555555"], "subagente do codex não aparece");
    assert.deepEqual(await keys("migracao banco"), ["codex:11111111-2222-3333-4444-555555555555"]);

    const r = (await idx.search("webhook"))!;
    const h = r.hits[0];
    assert.equal(h.title, "Webhook Twilio", "título = ai-title mais recente");
    assert.equal(h.cwd, "C:\\proj\\alfa");
    assert.equal(h.titleHit, true);
    assert.ok(h.snippets[0].text.includes(SEARCH_MARK_START + "webhook" + SEARCH_MARK_END), "trecho vem com destaque: " + h.snippets[0].text);

    const t1 = (await idx.search("plano"))!;
    assert.deepEqual(t1.hits.map((x) => [x.key, x.titleHit, x.matches]), [["m1", true, 0]], "casa só pelo título (metadado do Hub)");

    assert.deepEqual(await keys("banco", { agent: "codex" }), ["codex:11111111-2222-3333-4444-555555555555"]);
    assert.deepEqual(await keys("webhook", { agent: "codex" }), []);
    assert.deepEqual(await keys("webhook", { cwd: "c:/PROJ/alfa/" }), ["claude:c1"], "filtro de projeto ignora barra e caixa");
    assert.deepEqual(await keys("webhook", { cwd: "C:\\proj" }), ["claude:c1"], "subpasta do projeto entra");
    assert.deepEqual(await keys("webhook", { cwd: "C:\\proj\\al" }), [], "prefixo de nome não é subpasta");
    assert.deepEqual(await keys("webhook", { since: Date.now() + 86_400_000 }), []);
    assert.deepEqual(await keys("refat", { kind: "native" }), []);

    // Append: só o que entrou é lido, nada duplica.
    appendFileSync(join(fx.managedDir, "m1.jsonl"), line({ role: "user", text: "agora zebrafoo apareceu", ts: 3 }));
    const at1 = Date.now(); await new Promise((r) => setTimeout(r, 5));
    idx.requestSync(true);
    await syncedAfter(idx, at1);
    assert.deepEqual(await keys("zebrafoo"), ["m1"]);
    assert.equal((await idx.search("refatoracao"))!.hits[0].matches, 1, "append não duplica as mensagens antigas");

    // Reescrita (encolheu): o que saiu do arquivo sai do índice.
    writeFileSync(join(fx.managedDir, "m1.jsonl"), line({ role: "user", text: "conteúdo novo", ts: 9 }));
    const at2 = Date.now(); await new Promise((r) => setTimeout(r, 5));
    idx.requestSync(true);
    await syncedAfter(idx, at2);
    assert.deepEqual(await keys("zebrafoo"), []);
    assert.deepEqual(await keys("conteudo novo"), ["m1"]);

    // Arquivo apagado: sai do índice.
    unlinkSync(join(fx.codexDir, "2026", "11", "16", "rollout-2026-11-16T10-00-00-11111111-2222-3333-4444-555555555555.jsonl"));
    const at3 = Date.now(); await new Promise((r) => setTimeout(r, 5));
    idx.requestSync(true);
    await syncedAfter(idx, at3);
    assert.deepEqual(await keys("banco"), []);

    // Mapeamento para o cliente: gerenciada ganha os metadados atuais, nativa já representada some.
    const all = (await idx.search("webhook conteudo"))?.hits || [];
    const hits = (await idx.search("webhook"))!.hits.concat((await idx.search("conteudo"))!.hits);
    assert.equal(all.length, 0, "todas as palavras são obrigatórias");
    const mapped = toSessionSearchHits(hits, { managed: (k) => meta.find((m) => m.key === k), excludeNative: new Set(["claude:c1"]) });
    assert.deepEqual(mapped.map((x) => [x.id, x.title, x.where]), [["m1", "Plano de pagamentos", "content"]]);
    assert.equal(mapped[0].snippet.includes(SEARCH_MARK_START), false, "snippet simples vem sem marcadores");
  } finally {
    await idx.close();
    if (prevClaude === undefined) delete process.env.JARVIS_CLAUDE_DIR; else process.env.JARVIS_CLAUDE_DIR = prevClaude;
    if (prevCodex === undefined) delete process.env.JARVIS_CODEX_DIR; else process.env.JARVIS_CODEX_DIR = prevCodex;
    fx.done();
  }
});

test("índice: banco persiste entre aberturas e reabre pronto (sem remontar do zero)", async (t) => {
  const { sessionIndexSupported, SessionIndex } = await import("./session-index.js");
  if (!sessionIndexSupported()) { t.skip("better-sqlite3 não instalado"); return; }
  const fx = fixture();
  const dbPath = join(fx.root, "idx", "s.db");
  const meta = [{ key: "m1", agent: "claude-code", cwd: "C:\\proj\\alfa", title: "Plano", updatedAt: Date.now() }];
  const mk = () => new SessionIndex({ managedDir: fx.managedDir, managedMeta: () => meta, dbPath, native: false, startDelayMs: 60_000, resyncMs: 600_000 });
  const a = mk();
  try {
    a.requestSync(true);
    await until(() => a.status().ready && !a.status().building);
  } finally { await a.close(); }
  const b = mk();
  try {
    const r = await b.search("refatoracao");
    assert.ok(r, "reabre já pronto");
    assert.deepEqual(r!.hits.map((h) => h.key), ["m1"]);
  } finally { await b.close(); fx.done(); }
});

test("índice: o trecho de cada sessão vem das mensagens DELA (regressão: rowid ligado como REAL)", async (t) => {
  const { sessionIndexSupported, SessionIndex } = await import("./session-index.js");
  if (!sessionIndexSupported()) { t.skip("better-sqlite3 não instalado"); return; }
  const fx = fixture();
  writeFileSync(join(fx.managedDir, "m3.jsonl"),
    line({ role: "user", text: "primeira linha sem o termo", ts: 1 }) +
    line({ role: "user", text: "a sessão de deploy noturno falhou", ts: 2 }));
  const meta = [
    { key: "m1", agent: "claude-code", cwd: "C:\proj\alfa", title: "Pagamentos", updatedAt: Date.now() },
    { key: "m3", agent: "codex", cwd: "C:\proj\beta", title: "Noturno", updatedAt: Date.now() - 1000 },
  ];
  const idx = new SessionIndex({ managedDir: fx.managedDir, managedMeta: () => meta, dbPath: join(fx.root, "idx", "s.db"), native: false, startDelayMs: 60_000, resyncMs: 600_000 });
  try {
    idx.requestSync(true);
    await until(() => idx.status().ready && !idx.status().building);
    const r = (await idx.search("sessao"))!;
    const byKey = new Map(r.hits.map((h) => [h.key, h.snippets.map((s) => s.text).join(" ")]));
    assert.deepEqual([...byKey.keys()].sort(), ["m1", "m3"]);
    assert.match(byKey.get("m1")!, /pagamentos/, "trecho de m1 é de m1: " + byKey.get("m1"));
    assert.match(byKey.get("m3")!, /deploy noturno/, "trecho de m3 é de m3: " + byKey.get("m3"));
    assert.doesNotMatch(byKey.get("m3")!, /pagamentos/);
  } finally { await idx.close(); fx.done(); }
});
