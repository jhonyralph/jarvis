/**
 * Índice de busca entre sessões — a fachada que o Hub e o Runner usam (2026-11-16).
 *
 * Antes: cada busca (e cada pausa de 300 ms na digitação) relia e reinterpretava os transcripts
 * inteiros — 335 MB de JSON para chegar a 22 MB de texto, 54–67 s por busca — e as sessões nativas
 * tinham teto de 40 (as ~1.600 mais antigas nunca eram achadas). Agora um índice SQLite FTS5 mora em
 * disco (~/.jarvis/index/sessions.db), é montado e atualizado por uma worker thread
 * (`session-index-worker.ts`) e responde em milissegundos.
 *
 * O better-sqlite3 é dependência OPCIONAL: máquina onde ele não instalou continua com a busca antiga
 * (`search()` devolve null e quem chama cai no caminho de sempre). Nada aqui lança para quem chama.
 */
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripSearchMarks } from "./session-index-query.js";

export interface SessionIndexMeta { key: string; agent: string; cwd: string; title: string; updatedAt: number }
export interface SessionIndexFilters { agent?: string; since?: number; cwd?: string; kind?: "managed" | "native" }
export interface SessionIndexSnippet { text: string; role: string; ts: number }
export interface SessionIndexHit {
  key: string; kind: "managed" | "native"; agent: string; cwd: string; title: string; updatedAt: number;
  score: number; matches: number; titleHit: boolean; snippets: SessionIndexSnippet[];
}
export interface SessionIndexStatus {
  available: boolean; ready: boolean; building: boolean; filesDone: number; filesTotal: number;
  messages: number; lastSyncAt: number; lastSyncMs: number; error?: string;
  lastChanged?: number; lastRebuilt?: number; lastBytes?: number;
  /** início da última sincronização (com `lastSyncAt` ≥ isto, ela terminou) */
  lastSyncStartedAt?: number;
}
/** `tooShort`: nada pesquisável (só 1 letra/pontuação) — o cliente pede pelo menos 2 letras. */
export interface SessionIndexResult { hits: SessionIndexHit[]; total: number; capped: boolean; ms: number; status: SessionIndexStatus; tooShort?: boolean }

/** O módulo nativo existe nesta instalação? (sem carregá-lo: só resolve o caminho) */
export function sessionIndexSupported(): boolean {
  if (process.env.JARVIS_SESSION_INDEX === "0") return false;
  try { createRequire(import.meta.url).resolve("better-sqlite3"); return true; } catch { return false; }
}

export interface SessionIndexOptions {
  /** pasta dos JSONL das sessões gerenciadas (Store.messagesDir()) */
  managedDir: string;
  /** metadados das sessões gerenciadas VISÍVEIS (o que não estiver aqui não aparece na busca) */
  managedMeta: () => SessionIndexMeta[];
  /**
   * Nome do índice deste PROCESSO (padrão "sessions") → ~/.jarvis/index/<nome>.db. Hub e Runner na
   * mesma máquina e na mesma pasta de dados NÃO podem dividir o banco: a sincronização de um esconde as
   * sessões gerenciadas que só o outro lista (achado no e2e Hub+Runner, 2026-11-16).
   */
  name?: string;
  /** arquivo do banco (vence `name`) */
  dbPath?: string;
  /** indexar também as sessões nativas do Claude/Codex desta máquina (padrão true) */
  native?: boolean;
  /** espera antes da 1ª montagem (o boot vem primeiro) */
  startDelayMs?: number;
  /** ressincronização periódica */
  resyncMs?: number;
  /** busca que demora mais que isso volta null (quem chama usa o caminho antigo) */
  queryTimeoutMs?: number;
}

const RETRY_AFTER_CRASH_MS = 5 * 60_000;
const MIN_SYNC_GAP_MS = 5_000;

export class SessionIndex {
  private worker: Worker | null = null;
  private readyPromise: Promise<boolean> | null = null;
  private pending = new Map<number, (v: any) => void>();
  private seq = 0;
  private last: SessionIndexStatus;
  private disabledUntil = 0;
  private fatal = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncReq = 0;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly opts: Required<Omit<SessionIndexOptions, "managedMeta">> & { managedMeta: () => SessionIndexMeta[] };

