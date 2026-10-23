/**
 * Túnel da IDE (BRW-IDE-00 F4) — HTTP + WebSocket do code-server de uma máquina REMOTA atravessando a
 * conexão que o runner já mantém com o Hub.
 *
 * Por que um túnel: o runner disca o Hub (NAT, notebook que dorme), então o Hub não alcança o
 * `127.0.0.1` do runner, e o code-server só escuta em loopback (lei §3.2 da spec). O Hub abre
 * "streams" multiplexados nessa conexão; o runner liga cada um ao code-server local e repassa bytes.
 *
 * Frame (mensagem BINÁRIA do WebSocket, mesmo canal dos frames do browser):
 *
 *   off len campo
 *   0   1   kind = 0x54 ('T')   — 0x42 é o browser (F1); o 1º byte separa os dois sem parse
 *   1   1   versão = 1
 *   2   1   op: 1 OPEN · 2 DATA · 3 END · 4 RESET · 5 WINDOW · 6 RESPONSE
 *   3   1   reservado (0)
 *   4   4   streamId (u32 BE) — só o Hub (quem abre) cunha ids
 *   8   …   payload:
 *             OPEN     JSON {mode:"http"|"upgrade", method, path, headers:[k,v,…], win}
 *             DATA     bytes crus
 *             END      vazio (meia-volta: este lado não manda mais nada)
 *             RESET    motivo UTF-8 (opcional) — derruba o stream nos dois lados
 *             WINDOW   u32 BE: crédito NOVO de bytes que o outro lado pode mandar
 *             RESPONSE JSON {status, statusMessage?, headers:[k,v,…]} (só modo http, runner → Hub)
 *
 * Controle de fluxo por CRÉDITO (como HTTP/2): quem recebe concede; quem manda nunca passa do que foi
 * concedido. O Hub concede `win` no OPEN; o runner concede a dele num WINDOW logo depois de aceitar.
 * O crédito só volta quando os bytes foram CONSUMIDOS (o destino — o socket do navegador ou o do
 * code-server — aceitou a escrita), então um navegador lento segura só o próprio stream, e a memória
 * em trânsito fica limitada a `janela × streams`. Além disso, quem manda para de mandar DATA quando o
 * próprio link acumula (`bufferedAmount`), para um stream pesado não enterrar os outros nem o resto do
 * tráfego do runner (turnos, terminal, browser). Frames de controle sempre passam.
 *
 * O Hub só lê o cabeçalho de 8 bytes e, uma vez por requisição, o JSON pequeno do RESPONSE — corpo e
 * bytes de WebSocket nunca são interpretados (lei §3.5 e incidentes INC-01..03: nada pesado no loop).
 */
import { Duplex } from "node:stream";
import { request as httpRequest, type Agent, type IncomingMessage } from "node:http";
import { connect as netConnect, type Socket } from "node:net";

export const IDE_TUNNEL_KIND = 0x54; // 'T'
export const IDE_TUNNEL_VERSION = 1;
export const TunnelOp = { OPEN: 1, DATA: 2, END: 3, RESET: 4, WINDOW: 5, RESPONSE: 6 } as const;
export type TunnelOpCode = typeof TunnelOp[keyof typeof TunnelOp];
export const TUNNEL_HEADER_BYTES = 8;
/** Teto do JSON de OPEN/RESPONSE (o Node já limita cabeçalhos HTTP a 16 KB). */
export const TUNNEL_MAX_HEAD_BYTES = 64 * 1024;

export interface TunnelOpenHead {
  mode: "http" | "upgrade";
  method: string;
  /** caminho JÁ sem o prefixo `/ide/<runnerId>` (o que o code-server vê) */
  path: string;
  /** cabeçalhos crus `[nome, valor, nome, valor…]` — preserva duplicatas e o `Host` original */
  headers: string[];
}
export interface TunnelResponseHead { status: number; statusMessage?: string; headers: string[] }

// ================================================================================ codec (puro)

