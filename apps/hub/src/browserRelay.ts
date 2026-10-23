/**
 * Relay do browser remoto no Hub (BRW-IDE-00 F1).
 *
 * O Hub NÃO interpreta frame (lei §3.5): lê só o pageId do cabeçalho binário para saber a quem
 * entregar e repassa o MESMO Buffer. Contra espectador lento vale o que o F0 mediu (§13.1): crédito
 * por espectador — no máximo 2 frames sem `fack`; acima disso guarda só o MAIS RECENTE e entrega
 * quando chegar a confirmação. Atraso limitado ao RTT do espectador, memória limitada a 1 frame.
 *
 * Também é aqui que mora a contagem de espectadores por (máquina, aba): o produtor só codifica
 * enquanto há ao menos um (o último que sai — inclusive por queda do socket — desliga o screencast).
 *
 * Genérico no tipo do espectador (`V` = WebSocket em produção, objeto qualquer nos testes) e sem
 * timers próprios: o Hub chama `tick()` 1×/s. Nada aqui bloqueia o event loop.
 */
import { peekBrowserFramePageId } from "@jarvis/core";
import { RUNNER_CAPABILITY_SINCE, type BrowserInput, type BrowserProfileName, type BrowserStateInfo, type RunnerInfo } from "@jarvis/protocol";

export const BROWSER_MAX_INFLIGHT = 2;
/** Crédito preso (fack perdido) não pode congelar a tela para sempre. */
export const BROWSER_CREDIT_TIMEOUT_MS = 5000;

export interface BrowserViewDims { maxWidth: number; maxHeight: number }

export interface BrowserRelayHooks<V> {
  /** entrega o frame binário (Buffer intacto) ao espectador */
  sendFrame(viewer: V, frame: Buffer): void;
  /** liga/reajusta (`on`) ou desliga o screencast no produtor da máquina */
  setProducer(runnerId: string, pageId: string, on: boolean, dims: BrowserViewDims): void;
  /** retorno de qualidade para o produtor (≈1/s por aba com tráfego) */
  feedback?(runnerId: string, pageId: string, delivered: number, dropped: number): void;
  /** o espectador ainda pode ver? (socket aberto, ainda dono) — checado a cada entrega */
  canView?(viewer: V): boolean;
  /** resumo de uma sessão de espectadores quando a aba deixa de ser assistida */
  onPageIdle?(summary: BrowserPageSummary): void;
  now?: () => number;
}

export interface BrowserPageSummary { runnerId: string; pageId: string; seconds: number; framesIn: number; delivered: number; dropped: number; bytesOut: number; fpsDelivered: number }

interface ViewerState { runnerId: string; pageId: string; inflight: number; pending: Buffer | null; dims: BrowserViewDims; lastSendAt: number }
interface PageEntry<V> {
  runnerId: string; pageId: string; viewers: Set<V>; lastFrame: Buffer | null; dims: BrowserViewDims | null;
  win: { delivered: number; dropped: number };
  totals: { framesIn: number; delivered: number; dropped: number; bytesOut: number; since: number };
}

const key = (runnerId: string, pageId: string) => runnerId + "\u0000" + pageId;

export class BrowserRelay<V> {
  private readonly viewerState = new Map<V, ViewerState>();
  private readonly pages = new Map<string, PageEntry<V>>();
  /** abas sem espectador que ainda mandaram frame: último "pare" enviado (evita martelar o produtor) */
  private readonly nudged = new Map<string, number>();
  private window = { framesIn: 0, delivered: 0, dropped: 0, bytesOut: 0, since: 0 };

  constructor(private readonly hooks: BrowserRelayHooks<V>) { this.window.since = this.now(); }

  private now(): number { return this.hooks.now ? this.hooks.now() : Date.now(); }

