/**
 * BRW-IDE-00 F4 — VS Code (code-server) de cada máquina, servido pelo Hub em `/ide/<runnerId>/…`.
 *
 * Fica fora do `index.ts` pelo mesmo motivo do `fileEdit.ts`: as regras aqui são de SEGURANÇA e
 * merecem teste de unidade sem subir um Hub inteiro. O `index.ts` só injeta o Hub real.
 *
 * Leis da spec que este arquivo implementa:
 *   §3.2 o code-server só escuta em 127.0.0.1; o acesso remoto passa SEMPRE pelo Hub — direto para a
 *        máquina do Hub, pelo túnel na conexão do runner (`@jarvis/core` ide-tunnel.ts) para as outras;
 *   §3.3 só o DONO: o WebSocket da UI é autenticado, mas uma aba/iframe do navegador não manda
 *        cabeçalho nosso. Então: `ide_open` (WS autenticado, só dono) → bilhete de uso ÚNICO e curto →
 *        `/ide/<id>/__jarvis_auth?t=…` troca o bilhete por um cookie HttpOnly + SameSite=Strict (+
 *        Secure com TLS) com Path `/ide/<id>/` → TODA requisição e upgrade revalida o cookie E que o
 *        dispositivo dono continua existindo e dono (revogar o aparelho corta a IDE na hora);
 *   §3.5 o Hub só repassa bytes: lê a cabeçalho HTTP (o Node já fez) e o JSON pequeno de resposta do
 *        túnel; corpos e bytes de WebSocket nunca são interpretados;
 *   §13.2 as três pegadinhas do F0: o `Host` ORIGINAL vai ao code-server (ele recusa WebSocket com
 *        Origin≠Host), a pasta vai como URI `/c:/…` no Windows, e o `Service-Worker-Allowed` é
 *        injetado em `…/serviceWorker.js` (bug do code-server no Windows).
 */
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { Agent, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { RUNNER_CAPABILITY_SINCE, type IdeStateInfo } from "@jarvis/protocol";
import { TunnelMux, codeServerFolderParam, serializeRequestHead, type IdeManager, type TunnelOpenHead, type TunnelStream } from "@jarvis/core";

// ================================================================================ puro: caminho

export const IDE_PATH_PREFIX = "/ide/";
export const IDE_COOKIE = "jarvis_ide";
export const IDE_AUTH_PATH = "/__jarvis_auth";
const RUNNER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Só ids que viram um segmento de caminho sem codificação (todos os reais: `local`, `m-xxxxxxxx`). */
export function isIdeRunnerId(id: unknown): id is string { return typeof id === "string" && RUNNER_ID_RE.test(id); }
export function idePrefix(runnerId: string): string { return `${IDE_PATH_PREFIX}${runnerId}`; }

export type IdePath = { runnerId: string; prefix: string; rest: string } | { runnerId: string; prefix: string; redirect: string } | null;

/** `/ide/<id>/resto?q` → `{ runnerId, prefix:"/ide/<id>", rest:"/resto?q" }`. `/ide/<id>` (sem barra) pede
 *  redirecionamento: os caminhos relativos do workbench precisam da barra final. */
export function parseIdePath(url: string): IdePath {
  if (!url.startsWith(IDE_PATH_PREFIX)) return null;
  const after = url.slice(IDE_PATH_PREFIX.length);
  const cut = after.search(/[/?#]/);
  const runnerId = cut < 0 ? after : after.slice(0, cut);
  if (!isIdeRunnerId(runnerId)) return null;
  const prefix = idePrefix(runnerId);
  const tail = cut < 0 ? "" : after.slice(cut);
  if (!tail.startsWith("/")) return { runnerId, prefix, redirect: `${prefix}/${tail.startsWith("?") ? tail : ""}` };
  return { runnerId, prefix, rest: tail };
}

// ============================================================================= puro: cabeçalhos

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization", "te", "trailer", "trailers", "transfer-encoding", "upgrade"]);

export function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of String(Array.isArray(header) ? header.join(";") : header || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim(); if (!k || out.has(k)) continue;
    out.set(k, part.slice(i + 1).trim());
  }
  return out;
}

/** Tira o NOSSO cookie do cabeçalho Cookie (é credencial do Jarvis; o code-server não precisa dele). */
export function stripCookie(value: string, name = IDE_COOKIE): string {
  return value.split(";").map((p) => p.trim()).filter((p) => p && !p.startsWith(name + "=")).join("; ");
}

/**
 * Cabeçalhos que vão ao code-server. Preserva o `Host` ORIGINAL e a ordem/duplicatas; no modo http tira
 * os hop-by-hop (cada perna tem a própria conexão); no upgrade mantém `Connection/Upgrade/Sec-WebSocket-*`.
 */
export function upstreamRequestHeaders(raw: string[], mode: "http" | "upgrade"): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const k = raw[i], lk = k.toLowerCase();
    let v = raw[i + 1];
    if (mode === "http" && HOP_BY_HOP.has(lk)) continue;
    if (lk === "cookie") { v = stripCookie(v); if (!v) continue; }
    out.push(k, v);
  }
  return out;
}