export function encodeTunnelFrame(op: TunnelOpCode, streamId: number, payload?: Buffer | null): Buffer {
  const len = payload ? payload.length : 0;
  const buf = Buffer.allocUnsafe(TUNNEL_HEADER_BYTES + len);
  buf[0] = IDE_TUNNEL_KIND; buf[1] = IDE_TUNNEL_VERSION; buf[2] = op; buf[3] = 0;
  buf.writeUInt32BE(streamId >>> 0, 4);
  if (payload && len) payload.copy(buf, TUNNEL_HEADER_BYTES);
  return buf;
}

/** null = não é frame do túnel (ou versão desconhecida). O payload é uma VISTA do buffer (sem cópia). */
export function decodeTunnelFrame(buf: Buffer): { op: TunnelOpCode; streamId: number; payload: Buffer } | null {
  if (!Buffer.isBuffer(buf) || buf.length < TUNNEL_HEADER_BYTES || buf[0] !== IDE_TUNNEL_KIND || buf[1] !== IDE_TUNNEL_VERSION) return null;
  const op = buf[2] as TunnelOpCode;
  if (op < TunnelOp.OPEN || op > TunnelOp.RESPONSE) return null;
  return { op, streamId: buf.readUInt32BE(4), payload: buf.subarray(TUNNEL_HEADER_BYTES) };
}

export function isTunnelFrame(buf: Buffer): boolean { return Buffer.isBuffer(buf) && buf.length >= TUNNEL_HEADER_BYTES && buf[0] === IDE_TUNNEL_KIND; }

const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const hasCtl = (s: string) => /[\r\n\0]/.test(s);

/** Valida o cabeçalho de abertura que chegou pela rede (o runner não confia cegamente no Hub). */
export function parseOpenHead(payload: Buffer): (TunnelOpenHead & { win: number }) | { error: string } {
  if (payload.length > TUNNEL_MAX_HEAD_BYTES) return { error: "cabeçalho grande demais" };
  let o: any; try { o = JSON.parse(payload.toString("utf8")); } catch { return { error: "OPEN inválido" }; }
  if (!o || (o.mode !== "http" && o.mode !== "upgrade")) return { error: "modo inválido" };
  if (typeof o.method !== "string" || !TOKEN_RE.test(o.method) || o.method.length > 16) return { error: "método inválido" };
  if (typeof o.path !== "string" || !o.path.startsWith("/") || o.path.length > 16 * 1024 || hasCtl(o.path) || /\s/.test(o.path)) return { error: "caminho inválido" };
  if (!Array.isArray(o.headers) || o.headers.length % 2 !== 0 || o.headers.length > 400) return { error: "cabeçalhos inválidos" };
  for (let i = 0; i < o.headers.length; i++) {
    const v = o.headers[i];
    if (typeof v !== "string" || hasCtl(v) || (i % 2 === 0 && !TOKEN_RE.test(v))) return { error: "cabeçalho inválido" };
  }
  const win = Number.isFinite(o.win) ? Math.max(0, Math.min(Math.floor(o.win), 64 * 1024 * 1024)) : 0;
  return { mode: o.mode, method: o.method, path: o.path, headers: o.headers, win };
}

export function parseResponseHead(payload: Buffer): TunnelResponseHead | null {
  if (payload.length > TUNNEL_MAX_HEAD_BYTES) return null;
  let o: any; try { o = JSON.parse(payload.toString("utf8")); } catch { return null; }
  if (!o || !Number.isInteger(o.status) || o.status < 100 || o.status > 599) return null;
  if (!Array.isArray(o.headers) || o.headers.length % 2 !== 0 || o.headers.some((v: unknown, i: number) => typeof v !== "string" || hasCtl(v) || (i % 2 === 0 && !TOKEN_RE.test(v)))) return null;
  return { status: o.status, statusMessage: typeof o.statusMessage === "string" && !hasCtl(o.statusMessage) ? o.statusMessage.slice(0, 200) : undefined, headers: o.headers };
}

