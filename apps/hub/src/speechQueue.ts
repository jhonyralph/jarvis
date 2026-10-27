/**
 * Fila única de fala (VOZ-01 F1, RN-O1…RN-O13).
 *
 * Antes cada aparelho tocava o que chegava, na hora: duas sessões respondendo juntas falavam uma por
 * cima da outra, e o "Hey Jarvis" do PC tocava em paralelo ao app. Aqui o Hub decide UMA fala por vez,
 * para o conjunto de aparelhos do dono.
 *
 * Puro de propósito: sem timers, sem rede, relógio injetado. Quem usa chama os eventos (`enqueue`,
 * `played`, `windowClosed`, …), executa os comandos devolvidos e chama `tick(now)` em `nextDeadline()`.
 * Assim cada regra da spec vira teste sem aparelho (speechQueue.test.ts).
 *
 * Modelo:
 *  - cada sessão tem a sua FAIXA; na vez de uma sessão, a faixa inteira toca — falas que chegam para
 *    ela enquanto fala entram na mesma faixa, logo depois da atual (RN-O2, RN-O4);
 *  - faixa vazia → abre a JANELA DE RESPOSTA daquela sessão no aparelho (RN-O3). A fila só passa para
 *    outra sessão quando a janela fecha sem fala, ou com "próxima";
 *  - o dono falou com a sessão → ela fica "aguardando a resposta" por um tempo curto, para a resposta
 *    (ou o ack) dela tocar antes de outra sessão;
 *  - "espere um pouco" segura a sessão em degraus (RN-O10…RN-O12); "encerrar" esvazia tudo (RN-O13).
 */

/** Prioridade entre sessões (RN-O5): maior primeiro; empate pela chegada. */
export type SpeechKind = "ask" | "reply" | "done" | "important" | "progress";
const PRIORITY: Record<SpeechKind, number> = { ask: 4, reply: 3, done: 3, important: 2, progress: 1 };

export interface SpeechItem {
  id: string;
  session: string;
  kind: SpeechKind;
  /** Trechos da mesma resposta compartilham `rid`; `more` = ainda vem trecho depois deste. */
  rid?: string;
  more?: boolean;
  /** Carga opaca para quem toca (áudio, texto, runnerId…). A fila não olha dentro. */
  payload?: unknown;
  /** Progresso que fica velho: depois disso não toca mais (RN-O6). */
  expiresAt?: number;
  /** Duração do áudio: aparelho que não avisa "terminei" (app antigo, listener do PC) não prende a fila. */
  durationMs?: number;
  /** Fechamento ("obrigado"): depois dele a sessão não abre janela de resposta (RN-E4 da VOZ-00). */
  closing?: boolean;
}

export type SpeechCommand =
  | { type: "play"; item: SpeechItem }
  /** Abrir o microfone do aparelho para responder a esta sessão. */
  | { type: "window"; session: string }
  /** Parar o que estiver tocando (barge-in, "próxima", encerrar). */
  | { type: "stop"; session?: string }
  /** Perguntar "posso trazer atualizações de outras sessões enquanto isso?" (RN-O11). */
  | { type: "ask_bring_others"; session: string; minutes: number }
  /** A espera acabou: perguntar se o dono conseguiu pensar (RN-O10). A vez fica segura para a sessão. */
  | { type: "checkin"; session: string }
  /** "Conseguiu pensar?" sem resposta duas vezes: a sessão fica só em texto (RN-O12). */
  | { type: "parked"; session: string }
  /** Algo foi descartado — só para log. */
  | { type: "dropped"; ids: string[]; reason: "off" | "expired" | "superseded" | "barge_in" | "skipped" };

export interface SpeechQueueOptions {
  /** Degraus do "espere um pouco", em minutos (padrão 2 → 5 → 10). */
  waitSteps?: number[];
  /** O dono falou com a sessão: quanto esperar a resposta (ou o ack) dela começar a tocar. */
  replyGraceMs?: number;
  /** Trecho com `more` cujo seguinte nunca chega não prende a fila. */
  moreStaleMs?: number;
  /** Teto da janela (e de perguntas sem resposta) se o aparelho nunca avisar que fechou. */
  windowMaxMs?: number;
  /** Folga depois da duração do áudio antes de dar a fala por terminada sem aviso do aparelho. */
  playSlackMs?: number;
}

