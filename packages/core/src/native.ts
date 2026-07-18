/**
 * Native CLI session sync — read-only import of existing Claude Code and Codex
 * sessions so they show up in Jarvis's list, each tagged with its own LLM.
 *
 *  - Claude:  ~/.claude/projects/<dashed-cwd>/<session-uuid>.jsonl
 *             lines: {type:"custom-title"|"ai-title"|"user"|"assistant", ...}, cwd embedded.
 *  - Codex:   ~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl
 *             line 1: {type:"session_meta", payload:{session_id, cwd}}; messages in response_item.
 *
 * Ids are prefixed ("claude:"/"codex:") so they never collide with Jarvis's own
 * session UUIDs and the open handler can route them here. Nothing is written back.
 */
import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";
import { writeJsonAtomic, readJson } from "./persist.js";

export interface NativeMeta {
  id: string;
  title: string;
  agent: string;
  cwd: string;
  updatedAt: number;
  count: number;
  source: "native";
}

const CLAUDE_DIR = join(homedir(), ".claude", "projects");
const CODEX_DIR = join(homedir(), ".codex", "sessions");
const HEAD_BYTES = 262144; // enough to reach the title + first human prompt

function readHead(path: string, bytes = HEAD_BYTES): string {
  try {
    const fd = openSync(path, "r");
    const b = Buffer.alloc(bytes);
    const n = readSync(fd, b, 0, bytes, 0);
    closeSync(fd);
    return b.subarray(0, n).toString("utf8");
  } catch {
    return "";
  }
}

// Lê o FIM do arquivo. O ai-title "correto" é reescrito a cada turno e, numa sessão grande, mora
// perto do EOF — muito além do head. A primeira linha pode vir cortada (offset no meio): o parser
// de linha ignora o JSON inválido. 128KB cobre com folga (o último título fica a ~30KB do fim).
function readTail(path: string, bytes = 131072): string {
  try {
    const size = statSync(path).size;
    if (size <= 0) return "";
    const start = Math.max(0, size - bytes);
    const len = Math.min(bytes, size);
    const fd = openSync(path, "r");
    const b = Buffer.alloc(len);
    const n = readSync(fd, b, 0, len, start);
    closeSync(fd);
    return b.subarray(0, n).toString("utf8");
  } catch {
    return "";
  }
}

function eachLine(text: string, fn: (o: any) => void): void {
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // truncated last line from the head cut, or non-JSON
    }
    fn(o);
  }
}