/** Linha de requisição + cabeçalhos para escrever cru num socket (upgrade de WebSocket). */
export function serializeRequestHead(head: Pick<TunnelOpenHead, "method" | "path" | "headers">): Buffer {
  let s = `${head.method} ${head.path} HTTP/1.1\r\n`;
  for (let i = 0; i + 1 < head.headers.length; i += 2) s += `${head.headers[i]}: ${head.headers[i + 1]}\r\n`;
  return Buffer.from(s + "\r\n", "latin1");
}

// ============================================================================ multiplexador

export interface TunnelMuxOptions {
  /** "opener" = Hub (abre streams); "acceptor" = runner (recebe OPEN e liga ao code-server) */
  role: "opener" | "acceptor";
  /** escreve um frame no link; `compress` = vale a pena deflate (texto) */
  send: (frame: Buffer, compress: boolean) => void;
  /** bytes parados no link agora (ws.bufferedAmount); DATA espera enquanto passar de `maxBacklog` */
  backlog?: () => number;
  maxBacklog?: number;
  /** crédito por stream, em bytes (padrão 512 KiB) */
  window?: number;
  /** maior DATA (padrão 64 KiB) — streams intercalam no link em pedaços deste tamanho */
  chunk?: number;
  /** streams simultâneos (padrão 128) */
  maxStreams?: number;
  /** acceptor: chegou um stream novo (já validado) */
  onStream?: (stream: TunnelStream) => void;
  /** opener: sem RESPONSE (http) / sem nenhum byte (upgrade) nesse tempo → RESET (padrão 60 s) */
  headTimeoutMs?: number;
  /** stream http sem tráfego nesse tempo → RESET (padrão 5 min). WebSocket não tem: o VS Code tem o próprio keepalive. */
  idleMs?: number;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export interface TunnelStats { streams: number; opened: number; resets: number; bytesIn: number; bytesOut: number; blockedMs: number }

export class TunnelMux {
  readonly role: "opener" | "acceptor";
  private readonly streams = new Map<number, TunnelStream>();
  private nextId = 1;
  private closed = false;
  private readonly blocked = new Set<TunnelStream>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private blockedSince = 0;
  readonly window: number;
  readonly chunk: number;
  readonly maxStreams: number;
  readonly maxBacklog: number;
  readonly headTimeoutMs: number;
  readonly idleMs: number;
  private readonly counters = { opened: 0, resets: 0, bytesIn: 0, bytesOut: 0, blockedMs: 0 };

  constructor(private readonly o: TunnelMuxOptions) {
    this.role = o.role;
    this.window = Math.max(1024, Math.floor(o.window ?? 512 * 1024));
    this.chunk = Math.max(256, Math.min(this.window, Math.floor(o.chunk ?? 64 * 1024)));
    this.maxStreams = Math.max(1, Math.floor(o.maxStreams ?? 128));
    this.maxBacklog = Math.max(64 * 1024, Math.floor(o.maxBacklog ?? 4 * 1024 * 1024));
    this.headTimeoutMs = Math.max(100, o.headTimeoutMs ?? 60_000);
    this.idleMs = Math.max(100, o.idleMs ?? 5 * 60_000);
  }

  get size(): number { return this.streams.size; }
  get isClosed(): boolean { return this.closed; }

  stats(reset = false): TunnelStats {
    const out = { streams: this.streams.size, ...this.counters, blockedMs: this.counters.blockedMs + (this.blockedSince ? Date.now() - this.blockedSince : 0) };
    if (reset) { this.counters.opened = 0; this.counters.resets = 0; this.counters.bytesIn = 0; this.counters.bytesOut = 0; this.counters.blockedMs = 0; if (this.blockedSince) this.blockedSince = Date.now(); }
    return out;
  }

