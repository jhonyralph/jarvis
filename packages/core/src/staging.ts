/**
 * Voice "staging" — the parallel, HIDDEN refine-before-commit flow. When the user speaks OVER the
 * agent (barge-in), that utterance doesn't go straight to the real session: a fast model refines it
 * (with the session's context), talks back, and iterates until the user CONFIRMS — only then the
 * final draft enters the real chat. Persisted with a 7-day TTL so drafts survive a reload and help
 * debug/evolve the flow (pruned on load). The store + prompt/parse are pure & unit-testable.
 */
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, readJson } from "./persist.js";

export interface StageTurn { role: "user" | "assistant"; text: string; ts: number; }
export interface StagingEntry {
  /** one active staging per real session → keyed by the target session id */
  id: string;
  targetSession: string;
  /** the current refined message (what would be sent on confirm) */
  draft: string;
  turns: StageTurn[];
  model?: string;
  effort?: string;
  /** true once it was escalated to a bigger model for this draft */
  escalated?: boolean;
  createdAt: number;
  updatedAt: number;
}

export const STAGING_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

export class StagingStore {
  private data: StagingEntry[] = [];
  private readonly file: string;
  constructor(dir?: string, private ttlMs = STAGING_TTL_MS) {
    this.file = join(dir || join(process.env.JARVIS_HOME || homedir(), ".jarvis"), "voice-staging.json");
    this.data = readJson<StagingEntry[]>(this.file, []).filter((e) => e && typeof e.id === "string");
    this.prune();
  }
  /** Drop entries older than the TTL (by updatedAt). Returns how many were removed. */
  prune(now = Date.now()): number {
    const before = this.data.length;
    this.data = this.data.filter((e) => now - (e.updatedAt || 0) < this.ttlMs);
    if (this.data.length !== before) this.flush();
    return before - this.data.length;
  }
  get(id: string): StagingEntry | undefined { const e = this.data.find((x) => x.id === id); return e ? { ...e } : undefined; }
  list(): StagingEntry[] { return this.data.map((e) => ({ ...e })); }
  /** Start (or reset) a staging draft for a target session. */
  start(targetSession: string, opts?: { model?: string; effort?: string }): StagingEntry {
    this.data = this.data.filter((e) => e.id !== targetSession);
    const e: StagingEntry = { id: targetSession, targetSession, draft: "", turns: [], model: opts?.model, effort: opts?.effort, escalated: false, createdAt: Date.now(), updatedAt: Date.now() };
    this.data.push(e); this.flush();
    return { ...e };
  }
  /** Append a turn + update the draft. */
  push(id: string, turn: StageTurn, draft: string, patch?: Partial<StagingEntry>): StagingEntry | undefined {
    const e = this.data.find((x) => x.id === id);
    if (!e) return undefined;
    e.turns.push(turn); e.draft = draft; e.updatedAt = Date.now();
    if (patch) Object.assign(e, patch);
    this.flush();
    return { ...e };
  }
  remove(id: string): boolean { const n = this.data.length; this.data = this.data.filter((e) => e.id !== id); if (this.data.length !== n) { this.flush(); return true; } return false; }
  private flush(): void { writeJsonAtomic(this.file, this.data); }
}

export interface RefineResult {
  /** the refined message ready to send (or the best current draft) */
  draft: string;
  /** the fast model flags that a proper answer needs a bigger model/effort */
  needsUpgrade: boolean;
  reason?: string;
  /** a short spoken line to say back to the user (a clarifying question or "é isso?") */
  say?: string;
}

/** Build the prompt for the FAST refine model: refine the user's spoken intent into a clean message,
 *  using the session context + the refine conversation so far; flag if it needs a bigger model. */
export function buildRefinePrompt(opts: { context: string; turns: StageTurn[]; utterance: string }): string {
  const hist = opts.turns.map((t) => `${t.role === "user" ? "Usuário" : "Você"}: ${t.text}`).join("\n") || "(início)";
  return (
    `Você ajuda a REFINAR, por voz, o que o usuário quer dizer ANTES de mandar para a sessão de código.\n` +
    `Não execute a tarefa — só transforme a fala num pedido claro e completo, e converse até ficar bom.\n\n` +
    `CONTEXTO DA SESSÃO (para entender do que se trata):\n${opts.context || "(sem contexto)"}\n\n` +
    `CONVERSA DE REFINO ATÉ AGORA:\n${hist}\n\n` +
    `NOVA FALA DO USUÁRIO: "${opts.utterance}"\n\n` +
    `Responda SOMENTE com JSON válido:\n` +
    `{"draft":"o pedido refinado, completo, pronto para enviar","say":"1 frase curta falada: uma pergunta pra esclarecer OU confirmar que entendeu","needsUpgrade":false,"reason":""}\n` +
    `- needsUpgrade=true só se refinar bem exige um modelo/raciocínio MAIOR (tarefa ambígua/complexa); em reason diga por quê.\n` +
    `- "say" é o que será FALADO de volta: curto, natural, sem markdown.`
  );
}

/** Parse the fast model's JSON refine reply. Falls back to treating the whole text as the draft. */
export function parseRefine(text: string): RefineResult {
  try {
    const j = JSON.parse((String(text || "").match(/\{[\s\S]*\}/) || [text])[0]);
    return {
      draft: typeof j.draft === "string" ? j.draft : String(text || "").trim(),
      needsUpgrade: !!j.needsUpgrade,
      reason: typeof j.reason === "string" ? j.reason : undefined,
      say: typeof j.say === "string" ? j.say : undefined,
    };
  } catch {
    return { draft: String(text || "").trim(), needsUpgrade: false };
  }
}
