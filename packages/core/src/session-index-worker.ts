/**
 * Worker do índice de busca entre sessões (SQLite FTS5 via better-sqlite3).
 *
 * Por que uma worker: o better-sqlite3 é SÍNCRONO e a montagem do índice lê gigabytes de transcript.
 * No event loop do Hub isso repetiria INC-01..03 (Hub parado = "Hub caiu"). Aqui nada disso toca o
 * loop do Hub: ele só troca mensagens pequenas com esta thread.
 *
 * O índice é DERIVADO dos arquivos de sessão (nunca a fonte da verdade): pode ser apagado a qualquer
 * momento e é refeito sozinho. Por isso esta worker só LÊ os transcripts e nunca grava nada fora do
 * próprio banco — em especial não chama o parse de `native.ts`, que grava o cache de títulos
 * (native-titles.json) e brigaria com a cópia do Hub.
 *
 * Incremental: os JSONL só crescem no fim (append). Para cada arquivo guardamos até onde lemos e a
 * assinatura dos bytes logo antes desse ponto; se o arquivo encolheu ou esses bytes mudaram (reescrita:
 * cancelamento que corta mensagens, migração), o arquivo é reindexado do zero. As mensagens novas e o
 * novo ponto de leitura entram na MESMA transação — worker morta no meio não duplica nada.
 */
import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { claudeFilesAsync, codexFilesAsync, cleanText, contentText, isCodexSubagentMeta, isInjected, isNoopAssistantText, resolveNativeCwd, titleText } from "./native.js";
import { buildFtsQuery, parseSearchQuery, searchableLength, searchCwdKey,sessionScore, titleMatches, SEARCH_MARK_END, SEARCH_MARK_START } from "./session-index-query.js";

type Kind = "managed" | "claude" | "codex";
interface ManagedMeta { key: string; agent: string; cwd: string; title: string; updatedAt: number }
interface Filters { agent?: string; since?: number; cwd?: string; kind?: "managed" | "native" }
interface Entry { role: string; text: string; ts: number }
interface ClaudeState { cwd: string; lastCwd: string; firstUser: string; aiTitle: string; customTitle: string; main: boolean }
interface CodexState { id: string; cwd: string; lastCwd: string; title: string; subagent: boolean }
type ParseState = Partial<ClaudeState & CodexState>;
interface FileRow { path: string; skey: string; kind: Kind; size: number; mtime: number; offset: number; tailsig: string; state: string }

const SCHEMA_VERSION = "1";
/** Teto de texto por mensagem no índice — resposta gigante entra pelo começo, que é o que se procura. */
const MAX_MSG_CHARS = 32_000;
/** Lote de leitura: pequeno o bastante para a worker responder uma busca entre um lote e outro. */
const READ_CHUNK = 2 * 1024 * 1024;
/** Linha maior que isso (saída de ferramenta colada inteira) é descartada sem quebrar a leitura. */
const MAX_LINE_BYTES = 64 * 1024 * 1024;
const TAIL_SIG_BYTES = 256;
const ONESHOT_CWD = /[\\/]\.jarvis[\\/]oneshot/i;
/** Quantos trechos casados entram na conta antes de agrupar por sessão. */
const MAX_MATCH_ROWS = 4000;
const SNIPPETS_PER_SESSION = 3;

const wd = workerData as { dbPath: string; managedDir: string; native: boolean };
const port = parentPort!;

// ------------------------------------------------------------------ banco
type Db = any;
let db: Db;
try {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  mkdirSync(dirname(wd.dbPath), { recursive: true });
  db = openDb(Database, wd.dbPath);
} catch (e) {
  port.postMessage({ type: "fatal", error: String((e as Error)?.message ?? e).slice(0, 300) });
  process.exit(0);
}

