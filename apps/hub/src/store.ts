/**
 * Minimal local store (v1). All data on this machine only.
 * Persists sessions/messages to a JSON file under ~/.jarvis/hub.
 * (SQLite comes later; this keeps v1 dependency-free and 100% local.)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredMessage {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
}

const DIR = join(homedir(), ".jarvis", "hub");
const FILE = join(DIR, "sessions.json");

export class Store {
  private data: Record<string, StoredMessage[]> = {};

  constructor() {
    if (existsSync(FILE)) {
      try {
        this.data = JSON.parse(readFileSync(FILE, "utf8"));
      } catch {
        this.data = {};
      }
    }
  }

  add(sessionId: string, msg: StoredMessage): void {
    (this.data[sessionId] ??= []).push(msg);
    this.flush();
  }

  history(sessionId: string): StoredMessage[] {
    return this.data[sessionId] ?? [];
  }

  sessions(): string[] {
    return Object.keys(this.data);
  }

  private flush(): void {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(this.data, null, 2));
  }
}