  /** Opener: abre um stream. null = teto de streams (o chamador responde 503). */
  open(head: TunnelOpenHead): TunnelStream | null {
    if (this.role !== "opener") throw new Error("só o opener abre streams");
    if (this.closed || this.streams.size >= this.maxStreams) return null;
    let id = this.nextId;
    for (let guard = 0; this.streams.has(id) || id === 0; guard++) { id = (id + 1) >>> 0; if (guard > this.maxStreams + 2) return null; }
    this.nextId = (id + 1) >>> 0 || 1;
    const s = new TunnelStream(this, id, head, 0);
    this.streams.set(id, s);
    this.counters.opened++;
    this.armSweep();
    this.sendFrame(encodeTunnelFrame(TunnelOp.OPEN, id, Buffer.from(JSON.stringify({ ...head, win: this.window }), "utf8")), false);
    return s;
  }

  /** Um frame binário chegou do link. Nunca lança (frame ruim vira RESET ou é ignorado). */
  onFrame(buf: Buffer): void {
    const f = decodeTunnelFrame(buf);
    if (!f || this.closed) return;
    const s = this.streams.get(f.streamId);
    switch (f.op) {
      case TunnelOp.OPEN: {
        if (this.role !== "acceptor") return;
        if (s) { this.sendReset(f.streamId, "id em uso"); return; }
        if (this.streams.size >= this.maxStreams) { this.sendReset(f.streamId, "limite de streams"); return; }
        const head = parseOpenHead(f.payload);
        if ("error" in head) { this.sendReset(f.streamId, head.error); return; }
        const { win, ...openHead } = head;
        const st = new TunnelStream(this, f.streamId, openHead, win);
        this.streams.set(f.streamId, st);
        this.counters.opened++;
        this.armSweep();
        // a NOSSA janela de recepção: só agora o Hub pode mandar corpo/bytes do WebSocket
        st.grant(this.window);
        try { this.o.onStream?.(st); } catch (e) { st.destroy(e as Error); }
        return;
      }
      case TunnelOp.DATA: if (s) { this.counters.bytesIn += f.payload.length; s._onData(f.payload); } return;
      case TunnelOp.END: if (s) s._onEnd(); return;
      case TunnelOp.RESET: if (s) s._onReset(f.payload.toString("utf8").slice(0, 300)); return;
      case TunnelOp.WINDOW: if (s && f.payload.length >= 4) s._onWindow(f.payload.readUInt32BE(0)); return;
      case TunnelOp.RESPONSE: {
        if (!s || this.role !== "opener") return;
        const head = parseResponseHead(f.payload);
        if (!head) { s.destroy(new Error("RESPONSE inválido")); return; }
        s._onResponse(head);
        return;
      }
    }
  }

  /** O link caiu (ou o Hub/runner está encerrando): derruba tudo sem tentar avisar o outro lado. */
  destroyAll(reason: string): void {
    this.closed = true;
    for (const s of [...this.streams.values()]) s._linkGone(reason);
    this.streams.clear();
    this.blocked.clear();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
  }

  // ------------------------------------------------------------------ uso interno dos streams
  /** @internal */ sendFrame(frame: Buffer, compress: boolean): void {
    if (this.closed) return;
    try { this.o.send(frame, compress); } catch (e) { this.log("ide_tunnel_send_error", { error: String((e as Error)?.message ?? e) }); }
  }
  /** @internal */ sendData(id: number, chunk: Buffer, compress: boolean): void { this.counters.bytesOut += chunk.length; this.sendFrame(encodeTunnelFrame(TunnelOp.DATA, id, chunk), compress); }
  /** @internal */ sendReset(id: number, reason: string): void { this.counters.resets++; this.sendFrame(encodeTunnelFrame(TunnelOp.RESET, id, Buffer.from(reason.slice(0, 300), "utf8")), false); }
  /** @internal */ linkBlocked(): boolean {
    const b = this.o.backlog ? this.o.backlog() : 0;
    const blocked = b > this.maxBacklog;
    if (blocked && !this.blockedSince) this.blockedSince = Date.now();
    else if (!blocked && this.blockedSince) { this.counters.blockedMs += Date.now() - this.blockedSince; this.blockedSince = 0; }
    return blocked;
  }
  /** @internal o link está cheio: tenta de novo daqui a pouco (um timer para o mux inteiro). */
  waitLink(s: TunnelStream): void {
    this.blocked.add(s);
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const list = [...this.blocked]; this.blocked.clear();
      for (const st of list) st._pump();
    }, 15);
    this.retryTimer.unref?.();
  }
  /** @internal */ remove(s: TunnelStream): void {
    if (this.streams.get(s.id) === s) this.streams.delete(s.id);
    this.blocked.delete(s);
    if (!this.streams.size && this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
  }
  /** @internal */ log(event: string, data?: Record<string, unknown>): void { try { this.o.log?.(event, data); } catch { /* log não derruba */ } }

  private armSweep(): void {
    if (this.sweepTimer) return;
    const every = Math.max(50, Math.min(5000, Math.floor(Math.min(this.headTimeoutMs, this.idleMs) / 4)));
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const s of [...this.streams.values()]) s._sweep(now);
    }, every);
    this.sweepTimer.unref?.();
  }
}