  /** O espectador passa a assistir esta aba (sai da anterior, se havia). Um socket = uma aba. */
  view(viewer: V, runnerId: string, pageId: string, dims: BrowserViewDims): void {
    const prev = this.viewerState.get(viewer);
    if (prev && prev.runnerId === runnerId && prev.pageId === pageId) {
      prev.dims = dims;
      const page = this.pages.get(key(runnerId, pageId));
      if (page) this.syncProducer(page);
      return;
    }
    if (prev) this.unview(viewer);
    const k = key(runnerId, pageId);
    let page = this.pages.get(k);
    if (!page) {
      page = { runnerId, pageId, viewers: new Set(), lastFrame: null, dims: null, win: { delivered: 0, dropped: 0 }, totals: { framesIn: 0, delivered: 0, dropped: 0, bytesOut: 0, since: this.now() } };
      this.pages.set(k, page);
      this.nudged.delete(k);
    }
    const st: ViewerState = { runnerId, pageId, inflight: 0, pending: null, dims, lastSendAt: 0 };
    page.viewers.add(viewer);
    this.viewerState.set(viewer, st);
    this.syncProducer(page);
    // Quem chega numa aba já assistida (e talvez parada) vê a tela na hora, sem esperar mudar algo.
    if (page.lastFrame) this.deliver(viewer, st, page, page.lastFrame);
  }

  /** Para de assistir (fechou o painel, trocou de máquina, socket caiu). */
  unview(viewer: V): void {
    const st = this.viewerState.get(viewer);
    if (!st) return;
    this.viewerState.delete(viewer);
    const page = this.pages.get(key(st.runnerId, st.pageId));
    if (!page) return;
    page.viewers.delete(viewer);
    if (!page.viewers.size) this.retire(page, true);
    else this.syncProducer(page);
  }

  /** O espectador confirmou um frame desta aba: devolve o crédito e entrega o mais recente guardado. */
  ack(viewer: V, pageId: string): void {
    const st = this.viewerState.get(viewer);
    // fack de uma aba antiga (trocou de aba com frame em trânsito) não dá crédito na nova.
    if (!st || st.pageId !== pageId) return;
    st.inflight = Math.max(0, st.inflight - 1);
    if (st.pending && st.inflight < BROWSER_MAX_INFLIGHT) {
      const page = this.pages.get(key(st.runnerId, st.pageId));
      const f = st.pending; st.pending = null;
      if (page) this.deliver(viewer, st, page, f);
    }
  }

  /** Frame binário do produtor da máquina. Repasse opaco. */
  onFrame(runnerId: string, frame: Buffer): "relayed" | "unwatched" | "invalid" {
    const pageId = peekBrowserFramePageId(frame);
    if (!pageId) return "invalid";
    const k = key(runnerId, pageId);
    const page = this.pages.get(k);
    if (!page) {
      // Corrida normal (o "pare" ainda está a caminho) ou produtor desobediente: lembra de novo, com
      // folga, em vez de repassar — sem espectador o Hub não carrega frame (§7).
      const t = this.now(), last = this.nudged.get(k);
      if (last === undefined || t - last > 2000) { this.nudged.set(k, t); this.hooks.setProducer(runnerId, pageId, false, { maxWidth: 0, maxHeight: 0 }); }
      return "unwatched";
    }
    page.lastFrame = frame;
    page.totals.framesIn++; this.window.framesIn++;
    for (const viewer of page.viewers) {
      const st = this.viewerState.get(viewer);
      if (!st) continue;
      if (st.inflight < BROWSER_MAX_INFLIGHT) this.deliver(viewer, st, page, frame);
      else {
        if (st.pending) this.countDrop(page);
        st.pending = frame;
      }
    }
    return "relayed";
  }

  /** Aba fechada na máquina: esquece (os espectadores dela ficam sem aba até escolherem outra). */
  dropPage(runnerId: string, pageId: string): V[] {
    const page = this.pages.get(key(runnerId, pageId));
    if (!page) return [];
    const viewers = [...page.viewers];
    for (const v of viewers) this.viewerState.delete(v);
    this.retire(page, false);
    return viewers;
  }

