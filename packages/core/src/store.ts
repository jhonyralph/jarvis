/**
 * Local store (v1) — single source of truth. Each session is bound at creation to
 * an **agent** and a **working folder**, both **locked** once it exists (only the
 * model/effort change per message). All data lives on the Hub machine.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, readJson } from "./persist.js";

export interface StoredMessage {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
  agent?: string;
  speaker?: string; // identified enrolled speaker (voice messages only)
  images?: string[]; // served URLs (/pasted/<file>) of pasted/attached images, shown inline
  files?: Array<{ name: string; content?: string }>; // non-image attachments — content omitted if too large to persist
  activity?: unknown[]; // assistant only: the buffered live stream events (tool/text/thinking, incl. sub-agent parentId) for that turn — lets a reload rebuild the SAME activity blocks (incl. finished sub-agents) instead of just the final text
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
}

interface SessionData {
  id: string;
  title: string;
  agent: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

/** Honors JARVIS_HOME (matches auth.ts) so a sandboxed runner / test run can relocate all state. */
const JARVIS_HOME = process.env.JARVIS_HOME || homedir();

export class Store {
  private data: Record<string, SessionData> = {};
  private readonly file: string;

  /** `dir` overrides the storage directory (tests / sandbox); defaults to ~/.jarvis/hub. */
  constructor(private defaults: { agent: string; cwd: string }, dir?: string) {
    this.file = join(dir || join(JARVIS_HOME, ".jarvis", "hub"), "sessions.json");
    // readJson recovers from `.bak` if the primary is torn/corrupt, so a bad file degrades to the
    // last good snapshot instead of wiping every session (the old bare read fell straight to {}).
    const raw = readJson<Record<string, unknown>>(this.file, {});
    for (const [id, v] of Object.entries(raw)) {
      if (Array.isArray(v)) continue; // drop v0 test data
      const s = v as Partial<SessionData>;
      this.data[id] = {
        id,
        title: s.title || "Conversa",
        agent: s.agent || defaults.agent,
        cwd: s.cwd || defaults.cwd,
        createdAt: s.createdAt ?? Date.now(),
        updatedAt: s.updatedAt ?? Date.now(),
        messages: s.messages ?? [],
      };
    }
  }

  /** Create if missing. agent + cwd are set here and never change afterwards. */
  ensure(id: string, opts?: { title?: string; agent?: string; cwd?: string }): SessionData {
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
      };
      this.flush();
    }
    return s;
  }

  get(id: string): SessionData | undefined {
    return this.data[id];
  }

  /** Clear a session's messages and (re)bind its agent/cwd — used by the voice
   *  "nova sessão" flow to start the fixed voice session fresh. */
  reset(id: string, opts?: { agent?: string; cwd?: string; title?: string }): SessionData {
    const s = this.ensure(id);
    s.messages = [];
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
    this.flush();
    return true;
  }

  add(id: string, msg: StoredMessage): void {
    const s = this.ensure(id);
    s.messages.push(msg);
    s.updatedAt = msg.ts;
    if ((s.title === "Nova conversa" || !s.title) && msg.role === "user") s.title = msg.text.slice(0, 48);
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
    this.flush();
    return true;
  }

  /** Cheap cross-session context: the last N sessions (any agent) with title +
   *  last user/assistant message (truncated). Used by cross-session search. */
  digest(n = 8, cap = 220): Array<{ id: string; agent: string; cwd: string; title: string; updatedAt: number; lastUser: string; lastAssistant: string }> {
    return Object.values(this.data)
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
    return Object.values(this.data)
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
      }));
  }

  private flush(): void {
    // Atomic write (temp + fsync + rename) with a `.bak` of the previous good file — a crash
    // mid-write can no longer truncate sessions.json and take all history with it.
    writeJsonAtomic(this.file, this.data, { pretty: true });
  }
}