export type SpeechMode = "idle" | "playing" | "window" | "engaged" | "held" | "off";

interface Lane { session: string; items: SpeechItem[]; seq: number }
interface Wait {
  /** Fim da espera; 0 = a pergunta "conseguiu pensar?" já foi pedida. */
  until: number;
  step: number;
  /** Resposta a "traga as outras": null = ainda não respondeu. */
  bring: boolean | null;
  /** Quantas vezes o "conseguiu pensar?" ficou sem resposta. */
  misses: number;
}

export class SpeechQueue {
  readonly opts: Required<SpeechQueueOptions>;
  private lanes = new Map<string, Lane>();
  private mode: SpeechMode = "idle";
  /** Sessão que está com a vez (tocando, em janela, aguardando resposta ou segurando a fila). */
  private current: string | null = null;
  private playingId: string | null = null;
  private playingRid: string | undefined;
  /** Último trecho tocado tinha `more`: a vez continua da sessão até o próximo trecho chegar. */
  private awaitingMore = false;
  private lastClosing = false;
  private deadline = 0;
  private waits = new Map<string, Wait>();
  /** Sessões cujo "conseguiu pensar?" ficou sem resposta e voltam a perguntar no fim da fila. */
  private pendingCheckin = new Set<string>();
  private seq = 0;

  constructor(opts: SpeechQueueOptions = {}) {
    this.opts = {
      waitSteps: opts.waitSteps?.length ? opts.waitSteps : [2, 5, 10],
      replyGraceMs: opts.replyGraceMs ?? 12_000,
      moreStaleMs: opts.moreStaleMs ?? 20_000,
      windowMaxMs: opts.windowMaxMs ?? 90_000,
      playSlackMs: opts.playSlackMs ?? 3_000,
    };
  }

  /** Sessão que está com a vez — é para ela que vai o que o dono falar agora (RN-O7). */
  focus(): string | null { return this.mode === "off" || this.mode === "idle" ? null : this.current; }
  isOff(): boolean { return this.mode === "off"; }
  /** A fila perguntou "posso trazer outras sessões?" a esta sessão e ainda não teve resposta. */
  awaitingBring(session: string): boolean { return this.waits.get(session)?.bring === null; }
  state(): { mode: SpeechMode; current: string | null; playing: string | null; pending: number; waiting: string[] } {
    let pending = 0;
    for (const l of this.lanes.values()) pending += l.items.length;
    return { mode: this.mode, current: this.current, playing: this.playingId, pending, waiting: [...this.waits.keys()] };
  }

  enqueue(item: SpeechItem, now: number): SpeechCommand[] {
    if (this.mode === "off") return [{ type: "dropped", ids: [item.id], reason: "off" }];
    const out: SpeechCommand[] = [];
    const lane = this.lane(item.session);
    // "Está em 40%" nunca depois de "terminou": progresso pendente da sessão perde para o novo (RN-O6).
    const old = lane.items.filter((i) => i.kind === "progress");
    if (old.length) {
      lane.items = lane.items.filter((i) => i.kind !== "progress");
      out.push({ type: "dropped", ids: old.map((i) => i.id), reason: "superseded" });
    }
    lane.items.push(item);
    // Fala da sessão que tem a vez e não está tocando nada (aguardando a resposta, em janela, segurando
    // a vez para perguntar, ou esperando o próximo trecho): toca já, sem passar pelo fim da fila.
    // Se ela está tocando, o item fica na faixa e toca logo depois do atual (RN-O4).
    const turnIsFree = this.mode === "engaged" || this.mode === "window" || this.mode === "held" || (this.mode === "playing" && !this.playingId);
    if (item.session === this.current && turnIsFree) return out.concat(this.playNext(now));
    return out.concat(this.pump(now));
  }

  /** O aparelho terminou de tocar `id`. */
  played(id: string, now: number): SpeechCommand[] {
    if (this.mode !== "playing" || id !== this.playingId) return [];
    this.playingId = null;
    return this.playNext(now);
  }

