/**
 * Local store (v1) — single source of truth. Each session is bound at creation to
 * an **agent** and a **working folder**, both **locked** once it exists (only the
 * model/effort change per message). All data lives on the Hub machine.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredMessage {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
  agent?: string;
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

const DIR = join(homedir(), ".jarvis", "hub");
const FILE = join(DIR, "sessions.json");

export class Store {
  private data: Record<string, SessionData> = {};

  constructor(private defaults: { agent: string; cwd: string }) {
    if (!existsSync(FILE)) return;
    try {
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
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
    } catch {
      this.data = {};
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
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(this.data, null, 2));
  }
}