/**
 * Cabeçalhos da resposta do code-server para o navegador: tira hop-by-hop (o Node refaz o framing),
 * injeta `Service-Worker-Allowed` em `…/serviceWorker.js` (bug do code-server no Windows, §13.2) e põe
 * o prefixo num `Location` absoluto-de-raiz (`/x` → `/ide/<id>/x`), que de outra forma sairia da IDE.
 */
export function downstreamResponseHeaders(raw: string[], ctx: { prefix: string; path: string }): string[] {
  const out: string[] = [];
  const pathOnly = ctx.path.split("?")[0];
  const isSw = pathOnly.endsWith("/serviceWorker.js");
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const k = raw[i], lk = k.toLowerCase();
    let v = raw[i + 1];
    if (HOP_BY_HOP.has(lk)) continue;
    if (isSw && lk === "service-worker-allowed") continue;
    if (lk === "location" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith(ctx.prefix + "/") && v !== ctx.prefix) v = ctx.prefix + v;
    out.push(k, v);
  }
  if (isSw) out.push("Service-Worker-Allowed", `${ctx.prefix}/`);
  return out;
}

export function buildSessionCookie(value: string, prefix: string, opts: { secure: boolean; maxAgeSec: number }): string {
  return `${IDE_COOKIE}=${value}; Path=${prefix}/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}${opts.secure ? "; Secure" : ""}`;
}

/** O pedido chegou por TLS (direto ou atrás de proxy que diz `x-forwarded-proto: https`)? */
export function requestIsTls(req: IncomingMessage): boolean {
  if ((req.socket as any)?.encrypted) return true;
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https";
}

// ================================================================================== auth (estado)

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface IdeTicket { runnerId: string; deviceId: string | null; userId: string | null; folder: string; exp: number }
export interface IdeSession { key: string; runnerId: string; deviceId: string | null; userId: string | null; createdAt: number; exp: number; closers: Set<() => void> }

/** Bilhetes de uso único (60 s) e sessões de IDE (cookie, 24 h). Só hashes na memória; nada no disco:
 *  reiniciar o Hub invalida tudo, e o dono reabre pelo Jarvis. */
export class IdeAuth {
  private readonly tickets = new Map<string, IdeTicket>();
  private readonly sessions = new Map<string, IdeSession>();
  constructor(private readonly o: { ticketTtlMs?: number; sessionTtlMs?: number; maxTickets?: number; maxSessions?: number; now?: () => number } = {}) {}
  private now(): number { return this.o.now ? this.o.now() : Date.now(); }
  get sessionTtlMs(): number { return this.o.sessionTtlMs ?? 24 * 3600_000; }

  mintTicket(t: Omit<IdeTicket, "exp">): string {
    const raw = randomBytes(32).toString("base64url");
    this.prune();
    while (this.tickets.size >= (this.o.maxTickets ?? 200)) this.tickets.delete(this.tickets.keys().next().value as string);
    this.tickets.set(sha(raw), { ...t, exp: this.now() + (this.o.ticketTtlMs ?? 60_000) });
    return raw;
  }

  /** Consome o bilhete (uso único, mesmo se vier para outra máquina) e abre uma sessão. */
  redeem(raw: string, runnerId: string): { cookie: string; session: IdeSession; folder: string } | { error: string } {
    if (typeof raw !== "string" || raw.length < 20 || raw.length > 200) return { error: "bilhete inválido" };
    const key = sha(raw);
    const t = this.tickets.get(key);
    if (!t) return { error: "bilhete inválido ou já usado" };
    this.tickets.delete(key);
    if (t.exp < this.now()) return { error: "bilhete expirado" };
    if (t.runnerId !== runnerId) return { error: "bilhete de outra máquina" };
    const cookie = randomBytes(32).toString("base64url");
    this.prune();
    while (this.sessions.size >= (this.o.maxSessions ?? 500)) { const first = this.sessions.values().next().value as IdeSession; this.dropSession(first); }
    const session: IdeSession = { key: sha(cookie), runnerId, deviceId: t.deviceId, userId: t.userId, createdAt: this.now(), exp: this.now() + this.sessionTtlMs, closers: new Set() };
    this.sessions.set(session.key, session);
    return { cookie, session, folder: t.folder };
  }

  /** Sessão do cookie, se ainda vale para ESTA máquina (o Path do cookie já restringe; aqui confere). */
  check(cookie: string | undefined, runnerId: string): IdeSession | null {
    if (!cookie || cookie.length < 20 || cookie.length > 200) return null;
    const s = this.sessions.get(sha(cookie));
    if (!s) return null;
    if (s.exp < this.now()) { this.dropSession(s); return null; }
    return s.runnerId === runnerId ? s : null;
  }