  /** Máquina caiu (ou o browser dela parou): tudo dela sai. Devolve os espectadores afetados. */
  dropRunner(runnerId: string): V[] {
    const out: V[] = [];
    for (const page of [...this.pages.values()]) if (page.runnerId === runnerId) out.push(...this.dropPage(runnerId, page.pageId));
    for (const k of [...this.nudged.keys()]) if (k.startsWith(runnerId + "\u0000")) this.nudged.delete(k);
    return out;
  }

  /** 1×/s: retorno de qualidade ao produtor e destrava crédito preso. */
  tick(): void {
    const t = this.now();
    for (const page of this.pages.values()) {
      if (page.win.delivered || page.win.dropped) this.hooks.feedback?.(page.runnerId, page.pageId, page.win.delivered, page.win.dropped);
      page.win = { delivered: 0, dropped: 0 };
      for (const viewer of page.viewers) {
        const st = this.viewerState.get(viewer);
        if (!st || st.inflight < BROWSER_MAX_INFLIGHT || t - st.lastSendAt < BROWSER_CREDIT_TIMEOUT_MS) continue;
        st.inflight = 0;
        if (st.pending) { const f = st.pending; st.pending = null; this.deliver(viewer, st, page, f); }
      }
    }
    for (const [k, at] of this.nudged) if (t - at > 60000) this.nudged.delete(k);
  }

  viewing(viewer: V): { runnerId: string; pageId: string } | undefined {
    const st = this.viewerState.get(viewer);
    return st ? { runnerId: st.runnerId, pageId: st.pageId } : undefined;
  }
  viewerCount(runnerId: string, pageId: string): number { return this.pages.get(key(runnerId, pageId))?.viewers.size || 0; }
  /** Abas desta máquina com espectador agora. */
  pagesOf(runnerId: string): string[] { return [...this.pages.values()].filter((p) => p.runnerId === runnerId).map((p) => p.pageId); }
  get activePages(): number { return this.pages.size; }

  /** Janela desde a última chamada — para o log periódico do Hub. */
  stats(): { pages: number; viewers: number; seconds: number; fpsIn: number; fpsDelivered: number; dropped: number; mbpsOut: number } {
    const t = this.now(), seconds = Math.max(0.001, (t - this.window.since) / 1000), w = this.window;
    const out = { pages: this.pages.size, viewers: this.viewerState.size, seconds: round(seconds), fpsIn: round(w.framesIn / seconds), fpsDelivered: round(w.delivered / seconds), dropped: w.dropped, mbpsOut: round((w.bytesOut * 8) / 1e6 / seconds) };
    this.window = { framesIn: 0, delivered: 0, dropped: 0, bytesOut: 0, since: t };
    return out;
  }

  private deliver(viewer: V, st: ViewerState, page: PageEntry<V>, frame: Buffer): void {
    if (this.hooks.canView && !this.hooks.canView(viewer)) { this.countDrop(page); return; }
    try { this.hooks.sendFrame(viewer, frame); } catch { this.countDrop(page); return; }
    st.inflight++; st.lastSendAt = this.now();
    page.win.delivered++; page.totals.delivered++; page.totals.bytesOut += frame.length;
    this.window.delivered++; this.window.bytesOut += frame.length;
  }
  private countDrop(page: PageEntry<V>): void { page.win.dropped++; page.totals.dropped++; this.window.dropped++; }

  /** A maior tela entre os espectadores manda (a menor reduz no próprio canvas). */
  private syncProducer(page: PageEntry<V>): void {
    let maxWidth = 0, maxHeight = 0;
    for (const v of page.viewers) { const d = this.viewerState.get(v)?.dims; if (d) { maxWidth = Math.max(maxWidth, d.maxWidth); maxHeight = Math.max(maxHeight, d.maxHeight); } }
    if (page.dims && page.dims.maxWidth === maxWidth && page.dims.maxHeight === maxHeight) return;
    page.dims = { maxWidth, maxHeight };
    this.hooks.setProducer(page.runnerId, page.pageId, true, page.dims);
  }