  /** O aparelho fechou a janela de resposta sem o dono falar (quem falou chega por `userSpoke`). */
  windowClosed(session: string, now: number): SpeechCommand[] {
    if (this.mode !== "window" || session !== this.current) return [];
    return this.afterWindow(session, now);
  }

  /** O dono falou com a sessão (na janela, ou por barge-in): espera a resposta dela começar. */
  userSpoke(session: string, now: number): SpeechCommand[] {
    if (this.mode === "off") return [];
    if (this.current && this.current !== session) this.dropEmpty(this.current);
    this.current = session;
    this.mode = "engaged";
    this.playingId = null;
    this.playingRid = undefined;
    this.awaitingMore = false;
    this.deadline = now + this.opts.replyGraceMs;
    // Falou com ela: respondeu ao "conseguiu pensar?" (ou voltou antes do fim da espera).
    this.waits.delete(session);
    this.pendingCheckin.delete(session);
    return [];
  }

  /** "Hey Jarvis" no meio da fala (RN-O7): para a voz; o resto da resposta interrompida não volta (I-3).
   *  Devolve a sessão para onde vai o que o dono disser (null = nenhuma com a vez → a voice). */
  bargeIn(now: number): { session: string | null; commands: SpeechCommand[] } {
    const session = this.focus();
    if (!session) return { session: null, commands: [] };
    const out: SpeechCommand[] = [];
    if (this.mode === "playing") {
      out.push({ type: "stop", session });
      const lane = this.lanes.get(session);
      if (lane && this.playingRid) {
        const cut = lane.items.filter((i) => i.rid === this.playingRid);
        lane.items = lane.items.filter((i) => i.rid !== this.playingRid);
        if (cut.length) out.push({ type: "dropped", ids: cut.map((i) => i.id), reason: "barge_in" });
      }
    }
    this.userSpoke(session, now);
    return { session, commands: out };
  }

  /** "Próxima" / "passe para a próxima": encerra a vez desta sessão. */
  next(now: number): SpeechCommand[] {
    const session = this.focus();
    if (!session) return [];
    const out: SpeechCommand[] = [];
    if (this.mode === "playing") {
      out.push({ type: "stop", session });
      // Pediu para passar no meio da fala: o que já estava na faixa desta sessão não toca agora.
      const lane = this.lanes.get(session);
      if (lane?.items.length) out.push({ type: "dropped", ids: lane.items.map((i) => i.id), reason: "skipped" });
      if (lane) lane.items = [];
    }
    const w = this.waits.get(session);
    if (w && w.bring === null) w.bring = true;
    this.dropEmpty(session);
    this.release();
    return out.concat(this.pump(now));
  }

  /** "Espere um pouco" / "me dá N minutos" (RN-O10). Na 1ª vez devolve a pergunta da RN-O11. */
  wait(session: string, now: number, minutes?: number): SpeechCommand[] {
    if (this.mode === "off") return [];
    const prev = this.waits.get(session);
    const step = prev ? Math.min(prev.step + 1, this.opts.waitSteps.length - 1) : 0;
    const min = minutes && minutes > 0 ? minutes : this.opts.waitSteps[step];
    const w: Wait = { until: now + min * 60_000, step, bring: prev?.bring ?? null, misses: 0 };
    this.waits.set(session, w);
    this.pendingCheckin.delete(session);
    if (this.current && this.current !== session) this.dropEmpty(this.current);
    this.release();
    // Já respondeu se as outras podem tocar: não pergunta de novo.
    if (w.bring !== null) return this.applyBring(session, w, now);
    this.current = session;
    this.mode = "held";
    this.deadline = now + this.opts.windowMaxMs; // sem resposta a "traga as outras" = sim
    return [{ type: "ask_bring_others", session, minutes: min }];
  }

  /** Resposta a "posso trazer atualizações de outras sessões enquanto isso?" (RN-O11). */
  bringOthers(session: string, yes: boolean, now: number): SpeechCommand[] {
    const w = this.waits.get(session);
    if (!w || this.mode === "off") return [];
    w.bring = yes;
    if (this.current === session) { this.dropEmpty(session); this.release(); }
    return this.applyBring(session, w, now);
  }

