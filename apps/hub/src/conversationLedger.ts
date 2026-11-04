import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "@jarvis/core";

export interface ConversationReceipt {
  id: string;
  principalId: string;
  clientId: string;
  runnerId: string;
  sessionId: string;
  originSessionId: string;
  text: string;
  at: number;
  updatedAt: number;
  status: "accepted" | "dispatched" | "handled" | "failed" | "interrupted" | "cancelled";
  reply?: string;
  error?: string;
  deletedAt?: number;
}
export interface ConversationPreferences {
  task?: { runnerId: string; sessionId: string; turnId?: string };
  quiet: boolean;
  seen: Record<string, number>;
  notified?: Record<string, number>;
}

/** Delivery metadata, NOT another execution store. Execution journals/history remain authoritative.
 * A receipt survives loss of an ACK. On restart uncertain dispatches become interrupted; we never
 * rerun an external action just because its terminal event was not observed.
 */
export class ConversationLedger {
  private rows = new Map<string, ConversationReceipt>();
  private corrupt = new Set<string>();
  readonly ready: Promise<void>;
  constructor(private dir: string, private now = Date.now, private writer = writeJsonAtomic) {
    this.ready = this.load();
  }
  private decode(name: string, text: string): ConversationReceipt {
    const row = JSON.parse(text) as ConversationReceipt;
    if (!row.principalId || !row.clientId || this.key(row.principalId, row.clientId) !== row.id || name !== `request-${row.id}.json`) throw new Error("invalid conversation receipt");
    if (row.status === "accepted" || row.status === "dispatched") row.status = "interrupted";
    return row;
  }
  private async load(): Promise<void> {
    let names: string[];
    try { names = await readdir(this.dir); } catch (e: any) { if (e.code === "ENOENT") return; throw e; }
    // Yield during recovery: thousands of small receipts must not block the Hub's heartbeat.
    for (const name of names) {
      if (!/^request-[a-f0-9]{64}\.json$/.test(name)) continue;
      const key = name.slice(8, -5);
      if (this.rows.has(key)) continue;
      try {
        const row = this.decode(name, await readFile(join(this.dir, name), "utf8"));
        if (!this.rows.has(key)) this.rows.set(row.id, row);
      } catch { if (!this.rows.has(key)) this.corrupt.add(key); }
    }
  }
  private key(principal: string, clientId: string): string { return createHash("sha256").update(JSON.stringify([principal, clientId])).digest("hex"); }
  private save(row: ConversationReceipt): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.writer(join(this.dir, `request-${row.id}.json`), row, { backup: false });
    this.rows.set(row.id, row);
  }
  get(principal: string, clientId: string): ConversationReceipt | undefined {
    const key = this.key(principal, clientId);
    // A retransmission can arrive before background recovery finishes. Read only ITS receipt.
    if (!this.rows.has(key) && !this.corrupt.has(key)) {
      const name = `request-${key}.json`, path = join(this.dir, name);
      if (existsSync(path)) { try { this.rows.set(key, this.decode(name, readFileSync(path, "utf8"))); } catch { this.corrupt.add(key); } }
    }
    if (this.corrupt.has(key)) throw new Error("Registro deste pedido ilegível; reenvio bloqueado para evitar execução duplicada.");
    const row = this.rows.get(key);
    return row ? structuredClone(row) : undefined;
  }
  accept(input: Pick<ConversationReceipt, "principalId" | "clientId" | "runnerId" | "sessionId" | "text">): ConversationReceipt {
    if (!input.principalId || !/^[A-Za-z0-9_-]{6,64}$/.test(input.clientId)) throw new Error("invalid conversation request identity");
    const previous = this.get(input.principalId, input.clientId);
    if (previous) return previous;
    const row: ConversationReceipt = { ...input, id: this.key(input.principalId, input.clientId), originSessionId: input.sessionId,
      status: "accepted", at: this.now(), updatedAt: this.now() };
    this.save(row); // throws on disk failure; caller MUST NOT ACK
    return structuredClone(row);
  }
  update(principal: string, clientId: string, patch: Partial<Pick<ConversationReceipt, "sessionId" | "runnerId" | "status" | "reply" | "error">>): void {
    const row = this.get(principal, clientId);
    if (!row) throw new Error("conversation request missing");
    if (row.deletedAt) return;
    this.save({ ...row, ...patch, updatedAt: this.now() });
  }
  list(principal: string): ConversationReceipt[] {
    return [...this.rows.values()].filter((r) => r.principalId === principal && !r.deletedAt).sort((a, b) => b.at - a.at).map((r) => structuredClone(r));
  }
  async forgetSession(runnerId: string, sessionId: string, includeConversation = false): Promise<void> {
    await this.ready;
    for (const row of this.rows.values()) {
      const ownConversation = includeConversation && sessionId === `conversation-${createHash("sha256").update(row.principalId).digest("hex").slice(0, 24)}`;
      if (!((row.runnerId === runnerId && (row.sessionId === sessionId || row.originSessionId === sessionId)) || ownConversation)) continue;
      // Keep only the receipt identity: deleting a history must not revive an already accepted action.
      this.save({ ...row, runnerId: "", sessionId: "", originSessionId: "", text: "", reply: undefined, error: undefined, status: "handled", deletedAt: this.now() });
    }
  }
  preferences(principal: string): ConversationPreferences {
    const path = join(this.dir, `preferences-${this.key(principal, "preferences")}.json`);
    if (!existsSync(path)) return { quiet: false, seen: {} };
    return JSON.parse(readFileSync(path, "utf8")) as ConversationPreferences;
  }
  configure(principal: string, change: Partial<ConversationPreferences>): ConversationPreferences {
    const prefs = { ...this.preferences(principal), ...change };
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.writer(join(this.dir, `preferences-${this.key(principal, "preferences")}.json`), prefs, { backup: false });
    return prefs;
  }
}