function openDb(Database: any, file: string): Db {
  const tryOpen = (): Db => {
    const d = new Database(file);
    d.pragma("journal_mode = WAL");
    d.pragma("synchronous = NORMAL");
    d.pragma("cache_size = -32000");
    d.pragma("temp_store = MEMORY");
    d.exec("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)");
    const v = d.prepare("SELECT v FROM meta WHERE k = 'schema'").get()?.v;
    if (v !== SCHEMA_VERSION) {
      d.exec(`
        DROP TABLE IF EXISTS msg_fts; DROP TABLE IF EXISTS msg; DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS files;
        CREATE TABLE files(path TEXT PRIMARY KEY, skey TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, offset INTEGER NOT NULL, tailsig TEXT NOT NULL, state TEXT NOT NULL);
        CREATE TABLE docs(skey TEXT PRIMARY KEY, kind TEXT NOT NULL, agent TEXT, cwd TEXT, cwdkey TEXT, title TEXT, updated INTEGER NOT NULL DEFAULT 0, skip INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE msg(id INTEGER PRIMARY KEY, skey TEXT NOT NULL, role TEXT, ts INTEGER, text TEXT NOT NULL);
        CREATE INDEX msg_skey ON msg(skey);
        CREATE VIRTUAL TABLE msg_fts USING fts5(text, content='msg', content_rowid='id', tokenize='unicode61 remove_diacritics 2', prefix='2 3');
        CREATE TRIGGER msg_ai AFTER INSERT ON msg BEGIN INSERT INTO msg_fts(rowid, text) VALUES (new.id, new.text); END;
        CREATE TRIGGER msg_ad AFTER DELETE ON msg BEGIN INSERT INTO msg_fts(msg_fts, rowid, text) VALUES ('delete', old.id, old.text); END;
      `);
      d.prepare("DELETE FROM meta WHERE k = 'built'").run();
      d.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', ?)").run(SCHEMA_VERSION);
    }
    return d;
  };
  try { return tryOpen(); }
  catch {
    // Banco ilegível (corrompido, versão estranha): é só um índice derivado — recomeça do zero.
    for (const f of [file, file + "-wal", file + "-shm"]) { try { unlinkSync(f); } catch { /* não existia */ } }
    return tryOpen();
  }
}

const q = {
  fileGet: db.prepare("SELECT * FROM files WHERE path = ?"),
  fileAll: db.prepare("SELECT path, skey FROM files"),
  fileUpsert: db.prepare("INSERT INTO files(path, skey, kind, size, mtime, offset, tailsig, state) VALUES (@path, @skey, @kind, @size, @mtime, @offset, @tailsig, @state) ON CONFLICT(path) DO UPDATE SET skey = excluded.skey, kind = excluded.kind, size = excluded.size, mtime = excluded.mtime, offset = excluded.offset, tailsig = excluded.tailsig, state = excluded.state"),
  fileDel: db.prepare("DELETE FROM files WHERE path = ?"),
  msgIns: db.prepare("INSERT INTO msg(skey, role, ts, text) VALUES (?, ?, ?, ?)"),
  msgDelKey: db.prepare("DELETE FROM msg WHERE skey = ?"),
  msgCount: db.prepare("SELECT count(*) AS n FROM msg"),
  docGet: db.prepare("SELECT * FROM docs WHERE skey = ?"),
  docUpsert: db.prepare("INSERT INTO docs(skey, kind, agent, cwd, cwdkey, title, updated, skip) VALUES (@skey, @kind, @agent, @cwd, @cwdkey, @title, @updated, @skip) ON CONFLICT(skey) DO UPDATE SET kind = excluded.kind, agent = excluded.agent, cwd = excluded.cwd, cwdkey = excluded.cwdkey, title = excluded.title, updated = excluded.updated, skip = excluded.skip"),
  docDel: db.prepare("DELETE FROM docs WHERE skey = ?"),
  docManagedKeys: db.prepare("SELECT skey FROM docs WHERE kind = 'managed'"),
  docSkip: db.prepare("UPDATE docs SET skip = 1 WHERE skey = ?"),
  docTouchManaged: db.prepare("INSERT INTO docs(skey, kind, updated, skip) VALUES (?, 'managed', ?, 1) ON CONFLICT(skey) DO NOTHING"),
};

/** Caminho comparável — a mesma regra do filtro de projeto no Hub (`sessionCwdWithin`). */
const cwdKey = searchCwdKey;