  /** Encerrar a voz (RN-O13): esvazia tudo e não fala mais até `on()`. */
  off(): SpeechCommand[] {
    const ids: string[] = [];
    for (const l of this.lanes.values()) for (const i of l.items) ids.push(i.id);
    const out: SpeechCommand[] = [{ type: "stop" }];
    if (ids.length) out.push({ type: "dropped", ids, reason: "off" });
    this.lanes.clear();
    this.waits.clear();
    this.pendingCheckin.clear();
    this.release();
    this.mode = "off";
    return out;
  }

  /** Religar a voz: volta ao fluxo normal com o que chegar dali em diante. */
  on(): void {
    if (this.mode === "off") this.mode = "idle";
  }

  /** Próximo instante em que `tick` tem algo a fazer (0 = nada agendado). */
  nextDeadline(): number {
    if (this.mode === "off") return 0;
    let d = this.deadline || Infinity;
    // Espera vencida só dispara com a fila livre (o `pump` cuida dela); com a fila ocupada, um prazo
    // já vencido faria o chamador tiquetaquear sem parar.
    if (this.mode === "idle") for (const w of this.waits.values()) if (w.bring !== null && w.until > 0 && w.until < d) d = w.until;
    for (const l of this.lanes.values()) for (const i of l.items) if (i.expiresAt && i.expiresAt < d) d = i.expiresAt;
    return d === Infinity ? 0 : d;
  }

  tick(now: number): SpeechCommand[] {
    if (this.mode === "off") return [];
    const out: SpeechCommand[] = this.expire(now);
    if (this.deadline && now >= this.deadline) {
      this.deadline = 0;
      const s = this.current;
      if (this.mode === "window" && s) return out.concat(this.afterWindow(s, now));
      // Fala sem aviso de "terminei" passou da duração: segue como se o aparelho tivesse avisado.
      if (this.mode === "playing" && this.playingId) return out.concat(this.played(this.playingId, now));
      if (this.mode === "held" && s) {
        // Sem resposta a "traga as outras" = sim; espera do "não" acabou → o pump pergunta "conseguiu pensar?".
        const w = this.waits.get(s);
        if (w && w.bring === null) w.bring = true;
        // A pergunta "conseguiu pensar?" nunca chegou (síntese falhou): não deixa a espera órfã.
        if (w && w.until === 0) this.waits.delete(s);
      }
      if (s) this.dropEmpty(s);
      this.release();
    }
    return out.concat(this.pump(now));
  }

  // ------------------------------------------------------------------ internos

  private lane(session: string): Lane {
    let l = this.lanes.get(session);
    if (!l) { l = { session, items: [], seq: ++this.seq }; this.lanes.set(session, l); }
    return l;
  }

  private dropEmpty(session: string): void {
    const l = this.lanes.get(session);
    if (l && !l.items.length) this.lanes.delete(session);
  }

  private release(): void {
    this.mode = "idle";
    this.current = null;
    this.playingId = null;
    this.playingRid = undefined;
    this.awaitingMore = false;
    this.lastClosing = false;
    this.deadline = 0;
  }

  private applyBring(session: string, w: Wait, now: number): SpeechCommand[] {
    if (w.bring) {
      // Sim: a sessão em espera vai para o fim e as outras tocam.
      const l = this.lanes.get(session);
      if (l) l.seq = ++this.seq;
      return this.pump(now);
    }
    // Não: a fila fica parada, em silêncio, até a espera acabar.
    this.current = session;
    this.mode = "held";
    this.deadline = w.until;
    return [];
  }

  private expire(now: number): SpeechCommand[] {
    const ids: string[] = [];
    for (const l of this.lanes.values()) {
      const keep = l.items.filter((i) => !i.expiresAt || i.expiresAt > now);
      if (keep.length !== l.items.length) for (const i of l.items) if (!keep.includes(i)) ids.push(i.id);
      l.items = keep;
    }
    for (const s of [...this.lanes.keys()]) if (s !== this.current) this.dropEmpty(s);
    return ids.length ? [{ type: "dropped", ids, reason: "expired" }] : [];
  }