  /** Revalida todas as sessões (revogação/rebaixamento): as que caíram fecham as conexões abertas. */
  revalidate(stillOwner: (s: IdeSession) => boolean): number {
    let n = 0;
    for (const s of [...this.sessions.values()]) if (s.exp < this.now() || !stillOwner(s)) { this.dropSession(s); n++; }
    return n;
  }

  dropSession(s: IdeSession): void {
    this.sessions.delete(s.key);
    for (const close of [...s.closers]) { try { close(); } catch { /* ignore */ } }
    s.closers.clear();
  }

  get counts(): { tickets: number; sessions: number } { this.prune(); return { tickets: this.tickets.size, sessions: this.sessions.size }; }

  private prune(): void {
    const now = this.now();
    for (const [k, t] of this.tickets) if (t.exp < now) this.tickets.delete(k);
    for (const s of [...this.sessions.values()]) if (s.exp < now) this.dropSession(s);
  }
}

// ======================================================================================= serviço

export interface IdeRunnerView {
  online: boolean;
  os?: string;
  protocolVersion?: number;
  ide?: boolean;
  /** identidade do socket atual — um túnel nunca sobrevive a uma reconexão */
  link: unknown;
  sendJson(obj: Record<string, unknown>): boolean;
  sendBinary(frame: Buffer, compress: boolean): void;
  backlog(): number;
}

export interface IdeServiceDeps<S> {
  authEnabled: boolean;
  localId: string;
  /** o code-server da máquina do Hub (null = desligado) */
  localIde: IdeManager | null;
  localOs: string;
  isOwner(ws: S): boolean;
  actor(ws: S): { userId?: string | null; deviceId?: string | null };
  canUseRunner(ws: S, runnerId: string): boolean;
  defaultRunner(ws: S): string;
  runner(runnerId: string): IdeRunnerView | null;
  send(ws: S, frame: Record<string, unknown>): void;
  isOpen(ws: S): boolean;
  /** o dispositivo existe e é dono (sempre true com auth desligada) */
  ownerDevice(deviceId: string | null): boolean;
  audit(event: string, info: { userId?: string | null; deviceId?: string | null; runnerId?: string; ip?: string; detail?: string }): void;
  clientIp(req: IncomingMessage): string;
  originAllowed(req: IncomingMessage): boolean;
  guard: { blockedFor(ip: string): number; recordFail(ip: string): { blocked: boolean }; recordSuccess(ip: string): void; connOpen(ip: string): boolean; connClose(ip: string): void };
  log(event: string, data?: Record<string, unknown>): void;
}

type Op = "status" | "install" | "open" | "stop";
interface Pending<S> { ws: S; clientReqId: string; runnerId: string; op: Op; folder: string; at: number }
const OPS: Record<string, Op> = { ide_status: "status", ide_install: "install", ide_open: "open", ide_stop: "stop" };
export const IDE_CLIENT_OPS = new Set(Object.keys(OPS));
const STATUSES = new Set(["unavailable", "not_installed", "installing", "stopped", "starting", "running", "error"]);
const PENDING_TTL_MS = 150_000;

/** Estado vindo do runner é dado NÃO confiável: só o formato do contrato passa. */
export function cleanIdeState(v: unknown): IdeStateInfo | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.status !== "string" || !STATUSES.has(s.status)) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
  const out: IdeStateInfo = { status: s.status as IdeStateInfo["status"], version: typeof s.version === "string" ? s.version.slice(0, 40) : "", installed: s.installed === true };
  if (n(s.sizeBytes) !== undefined) out.sizeBytes = n(s.sizeBytes);
  const p = s.progress as Record<string, unknown> | undefined;
  if (p && typeof p === "object" && (p.phase === "download" || p.phase === "verify" || p.phase === "extract")) out.progress = { phase: p.phase, received: n(p.received) ?? 0, total: n(p.total) ?? 0 };
  if (typeof s.reason === "string") out.reason = s.reason.slice(0, 400);
  if (n(s.startedAt) !== undefined) out.startedAt = n(s.startedAt);
  if (s.external === true) out.external = true;
  return out;
}

export function runnerOffersIde(info: { protocolVersion?: number; ide?: boolean } | null | undefined): boolean {
  return !!info && (info.protocolVersion || 0) >= RUNNER_CAPABILITY_SINCE.ideServer && info.ide === true;
}