/**
 * Um stream do túnel como `Duplex` do Node: `pipe()` resolve a contrapressão dos dois lados — escrever
 * espera crédito (o callback do `_write` só volta quando o pedaço saiu), e o crédito de volta só é
 * concedido quando quem lê consumiu.
 *
 * Eventos extras: `response` (opener, modo http) com o `TunnelResponseHead`.
 */
export class TunnelStream extends Duplex {
  /** deflate no link para os DATA deste lado (texto comprime; JPEG/wasm/binário não) */
  compress = false;
  readonly openedAt = Date.now();
  lastActivity = Date.now();
  response: TunnelResponseHead | null = null;
  private sendCredit: number;
  private recvAllowed = 0;     // crédito que concedemos e ainda não foi usado
  private delivered = 0;       // bytes empurrados para o lado de leitura
  private acked = 0;           // bytes já devolvidos como crédito
  private gotFirstByte = false;
  private ackScheduled = false;
  private endSent = false;
  private endReceived = false;
  private resetReceived = false;
  private linkDead = false;
  private readonly outQ: Array<{ buf: Buffer; off: number; cb: (err?: Error | null) => void }> = [];
  private pendingFinal: ((err?: Error | null) => void) | null = null;

  constructor(private readonly mux: TunnelMux, readonly id: number, readonly head: TunnelOpenHead, initialSendCredit: number) {
    // HWM = janela: o buffer de leitura nunca passa do crédito concedido.
    super({ allowHalfOpen: true, readableHighWaterMark: mux.window, writableHighWaterMark: mux.chunk });
    this.sendCredit = initialSendCredit;
    if (mux.role === "opener") this.recvAllowed = mux.window;
    // Stream interno: o erro chega a quem usa por `close`/`error` do pipe; sem ouvinte, um 'error'
    // derrubaria o processo (no Hub, o Hub inteiro).
    this.on("error", () => { /* tratado por quem usa */ });
  }

  /** Acceptor (modo http): manda status + cabeçalhos da resposta do code-server. */
  respond(head: TunnelResponseHead): void {
    if (this.mux.role !== "acceptor" || this.destroyed) return;
    this.mux.sendFrame(encodeTunnelFrame(TunnelOp.RESPONSE, this.id, Buffer.from(JSON.stringify(head), "utf8")), false);
  }

  /** @internal concede crédito de recepção ao outro lado. */
  grant(n: number): void {
    if (n <= 0 || this.destroyed) return;
    this.recvAllowed += n;
    const b = Buffer.allocUnsafe(4); b.writeUInt32BE(n >>> 0, 0);
    this.mux.sendFrame(encodeTunnelFrame(TunnelOp.WINDOW, this.id, b), false);
  }

