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
import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

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
function claudeFiles(): Array<{ path: string; mtime: number }> {
  const out: Array<{ path: string; mtime: number }> = [];
  if (!existsSync(CLAUDE_DIR)) return out;
  for (const dir of readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
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

function parseClaude(path: string): Omit<NativeMeta, "updatedAt"> | null {
  const head = readHead(path);
  if (!head) return null;
  const id = basename(path).replace(/\.jsonl$/i, "");
  let customTitle = "", aiTitle = "", firstUser = "", cwd = "";
  eachLine(head, (o) => {
    if (o.type === "custom-title" && o.customTitle) customTitle = o.customTitle;
    else if (o.type === "ai-title" && o.aiTitle) aiTitle = o.aiTitle;
    else if (o.type === "user" || o.type === "assistant") {
      if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
      if (!firstUser && o.type === "user" && typeof o.message?.content === "string") {
        const t = o.message.content.trim();
        if (t && !isInjected(t)) firstUser = t;
      }
    }
  });
  if (cwd && /[\\/]\.jarvis[\\/]oneshot/i.test(cwd)) return null; // Jarvis's own one-shot (search/summary/digest) — not a real session
  const title = customTitle || aiTitle || firstUser.slice(0, 60) || "Sessão Claude";
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
export function listNative(limit = Number(process.env.JARVIS_NATIVE_LIMIT || 25)): NativeMeta[] {
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
  const f = isNativeId(id) ? findFileById(id) : null;
  if (!f) return true; // nothing on disk — treat as already removed
  try { unlinkSync(f.path); } catch { return false; }
  pcache.delete(f.path);
  return true;
}

export type NativeEvent =
  | { kind: "message"; role: string; text: string; ts: number }
  | { kind: "tool"; name: string; summary: string };

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

/** For a file tool_use: the real path + (for edits) +/- line counts. Mirrors the live path. */
function toolStat(name: string, input: any): { path?: string; adds?: number; dels?: number } {
  const inp = input || {};
  if (name === "Edit") return { path: inp.file_path, ...editCounts(inp.old_string || "", inp.new_string || "") };
  if (name === "Write") return { path: inp.file_path, adds: inp.content ? String(inp.content).split("\n").length : 0, dels: 0 };
  if (name === "MultiEdit" && Array.isArray(inp.edits)) { let a = 0, d = 0; for (const e of inp.edits) { const c = editCounts(e?.old_string || "", e?.new_string || ""); a += c.adds; d += c.dels; } return { path: inp.file_path, adds: a, dels: d }; }
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
        else if (b.type === "tool_use") out.push({ kind: "tool", name: b.name, summary: toolSummary(b.name, b.input) });
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
function claudeFileOps(jsonlPath: string): Map<string, FileOp> {
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

export interface HistMsg { role: string; text: string; ts: number; name?: string; path?: string; adds?: number; dels?: number; }
/** Full read-only history of one native session — text turns AND tool activity (role:"tool"),
 *  interleaved in order, so the "editando/criando arquivo" blocks survive a page refresh. */
export function nativeHistory(id: string): { agent: string; cwd: string; title: string; messages: HistMsg[] } | null {
  if (!isNativeId(id)) return null;
  const f = findFileById(id);
  if (!f) return null;
  let raw: string;
  try {
    raw = readFileSync(f.path, "utf8");
  } catch {
    return null;
  }
  const messages: HistMsg[] = [];
  let cwd = "", title = "";
  eachLine(raw, (o) => {
    if (f.claude) {
      if (o.type === "custom-title" && o.customTitle) title = o.customTitle;
      else if (o.type === "ai-title" && o.aiTitle) title = title || o.aiTitle;
      else if (o.type === "user" || o.type === "assistant") {
        if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
        const ts = Date.parse(o.timestamp) || 0;
        const content = o.message?.content;
        if (o.type === "assistant" && Array.isArray(content)) {
          for (const b of content) {
            if (b.type === "text" && b.text) { const t = cleanText(b.text); if (t) messages.push({ role: "assistant", text: t, ts }); }
            else if (b.type === "tool_use") { const st = toolStat(b.name, b.input); messages.push({ role: "tool", text: toolSummary(b.name, b.input), ts, name: b.name, path: st.path, adds: st.adds, dels: st.dels }); }
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
      else if (o.type === "response_item" && o.payload?.type === "message" && (o.payload.role === "user" || o.payload.role === "assistant")) {
        const t = contentText(o.payload.content);
        if (t && !(o.payload.role === "user" && isInjected(t))) messages.push({ role: o.payload.role, text: t, ts: Date.parse(o.timestamp) || 0 });
      }
    }
  });
  return { agent: f.claude ? "claude-code" : "codex", cwd, title: title || messages.find((m) => m.role === "user")?.text.slice(0, 60) || "Sessão", messages };
}