// ------------------------------------------------------------------ leitura dos transcripts
function claudeEntry(o: any, st: ParseState): Entry | null {
  if (o?.type === "ai-title" && o.aiTitle) { st.aiTitle = String(o.aiTitle); return null; }
  if (o?.type === "custom-title" && o.customTitle) { st.customTitle = String(o.customTitle); return null; }
  if (o?.type !== "user" && o?.type !== "assistant") return null;
  // Conversa de subagente (sidechain) não é a conversa da sessão — a lista também a ignora.
  if (o.isSidechain) return null;
  st.main = true;
  if (typeof o.cwd === "string" && o.cwd) { if (!st.cwd) st.cwd = o.cwd; st.lastCwd = o.cwd; }
  const c = o.message?.content;
  if (!st.firstUser && o.type === "user" && typeof c === "string") { const t0 = c.trim(); if (t0 && !isInjected(t0)) st.firstUser = t0; }
  let t = Array.isArray(c) ? c.map((b: any) => (b?.type === "text" ? b.text || "" : "")).join(" ") : contentText(c);
  if (o.type === "user" && isInjected(t)) return null;
  t = cleanText(t);
  if (!t || (o.type === "assistant" && isNoopAssistantText(t))) return null;
  return { role: o.type, text: t, ts: Date.parse(o.timestamp) || 0 };
}

function codexEntry(o: any, st: ParseState): Entry | null {
  if (o?.type === "session_meta" && o.payload) {
    if (isCodexSubagentMeta(o.payload)) st.subagent = true;
    else {
      st.id = st.id || o.payload.session_id || o.payload.id || "";
      st.cwd = st.cwd || o.payload.cwd || "";
      st.title = st.title || titleText(o.payload.title || o.payload.name || "");
    }
  }
  const pc = o?.payload?.cwd;
  if (typeof pc === "string" && pc) st.lastCwd = pc;
  if (!(o?.type === "response_item" && o.payload?.type === "message" && (o.payload.role === "user" || o.payload.role === "assistant"))) return null;
  const role = o.payload.role as string;
  let t = contentText(o.payload.content);
  if (role === "user" && isInjected(t)) return null;
  if (role === "user" && !st.title) st.title = titleText(t);
  t = cleanText(t);
  if (!t || (role === "assistant" && isNoopAssistantText(t))) return null;
  return { role, text: t, ts: Date.parse(o.timestamp) || 0 };
}

function managedEntry(o: any): Entry | null {
  if (o?.role !== "user" && o?.role !== "assistant") return null;
  const t = typeof o.text === "string" ? o.text.trim() : "";
  if (!t) return null;
  return { role: o.role, text: t, ts: Number(o.ts) || 0 };
}

function codexKey(path: string, st: ParseState): string {
  if (st.id) return "codex:" + st.id;
  const m = basename(path).match(/([0-9a-f]{8}-[0-9a-f-]+)\.jsonl$/i);
  return "codex:" + (m ? m[1] : basename(path));
}

function skeyFor(kind: Kind, path: string, st: ParseState): string {
  if (kind === "managed") return basename(path, ".jsonl");
  if (kind === "claude") return "claude:" + basename(path, ".jsonl");
  return codexKey(path, st);
}

function docFor(kind: Kind, skey: string, st: ParseState, mtime: number): Record<string, unknown> | null {
  if (kind === "managed") return null; // metadados vêm do Hub/Runner (título, projeto, visibilidade)
  const cwd = resolveNativeCwd(st.cwd || "", st.lastCwd || "");
  if (kind === "claude") {
    const title = titleText(st.aiTitle || "") || titleText(st.customTitle || st.firstUser || "") || "Sessão";
    return { skey, kind: "native", agent: "claude-code", cwd, cwdkey: cwdKey(cwd), title, updated: Math.round(mtime), skip: !st.main || ONESHOT_CWD.test(cwd) ? 1 : 0 };
  }
  return { skey, kind: "native", agent: "codex", cwd, cwdkey: cwdKey(cwd), title: st.title || "Sessão Codex", updated: Math.round(mtime), skip: st.subagent || ONESHOT_CWD.test(cwd) ? 1 : 0 };
}

function sig(buf: Buffer): string { return createHash("sha1").update(buf).digest("hex"); }

async function readSigAt(path: string, offset: number): Promise<string> {
  return sig(await readSigBytes(path, offset));
}