  // ------------------------------------------------------------------ recepção
  /** @internal */ _onData(chunk: Buffer): void {
    if (this.destroyed || this.endReceived) return;
    if (chunk.length > this.recvAllowed) { this.destroy(new Error("o outro lado passou da janela")); return; }
    this.recvAllowed -= chunk.length;
    this.lastActivity = Date.now();
    this.gotFirstByte = true;
    if (!chunk.length) return;
    this.delivered += chunk.length;
    this.push(chunk);
    this.maybeAck();
  }
  /** @internal */ _onEnd(): void {
    if (this.endReceived || this.destroyed) return;
    this.endReceived = true;
    this.gotFirstByte = true;
    this.push(null);
  }
  /** @internal */ _onReset(reason: string): void {
    this.resetReceived = true;
    if (!this.destroyed) this.destroy(new Error(reason ? `túnel: ${reason}` : "túnel: stream encerrado pelo outro lado"));
  }
  /** @internal */ _onWindow(n: number): void {
    if (this.destroyed) return;
    this.sendCredit += n;
    this._pump();
  }
  /** @internal */ _onResponse(head: TunnelResponseHead): void {
    if (this.response || this.destroyed) return;
    this.response = head;
    this.gotFirstByte = true;
    this.lastActivity = Date.now();
    this.emit("response", head);
  }
  /** @internal */ _linkGone(reason: string): void {
    this.linkDead = true;
    if (!this.destroyed) this.destroy(new Error(`túnel caiu: ${reason}`));
  }
  /** @internal */ _sweep(now: number): void {
    if (this.destroyed) return;
    if (this.mux.role === "opener" && !this.gotFirstByte && now - this.openedAt > this.mux.headTimeoutMs) { this.destroy(new Error("a máquina não respondeu a tempo")); return; }
    if (this.head.mode === "http" && now - this.lastActivity > this.mux.idleMs) this.destroy(new Error("stream ocioso"));
  }

  /**
   * Devolve crédito do que já foi CONSUMIDO (saiu do buffer de leitura). Em lote: só quando o lote
   * passa de ¼ da janela OU o outro lado está ficando sem crédito (< ½ janela). Sem deadlock: se o
   * outro lado ainda tem ½ janela, ele consegue mandar, e cada `push` volta a chamar `_read` (que
   * reavalia aqui); se tem menos, devolvemos tudo o que foi consumido.
   */
  private maybeAck(): void {
    if (this.destroyed || this.endReceived) return;
    const pending = this.delivered - this.readableLength - this.acked;
    if (pending <= 0) return;
    if (pending >= Math.max(1, this.mux.window >> 2) || this.recvAllowed < this.mux.window / 2) { this.acked += pending; this.grant(pending); }
  }

  /**
   * O Node chama `_read` ANTES de tirar do buffer o que está sendo lido (e não chama de novo até o
   * próximo `push`). Reavaliar na hora não veria o consumo — e com o crédito todo usado o outro lado
   * pararia para sempre. Por isso a conta fica para o fim do laço de leitura (nextTick).
   */
  override _read(): void {
    if (this.ackScheduled) return;
    this.ackScheduled = true;
    process.nextTick(() => { this.ackScheduled = false; this.maybeAck(); });
  }

  // ------------------------------------------------------------------ envio
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk as any);
    this.outQ.push({ buf: chunk, off: 0, cb });
    this._pump();
  }

  override _final(cb: (err?: Error | null) => void): void {
    if (this.outQ.length) { this.pendingFinal = cb; return; }
    this.sendEnd(); cb();
  }

  private sendEnd(): void {
    if (this.endSent || this.destroyed) return;
    this.endSent = true;
    this.mux.sendFrame(encodeTunnelFrame(TunnelOp.END, this.id), false);
  }

  /** @internal manda o que der: limitado pelo crédito do outro lado e pelo link. */
  _pump(): void {
    while (this.outQ.length && !this.destroyed) {
      if (this.sendCredit <= 0) return; // espera WINDOW
      if (this.mux.linkBlocked()) { this.mux.waitLink(this); return; }
      const head = this.outQ[0];
      const n = Math.min(head.buf.length - head.off, this.sendCredit, this.mux.chunk);
      this.mux.sendData(this.id, head.buf.subarray(head.off, head.off + n), this.compress);
      this.sendCredit -= n;
      head.off += n;
      this.lastActivity = Date.now();
      if (head.off >= head.buf.length) { this.outQ.shift(); head.cb(); }
    }
    if (!this.outQ.length && this.pendingFinal) { const cb = this.pendingFinal; this.pendingFinal = null; this.sendEnd(); cb(); }
  }

  override _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
    // Fim limpo (END nos dois sentidos) não precisa de RESET; qualquer outro fim avisa o outro lado.
    if (!this.linkDead && !this.resetReceived && !(this.endSent && this.endReceived)) this.mux.sendReset(this.id, err ? String(err.message || err).slice(0, 200) : "cancelado");
    this.outQ.length = 0;
    this.pendingFinal = null;
    this.mux.remove(this);
    cb(err);
  }
}