  constructor(opts: SessionIndexOptions) {
    this.opts = {
      managedDir: opts.managedDir,
      managedMeta: opts.managedMeta,
      name: opts.name || "sessions",
      dbPath: opts.dbPath || join(process.env.JARVIS_HOME || homedir(), ".jarvis", "index", String(opts.name || "sessions").replace(/[^A-Za-z0-9._-]/g, "_") + ".db"),
      native: opts.native !== false,
      startDelayMs: opts.startDelayMs ?? 30_000,
      resyncMs: opts.resyncMs ?? 60_000,
      queryTimeoutMs: opts.queryTimeoutMs ?? 8_000,
    };
    this.last = { available: sessionIndexSupported(), ready: false, building: false, filesDone: 0, filesTotal: 0, messages: 0, lastSyncAt: 0, lastSyncMs: 0 };
  }

  /** Agenda a 1ª montagem e a ressincronização periódica. Idempotente. */
  start(): void {
    if (this.closed || this.startTimer || this.timer || !this.last.available) return;
    this.startTimer = setTimeout(() => { this.startTimer = null; this.requestSync(true); }, this.opts.startDelayMs);
    this.startTimer.unref?.();
    this.timer = setInterval(() => this.requestSync(true), this.opts.resyncMs);
    this.timer.unref?.();
  }

  status(): SessionIndexStatus {
    return { ...this.last, available: this.last.available && !this.fatal && Date.now() >= this.disabledUntil, ...(this.fatal ? { error: this.fatal } : {}) };
  }

  /** Pede uma atualização (sessão nova, turno terminou). Junta pedidos próximos. */
  requestSync(force = false): void {
    if (this.closed || !this.last.available || this.fatal) return;
    const wait = force ? 0 : Math.max(0, MIN_SYNC_GAP_MS - (Date.now() - this.lastSyncReq));
    // Pedido imediato passa na frente de um agendado (o agendado é só "junta pedidos próximos").
    if (this.syncTimer) { if (!force) return; clearTimeout(this.syncTimer); this.syncTimer = null; }
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.lastSyncReq = Date.now();
      void this.ensure().then((ok) => {
        if (!ok || !this.worker) return;
        let meta: SessionIndexMeta[] = [];
        try { meta = this.opts.managedMeta(); } catch { meta = []; }
        this.worker.postMessage({ type: "sync", managed: meta });
      });
    }, wait);
    this.syncTimer.unref?.();
  }

  /**
   * Busca. null = índice indisponível nesta máquina (módulo ausente, worker caída, tempo esgotado) OU
   * ainda não montado inteiro pela 1ª vez: quem chama usa a busca antiga (e mostra o progresso de
   * `status()`). Toda busca também pede uma atualização, sem esperar por ela.
   */
  async search(query: string, filters: SessionIndexFilters = {}, limit = 60): Promise<SessionIndexResult | null> {
    if (!(await this.ensure()) || !this.worker) return null;
    const id = ++this.seq;
    const worker = this.worker;
    const res = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) resolve(null); }, this.opts.queryTimeoutMs);
      this.pending.set(id, (v) => { clearTimeout(timer); resolve(v); });
      worker.postMessage({ type: "search", id, query, filters, limit });
    });
    // Busca sempre puxa uma atualização (sem esperar por ela): o que mudou desde a última aparece na próxima.
    this.requestSync();
    if (!res || !res.ok) return null;
    if (res.status) this.last = { ...this.last, ...res.status, available: true };
    // Índice ainda não montado inteiro (1ª vez nesta máquina): incompleto — a busca antiga responde.
    if (!this.last.ready) return null;
    return { hits: res.hits || [], total: Number(res.total) || 0, capped: !!res.capped, ms: Number(res.ms) || 0, status: this.status(), ...(res.tooShort ? { tooShort: true } : {}) };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const w = this.worker; this.worker = null; this.readyPromise = null;
    for (const r of this.pending.values()) r(null);
    this.pending.clear();
    if (!w) return;
    // Pede para a worker fechar o banco e sair SOZINHA; só mata se ela não sair. terminate() logo após o
    // pedido matava a thread no meio do db.close() nativo — o processo inteiro caía com 0xC0000005
    // (achado no teste de estresse, 2026-11-16).
    await new Promise<void>((resolve) => {
      const kill = (): void => { void w.terminate().catch(() => undefined).finally(resolve); };
      const timer = setTimeout(kill, 3000);
      w.once("exit", () => { clearTimeout(timer); resolve(); });
      try { w.postMessage({ type: "close" }); } catch { clearTimeout(timer); kill(); }
    });
  }

  /** Sobe a worker sob demanda. false = indisponível agora. */
  private ensure(): Promise<boolean> {
    if (this.closed || !this.last.available || this.fatal || Date.now() < this.disabledUntil) return Promise.resolve(false);
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => { if (!settled) { settled = true; resolve(ok); } };
      let w: Worker;
      try {
        // Hub e Runner rodam TypeScript via tsx, mas a worker não herda o loader: a partida em .mjs o
        // registra lá dentro. (Compilado para .js, o worker .js é carregado direto.)
        const entry = import.meta.url.endsWith(".ts") ? "./session-index-worker.mjs" : "./session-index-worker.js";
        w = new Worker(new URL(entry, import.meta.url), {
          workerData: { dbPath: this.opts.dbPath, managedDir: this.opts.managedDir, native: this.opts.native },
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        });
      } catch (e) {
        this.disable(String((e as Error)?.message ?? e)); done(false); return;
      }
      this.worker = w;
      w.unref();
      w.on("message", (m: any) => {
        if (m?.type === "ready") { if (m.status) this.last = { ...this.last, ...m.status, available: true }; done(true); return; }
        if (m?.type === "fatal") { this.fatal = "índice indisponível: " + String(m.error || "erro"); done(false); return; }
        if (m?.type === "progress" && m.status) { this.last = { ...this.last, ...m.status, available: true }; return; }
        if ((m?.type === "result" || m?.type === "status") && typeof m.id === "number") {
          const cb = this.pending.get(m.id);
          if (cb) { this.pending.delete(m.id); cb(m); }
        }
      });
      const gone = (why: string): void => {
        if (this.worker === w) { this.worker = null; this.readyPromise = null; }
        for (const r of this.pending.values()) r(null);
        this.pending.clear();
        if (!this.closed && !this.fatal) this.disable(why);
        done(false);
      };
      w.on("error", (e) => gone(String((e as Error)?.message ?? e)));
      w.on("exit", (code) => gone("worker saiu (" + code + ")"));
    });
    return this.readyPromise;
  }

  /** Worker caiu: fica de fora por um tempo (busca antiga nesse meio-tempo) e tenta de novo depois. */
  private disable(why: string): void {
    this.disabledUntil = Date.now() + RETRY_AFTER_CRASH_MS;
    this.last = { ...this.last, error: why.slice(0, 200) };
  }
}