const yieldToMessages = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Indexa `path` a partir de onde parou (ou do zero). Lê em lotes; cada lote = uma transação com as
 * mensagens novas + o novo ponto de leitura. Entre lotes devolve a vez (buscas são atendidas).
 */
async function indexFile(path: string, kind: Kind, size: number, mtime: number, prev: FileRow | undefined): Promise<void> {
  let offset = 0;
  let state: ParseState = {};
  let skey = prev?.skey || "";
  if (prev && size >= prev.offset && prev.offset > 0 && (await readSigAt(path, prev.offset)) === prev.tailsig) {
    offset = prev.offset;
    try { state = JSON.parse(prev.state || "{}"); } catch { state = {}; }
  } else if (prev) {
    // Reescrito/encolhido: tudo desta sessão sai e entra de novo.
    syncRebuilt++;
    db.transaction(() => { q.msgDelKey.run(prev.skey); q.fileDel.run(path); })();
    skey = "";
  }
  if (offset >= size) { // nada novo (só a data mudou)
    q.fileUpsert.run({ path, skey: skey || skeyFor(kind, path, state), kind, size, mtime, offset, tailsig: prev?.tailsig || sig(Buffer.alloc(0)), state: JSON.stringify(state) });
    return;
  }
  const fh = await open(path, "r");
  try {
    let pos = offset, carry = Buffer.alloc(0), dropping = false;
    // Últimos bytes CONSUMIDOS (até o fim da última linha completa) — a assinatura que a próxima
    // sincronização compara para saber se o arquivo só cresceu.
    let tail = offset > 0 ? await readSigBytes(path, offset) : Buffer.alloc(0);
    let lastSig = sig(tail);
    const buf = Buffer.alloc(READ_CHUNK);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, READ_CHUNK, pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      syncBytes += bytesRead;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : Buffer.from(buf.subarray(0, bytesRead));
      const lastNl = data.lastIndexOf(10);
      if (lastNl < 0) {
        carry = data;
        if (carry.length > MAX_LINE_BYTES) { carry = Buffer.alloc(0); dropping = true; }
        continue;
      }
      const complete = data.subarray(0, lastNl + 1);
      carry = Buffer.from(data.subarray(lastNl + 1));
      const entries: Entry[] = [];
      let start = 0;
      while (start < complete.length) {
        const nl = complete.indexOf(10, start);
        const line = complete.subarray(start, nl);
        start = nl + 1;
        if (dropping) { dropping = false; continue; } // resto da linha gigante descartada
        if (!line.length) continue;
        let o: any;
        try { o = JSON.parse(line.toString("utf8")); } catch { continue; }
        const e = kind === "managed" ? managedEntry(o) : kind === "claude" ? claudeEntry(o, state) : codexEntry(o, state);
        if (e) entries.push(e.text.length > MAX_MSG_CHARS ? { ...e, text: e.text.slice(0, MAX_MSG_CHARS) } : e);
      }
      tail = Buffer.from(Buffer.concat([tail, complete]).subarray(-TAIL_SIG_BYTES));
      lastSig = sig(tail);
      const consumed = pos - carry.length;
      if (!skey) skey = skeyFor(kind, path, state);
      const k = skey;
      db.transaction(() => {
        for (const e of entries) q.msgIns.run(k, e.role, e.ts, e.text);
        q.fileUpsert.run({ path, skey: k, kind, size, mtime, offset: consumed, tailsig: lastSig, state: JSON.stringify(state) });
      })();
      await yieldToMessages();
    }
    if (!skey) skey = skeyFor(kind, path, state);
    // Arquivo sem nenhuma linha completa nova ainda (ex.: só uma linha em escrita): registra assim mesmo.
    if (!q.fileGet.get(path)) q.fileUpsert.run({ path, skey, kind, size, mtime, offset, tailsig: lastSig, state: JSON.stringify(state) });
    else db.prepare("UPDATE files SET size = ?, mtime = ? WHERE path = ?").run(size, mtime, path);
  } finally {
    await fh.close().catch(() => undefined);
  }
  const doc = docFor(kind, skey, state, mtime);
  if (doc) q.docUpsert.run(doc);
  else q.docTouchManaged.run(skey, Math.round(mtime));
}