  /** Toca o próximo da faixa da sessão que tem a vez; faixa vazia → janela de resposta. */
  private playNext(now: number): SpeechCommand[] {
    const session = this.current;
    if (!session) { this.release(); return this.pump(now); }
    const item = this.lanes.get(session)?.items.shift();
    if (item) {
      this.mode = "playing";
      this.playingId = item.id;
      this.playingRid = item.rid;
      this.awaitingMore = !!item.more;
      this.lastClosing = !!item.closing;
      this.deadline = item.durationMs ? now + item.durationMs + this.opts.playSlackMs : 0;
      return [{ type: "play", item }];
    }
    this.dropEmpty(session);
    this.playingId = null;
    if (this.awaitingMore) {
      // Trecho seguinte ainda em síntese: a vez continua desta sessão, com teto.
      this.mode = "playing";
      this.deadline = now + this.opts.moreStaleMs;
      return [];
    }
    if (this.lastClosing) {
      // "Obrigado" encerrou a conversa com esta sessão: sem janela, a fila segue.
      this.release();
      return this.pump(now);
    }
    this.mode = "window";
    this.deadline = now + this.opts.windowMaxMs;
    return [{ type: "window", session }];
  }

  private afterWindow(session: string, now: number): SpeechCommand[] {
    const out: SpeechCommand[] = [];
    const w = this.waits.get(session);
    if (w && w.bring === null) w.bring = true; // "traga as outras" ficou sem resposta = sim
    if (w && w.until === 0) {
      // Era o "conseguiu pensar?" e ninguém respondeu (RN-O12): uma vez para o fim da fila, depois texto.
      w.misses++;
      if (w.misses >= 2) { this.waits.delete(session); out.push({ type: "parked", session }); }
      else this.pendingCheckin.add(session);
    }
    this.dropEmpty(session);
    this.release();
    return out.concat(this.pump(now));
  }

  /** Escolhe a próxima sessão (RN-O5) e começa a tocar. */
  private pump(now: number): SpeechCommand[] {
    if (this.mode !== "idle") return [];
    // 1) Espera vencida: a sessão pergunta "conseguiu pensar?" antes de qualquer outra (RN-O10).
    for (const [session, w] of this.waits) {
      if (w.bring !== null && w.until > 0 && now >= w.until) return this.startCheckin(session, w, now);
    }
    // 2) A sessão de maior prioridade; empate pela ordem de chegada. Sessão em espera não toca.
    let best: Lane | null = null;
    let bestPri = -1;
    for (const l of this.lanes.values()) {
      if (!l.items.length) continue;
      const w = this.waits.get(l.session);
      if (w && w.until > now) continue;
      const pri = Math.max(...l.items.map((i) => PRIORITY[i.kind]));
      if (!best || pri > bestPri || (pri === bestPri && l.seq < best.seq)) { best = l; bestPri = pri; }
    }
    if (best) {
      this.current = best.session;
      return this.playNext(now);
    }
    // 3) Fila vazia: repete o "conseguiu pensar?" de quem ficou sem responder (foi para o fim).
    for (const session of this.pendingCheckin) {
      this.pendingCheckin.delete(session);
      const w = this.waits.get(session);
      if (w) return this.startCheckin(session, w, now);
    }
    return [];
  }

  /** Segura a vez para a sessão enquanto o chamador sintetiza e enfileira a pergunta. */
  private startCheckin(session: string, w: Wait, now: number): SpeechCommand[] {
    w.until = 0;
    this.current = session;
    this.mode = "held";
    this.playingId = null;
    this.awaitingMore = false;
    this.deadline = now + this.opts.replyGraceMs;
    return [{ type: "checkin", session }];
  }
}

/** Duração de um WAV em base64 (cabeçalho RIFF); 0 se não der para ler. */
export function wavDurationMs(b64: string): number {
  if (!b64) return 0;
  try {
    const buf = Buffer.from(b64.slice(0, 2_000), "base64");
    if (buf.toString("ascii", 0, 4) !== "RIFF") return 0;
    const byteRate = buf.readUInt32LE(28);
    const at = buf.indexOf("data", 12, "ascii");
    if (!byteRate || at < 0) return 0;
    const total = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
    return Math.round(((total - (at + 8)) / byteRate) * 1000);
  } catch { return 0; }
}
