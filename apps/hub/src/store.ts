/**
 * Local store (v1) — the single source of truth. All sessions/messages live here
 * (on the Hub machine), so EVERY client (desktop + phone) sees the same list and
 * the same conversation. JSON for now; SQLite later.
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
  createdAt: number;
  updatedAt: number;
  lastMessage: string;
  count: number;
}

interface SessionData {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

const DIR = join(homedir(), ".jarvis", "hub");
const FILE = join(DIR, "sessions.json");

export class Store {
  private data: Record<string, SessionData> = {};

  constructor() {
    if (!existsSync(FILE)) return;
    try {
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
      for (const [id, v] of Object.entries(raw)) {
        if (Array.isArray(v)) {
          // migrate v0 format (id -> message[])
          const msgs = v as StoredMessage[];
          this.data[id] = {
            id,
            title: msgs.find((m) => m.role === "user")?.text.slice(0, 48) || "Conversa",
            createdAt: msgs[0]?.ts ?? Date.now(),
            updatedAt: msgs.at(-1)?.ts ?? Date.now(),
            messages: msgs,
          };
        } else {
          this.data[id] = v as SessionData;
        }
      }
    } catch {
      this.data = {};
    }
  }

  ensure(id: string, title?: string): SessionData {
    let s = this.data[id];
    if (!s) {
      s = this.data[id] = { id, title: title || "Nova conversa", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      this.flush();
    }
    return s;
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

  list(): SessionMeta[] {
    return Object.values(this.data)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id,
        title: s.title,
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