  private retire(page: PageEntry<V>, stopProducer: boolean): void {
    this.pages.delete(key(page.runnerId, page.pageId));
    if (stopProducer) this.hooks.setProducer(page.runnerId, page.pageId, false, page.dims || { maxWidth: 0, maxHeight: 0 });
    const seconds = Math.max(0.001, (this.now() - page.totals.since) / 1000);
    this.hooks.onPageIdle?.({ runnerId: page.runnerId, pageId: page.pageId, seconds: round(seconds), framesIn: page.totals.framesIn, delivered: page.totals.delivered, dropped: page.totals.dropped, bytesOut: page.totals.bytesOut, fpsDelivered: round(page.totals.delivered / seconds) });
  }
}

function round(n: number): number { return Math.round(n * 10) / 10; }

// ======================================================================= gate e validação (puras)

/** Owner-only (decisão de 2026-10-19, lei §3.3): membro é recusado mesmo com grant na máquina. */
export function browserAccess(p: { authEnabled: boolean; role?: string | null }): { ok: true } | { ok: false; reason: string } {
  if (!p.authEnabled) return { ok: true };
  if (p.role === "owner") return { ok: true };
  return { ok: false, reason: "o browser remoto é só do dono" };
}

/** A máquina oferece o browser? Protocolo novo o bastante E ela declarou ter navegador. */
export function runnerHasBrowser(info: Pick<RunnerInfo, "protocolVersion" | "browser"> | undefined): boolean {
  return !!info && (info.protocolVersion || 1) >= RUNNER_CAPABILITY_SINCE.remoteBrowser && info.browser === true;
}

/** F2 — a máquina serve as ferramentas de browser às IAs dela (e o perfil "IA" no painel). Runner < 19
 *  ou com `JARVIS_BROWSER_AGENT=0` simplesmente não oferece. */
export function runnerHasBrowserAgent(info: Pick<RunnerInfo, "protocolVersion" | "browser" | "browserAgent"> | undefined): boolean {
  return runnerHasBrowser(info) && (info!.protocolVersion || 1) >= RUNNER_CAPABILITY_SINCE.browserAgentTools && info!.browserAgent === true;
}
/** F2 — "selecionar pontos" (só precisa do browser e do protocolo 19). */
export function runnerHasBrowserGrab(info: Pick<RunnerInfo, "protocolVersion" | "browser"> | undefined): boolean {
  return runnerHasBrowser(info) && (info!.protocolVersion || 1) >= RUNNER_CAPABILITY_SINCE.browserGrab;
}

/**
 * F2 — este turno leva a ponte de browser? Só turno do DONO (lei §3.3: browser é owner-only, e a IA de
 * um membro não pode ver o browser logado do dono) numa máquina que oferece as ferramentas. O resto
 * (nível, liberação do nível 3) é da máquina dona do browser.
 */
export function browserToolsForTurn(p: { ownerTurn: boolean; machineOffers: boolean }): boolean {
  return p.ownerTurn === true && p.machineOffers === true;
}

/**
 * F2 — abas por (máquina, PERFIL). Com o perfil do agente, a mesma máquina manda dois `browser_state`
 * (um por perfil); esquecer no relay "as abas que sumiram" olhando só um deles derrubaria o espectador
 * do OUTRO perfil. Devolve as abas a soltar do relay.
 */
export class BrowserProfilePages {
  private readonly map = new Map<string, Map<BrowserProfileName, Set<string>>>();
  update(runnerId: string, state: Pick<BrowserStateInfo, "profile" | "running" | "pages">): string[] {
    const profile: BrowserProfileName = state?.profile === "agent" ? "agent" : "owner";
    let byProfile = this.map.get(runnerId);
    if (!byProfile) { byProfile = new Map(); this.map.set(runnerId, byProfile); }
    const before = byProfile.get(profile) || new Set<string>();
    const now = new Set<string>(state?.running && Array.isArray(state.pages) ? state.pages.map((p) => String(p?.pageId || "")).filter(Boolean) : []);
    byProfile.set(profile, now);
    return [...before].filter((id) => !now.has(id));
  }
  /** máquina caiu: tudo dela sai */
  drop(runnerId: string): void { this.map.delete(runnerId); }
  profileOf(runnerId: string, pageId: string): BrowserProfileName | undefined {
    for (const [profile, ids] of this.map.get(runnerId) || []) if (ids.has(pageId)) return profile;
    return undefined;
  }
}

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const intIn = (v: unknown, min: number, max: number, dflt: number): number => { const n = num(v); return n === undefined ? dflt : Math.max(min, Math.min(max, Math.round(n))); };

