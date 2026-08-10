/**
 * Local store (v1) — single source of truth. Each session is bound at creation to
 * an **agent** and a **working folder**, both **locked** once it exists (only the
 * model/effort change per message). All data lives on the Hub machine.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ContextManifest, PermissionMode } from "@jarvis/protocol";
import { writeJsonAtomic, writeTextAtomic, readJson } from "./persist.js";

export interface StoredMessage {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
  agent?: string;
  speaker?: string; // identified enrolled speaker (voice messages only)
  images?: string[]; // served URLs (/pasted/<file>) of pasted/attached images, shown inline
  files?: Array<{ name: string; content?: string; path?: string; size?: number; binary?: boolean; mime?: string }>; // non-image attachments; large/binary content is path-only
  activity?: unknown[]; // assistant only: the buffered live stream events (tool/text/thinking, incl. sub-agent parentId) for that turn — lets a reload rebuild the SAME activity blocks (incl. finished sub-agents) instead of just the final text
  usage?: {
    costUsd?: number;
    costKind?: "billed" | "estimated_api_equivalent" | "subscription_included" | "tokens_only" | "unavailable";
    source?: string;
    model?: string;
    effort?: string;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    contextTokens?: number;
  };
  contextManifest?: ContextManifest;
}

export interface SessionMeta {
  id: string;
  title: string;
  agent: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  lastMessage: string;
  count: number;
  archived?: boolean;
  /** Sum of every message's recorded usage.costUsd — lets the client offer a "sort by cost" view. 0 when nothing was billed/estimated. */
  cost: number;
  /** Last permission mode chosen for this session (durable, mutable, inheritable). */
  permissionMode?: PermissionMode;
}

interface SessionData {
  id: string;
  title: string;
  agent: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
  hidden?: boolean;
  /** User-archived: still listed (so it can be found), but filtered out of the default "Active" view. */
  archived?: boolean;
  rootExecutionId?: string;
  executionId?: string;
  /** Permission mode chosen for this session. Unlike agent/cwd this is NOT locked — the user can
   *  switch it mid-conversation via the picker; the latest value is what new sessions inherit. */
  permissionMode?: PermissionMode;
}

function titleFromMessage(text: string, cap = 240): string {
  return text.replace(/\s+/g, " ").trim().slice(0, cap);
}

/** Honors JARVIS_HOME (matches auth.ts) so a sandboxed runner / test run can relocate all state. */
const JARVIS_HOME = process.env.JARVIS_HOME || homedir();

export class Store {
  private data: Record<string, SessionData> = {};
  private readonly file: string;
  private readonly msgDir: string;

  /** `dir` overrides the storage directory (tests / sandbox); defaults to ~/.jarvis/hub. */
  constructor(private defaults: { agent: string; cwd: string }, dir?: string) {
    const base = dir || join(JARVIS_HOME, ".jarvis", "hub");
    this.file = join(base, "sessions.json");
    // Message history lives OUT of sessions.json: one append-only JSONL per session under this dir.
    // Why: sessions.json used to inline every message, so a single ~50MB file was re-serialized,
    // fsync'd and `.bak`-copied SYNCHRONOUSLY on EVERY mutation (incl. each streamed chunk), freezing
    // the Hub event loop for tens of seconds — slow session creation, dropped runner pongs, EPERM on
    // the rename. Now sessions.json holds only metadata (tiny, cheap) and a message append is O(1).
    this.msgDir = join(base, "sessions");
    // readJson recovers from `.bak` if the primary is torn/corrupt, so a bad file degrades to the
    // last good snapshot instead of wiping every session (the old bare read fell straight to {}).
    const raw = readJson<Record<string, unknown>>(this.file, {});
    let migrated = false;
    for (const [id, v] of Object.entries(raw)) {
      if (Array.isArray(v)) continue; // drop v0 test data
      const s = v as Partial<SessionData>;
      // Old format inlined `messages`. If present, adopt them and rewrite to the per-session JSONL
      // ONCE (idempotent: a full overwrite, so a re-run after a crash can't duplicate lines). New
      // format has no inline messages → load them from the JSONL.
      const inline = Array.isArray(s.messages) ? (s.messages as StoredMessage[]) : null;
      const messages = inline && inline.length ? inline : this.readMessages(id);
      this.data[id] = {
        id,
        title: s.title || "Conversa",
        agent: s.agent || defaults.agent,
        cwd: s.cwd || defaults.cwd,
        createdAt: s.createdAt ?? Date.now(),
        updatedAt: s.updatedAt ?? Date.now(),
        messages,
        hidden: s.hidden === true,
        archived: s.archived === true,
        rootExecutionId: typeof s.rootExecutionId === "string" ? s.rootExecutionId : undefined,
        executionId: typeof s.executionId === "string" ? s.executionId : undefined,
        permissionMode: typeof s.permissionMode === "string" ? (s.permissionMode as PermissionMode) : undefined,
      };
      if (inline && inline.length) { this.rewriteMessages(id, messages); migrated = true; }
    }
    // Persist the stripped, metadata-only sessions.json once. writeJsonAtomic copies the previous
    // (possibly ~50MB) file to sessions.json.bak first, so the pre-migration data is preserved.
    if (migrated) this.flush();
  }