// ------------------------------- file discovery -------------------------------
// Jarvis roda seus próprios prompts descartáveis (busca/resumo/digest/warmup) com cwd em
// ~/.jarvis/oneshot; o claude grava um transcript para cada um, e o projeto vira o diretório
// dashed "…-jarvis-oneshot". São centenas, com mtime sempre fresco — se entrarem na descoberta,
// tomam as vagas do topo por mtime e EXPULSAM as sessões reais da janela (slice antes do filtro).
// Excluídos aqui na origem; purgeProbeJunk ainda os alcança via includeScratch=true.
const SCRATCH_DIR = /jarvis-oneshot$/i;
function claudeFiles(includeScratch = false): Array<{ path: string; mtime: number }> {
  const out: Array<{ path: string; mtime: number }> = [];
  if (!existsSync(CLAUDE_DIR)) return out;
  for (const dir of readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (!includeScratch && SCRATCH_DIR.test(dir.name)) continue;
    const p = join(CLAUDE_DIR, dir.name);
    let files: string[];
    try {
      files = readdirSync(p);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        out.push({ path: join(p, f), mtime: statSync(join(p, f)).mtimeMs });
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

function codexFiles(): Array<{ path: string; mtime: number }> {
  const out: Array<{ path: string; mtime: number }> = [];
  if (!existsSync(CODEX_DIR)) return out;
  const walk = (d: string, depth: number) => {
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        try {
          out.push({ path: p, mtime: statSync(p).mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(CODEX_DIR, 0);
  return out;
}

// ------------------------------- parsing -------------------------------
const isInjected = (t: string) => !t || t.startsWith("<") || t.startsWith("#") || /^\s*\[[^\]]+\]\s*$/.test(t);
/** Strip tooling/system blocks that leak into message text (subagent notifications, usage, reminders). */
function cleanText(t: string): string {
  return (t || "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<usage>[\s\S]*?<\/usage>/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-[\s\S]*?<\/local-command-[a-z]*>/g, "")
    .trim();
}

function contentText(c: any): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === "string" ? p : p?.text || "")).join("").trim();
  return "";
}

// Nome ESTÁVEL de uma sessão nativa. O Claude Code reescreve o ai-title a cada turno; se o menu
// seguisse o mais recente, o nome ficaria mudando "no meio da corrida". Então CONGELAMOS: na
// primeira vez que vemos um ai-title de verdade, gravamos e nunca mais mudamos. Guardado em
// ~/.jarvis (NÃO toca o store do .claude). Apagar essa sessão limpa a entrada (deleteNative).
const TITLES_FILE = join(homedir(), ".jarvis", "native-titles.json");
let titleStore: Record<string, string> | null = null;
function loadTitles(): Record<string, string> {
  if (!titleStore) titleStore = readJson<Record<string, string>>(TITLES_FILE, {});
  return titleStore ?? {};
}
function saveTitles(): void { try { writeJsonAtomic(TITLES_FILE, titleStore ?? {}); } catch { /* ignore */ } }
/** Congela o 1º ai-title real visto; depois disso, sempre o mesmo (estável). `fallback` (custom-title
 *  ou 1ª mensagem) é usado só enquanto ainda não há ai-title — e NÃO é congelado. */
function stableTitle(id: string, latestAi: string, fallback: string): string {
  const store = loadTitles();
  if (store[id]) return store[id];
  if (latestAi) { store[id] = latestAi; saveTitles(); return latestAi; }
  return fallback || "Sessão Claude";
}

function parseClaude(path: string): Omit<NativeMeta, "updatedAt"> | null {
  const head = readHead(path);
  if (!head) return null;
  const id = basename(path).replace(/\.jsonl$/i, "");
  let firstUser = "", cwd = "";
  eachLine(head, (o) => {
    if (o.type === "user" || o.type === "assistant") {
      if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
      if (!firstUser && o.type === "user" && typeof o.message?.content === "string") {
        const t = o.message.content.trim();
        if (t && !isInjected(t)) firstUser = t;
      }
    }
  });
  if (cwd && /[\\/]\.jarvis[\\/]oneshot/i.test(cwd)) return null; // Jarvis's own one-shot (search/summary/digest) — not a real session
  // Título CORRETO = o ai-title MAIS RECENTE (o Claude Code o reescreve a cada turno; fica descritivo
  // e no idioma da conversa). Ele vive no FIM do arquivo, então lemos a cauda. O último vence.
  let aiTitle = "", customTitle = "";
  eachLine(readTail(path), (o) => {
    if (o.type === "ai-title" && o.aiTitle) aiTitle = o.aiTitle;
    else if (o.type === "custom-title" && o.customTitle) customTitle = o.customTitle;
  });
  const title = stableTitle("claude:" + id, aiTitle, customTitle || firstUser.slice(0, 60));
  return { id: "claude:" + id, title, agent: "claude-code", cwd, count: 0, source: "native" };
}

function parseCodex(path: string): Omit<NativeMeta, "updatedAt"> | null {
  const head = readHead(path);
  if (!head) return null;
  let id = "", cwd = "", title = "";
  eachLine(head, (o) => {
    if (o.type === "session_meta" && o.payload) {
      id = o.payload.session_id || o.payload.id || id;
      cwd = o.payload.cwd || cwd;
    } else if (!title && o.type === "response_item" && o.payload?.type === "message" && o.payload.role === "user") {
      const t = contentText(o.payload.content);
      if (t && !isInjected(t)) title = t;
    }
  });
  if (cwd && /[\\/]\.jarvis[\\/]oneshot/i.test(cwd)) return null; // Jarvis's own one-shot (summary/digest/voice) — not a real session
  if (!id) {
    const m = basename(path).match(/([0-9a-f]{8}-[0-9a-f-]+)\.jsonl$/i);
    id = m ? m[1] : basename(path);
  }
  return { id: "codex:" + id, title: (title || "Sessão Codex").slice(0, 60), agent: "codex", cwd, count: 0, source: "native" };
}

// ------------------------------- caching + public API -------------------------------
const pcache = new Map<string, { mtime: number; meta: Omit<NativeMeta, "updatedAt"> | null }>();
function cachedParse(path: string, mtime: number, fn: (p: string) => Omit<NativeMeta, "updatedAt"> | null) {
  const c = pcache.get(path);
  if (c && c.mtime === mtime) return c.meta;
  const meta = fn(path);
  pcache.set(path, { mtime, meta });
  return meta;
}

let listCache: { at: number; list: NativeMeta[] } | null = null;

/** Recent native sessions across Claude + Codex, newest first, agent-tagged. */
export function listNative(limit = Number(process.env.JARVIS_NATIVE_LIMIT || 40)): NativeMeta[] {
  if (listCache && Date.now() - listCache.at < 15000) return listCache.list;
  const metas: NativeMeta[] = [];
  for (const { path, mtime } of claudeFiles().sort((a, b) => b.mtime - a.mtime).slice(0, limit)) {
    const m = cachedParse(path, mtime, parseClaude);
    if (m) metas.push({ ...m, updatedAt: mtime });
  }
  for (const { path, mtime } of codexFiles().sort((a, b) => b.mtime - a.mtime).slice(0, limit)) {
    const m = cachedParse(path, mtime, parseCodex);
    if (m) metas.push({ ...m, updatedAt: mtime });
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  const list = metas.slice(0, limit);
  listCache = { at: Date.now(), list };
  return list;
}

// ------------------------------- full-text search -------------------------------
// Filtro LITERAL sobre título + CONTEÚDO da conversa (não é busca semântica/LLM): digitar "a2p"
// tem que achar a sessão da Twilio A2P mesmo que "a2p" só apareça no meio do chat. Como um grep
// em todos os arquivos de sessão.
export interface SessionHit { id: string; title: string; agent: string; cwd: string; updatedAt: number; snippet: string; where: "title" | "content"; }

/** Trecho legível ao redor da 1ª ocorrência (colapsa espaços/novas linhas, com reticências). */
export function snippetAround(hay: string, idx: number, tokLen: number, span = 200): string {
  if (idx < 0) return hay.slice(0, span).replace(/\s+/g, " ").trim();
  const start = Math.max(0, idx - 70), end = Math.min(hay.length, idx + tokLen + 110);
  let s = hay.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "… " + s;
  if (end < hay.length) s = s + " …";
  return s.slice(0, span);
}

// Haystack (título + textos das mensagens) por arquivo, com teto de tamanho pra sessões gigantes
// não estourarem memória, cacheado por mtime (a 1ª busca parseia; refinar o termo é instantâneo).
const SEARCH_CAP = 2 * 1024 * 1024;
const searchDocCache = new Map<string, { key: string; title: string; hay: string }>();
function searchDoc(path: string, mtime: number, claude: boolean, title: string): { title: string; hay: string } {
  const key = String(mtime);
  const hit = searchDocCache.get(path);
  if (hit && hit.key === key) return hit;
  let raw = "";
  try { raw = readFileSync(path, "utf8"); } catch { return { title, hay: title }; }
  const parts: string[] = [title];
  let total = title.length;
  eachLine(raw, (o) => {
    if (total > SEARCH_CAP) return;
    let t = "";
    if (claude) {
      if (o.type !== "user" && o.type !== "assistant") return;
      const c = o.message?.content;
      t = Array.isArray(c) ? c.map((b: any) => (b?.type === "text" ? b.text || "" : "")).join(" ") : contentText(c);
      if (o.type === "user" && isInjected(t)) return;
    } else {
      if (!(o.type === "response_item" && o.payload?.type === "message" && (o.payload.role === "user" || o.payload.role === "assistant"))) return;
      t = contentText(o.payload.content);
      if (o.payload.role === "user" && isInjected(t)) return;
    }
    t = cleanText(t);
    if (t) { parts.push(t); total += t.length + 1; }
  });
  const doc = { key, title, hay: parts.join("\n").slice(0, SEARCH_CAP) };
  if (searchDocCache.size > 60) searchDocCache.clear();
  searchDocCache.set(path, doc);
  return doc;
}

/** Native sessions whose title OR conversation contains ALL query tokens (case-insensitive). */
export function searchNative(query: string, limit = Number(process.env.JARVIS_NATIVE_LIMIT || 40)): SessionHit[] {
  const tokens = query.toLowerCase().split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return [];
  const cand = [
    ...claudeFiles().map((f) => ({ ...f, claude: true })),
    ...codexFiles().map((f) => ({ ...f, claude: false })),
  ].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  const hits: SessionHit[] = [];
  for (const { path, mtime, claude } of cand) {
    const meta = cachedParse(path, mtime, claude ? parseClaude : parseCodex);
    if (!meta) continue;
    const doc = searchDoc(path, mtime, claude, meta.title);
    const hl = doc.hay.toLowerCase();
    if (!tokens.every((t) => hl.includes(t))) continue;
    const titleL = doc.title.toLowerCase();
    // snippet: mostra a 1ª ocorrência de conteúdo; se o termo só bate no título, mostra o título.
    const primary = tokens.find((t) => !titleL.includes(t)) || tokens[0];
    const idx = hl.indexOf(primary);
    const inContent = idx >= doc.title.length + 1;
    hits.push({ id: meta.id, title: meta.title, agent: meta.agent, cwd: meta.cwd, updatedAt: mtime, where: inContent ? "content" : "title", snippet: inContent ? snippetAround(doc.hay, idx, primary.length) : meta.title });
  }
  return hits;
}

/** One-time cleanup of the availability-probe litter: native claude sessions whose whole
 *  content is the "ok" ping the OLD probe left in the home dir. The signature is very specific
 *  (title "ok" + tiny file + first user message exactly "ok") so it can never touch a real
 *  conversation. Runs at Hub/Runner startup on each machine. Returns how many were removed. */
export function purgeProbeJunk(): number {
  let n = 0;
  for (const { path } of claudeFiles(true)) {
    try {
      if (statSync(path).size > 30000) continue;
      const meta = parseClaude(path);
      if (!meta || meta.title.trim().toLowerCase() !== "ok") continue;
      let firstUser = "";
      eachLine(readHead(path, 8000), (o) => { if (!firstUser && o.type === "user" && typeof o.message?.content === "string") firstUser = o.message.content.trim(); });
      if (firstUser.toLowerCase() !== "ok") continue;
      unlinkSync(path); n++;
    } catch { /* skip */ }
  }
  if (n) listCache = null;
  return n;
}

/** Delete Jarvis's own throwaway one-shot transcripts (search/summary/digest/warmup) that claude
 *  writes into ~/.claude under the "…-jarvis-oneshot" project. They are never real sessions (already
 *  excluded from the list) but pile up by the hundreds. Only files OLDER than maxAgeMs are removed,
 *  so an in-flight one-shot is never touched. Runs at Hub/Runner startup. Returns how many removed. */
const SCRATCH_PATH = /jarvis-oneshot[\\/]/i;
export function purgeScratch(maxAgeMs = 30 * 60_000): number {
  let n = 0;
  const now = Date.now();
  for (const { path, mtime } of claudeFiles(true)) {
    if (!SCRATCH_PATH.test(path)) continue;
    if (now - mtime < maxAgeMs) continue;
    try { unlinkSync(path); n++; } catch { /* skip */ }
  }
  if (n) listCache = null;
  return n;
}

export function isNativeId(id: string): boolean {
  return typeof id === "string" && (id.startsWith("claude:") || id.startsWith("codex:"));
}

/** The on-disk jsonl for a native id (+ whether it's a claude session) — for live tailing. */
export function nativeFilePath(id: string): { path: string; claude: boolean } | null {
  return isNativeId(id) ? findFileById(id) : null;
}

/** Permanently delete a native session's jsonl (claude:<id> / codex:<id>). Irreversible.
 *  A managed session's bound claude session is deleted by passing "claude:" + session_id.
 *  Best-effort: a session whose file is already gone counts as removed (returns true) so
 *  the UI drops it either way; only a real unlink failure (locked/permission) returns false. */
export function deleteNative(id: string): boolean {
  listCache = null; // always re-scan the list after a delete attempt
  const store = loadTitles(); if (store[id]) { delete store[id]; saveTitles(); } // esquece o nome congelado
  const f = isNativeId(id) ? findFileById(id) : null;
  if (!f) return true; // nothing on disk — treat as already removed
  try { unlinkSync(f.path); } catch { return false; }
  pcache.delete(f.path);
  return true;
}

/** The message roles Jarvis surfaces from a native transcript (matches the Runner↔Hub protocol's
 *  RunnerMsg.role). On-disk values are normalized to these; anything else is dropped upstream. */
export type MsgRole = "user" | "assistant" | "system" | "tool";

export type NativeEvent =
  | { kind: "message"; role: MsgRole; text: string; ts: number }
  // path/adds/dels/rows so a LIVE-mirrored tool block matches what a page refresh shows:
  // clickable file, +/- counts, expandable diff. Without them the tail rendered a bare "Editando".
  | { kind: "tool"; name: string; summary: string; detail?: string; path?: string; adds?: number; dels?: number; rows?: DiffRow[] };

function toolSummary(name: string, input: any): string {
  const base = (p: string) => (p || "").split(/[\\/]/).pop() || p;
  try {
    switch (name) {
      case "Bash": return "Bash: " + String(input?.command || "").replace(/\s+/g, " ").slice(0, 90);
      case "Read": return "Lendo " + base(input?.file_path);
      case "Write": return "Criando " + base(input?.file_path);
      case "Edit": case "NotebookEdit": case "MultiEdit": return "Editando " + base(input?.file_path);
      case "Grep": return "Buscando /" + String(input?.pattern || "").slice(0, 40) + "/";
      case "Glob": return "Listando " + String(input?.pattern || "");
      case "Task": case "Agent": return "Subagente: " + String(input?.description || input?.subagent_type || "").slice(0, 60);
      case "WebFetch": return "Abrindo " + String(input?.url || "").slice(0, 60);
      case "WebSearch": return "Pesquisando: " + String(input?.query || "").slice(0, 60);
      default: { const s = JSON.stringify(input || {}); return name + (s && s !== "{}" ? " " + s.slice(0, 60) : ""); }
    }
  } catch { return name; }
}

/** Full command/args behind a tool row (untruncated, newlines kept) — shown when the row is
 *  expanded. undefined when the summary already shows everything. Mirrors agents.ts:toolDetail. */
function toolDetail(name: string, input: any): string | undefined {
  let full = "";
  if (name === "Bash") full = String(input?.command || "");
  else if (name === "Task" || name === "Agent") full = String(input?.prompt || input?.description || "");
  else if (name === "Grep") full = String(input?.pattern || "");
  else if (name === "WebFetch") full = String(input?.url || "");
  else if (name === "WebSearch") full = String(input?.query || "");
  else { try { full = JSON.stringify(input ?? {}, null, 1); } catch { full = ""; } }
  full = full.trim();
  if (!full || full.length <= 90) return undefined;
  return full.length > 4000 ? full.slice(0, 4000) + "\n… (truncado)" : full;
}

/** For a file tool_use: the real path, +/- line counts AND the diff rows of THIS specific edit
 *  (so the chat can expand exactly what changed at that point). Rows are capped — a huge edit
 *  omits them and the UI falls back to the full-file diff panel. Shared by history + live stream. */
export function toolFileStat(name: string, input: any): { path?: string; adds?: number; dels?: number; rows?: DiffRow[] } {
  const inp = input || {};
  const cap = (rows: DiffRow[]): DiffRow[] | undefined => (rows.length && rows.length <= 300 ? rows : undefined);
  if (name === "Edit") { const c = editCounts(inp.old_string || "", inp.new_string || ""); return { path: inp.file_path, ...c, rows: cap(lineDiff(inp.old_string || "", inp.new_string || "")) }; }
  if (name === "Write") { const lines = String(inp.content || "").split("\n"); return { path: inp.file_path, adds: inp.content ? lines.length : 0, dels: 0, rows: cap(inp.content ? lines.map((s: string) => ({ t: "+" as const, s })) : []) }; }
  if (name === "MultiEdit" && Array.isArray(inp.edits)) {
    let a = 0, d = 0; const rows: DiffRow[] = [];
    inp.edits.forEach((e: any, i: number) => { if (i) rows.push({ t: "@", s: `— edição ${i + 1} —` }); rows.push(...lineDiff(e?.old_string || "", e?.new_string || "")); const c = editCounts(e?.old_string || "", e?.new_string || ""); a += c.adds; d += c.dels; });
    return { path: inp.file_path, adds: a, dels: d, rows: cap(rows) };
  }
  if (name === "Read") return { path: inp.file_path };
  if (name === "NotebookEdit") return { path: inp.notebook_path };
  return {};
}

/** Parse ONE jsonl line into displayable events: text turns AND tool activity (for live tailing). */
export function parseNativeEvents(line: string, claude: boolean): NativeEvent[] {
  let o: any;
  try { o = JSON.parse(line); } catch { return []; }
  const out: NativeEvent[] = [];
  if (claude) {
    if (o.type === "assistant") {
      for (const b of o.message?.content || []) {
        if (b.type === "text" && b.text?.trim()) { const t = cleanText(b.text); if (t) out.push({ kind: "message", role: "assistant", text: t, ts: Date.parse(o.timestamp) || 0 }); }
        else if (b.type === "tool_use") { const st = toolFileStat(b.name, b.input); out.push({ kind: "tool", name: b.name, summary: toolSummary(b.name, b.input), detail: toolDetail(b.name, b.input), path: st.path, adds: st.adds, dels: st.dels, rows: st.rows }); }
      }
    } else if (o.type === "user") {
      const t = cleanText(contentText(o.message?.content));
      if (t && !isInjected(t)) out.push({ kind: "message", role: "user", text: t, ts: Date.parse(o.timestamp) || 0 });
    }
    return out;
  }
  if (o.type === "response_item" && o.payload?.type === "message") {
    const role = o.payload.role;
    if (role === "user" || role === "assistant") {
      const t = contentText(o.payload.content);
      if (t && !(role === "user" && isInjected(t))) out.push({ kind: "message", role, text: t, ts: Date.parse(o.timestamp) || 0 });
    }
  }
  return out;
}

// ------------------------- files touched in a session -------------------------
export interface TouchedFile { path: string; action: "read" | "edit" | "write"; adds: number; dels: number; }
export interface DiffRow { t: " " | "+" | "-" | "@"; s: string; }

/** Line-level diff (LCS). Rows tagged ' '(context) '+'(add) '-'(del). Caps work to stay fast. */
export function lineDiff(a: string, b: string): DiffRow[] {
  const A = (a ?? "").split("\n"), B = (b ?? "").split("\n");
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return [...A.map((s) => ({ t: "-" as const, s })), ...B.map((s) => ({ t: "+" as const, s }))];
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: " ", s: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", s: A[i] }); i++; }
    else { out.push({ t: "+", s: B[j] }); j++; }
  }
  while (i < n) out.push({ t: "-", s: A[i++] });
  while (j < m) out.push({ t: "+", s: B[j++] });
  return out;
}
/** +/- line counts for a single old→new edit. */
export function editCounts(oldStr: string, newStr: string): { adds: number; dels: number } {
  let adds = 0, dels = 0;
  for (const r of lineDiff(oldStr, newStr)) { if (r.t === "+") adds++; else if (r.t === "-") dels++; }
  return { adds, dels };
}

interface FileOp { action: "read" | "edit" | "write"; edits: Array<{ old: string; new: string }>; content?: string; adds: number; dels: number; }
function resolveClaudeJsonl(id: string): string | null {
  const f = findFileById(id.startsWith("claude:") ? id : "claude:" + id);
  return f && f.claude ? f.path : null;
}
/** Walk a claude session jsonl and aggregate per-file tool activity (Read/Edit/Write/MultiEdit). */
// Aggregating a session costs a full re-read plus an LCS diff per edit, and it is hit on every
// open (and again per inline diff). Cached on the jsonl's mtime+size, so re-opening a session —
// or a session that is idle — is free, while a live one re-aggregates as soon as it grows.
const opsCache = new Map<string, { key: string; ops: Map<string, FileOp> }>();
function claudeFileOps(jsonlPath: string): Map<string, FileOp> {
  let stamp = "";
  try { const s = statSync(jsonlPath); stamp = `${s.mtimeMs}:${s.size}`; } catch { /* fall through to a fresh read */ }
  const hit = opsCache.get(jsonlPath);
  if (hit && stamp && hit.key === stamp) return hit.ops;
  const ops = new Map<string, FileOp>();
  let raw: string;
  try { raw = readFileSync(jsonlPath, "utf8"); } catch { return ops; }
  const bump = (p: string): FileOp => { let o = ops.get(p); if (!o) { o = { action: "read", edits: [], adds: 0, dels: 0 }; ops.set(p, o); } return o; };
  eachLine(raw, (o: any) => {
    if (o.type !== "assistant") return;
    for (const b of o.message?.content || []) {
      if (b.type !== "tool_use") continue;
      const inp = b.input || {};
      if (b.name === "Read" && inp.file_path) bump(inp.file_path);
      else if (b.name === "Edit" && inp.file_path) { const x = bump(inp.file_path); x.action = "edit"; if (typeof inp.old_string === "string") x.edits.push({ old: inp.old_string, new: inp.new_string || "" }); }
      else if (b.name === "MultiEdit" && inp.file_path && Array.isArray(inp.edits)) { const x = bump(inp.file_path); x.action = "edit"; for (const e of inp.edits) if (typeof e?.old_string === "string") x.edits.push({ old: e.old_string, new: e.new_string || "" }); }
      else if (b.name === "Write" && inp.file_path) { const x = bump(inp.file_path); if (x.action !== "edit") x.action = "write"; x.content = inp.content || ""; }
      else if (b.name === "NotebookEdit" && inp.notebook_path) { bump(inp.notebook_path).action = "edit"; }
    }
  });
  for (const o of ops.values()) {
    if (o.action === "edit") for (const e of o.edits) { const c = editCounts(e.old, e.new); o.adds += c.adds; o.dels += c.dels; }
    else if (o.action === "write" && o.content != null) o.adds = o.content ? o.content.split("\n").length : 0;
  }
  if (stamp) { if (opsCache.size > 40) opsCache.clear(); opsCache.set(jsonlPath, { key: stamp, ops }); }
  return ops;
}
/** Files touched in a session (real absolute paths + action + +/- counts). id: "claude:<uuid>" or a raw claude session_id. */
export function sessionFiles(id: string): TouchedFile[] {
  const jsonl = resolveClaudeJsonl(id);
  if (!jsonl) return [];
  return [...claudeFileOps(jsonl).entries()]
    .map(([path, o]) => ({ path, action: o.action, adds: o.adds, dels: o.dels }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
/** The unified diff rows for ONE edited file in a session (concatenates multiple edits). */
export function sessionFileDiff(id: string, path: string): { path: string; name: string; rows?: DiffRow[]; adds?: number; dels?: number; error?: string } {
  const jsonl = resolveClaudeJsonl(id);
  if (!jsonl) return { path, name: basename(path), error: "sessão não encontrada" };
  const o = claudeFileOps(jsonl).get(path);
  if (!o || o.action !== "edit" || !o.edits.length) return { path, name: basename(path), error: "sem diff (não foi editado nesta sessão)" };
  const rows: DiffRow[] = [];
  o.edits.forEach((e, idx) => { if (idx) rows.push({ t: "@", s: `— edição ${idx + 1} de ${o.edits.length} —` }); for (const r of lineDiff(e.old, e.new)) rows.push(r); });
  return { path, name: basename(path), rows, adds: o.adds, dels: o.dels };
}

/** Cheap agent+cwd lookup (head read only) — used to continue a native session. */
export function nativeInfo(id: string): { agent: string; cwd: string } | null {
  if (!isNativeId(id)) return null;
  const f = findFileById(id);
  if (!f) return null;
  const meta = f.claude ? parseClaude(f.path) : parseCodex(f.path);
  return meta ? { agent: meta.agent, cwd: meta.cwd } : null;
}

function findFileById(id: string): { path: string; claude: boolean } | null {
  const claude = id.startsWith("claude:");
  const uuid = id.slice(id.indexOf(":") + 1);
  const files = claude ? claudeFiles() : codexFiles();
  const hit = files.find((f) => basename(f.path).includes(uuid));
  return hit ? { path: hit.path, claude } : null;
}

export interface HistMsg { role: MsgRole; text: string; ts: number; name?: string; detail?: string; path?: string; adds?: number; dels?: number; rows?: DiffRow[]; }
/** Full read-only history of one native session — text turns AND tool activity (role:"tool"),
 *  interleaved in order, so the "editando/criando arquivo" blocks survive a page refresh. */
// `diffLimit` bounds how many tool items get their file stats computed. Each Edit stat runs an
// LCS diff, and the caller only ever renders the tail of the history — computing stats for every
// tool_use in a long session meant hundreds of diffs built and then thrown away on the slice,
// which is what made switching sessions crawl. Stats are filled for the last N tool items only.
// Parsing a session's history means reading and JSON-parsing its whole jsonl — ~120ms on a 30MB
// session, and it's on the critical path of every open (the file list rides along in the same
// response, which is why "os arquivos demoram a aparecer"). Cache the PARSED VIEW keyed on the
// jsonl's mtime+size (not the file bytes): an idle session re-opens instantly, a live one whose
// jsonl just grew re-parses. Bounded so memory can't run away.
type NativeHist = { agent: string; cwd: string; title: string; messages: HistMsg[]; inputTokens?: number; model?: string; effort?: string };
const histCache = new Map<string, { key: string; data: NativeHist }>();
// Contexto de entrada (fresh + cache) do último turno do thread principal — pro medidor de consumo
// aparecer JÁ ao abrir a sessão, não só depois da 1ª mensagem nova. Mesma conta de agents.ts.
function inputContextOf(u: any): number | undefined {
  if (!u) return undefined;
  const n = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  return n || undefined;
}
// ---- parse-health telemetry -------------------------------------------------
// The native readers reverse-engineer an UNDOCUMENTED on-disk format, so an upstream CLI change
// degrades SILENTLY: a non-empty transcript that suddenly parses to zero messages is the tell.
// We count that and warn (throttled) so a format break surfaces HERE instead of as a user
// "my history went blank" much later. The Hub can also surface nativeParseHealth() in a status view.
const PARSE_HEALTH = { parses: 0, emptyNonEmptyFiles: 0, lastEmptyPath: "", lastEmptyAt: 0 };
let lastParseWarnAt = 0;
function noteParse(path: string, bytes: number, produced: number): void {
  PARSE_HEALTH.parses++;
  if (bytes > 2048 && produced === 0) {
    PARSE_HEALTH.emptyNonEmptyFiles++;
    PARSE_HEALTH.lastEmptyPath = path;
    PARSE_HEALTH.lastEmptyAt = Date.now();
    if (PARSE_HEALTH.lastEmptyAt - lastParseWarnAt > 60_000) {
      lastParseWarnAt = PARSE_HEALTH.lastEmptyAt;
      console.warn(`[native] AVISO: transcript de ${bytes} bytes parseou 0 mensagens — possível mudança no formato on-disk do CLI: ${path}`);
    }
  }
}
/** Snapshot of native-parse health. `emptyNonEmptyFiles` = non-empty transcripts that parsed to
 *  zero messages — the early signal that an upstream (Claude/Codex) format change broke the reader. */
export function nativeParseHealth(): { parses: number; emptyNonEmptyFiles: number; lastEmptyPath: string; lastEmptyAt: number } {
  return { ...PARSE_HEALTH };
}

export function nativeHistory(id: string, diffLimit = 120): NativeHist | null {
  if (!isNativeId(id)) return null;
  const f = findFileById(id);
  if (!f) return null;
  let stamp = "";
  try { const s = statSync(f.path); stamp = `${diffLimit}:${s.mtimeMs}:${s.size}`; } catch { /* fall through */ }
  const ckey = f.path;
  const hit = histCache.get(ckey);
  if (hit && stamp && hit.key === stamp) return hit.data;
  let raw: string;
  try {
    raw = readFileSync(f.path, "utf8");
  } catch {
    return null;
  }
  const messages: HistMsg[] = [];
  const toolRefs: Array<{ m: HistMsg; name: string; input: unknown }> = [];
  let cwd = "", lastAi = "", lastCustom = "";
  let lastUsage: any;
  // Modelo/esforço REAIS da sessão nativa, pra web refletir o que a máquina está usando (e não o
  // default global). O último vence (a sessão pode ter trocado de modelo no meio). Claude grava o
  // modelo por turno em message.model (ignora "<synthetic>", que é injeção interna, e sidechains de
  // subagente); Claude NÃO grava o esforço em lugar nenhum do transcript, então effort fica vazio
  // pro claude. Codex grava ambos no evento turn_context (model + effort no topo do payload).
  let lastModel = "", lastEffort = "";
  eachLine(raw, (o) => {
    if (f.claude) {
      if (o.type === "custom-title" && o.customTitle) lastCustom = o.customTitle;   // último vence
      else if (o.type === "ai-title" && o.aiTitle) lastAi = o.aiTitle;              // título CORRETO = ai-title mais recente
      else if (o.type === "user" || o.type === "assistant") {
        if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
        if (o.type === "assistant" && !o.isSidechain && o.message?.usage) lastUsage = o.message.usage;
        if (o.type === "assistant" && !o.isSidechain && typeof o.message?.model === "string" && o.message.model && o.message.model !== "<synthetic>") lastModel = o.message.model;
        const ts = Date.parse(o.timestamp) || 0;
        const content = o.message?.content;
        if (o.type === "assistant" && Array.isArray(content)) {
          for (const b of content) {
            if (b.type === "text" && b.text) { const t = cleanText(b.text); if (t) messages.push({ role: "assistant", text: t, ts }); }
            else if (b.type === "tool_use") { const m: HistMsg = { role: "tool", text: toolSummary(b.name, b.input), detail: toolDetail(b.name, b.input), ts, name: b.name }; messages.push(m); toolRefs.push({ m, name: b.name, input: b.input }); }
          }
        } else {
          let t = contentText(content);
          if (o.type === "user" && isInjected(t)) return; // tool-results/notifications injected as "user"
          t = cleanText(t);
          if (t) messages.push({ role: o.type, text: t, ts });
        }
      }
    } else {
      if (o.type === "session_meta" && o.payload) cwd = o.payload.cwd || cwd;
      else if (o.type === "turn_context" && o.payload) { if (typeof o.payload.model === "string" && o.payload.model) lastModel = o.payload.model; if (typeof o.payload.effort === "string" && o.payload.effort) lastEffort = o.payload.effort; }
      else if (o.type === "response_item" && o.payload?.type === "message" && (o.payload.role === "user" || o.payload.role === "assistant")) {
        const t = contentText(o.payload.content);
        if (t && !(o.payload.role === "user" && isInjected(t))) messages.push({ role: o.payload.role, text: t, ts: Date.parse(o.timestamp) || 0 });
      }
    }
  });
  for (const r of toolRefs.slice(-diffLimit)) {
    const st = toolFileStat(r.name, r.input);
    r.m.path = st.path; r.m.adds = st.adds; r.m.dels = st.dels; r.m.rows = st.rows;
  }
  noteParse(f.path, raw.length, messages.length); // format-drift telemetry (non-empty file, 0 msgs)
  const data: NativeHist = { agent: f.claude ? "claude-code" : "codex", cwd, title: stableTitle(id, lastAi, lastCustom || messages.find((m) => m.role === "user")?.text.slice(0, 60) || "Sessão"), messages, inputTokens: inputContextOf(lastUsage), model: lastModel || undefined, effort: lastEffort || undefined };
  if (stamp) { if (histCache.size > 24) histCache.clear(); histCache.set(ckey, { key: stamp, data }); }
  return data;
}