async function readSigBytes(path: string, offset: number): Promise<Buffer> {
  const start = Math.max(0, offset - TAIL_SIG_BYTES), len = offset - start;
  if (len <= 0) return Buffer.alloc(0);
  const fh = await open(path, "r");
  try { const b = Buffer.alloc(len); const { bytesRead } = await fh.read(b, 0, len, start); return b.subarray(0, bytesRead); }
  finally { await fh.close().catch(() => undefined); }
}

async function listManaged(): Promise<Array<{ path: string; kind: Kind }>> {
  let names: string[] = [];
  try { names = await readdir(wd.managedDir); } catch { return []; }
  return names.filter((n) => n.endsWith(".jsonl")).map((n) => ({ path: join(wd.managedDir, n), kind: "managed" as Kind }));
}

// ------------------------------------------------------------------ sincronização
// `ready` = o índice já foi montado INTEIRO ao menos uma vez (marca gravada no banco, sobrevive a
// restart). Antes disso ele está incompleto e quem chama usa a busca antiga.
const status = {
  ready: db.prepare("SELECT v FROM meta WHERE k = 'built'").get()?.v === "1", building: false, filesDone: 0, filesTotal: 0, messages: 0, lastSyncAt: 0, lastSyncMs: 0, error: "" as string,
  /** da última sincronização: arquivos que mudaram, quantos foram refeitos do zero, bytes lidos */
  lastChanged: 0, lastRebuilt: 0, lastBytes: 0, lastSyncStartedAt: 0,
};
let syncBytes = 0, syncRebuilt = 0;
let syncing = false, syncAgain: ManagedMeta[] | null = null;
/** pedido de fechar recebido: nada novo começa e a sincronização em curso para no próximo arquivo */
let closing = false;

function applyManagedMeta(meta: ManagedMeta[]): void {
  const live = new Set<string>();
  db.transaction(() => {
    for (const m of meta) {
      if (!m || typeof m.key !== "string" || !m.key) continue;
      live.add(m.key);
      q.docUpsert.run({ skey: m.key, kind: "managed", agent: m.agent || "", cwd: m.cwd || "", cwdkey: cwdKey(m.cwd || ""), title: m.title || "", updated: Math.round(Number(m.updatedAt) || 0), skip: 0 });
    }
    // Sessão que o Hub não lista mais (apagada, oculta, interna) não aparece na busca.
    for (const r of q.docManagedKeys.all() as Array<{ skey: string }>) if (!live.has(r.skey)) q.docSkip.run(r.skey);
  })();
}

async function sync(meta: ManagedMeta[]): Promise<void> {
  if (closing) return;
  if (syncing) { syncAgain = meta; return; }
  syncing = true;
  const t0 = Date.now();
  status.lastSyncStartedAt = t0;
  let changed = 0;
  try {
    status.building = true;
    applyManagedMeta(meta);
    const found: Array<{ path: string; kind: Kind }> = [...await listManaged()];
    if (wd.native) {
      const [cf, xf] = await Promise.all([claudeFilesAsync(), codexFilesAsync()]);
      for (const f of cf) found.push({ path: f.path, kind: "claude" });
      for (const f of xf) found.push({ path: f.path, kind: "codex" });
    }
    const stats = new Map<string, { kind: Kind; size: number; mtime: number }>();
    for (let i = 0; i < found.length; i += 64) {
      const part = found.slice(i, i + 64);
      const res = await Promise.all(part.map(async (f) => { try { const s = await stat(f.path); return s.isFile() ? { ...f, size: s.size, mtime: s.mtimeMs } : null; } catch { return null; } }));
      for (const r of res) if (r) stats.set(r.path, { kind: r.kind, size: r.size, mtime: r.mtime });
    }
    // Arquivo que sumiu: sai do índice.
    const gone = (q.fileAll.all() as Array<{ path: string; skey: string }>).filter((r) => !stats.has(r.path));
    if (gone.length) db.transaction(() => { for (const g of gone) { q.msgDelKey.run(g.skey); q.fileDel.run(g.path); const d = q.docGet.get(g.skey); if (d && d.kind !== "managed") q.docDel.run(g.skey); } })();
    // Mais recentes primeiro: na 1ª montagem o que se procura mais já fica pesquisável cedo.
    const todo = [...stats.entries()].sort((a, b) => b[1].mtime - a[1].mtime);
    status.filesTotal = todo.length;
    status.filesDone = 0;
    syncBytes = 0; syncRebuilt = 0;
    for (const [path, s] of todo) {
      if (closing) break;
      const prev = q.fileGet.get(path) as FileRow | undefined;
      if (!(prev && prev.size === s.size && prev.mtime === s.mtime)) {
        changed++;
        try { await indexFile(path, s.kind, s.size, s.mtime, prev); }
        catch (e) { status.error = `${basename(path)}: ${String((e as Error)?.message ?? e).slice(0, 160)}`; }
      }
      status.filesDone++;
      if (status.filesDone % 50 === 0) { port.postMessage({ type: "progress", status: snapshot() }); await yieldToMessages(); }
    }
    if (!status.ready) db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('built', '1')").run();
    status.ready = true;
  } catch (e) {
    status.error = String((e as Error)?.message ?? e).slice(0, 200);
  } finally {
    status.building = false;
    status.lastChanged = changed; status.lastRebuilt = syncRebuilt; status.lastBytes = syncBytes;
    status.lastSyncAt = Date.now();
    status.lastSyncMs = Date.now() - t0;
    syncing = false;
    if (!closing) {
      port.postMessage({ type: "progress", status: snapshot() });
      if (syncAgain) { const next = syncAgain; syncAgain = null; void sync(next); }
    }
  }
}