/** Input do cliente → forma canônica (ou null). Nada de campo extra atravessa para a máquina. */
export function sanitizeBrowserInput(raw: any): BrowserInput | null {
  if (!raw || typeof raw !== "object") return null;
  const x = num(raw.x), y = num(raw.y), modifiers = intIn(raw.modifiers, 0, 15, 0);
  if (raw.kind === "mouse") {
    if (!["move", "down", "up"].includes(raw.type) || x === undefined || y === undefined) return null;
    const button = ["left", "middle", "right", "none"].includes(raw.button) ? raw.button : undefined;
    return { kind: "mouse", type: raw.type, x, y, ...(button ? { button } : {}), ...(num(raw.buttons) !== undefined ? { buttons: intIn(raw.buttons, 0, 31, 0) } : {}), ...(num(raw.clickCount) !== undefined ? { clickCount: intIn(raw.clickCount, 1, 3, 1) } : {}), modifiers };
  }
  if (raw.kind === "wheel") {
    if (x === undefined || y === undefined) return null;
    return { kind: "wheel", x, y, dx: num(raw.dx) ?? 0, dy: num(raw.dy) ?? 0, modifiers };
  }
  if (raw.kind === "key") {
    if (!["down", "up"].includes(raw.type) || typeof raw.key !== "string" || !raw.key || raw.key.length > 32) return null;
    return { kind: "key", type: raw.type, key: raw.key, ...(typeof raw.code === "string" && raw.code.length <= 32 ? { code: raw.code } : {}), modifiers };
  }
  if (raw.kind === "text") {
    if (typeof raw.text !== "string" || !raw.text) return null;
    return { kind: "text", text: raw.text.slice(0, 10000) };
  }
  return null;
}

export type BrowserClientOp =
  | { op: "open"; runnerId: string; reqId: string; profile: BrowserProfileName }
  | { op: "detach"; runnerId: string }
  | { op: "tab"; runnerId: string; reqId?: string; tab: "new" | "close" | "activate"; pageId?: string; url?: string; profile: BrowserProfileName }
  | { op: "nav"; runnerId: string; pageId: string; url?: string; action?: "back" | "forward" | "reload" | "stop" }
  | { op: "input"; runnerId: string; pageId: string; input: BrowserInput }
  | { op: "view"; runnerId: string; pageId: string; on: boolean; dims: BrowserViewDims }
  | { op: "fack"; runnerId: string; pageId: string }
  | { op: "viewport"; runnerId: string; pageId: string; width?: number; height?: number; mobile?: boolean; scale?: number }
  | { op: "dialog"; runnerId: string; pageId: string; accept: boolean; promptText?: string }
  | { op: "shutdown"; runnerId: string; profile: BrowserProfileName }
  /** F2 — o dono liga/desliga o nível 3 (IA dirigindo o perfil dele) para UMA sessão */
  | { op: "agent_grant"; runnerId: string; sessionId: string; on: boolean }
  /** F2 — "Assumir": revoga todas as liberações do nível 3 da máquina */
  | { op: "agent_revoke"; runnerId: string }
  /** F2 — seleção de pontos: elemento sob (x,y) da aba */
  | { op: "grab"; runnerId: string; reqId: string; pageId: string; x: number; y: number };