export function createIdeService<S extends object>(d: IdeServiceDeps<S>) {
  const auth = new IdeAuth();
  const tunnels = new Map<string, { mux: TunnelMux; link: unknown }>();
  const watchers = new Map<string, Set<S>>();
  const pending = new Map<string, Pending<S>>();
  const deniedAt = new WeakMap<S, number>();
  const localAgent = new Agent({ keepAlive: true, maxSockets: 64 });
  let localOpen = 0;
  const LOCAL_MAX = 256;
  const stats = { http: 0, upgrades: 0, denied: 0, errors: 0 };
  let pendingTimer: ReturnType<typeof setInterval> | null = null;

  // ------------------------------------------------------------------ capacidade e estado
  function capable(runnerId: string): boolean {
    if (!isIdeRunnerId(runnerId)) return false;
    if (runnerId === d.localId) return !!d.localIde?.available;
    return runnerOffersIde(d.runner(runnerId));
  }
  function watch(ws: S, runnerId: string): void {
    let set = watchers.get(runnerId);
    if (!set) { set = new Set(); watchers.set(runnerId, set); }
    set.add(ws);
  }
  function unwatch(ws: S): void { for (const [rid, set] of watchers) if (set.delete(ws) && !set.size) watchers.delete(rid); }
  function broadcast(runnerId: string, frame: Record<string, unknown>, except?: S): void {
    for (const ws of watchers.get(runnerId) || []) {
      if (ws === except) continue;
      if (!d.isOpen(ws) || !d.isOwner(ws)) { watchers.get(runnerId)?.delete(ws); continue; }
      d.send(ws, { ...frame, runnerId });
    }
  }
  function folderFor(runnerId: string, cwd: unknown): string {
    if (typeof cwd !== "string" || !cwd.trim() || cwd.length > 4096 || /[\0\r\n]/.test(cwd)) return "";
    const os = runnerId === d.localId ? d.localOs : (d.runner(runnerId)?.os || "linux");
    return codeServerFolderParam(cwd.trim(), os);
  }
  function readyFrame(p: { ws: S; runnerId: string; clientReqId: string; folder: string }): void {
    const a = d.actor(p.ws);
    const ticket = auth.mintTicket({ runnerId: p.runnerId, deviceId: a.deviceId ?? null, userId: a.userId ?? null, folder: p.folder });
    d.send(p.ws, { t: "ide_ready", runnerId: p.runnerId, reqId: p.clientReqId, url: `${idePrefix(p.runnerId)}${IDE_AUTH_PATH}?t=${ticket}`, expiresInMs: 60_000 });
  }

  /** Mudança de estado do code-server LOCAL (progresso, subiu, caiu, ocioso). */
  function onLocalState(state: IdeStateInfo): void { broadcast(d.localId, { t: "ide_state", state }); }

  // ------------------------------------------------------------------ mensagens do cliente
  function handleClient(ws: S, msg: any): void {
    const op = OPS[String(msg?.t)];
    if (!op) return;
    const clientReqId = typeof msg.reqId === "string" && msg.reqId.length <= 100 ? msg.reqId : "ide-" + randomUUID().slice(0, 8);
    const runnerId = typeof msg.runnerId === "string" && msg.runnerId ? msg.runnerId : d.defaultRunner(ws);
    const who = { ...d.actor(ws), runnerId };
    const fail = (message: string) => d.send(ws, { t: "ide_error", runnerId, reqId: clientReqId, message: message.slice(0, 400) });
    if (!d.isOwner(ws)) {
      stats.denied++;
      const last = deniedAt.get(ws) || 0;
      if (Date.now() - last > 10_000) { deniedAt.set(ws, Date.now()); d.audit("ide_denied", { ...who, detail: String(msg.t).slice(0, 40) }); }
      fail("o VS Code das máquinas é só do dono");
      return;
    }
    if (!d.canUseRunner(ws, runnerId)) { fail("sem acesso a esta máquina"); return; }
    if (!isIdeRunnerId(runnerId)) { fail("id de máquina inválido para a IDE"); return; }
    watch(ws, runnerId);
    if (runnerId === d.localId) { handleLocal(ws, op, clientReqId, msg, who); return; }
    const rv = d.runner(runnerId);
    if (!rv || !rv.online) { fail("máquina offline"); return; }
    if (!runnerOffersIde(rv)) { fail("esta máquina não oferece o VS Code (runner antigo, SO sem build do code-server ou JARVIS_IDE=0)"); return; }
    if (op === "install") d.audit("ide_install", { ...who, detail: "code-server" });
    if (op === "open") d.audit("ide_open", { ...who, detail: typeof msg.cwd === "string" ? msg.cwd.slice(0, 300) : "" });
    if (op === "stop") d.audit("ide_stop", { ...who, detail: "pedido do dono" });
    const hubReqId = "ide-" + randomUUID();
    pending.set(hubReqId, { ws, clientReqId, runnerId, op, folder: op === "open" ? folderFor(runnerId, msg.cwd) : "", at: Date.now() });
    armPendingSweep();
    if (!rv.sendJson({ t: `ide_${op}`, reqId: hubReqId })) { pending.delete(hubReqId); fail("máquina offline"); }
  }

  function handleLocal(ws: S, op: Op, clientReqId: string, msg: any, who: Record<string, unknown>): void {
    const ide = d.localIde;
    const fail = (message: string) => d.send(ws, { t: "ide_error", runnerId: d.localId, reqId: clientReqId, message: message.slice(0, 400) });
    if (!ide || !ide.available) { fail(`VS Code indisponível no servidor: ${ide?.unavailableReason || "desligado (JARVIS_IDE=0)"}`); return; }
    const reply = () => d.send(ws, { t: "ide_state", runnerId: d.localId, reqId: clientReqId, state: ide.state() });
    switch (op) {
      case "status": reply(); return;
      case "install":
        d.audit("ide_install", { ...who, detail: "code-server" });
        ide.install().catch(() => { /* o estado (error + motivo) sai pelo onState */ });
        reply();
        return;
      case "stop":
        d.audit("ide_stop", { ...who, detail: "pedido do dono" });
        ide.cancelInstall();
        ide.stop("pedido do dono").then(reply, (e) => fail(String(e?.message ?? e)));
        return;
      case "open": {
        d.audit("ide_open", { ...who, detail: typeof msg.cwd === "string" ? msg.cwd.slice(0, 300) : "" });
        const folder = folderFor(d.localId, msg.cwd);
        ide.ensureRunning().then(() => { reply(); readyFrame({ ws, runnerId: d.localId, clientReqId, folder }); }, (e) => { reply(); fail(String(e?.message ?? e)); });
        return;
      }
    }
  }

  /** `ide_state` do runner (resposta com `reqId` ou espontânea). */
  function onRunnerState(runnerId: string, m: any): void {
    const state = cleanIdeState(m?.state);
    if (!state) return;
    const p = typeof m.reqId === "string" ? pending.get(m.reqId) : undefined;
    if (p && p.runnerId === runnerId) {
      pending.delete(m.reqId);
      if (d.isOpen(p.ws)) {
        d.send(p.ws, { t: "ide_state", runnerId, reqId: p.clientReqId, state });
        if (p.op === "open") {
          if (state.status === "running") readyFrame(p);
          else d.send(p.ws, { t: "ide_error", runnerId, reqId: p.clientReqId, message: state.reason || (state.status === "not_installed" ? "o VS Code não está instalado nesta máquina" : `o VS Code não subiu (${state.status})`) });
        }
      }
      broadcast(runnerId, { t: "ide_state", state }, p.ws);
      return;
    }
    broadcast(runnerId, { t: "ide_state", state });
  }

  function armPendingSweep(): void {
    if (pendingTimer) return;
    pendingTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, p] of pending) if (now - p.at > PENDING_TTL_MS) {
        pending.delete(id);
        if (d.isOpen(p.ws)) d.send(p.ws, { t: "ide_error", runnerId: p.runnerId, reqId: p.clientReqId, message: "a máquina não respondeu a tempo" });
      }
      if (!pending.size && pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; }
    }, 5000);
    pendingTimer.unref?.();
  }

  // ------------------------------------------------------------------ túnel por máquina
  function tunnelFor(runnerId: string): TunnelMux | null {
    const rv = d.runner(runnerId);
    if (!rv || !rv.online || !runnerOffersIde(rv)) return null;
    const cur = tunnels.get(runnerId);
    if (cur && cur.link === rv.link && !cur.mux.isClosed) return cur.mux;
    if (cur) cur.mux.destroyAll("reconexão da máquina");
    const link = rv.link;
    const mux = new TunnelMux({
      role: "opener",
      // sempre o socket ATUAL do runner, conferido pela identidade: frame de um túnel velho não vaza
      // para a conexão nova.
      send: (frame, compress) => { const r = d.runner(runnerId); if (r && r.link === link) r.sendBinary(frame, compress); },
      backlog: () => { const r = d.runner(runnerId); return r && r.link === link ? r.backlog() : 0; },
      log: (event, data) => d.log(event, { runnerId, ...(data || {}) }),
    });
    tunnels.set(runnerId, { mux, link });
    return mux;
  }
  /** Frame binário `kind 0x54` que chegou da conexão de um runner. */
  function onRunnerFrame(runnerId: string, link: unknown, buf: Buffer): void {
    const t = tunnels.get(runnerId);
    if (t && t.link === link) t.mux.onFrame(buf);
  }
  function runnerOffline(runnerId: string): void {
    const t = tunnels.get(runnerId);
    if (t) { t.mux.destroyAll("máquina offline"); tunnels.delete(runnerId); }
    for (const [id, p] of pending) if (p.runnerId === runnerId) { pending.delete(id); if (d.isOpen(p.ws)) d.send(p.ws, { t: "ide_error", runnerId, reqId: p.clientReqId, message: "máquina offline" }); }
    if (watchers.has(runnerId)) broadcast(runnerId, { t: "ide_error", message: "máquina offline" });
  }

  // ------------------------------------------------------------------ HTTP
  function page(res: ServerResponse, status: number, title: string, text: string, extra: Record<string, string> = {}): void {
    if (res.headersSent) { res.destroy(); return; }
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
      + `<body style="font-family:system-ui,sans-serif;background:#0b0e13;color:#e5e7eb;display:grid;place-items:center;min-height:90vh;margin:0">`
      + `<div style="max-width:440px;padding:24px;text-align:center"><h2 style="margin:0 0 10px;font-size:19px">${esc(title)}</h2><p style="color:#9ca3af;line-height:1.5">${esc(text)}</p>`
      + `<p><a href="/" style="color:#93c5fd">Abrir o Jarvis</a></p></div></body></html>`;
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", ...extra });
    res.end(html);
  }
  const wantsHtml = (req: IncomingMessage) => req.headers["sec-fetch-dest"] === "document" || String(req.headers.accept || "").includes("text/html");
  function deny(req: IncomingMessage, res: ServerResponse, status: number, title: string, text: string): void {
    if (res.headersSent) { if (!res.writableEnded) res.destroy(); return; }
    if (wantsHtml(req)) { page(res, status, title, text); return; }
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(text);
  }

  const authFailAt = new Map<string, number>();
  function redeem(req: IncomingMessage, res: ServerResponse, runnerId: string, prefix: string, query: string): void {
    const ip = d.clientIp(req);
    if (req.method !== "GET" && req.method !== "HEAD") { deny(req, res, 405, "Método não permitido", "Use o link aberto pelo Jarvis."); return; }
    if (d.guard.blockedFor(ip) > 0) { deny(req, res, 429, "Muitas tentativas", "Aguarde um pouco e abra o VS Code de novo pelo Jarvis."); return; }
    const t = new URLSearchParams(query).get("t") || "";
    const r = auth.redeem(t, runnerId);
    if ("error" in r) {
      const g = d.guard.recordFail(ip);
      const last = authFailAt.get(ip) || 0;
      if (Date.now() - last > 10_000) { authFailAt.set(ip, Date.now()); d.audit("ide_auth_fail", { ip, runnerId, detail: r.error + (g.blocked ? " — bloqueado" : "") }); }
      if (authFailAt.size > 1000) authFailAt.clear();
      deny(req, res, 401, "Link do VS Code inválido", `${r.error[0].toUpperCase()}${r.error.slice(1)}. Abra o VS Code de novo pelo Jarvis (o link vale uma vez, por 1 minuto).`);
      return;
    }
    if (!d.ownerDevice(r.session.deviceId)) { auth.dropSession(r.session); deny(req, res, 403, "Acesso recusado", "Este dispositivo não é mais dono do Jarvis."); return; }
    d.guard.recordSuccess(ip);
    d.audit("ide_session", { userId: r.session.userId, deviceId: r.session.deviceId, runnerId, ip, detail: r.folder ? `pasta ${r.folder}`.slice(0, 300) : "sem pasta" });
    const target = `${prefix}/${r.folder ? `?folder=${encodeURIComponent(r.folder)}` : ""}`;
    res.writeHead(302, { location: target, "set-cookie": buildSessionCookie(r.cookie, prefix, { secure: requestIsTls(req), maxAgeSec: auth.sessionTtlMs / 1000 }), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    res.end();
  }

  type Target = { kind: "local"; ide: IdeManager } | { kind: "tunnel"; mux: TunnelMux } | { error: string; status: number };
  function target(runnerId: string): Target {
    if (runnerId === d.localId) {
      const ide = d.localIde;
      if (!ide || !ide.available) return { status: 404, error: "o VS Code está desligado nesta máquina" };
      if (!ide.installed && !ide.running) return { status: 503, error: "o VS Code não está instalado nesta máquina — instale pelo Jarvis" };
      return { kind: "local", ide };
    }
    const rv = d.runner(runnerId);
    if (!rv || !rv.online) return { status: 502, error: "máquina offline" };
    const mux = tunnelFor(runnerId);
    if (!mux) return { status: 404, error: "esta máquina não oferece o VS Code" };
    return { kind: "tunnel", mux };
  }

  /** Requisição HTTP em `/ide/…`. Devolve false se o caminho não é da IDE. */
  function handleHttp(req: IncomingMessage, res: ServerResponse): boolean {
    const p = parseIdePath(req.url || "/");
    if (!p) { if ((req.url || "").startsWith(IDE_PATH_PREFIX)) { deny(req, res, 404, "Não encontrado", "Endereço de IDE inválido."); return true; } return false; }
    if ("redirect" in p) { res.writeHead(301, { location: p.redirect, "cache-control": "no-store" }); res.end(); return true; }
    const qi = p.rest.indexOf("?");
    const restPath = qi < 0 ? p.rest : p.rest.slice(0, qi);
    if (restPath === IDE_AUTH_PATH) { redeem(req, res, p.runnerId, p.prefix, qi < 0 ? "" : p.rest.slice(qi + 1)); return true; }
    const session = auth.check(parseCookies(req.headers.cookie).get(IDE_COOKIE), p.runnerId);
    if (!session || !d.ownerDevice(session.deviceId)) {
      if (session) auth.dropSession(session);
      stats.denied++;
      deny(req, res, 401, "Sessão do VS Code expirada", "Abra o VS Code desta máquina de novo pelo Jarvis.");
      return true;
    }
    const tg = target(p.runnerId);
    if ("error" in tg) { deny(req, res, tg.status, "VS Code indisponível", tg.error); return true; }
    stats.http++;
    const head: TunnelOpenHead = { mode: "http", method: req.method || "GET", path: p.rest, headers: upstreamRequestHeaders(req.rawHeaders, "http") };
    const respond = (status: number, statusMessage: string | undefined, raw: string[]) => {
      if (res.headersSent) return;
      const h = downstreamResponseHeaders(raw, { prefix: p.prefix, path: p.rest });
      statusMessage ? res.writeHead(status, statusMessage, h) : res.writeHead(status, h);
    };
    const close = () => { if (!res.destroyed) res.destroy(); };
    session.closers.add(close);
    res.once("close", () => session.closers.delete(close));
    if (tg.kind === "local") proxyLocalHttp(tg.ide, head, req, res, respond);
    else proxyTunnelHttp(tg.mux, head, req, res, respond);
    return true;
  }

  function badGateway(res: ServerResponse, req: IncomingMessage, err: unknown): void {
    stats.errors++;
    if (res.headersSent) { if (!res.writableEnded) res.destroy(); return; }
    deny(req, res, 502, "O VS Code não respondeu", String((err as Error)?.message || err || "erro no proxy").slice(0, 300));
  }

  function proxyLocalHttp(ide: IdeManager, head: TunnelOpenHead, req: IncomingMessage, res: ServerResponse, respond: (s: number, m: string | undefined, h: string[]) => void): void {
    if (localOpen >= LOCAL_MAX) { deny(req, res, 503, "Ocupado", "Conexões demais com o VS Code."); return; }
    localOpen++; ide.retain();
    let released = false;
    const release = () => { if (released) return; released = true; localOpen--; ide.release(); };
    res.once("close", release);
    ide.ensureRunning().then((port) => {
      if (res.destroyed) return;
      const up = httpRequest({ host: "127.0.0.1", port, method: head.method, path: head.path, headers: head.headers as any, setHost: false, agent: localAgent });
      let upRes: IncomingMessage | null = null;
      up.on("response", (r) => {
        upRes = r;
        respond(r.statusCode || 502, r.statusMessage, r.rawHeaders);
        r.on("error", () => res.destroy());
        r.pipe(res);
      });
      up.on("error", (e) => badGateway(res, req, e));
      res.once("close", () => { if (!upRes || !upRes.complete) up.destroy(); });
      req.pipe(up);
    }, (e) => { release(); badGateway(res, req, e); });
  }

  function proxyTunnelHttp(mux: TunnelMux, head: TunnelOpenHead, req: IncomingMessage, res: ServerResponse, respond: (s: number, m: string | undefined, h: string[]) => void): void {
    const s = mux.open(head);
    if (!s) { deny(req, res, 503, "Ocupado", "Conexões demais com o VS Code desta máquina."); return; }
    let lastErr: Error | null = null;
    s.on("error", (e) => { lastErr = e; });
    s.once("response", (h) => { respond(h.status, h.statusMessage, h.headers); s.pipe(res); });
    s.once("close", () => {
      if (!res.headersSent) badGateway(res, req, lastErr || new Error("a máquina encerrou a conexão"));
      else if (!res.writableEnded) res.destroy();
    });
    res.once("close", () => { if (!s.destroyed && !s.readableEnded) s.destroy(); });
    req.pipe(s);
  }

  // ------------------------------------------------------------------ upgrade (WebSocket)
  function rawReply(socket: Duplex, status: number, text: string): void {
    try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`); } catch { /* ignore */ }
    setTimeout(() => { try { socket.destroy(); } catch { /* ignore */ } }, 1000).unref?.();
  }

  /** Upgrade em `/ide/…`. Devolve false se o caminho não é da IDE (quem chamou trata). */
  function handleUpgrade(req: IncomingMessage, socket: Duplex, buffered: Buffer): boolean {
    const p = parseIdePath(req.url || "/");
    if (!p) { if ((req.url || "").startsWith(IDE_PATH_PREFIX)) { rawReply(socket, 404, "Not Found"); return true; } return false; }
    socket.on("error", () => { /* fechado abaixo */ });
    if ("redirect" in p) { rawReply(socket, 404, "Not Found"); return true; }
    // Defesa própria além da do code-server: um site de fora não abre WebSocket na IDE (o cookie
    // SameSite=Strict já não iria, e o Origin tem de ser o deste Hub).
    if (!d.originAllowed(req)) { stats.denied++; d.audit("ide_origin_reject", { ip: d.clientIp(req), runnerId: p.runnerId, detail: String(req.headers.origin || "").slice(0, 120) }); rawReply(socket, 403, "Forbidden"); return true; }
    const session = auth.check(parseCookies(req.headers.cookie).get(IDE_COOKIE), p.runnerId);
    if (!session || !d.ownerDevice(session.deviceId)) { if (session) auth.dropSession(session); stats.denied++; rawReply(socket, 401, "Unauthorized"); return true; }
    const tg = target(p.runnerId);
    if ("error" in tg) { rawReply(socket, tg.status, tg.error); return true; }
    const ip = d.clientIp(req);
    if (!d.guard.connOpen(ip)) { rawReply(socket, 503, "Too many connections"); return true; }
    stats.upgrades++;
    const head: TunnelOpenHead = { mode: "upgrade", method: req.method || "GET", path: p.rest, headers: upstreamRequestHeaders(req.rawHeaders, "upgrade") };
    const sock = socket as Socket;
    try { sock.setNoDelay?.(true); sock.setKeepAlive?.(true, 30_000); sock.setTimeout?.(0); } catch { /* não é net.Socket */ }
    let closed = false;
    const close = () => { if (!socket.destroyed) socket.destroy(); };
    session.closers.add(close);
    socket.once("close", () => { if (closed) return; closed = true; session.closers.delete(close); d.guard.connClose(ip); });
    if (tg.kind === "local") upgradeLocal(tg.ide, head, socket, buffered);
    else upgradeTunnel(tg.mux, head, socket, buffered);
    return true;
  }

  function upgradeLocal(ide: IdeManager, head: TunnelOpenHead, socket: Duplex, buffered: Buffer): void {
    if (localOpen >= LOCAL_MAX) { rawReply(socket, 503, "Too many connections"); return; }
    localOpen++; ide.retain();
    let released = false;
    socket.once("close", () => { if (released) return; released = true; localOpen--; ide.release(); });
    ide.ensureRunning().then((port) => {
      if (socket.destroyed) return;
      const up = netConnect(port, "127.0.0.1");
      up.setNoDelay(true);
      up.once("connect", () => {
        up.write(serializeRequestHead(head));
        if (buffered?.length) up.write(buffered);
        up.pipe(socket); socket.pipe(up);
      });
      up.on("error", () => { stats.errors++; if (!socket.destroyed) socket.destroy(); });
      up.on("close", () => { if (!socket.destroyed) socket.end(); setTimeout(() => { if (!socket.destroyed) socket.destroy(); }, 5000).unref?.(); });
      socket.once("close", () => { if (!up.destroyed) up.destroy(); });
    }, (e) => { stats.errors++; rawReply(socket, 502, String((e as Error)?.message || e).slice(0, 200)); });
  }

  function upgradeTunnel(mux: TunnelMux, head: TunnelOpenHead, socket: Duplex, buffered: Buffer): void {
    const s: TunnelStream | null = mux.open(head);
    if (!s) { rawReply(socket, 503, "Too many connections"); return; }
    let gotBytes = false;
    s.once("data", () => { gotBytes = true; });
    if (buffered?.length) s.write(buffered);
    s.pipe(socket); socket.pipe(s);
    s.once("close", () => {
      if (!gotBytes && !socket.destroyed) { stats.errors++; rawReply(socket, 502, "Bad Gateway"); return; }
      // fim: entrega o que ainda está no buffer do socket (o quadro de fechamento do WebSocket) antes de fechar
      if (!socket.destroyed) { socket.end(); setTimeout(() => { if (!socket.destroyed) socket.destroy(); }, 5000).unref?.(); }
    });
    socket.once("close", () => { if (!s.destroyed) s.destroy(); });
  }

  // ------------------------------------------------------------------ revogação, limpeza, métricas
  /** Revogar/rebaixar um dispositivo: sessões dele caem e as conexões abertas fecham. */
  function revalidate(): number {
    const n = auth.revalidate((s) => d.ownerDevice(s.deviceId));
    if (n) d.log("ide_sessions_revoked", { count: n });
    return n;
  }
  function onSocketClose(ws: S): void { unwatch(ws); }
  function statsLine(): Record<string, unknown> | null {
    const tun: Record<string, unknown> = {};
    let any = stats.http + stats.upgrades + stats.denied + stats.errors > 0;
    for (const [rid, t] of tunnels) { const st = t.mux.stats(true); if (st.streams || st.bytesIn || st.bytesOut) { tun[rid] = st; any = true; } }
    if (!any && !localOpen) return null;
    const line = { ...stats, localOpen, ...auth.counts, tunnels: tun };
    stats.http = 0; stats.upgrades = 0; stats.denied = 0; stats.errors = 0;
    return line;
  }
  function shutdown(): void {
    for (const [, t] of tunnels) t.mux.destroyAll("Hub encerrando");
    tunnels.clear();
    localAgent.destroy();
    if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; }
  }

  return { capable, handleClient, onLocalState, onRunnerState, onRunnerFrame, runnerOffline, handleHttp, handleUpgrade, revalidate, onSocketClose, statsLine, shutdown, auth, _tunnels: tunnels };
}

export type IdeService<S extends object> = ReturnType<typeof createIdeService<S>>;