function snapshot(): typeof status {
  try { status.messages = (q.msgCount.get() as { n: number }).n; } catch { /* banco ocupado: fica o último */ }
  return { ...status };
}

// ------------------------------------------------------------------ busca
function search(raw: string, filters: Filters, limit: number): unknown {
  const fts = buildFtsQuery(raw);
  // Sem nada pesquisável (vazio, só pontuação, só 1 letra): sem busca — nem por título.
  if (!fts) return { hits: [], total: 0, capped: false, tooShort: true };
  const p0 = parseSearchQuery(raw);
  const parsed = { terms: p0.terms.filter((t) => searchableLength(t) >= 2), phrases: p0.phrases.filter((t) => searchableLength(t) >= 2) };
  const where: string[] = ["d.skip = 0"];
  const params: unknown[] = [];
  if (filters.agent) { where.push("d.agent = ?"); params.push(filters.agent); }
  if (filters.since) { where.push("d.updated >= ?"); params.push(Math.round(filters.since)); }
  if (filters.kind) { where.push("d.kind = ?"); params.push(filters.kind); }
  if (filters.cwd) {
    const k = cwdKey(filters.cwd).replace(/[!%_]/g, (c) => "!" + c);
    where.push("(d.cwdkey = ? OR d.cwdkey LIKE ? ESCAPE '!')");
    params.push(cwdKey(filters.cwd), k + "/%");
  }
  const sessions = new Map<string, { best: number; matches: number; ids: Array<{ id: number; r: number }>; titleHit: boolean }>();
  let capped = false;
  if (fts) {
    const rows = db.prepare(`SELECT m.id AS id, m.skey AS skey, msg_fts.rank AS r FROM msg_fts JOIN msg m ON m.id = msg_fts.rowid JOIN docs d ON d.skey = m.skey WHERE msg_fts MATCH ? AND ${where.join(" AND ")} ORDER BY msg_fts.rank LIMIT ${MAX_MATCH_ROWS}`).all(fts, ...params) as Array<{ id: number; skey: string; r: number }>;
    capped = rows.length >= MAX_MATCH_ROWS;
    for (const row of rows) {
      let s = sessions.get(row.skey);
      if (!s) { s = { best: row.r, matches: 0, ids: [], titleHit: false }; sessions.set(row.skey, s); }
      s.matches++;
      if (row.r < s.best) s.best = row.r;
      if (s.ids.length < SNIPPETS_PER_SESSION) s.ids.push({ id: row.id, r: row.r });
    }
  }
  // Título: as mesmas regras, sem acento. ~2 mil sessões: varrer em memória é instantâneo.
  if (parsed.terms.length || parsed.phrases.length) {
    const docs = db.prepare(`SELECT d.skey AS skey, d.title AS title FROM docs d WHERE ${where.join(" AND ")}`).all(...params) as Array<{ skey: string; title: string }>;
    for (const d of docs) {
      if (!titleMatches(d.title || "", parsed)) continue;
      const s = sessions.get(d.skey);
      if (s) s.titleHit = true;
      else sessions.set(d.skey, { best: 0, matches: 0, ids: [], titleHit: true });
    }
  }
  const docStmt = q.docGet;
  const now = Date.now();
  const all = [...sessions.entries()].map(([skey, s]) => {
    const d = docStmt.get(skey) as { kind: string; agent: string; cwd: string; title: string; updated: number } | undefined;
    return { skey, s, d, score: sessionScore(s.best, s.matches, d?.updated || 0, now) };
  }).filter((x) => x.d);
  all.sort((a, b) => (Number(b.s.titleHit) - Number(a.s.titleHit)) || (b.score - a.score) || ((b.d!.updated || 0) - (a.d!.updated || 0)));
  const top = all.slice(0, limit);
  // Trechos de TODAS as sessões da página numa consulta só, com os ids LITERAIS (inteiros validados).
  // Não usar `rowid = ?`: o better-sqlite3 liga número JS como REAL e o FTS5 IGNORA a restrição de
  // rowid com valor REAL — todo trecho saía da 1ª mensagem que casou (achado na validação, 2026-11-16).
  const wanted = top.flatMap(({ s }) => s.ids.map((x) => x.id)).filter((n) => Number.isSafeInteger(n));
  const snip = new Map<number, string>(), info = new Map<number, { role: string; ts: number }>();
  if (wanted.length) {
    const list = wanted.join(",");
    for (const r of db.prepare(`SELECT rowid AS id, snippet(msg_fts, 0, '${SEARCH_MARK_START}', '${SEARCH_MARK_END}', '…', 24) AS s FROM msg_fts WHERE msg_fts MATCH ? AND rowid IN (${list})`).all(fts) as Array<{ id: number; s: string }>) snip.set(r.id, r.s);
    for (const r of db.prepare(`SELECT id, role, ts FROM msg WHERE id IN (${list})`).all() as Array<{ id: number; role: string; ts: number }>) info.set(r.id, { role: r.role, ts: r.ts });
  }
  const hits = top.map(({ skey, s, d, score }) => ({
    key: skey, kind: d!.kind, agent: d!.agent || "", cwd: d!.cwd || "", title: d!.title || "", updatedAt: d!.updated || 0,
    score, matches: s.matches, titleHit: s.titleHit,
    snippets: s.ids.map(({ id }) => ({ text: snip.get(id) || "", role: info.get(id)?.role || "", ts: info.get(id)?.ts || 0 })).filter((x) => x.text),
  }));
  return { hits, total: all.length, capped };
}