/** Mensagem `browser_*` do cliente → operação validada. `error` = recusa com motivo. */
export function parseBrowserClientMessage(msg: any, defaultRunnerId: string): BrowserClientOp | { error: string } {
  const t = String(msg?.t || "");
  const runnerId = typeof msg?.runnerId === "string" && msg.runnerId ? msg.runnerId : defaultRunnerId;
  const pageId = typeof msg?.pageId === "string" && PAGE_ID.test(msg.pageId) ? msg.pageId : undefined;
  const needPage = (): string | { error: string } => pageId || { error: "aba inválida" };
  // Perfil ausente = o do dono (cliente da F1); o do agente só quando pedido explicitamente.
  const profile: BrowserProfileName = msg?.profile === "agent" ? "agent" : "owner";
  switch (t) {
    case "browser_open": return { op: "open", runnerId, profile, reqId: typeof msg.reqId === "string" && msg.reqId.length <= 80 ? msg.reqId : "brw-" + Math.random().toString(36).slice(2) };
    case "browser_detach": return { op: "detach", runnerId };
    case "browser_shutdown": return { op: "shutdown", runnerId, profile };
    case "browser_agent_grant": {
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId.trim() : "";
      if (!sessionId || sessionId.length > 200) return { error: "sessão inválida" };
      return { op: "agent_grant", runnerId, sessionId, on: msg.on === true };
    }
    case "browser_agent_revoke": return { op: "agent_revoke", runnerId };
    case "browser_grab": {
      const p = needPage(); if (typeof p !== "string") return p;
      const x = num(msg.x), y = num(msg.y);
      if (x === undefined || y === undefined || x < 0 || y < 0 || x > 20000 || y > 20000) return { error: "ponto inválido" };
      return { op: "grab", runnerId, pageId: p, x, y, reqId: typeof msg.reqId === "string" && msg.reqId && msg.reqId.length <= 80 ? msg.reqId : "grab-" + Math.random().toString(36).slice(2) };
    }
    case "browser_tab": {
      if (!["new", "close", "activate"].includes(msg.op)) return { error: "operação de aba inválida" };
      if (msg.op !== "new" && !pageId) return { error: "aba inválida" };
      return { op: "tab", runnerId, tab: msg.op, profile, ...(typeof msg.reqId === "string" ? { reqId: msg.reqId.slice(0, 80) } : {}), ...(pageId ? { pageId } : {}), ...(typeof msg.url === "string" && msg.url ? { url: msg.url.slice(0, 4096) } : {}) };
    }
    case "browser_nav": {
      const p = needPage(); if (typeof p !== "string") return p;
      if (typeof msg.url === "string" && msg.url.trim()) return { op: "nav", runnerId, pageId: p, url: msg.url.slice(0, 4096) };
      if (["back", "forward", "reload", "stop"].includes(msg.action)) return { op: "nav", runnerId, pageId: p, action: msg.action };
      return { error: "navegação inválida" };
    }
    case "browser_input": {
      const p = needPage(); if (typeof p !== "string") return p;
      const input = sanitizeBrowserInput(msg.input);
      return input ? { op: "input", runnerId, pageId: p, input } : { error: "input inválido" };
    }
    case "browser_view": {
      const p = needPage(); if (typeof p !== "string") return p;
      return { op: "view", runnerId, pageId: p, on: msg.on !== false, dims: { maxWidth: intIn(msg.maxWidth, 160, 3840, 1280), maxHeight: intIn(msg.maxHeight, 120, 3840, 1280) } };
    }
    case "browser_fack": {
      const p = needPage(); if (typeof p !== "string") return p;
      return { op: "fack", runnerId, pageId: p };
    }
    case "browser_viewport": {
      const p = needPage(); if (typeof p !== "string") return p;
      if (!(num(msg.width)! > 0)) return { op: "viewport", runnerId, pageId: p };
      return { op: "viewport", runnerId, pageId: p, width: intIn(msg.width, 200, 3840, 390), height: intIn(msg.height, 200, 3840, 800), mobile: msg.mobile === true, scale: Math.max(1, Math.min(3, num(msg.scale) ?? 1)) };
    }
    case "browser_dialog": {
      const p = needPage(); if (typeof p !== "string") return p;
      return { op: "dialog", runnerId, pageId: p, accept: msg.accept === true, ...(typeof msg.promptText === "string" ? { promptText: msg.promptText.slice(0, 10000) } : {}) };
    }
    default: return { error: "mensagem de browser desconhecida" };
  }
}