// ======================================================= acceptor: ligar ao code-server local

/** Cabeçalhos `content-type` que valem deflate no link (corpo de texto sem codificação própria). */
export function compressibleResponse(headers: Record<string, string | string[] | undefined>): boolean {
  if (headers["content-encoding"]) return false;
  const ct = String(headers["content-type"] || "").toLowerCase();
  return /^(text\/|application\/(javascript|x-javascript|json|xml|manifest\+json)|image\/svg\+xml)/.test(ct);
}

export interface BridgeOptions {
  host?: string;
  /** agente keep-alive para o code-server (evita um handshake TCP por arquivo estático) */
  agent?: Agent;
}

/**
 * Liga um stream aceito ao servidor local (code-server em 127.0.0.1:`port`). Modo http: refaz a
 * requisição (o `Host` original vai junto — o code-server compara Origin com Host) e devolve
 * status/cabeçalhos por RESPONSE e o corpo por DATA. Modo upgrade: TCP cru, escreve a linha de
 * requisição e depois só repassa bytes nos dois sentidos (inclusive a resposta 101).
 */
export function bridgeTunnelStream(stream: TunnelStream, port: number, opts: BridgeOptions = {}): void {
  const host = opts.host || "127.0.0.1";
  const head = stream.head;
  if (head.mode === "http") {
    let up: ReturnType<typeof httpRequest>;
    try {
      up = httpRequest({ host, port, method: head.method, path: head.path, headers: head.headers as any, setHost: false, agent: opts.agent });
    } catch (e) { stream.destroy(e as Error); return; }
    up.on("response", (r: IncomingMessage) => {
      stream.compress = compressibleResponse(r.headers);
      stream.respond({ status: r.statusCode || 502, statusMessage: r.statusMessage, headers: r.rawHeaders });
      r.on("error", (e) => stream.destroy(e));
      r.on("aborted", () => stream.destroy(new Error("resposta abortada pelo servidor local")));
      r.pipe(stream);
    });
    up.on("error", (e) => stream.destroy(e));
    stream.on("close", () => { if (!up.destroyed) up.destroy(); });
    stream.pipe(up);
    return;
  }
  const sock: Socket = netConnect(port, host);
  sock.setNoDelay(true);
  sock.once("connect", () => {
    sock.write(serializeRequestHead(head));
    stream.pipe(sock);
    sock.pipe(stream);
  });
  sock.on("error", (e) => stream.destroy(e));
  // O code-server fechou: se foi um fim limpo (o END já saiu pelo pipe), espera o END do outro lado
  // por um tempo curto — destruir na hora mandaria RESET e o Hub poderia descartar o quadro de
  // fechamento do WebSocket que ainda está a caminho do navegador.
  sock.on("close", () => {
    if (stream.destroyed) return;
    if (!stream.writableEnded) { stream.destroy(new Error("o servidor local fechou a conexão")); return; }
    setTimeout(() => { if (!stream.destroyed) stream.destroy(); }, 10_000).unref?.();
  });
  stream.on("close", () => { if (!sock.destroyed) sock.destroy(); });
}