// ------------------------------------------------------------------ mensagens
port.on("message", (m: any) => {
  if (closing) return;
  if (m?.type === "sync") { void sync(Array.isArray(m.managed) ? m.managed : []); return; }
  if (m?.type === "search") {
    const t0 = Date.now();
    try {
      const out = search(String(m.query || ""), (m.filters || {}) as Filters, Math.max(1, Math.min(200, Number(m.limit) || 60)));
      port.postMessage({ type: "result", id: m.id, ok: true, ms: Date.now() - t0, status: snapshot(), ...(out as object) });
    } catch (e) {
      port.postMessage({ type: "result", id: m.id, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200), status: snapshot() });
    }
    return;
  }
  if (m?.type === "status") { port.postMessage({ type: "status", id: m.id, status: snapshot() }); return; }
  if (m?.type === "close") {
    // Fecha o banco e deixa a thread TERMINAR SOZINHA (sem process.exit, que dentro da worker é
    // encerramento abrupto como terminate()): fechar a porta tira o último handle e a limpeza do módulo
    // nativo roda na ordem normal. Sincronização em curso para no próximo lote (banco fechado).
    closing = true;
    try { db.close(); } catch { /* já fechado */ }
    port.close();
    return;
  }
});
port.postMessage({ type: "ready", status: snapshot() });