/** Resultado de busca como o cliente recebe (o mesmo formato do Hub e do Runner). */
export interface SessionSearchHit {
  id: string; title: string; agent: string; cwd: string; updatedAt: number;
  where: "title" | "content"; snippet: string; snippets: SessionIndexSnippet[];
  matches: number; score: number; titleHit: boolean; runnerId?: string;
}

/** Ordem final (juntando máquinas): título casado primeiro, depois a nota, depois a data. */
export function compareSessionSearchHits(a: Partial<SessionSearchHit>, b: Partial<SessionSearchHit>): number {
  return (Number(!!b.titleHit) - Number(!!a.titleHit)) || ((b.score ?? -1) - (a.score ?? -1)) || ((b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * Do acerto do índice ao acerto do cliente, aplicando o que só o processo dono sabe: qual sessão
 * gerenciada está visível (e seus metadados atuais), qual nativa já é representada por uma gerenciada
 * (não aparece duas vezes) e o título nativo conhecido. Igual no Hub e no Runner.
 */
export function toSessionSearchHits(hits: SessionIndexHit[], ctx: {
  managed: (key: string) => SessionIndexMeta | null | undefined;
  excludeNative: Set<string>;
  nativeTitle?: (key: string) => string | undefined;
  allow?: (id: string) => boolean;
}): SessionSearchHit[] {
  const out: SessionSearchHit[] = [];
  for (const h of hits) {
    let meta: { title: string; agent: string; cwd: string; updatedAt: number };
    if (h.kind === "managed") {
      const m = ctx.managed(h.key);
      if (!m) continue;
      meta = { title: m.title, agent: m.agent, cwd: m.cwd, updatedAt: m.updatedAt };
    } else {
      if (ctx.excludeNative.has(h.key)) continue;
      meta = { title: ctx.nativeTitle?.(h.key) || h.title, agent: h.agent, cwd: h.cwd, updatedAt: h.updatedAt };
    }
    if (ctx.allow && !ctx.allow(h.key)) continue;
    const first = h.snippets[0]?.text || "";
    out.push({
      id: h.key, ...meta, where: h.matches > 0 ? "content" : "title",
      snippet: first ? stripSearchMarks(first) : meta.title, snippets: h.snippets,
      matches: h.matches, score: h.score, titleHit: h.titleHit,
    });
  }
  return out;
}