  private msgFile(id: string): string {
    // ids are UUIDs or fixed constants; sanitize defensively so nothing escapes msgDir.
    return join(this.msgDir, `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.jsonl`);
  }

  /** Load a session's messages from its append-only JSONL, tolerating a torn trailing line. */
  private readMessages(id: string): StoredMessage[] {
    const f = this.msgFile(id);
    if (!existsSync(f)) return [];
    const out: StoredMessage[] = [];
    let raw = "";
    try { raw = readFileSync(f, "utf8"); } catch { return []; }
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try { out.push(JSON.parse(line) as StoredMessage); } catch { /* skip a partial/torn line */ }
    }
    return out;
  }

  /** Append one message with an O(1) write — no full-store rewrite. */
  private appendMessage(id: string, msg: StoredMessage): void {
    try {
      mkdirSync(this.msgDir, { recursive: true });
      appendFileSync(this.msgFile(id), JSON.stringify(msg) + "\n");
    } catch { /* best-effort: the in-memory copy still serves this run */ }
  }

  /** Rewrite a session's whole JSONL (used by migration, reset, dropLastUser). Crash-safe. */
  private rewriteMessages(id: string, messages: StoredMessage[]): void {
    try {
      mkdirSync(this.msgDir, { recursive: true });
      writeTextAtomic(this.msgFile(id), messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length ? "\n" : ""), { backup: false });
    } catch { /* best-effort */ }
  }

  /** Create if missing. agent + cwd are set here and never change afterwards. */
  ensure(id: string, opts?: { title?: string; agent?: string; cwd?: string; hidden?: boolean; rootExecutionId?: string; executionId?: string; permissionMode?: PermissionMode }): SessionData {
    let s = this.data[id];
    if (!s) {
      s = this.data[id] = {
        id,
        title: opts?.title || "Nova conversa",
        agent: opts?.agent || this.defaults.agent,
        cwd: opts?.cwd || this.defaults.cwd,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        hidden: opts?.hidden === true,
        rootExecutionId: opts?.rootExecutionId,
        executionId: opts?.executionId,
        permissionMode: opts?.permissionMode,
      };
      this.flush();
    }
    return s;
  }

  /** Set the session's permission mode. Mutable at any time (the picker can switch mid-conversation),
   *  unlike agent/cwd which are locked once the session starts. Returns false if the session is gone. */
  setPermissionMode(id: string, mode: PermissionMode): boolean {
    const s = this.data[id];
    if (!s) return false;
    if (s.permissionMode === mode) return true;
    s.permissionMode = mode;
    this.flush();
    return true;
  }

  /** Settings a NEW session for `cwd` should inherit from the most recent STARTED session in the same
   *  folder: its agent, last-used model/effort (from that session's last message usage) and permission
   *  mode. Returns undefined when the project has no prior started session (a genuinely new project). */
  inheritForCwd(cwd: string): { agent?: string; model?: string; effort?: string; permissionMode?: PermissionMode } | undefined {
    const s = Object.values(this.data)
      .filter((x) => !x.hidden && x.cwd === cwd && x.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!s) return undefined;
    const lastUsage = [...s.messages].reverse().find((m) => m.usage)?.usage;
    return { agent: s.agent, model: lastUsage?.model, effort: lastUsage?.effort, permissionMode: s.permissionMode };
  }

  get(id: string): SessionData | undefined {
    return this.data[id];
  }

  isHidden(id: string): boolean { return this.data[id]?.hidden === true; }

  /** Archive / unarchive a session. Archived sessions stay listed (with the flag) so they can still be
   *  found, but the client filters them out of the default "Active" view. */
  setArchived(id: string, archived: boolean): boolean {
    const s = this.data[id];
    if (!s) return false;
    s.archived = archived === true;
    this.flush();
    return true;
  }

  /** Clear a session's messages and (re)bind its agent/cwd — used by the voice
   *  "nova sessão" flow to start the fixed voice session fresh. */
  reset(id: string, opts?: { agent?: string; cwd?: string; title?: string }): SessionData {
    const s = this.ensure(id);
    s.messages = [];
    this.rewriteMessages(id, []);
    if (opts?.agent) s.agent = opts.agent;
    if (opts?.cwd) s.cwd = opts.cwd;
    s.title = opts?.title || s.title;
    s.updatedAt = Date.now();
    this.flush();
    return s;
  }

  /** Change agent/cwd — allowed ONLY while the session has no messages (still "new").
   *  Enforces the locked-session rule server-side: once a conversation starts, the
   *  agent and folder are frozen; only model/effort vary per message. */
  reconfigure(id: string, opts: { agent?: string; cwd?: string }): boolean {
    const s = this.data[id];
    if (!s || s.messages.length > 0) return false;
    if (opts.agent) s.agent = opts.agent;
    if (opts.cwd) s.cwd = opts.cwd;
    this.flush();
    return true;
  }

  /** Permanently drop a session (its messages go with it). Irreversible. */
  delete(id: string): boolean {
    if (!this.data[id]) return false;
    delete this.data[id];
    try { rmSync(this.msgFile(id), { force: true }); } catch { /* history file may not exist */ }
    this.flush();
    return true;
  }

  add(id: string, msg: StoredMessage): void {
    const s = this.ensure(id);
    s.messages.push(msg);
    s.updatedAt = msg.ts;
    if ((s.title === "Nova conversa" || !s.title) && msg.role === "user") s.title = titleFromMessage(msg.text);
    this.appendMessage(id, msg); // O(1) append — the message does NOT go through the metadata flush
    this.flush();
  }

  history(id: string): StoredMessage[] {
    return this.data[id]?.messages ?? [];
  }

  /** Remove the trailing USER message — a turn the user cancelled before any reply, "taking it back"
   *  to edit and resend. No-op if the last message isn't a user one (a reply already landed). */
  dropLastUser(id: string): boolean {
    const s = this.data[id];
    if (!s || !s.messages.length || s.messages[s.messages.length - 1].role !== "user") return false;
    s.messages.pop();
    s.updatedAt = s.messages.at(-1)?.ts ?? s.updatedAt;
    this.rewriteMessages(id, s.messages);
    this.flush();
    return true;
  }

  /** Cheap cross-session context: the last N sessions (any agent) with title +
   *  last user/assistant message (truncated). Used by cross-session search. */
  digest(n = 8, cap = 220): Array<{ id: string; agent: string; cwd: string; title: string; updatedAt: number; lastUser: string; lastAssistant: string }> {
    return Object.values(this.data).filter((s) => !s.hidden)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, n)
      .map((s) => ({
        id: s.id,
        agent: s.agent,
        cwd: s.cwd,
        title: s.title,
        updatedAt: s.updatedAt,
        lastUser: [...s.messages].reverse().find((m) => m.role === "user")?.text.slice(0, cap) ?? "",
        lastAssistant: [...s.messages].reverse().find((m) => m.role === "assistant")?.text.slice(0, cap) ?? "",
      }));
  }

  list(): SessionMeta[] {
    return Object.values(this.data).filter((s) => !s.hidden)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id,
        title: s.title,
        agent: s.agent,
        cwd: s.cwd,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        lastMessage: s.messages.at(-1)?.text.slice(0, 60) ?? "",
        count: s.messages.length,
        archived: s.archived === true,
        cost: s.messages.reduce((sum, m) => sum + (m.usage?.costUsd ?? 0), 0),
        permissionMode: s.permissionMode,
      }));
  }

  private flush(): void {
    // Atomic write (temp + fsync + rename) with a `.bak` of the previous good file — a crash
    // mid-write can no longer truncate sessions.json and take all history with it. Now writes
    // ONLY metadata (no messages), so this is a tiny, fast write regardless of history size —
    // that is what removed the multi-second event-loop stalls on every message.
    const meta: Record<string, Omit<SessionData, "messages">> = {};
    for (const [id, s] of Object.entries(this.data)) {
      const { messages: _messages, ...rest } = s;
      void _messages;
      meta[id] = rest;
    }
    writeJsonAtomic(this.file, meta, { pretty: true });
  }
}
