/**
 * Ponte da fila única de fala (VOZ-01 F1) com aparelhos e síntese.
 *
 * Toda fala do Jarvis passa por aqui: UMA por vez, no aparelho onde o dono falou por último. Antes
 * cada aparelho tocava o que chegava — duas sessões respondendo juntas falavam uma por cima da outra,
 * e o listener do PC tocava a voice ao mesmo tempo que o app aberto nela (a mesma fala, duas vezes).
 *
 * As regras moram em ./speechQueue.ts (puro); aqui só o transporte: escolher o aparelho, mandar os
 * quadros, agendar o `tick`, sintetizar as falas da própria fila e entender a fala do dono. Tudo o que
 * toca o mundo vem por `deps`, para os testes rodarem com aparelhos falsos (speechBridge.test.ts).
 */
import { randomUUID } from "node:crypto";
import { SpeechQueue, wavDurationMs, type SpeechCommand, type SpeechItem, type SpeechKind, type SpeechQueueOptions } from "./speechQueue.js";
import { parseSpeechCommand } from "./speechCommands.js";

export interface SpeechSocket { readyState: number; readonly OPEN: number }

export interface SpeechBridgeDeps<W extends SpeechSocket> {
  send(ws: W, frame: Record<string, unknown>): void;
  synthesize(text: string): Promise<Buffer>;
  /** Listeners "Hey Jarvis" conectados (o do PC hoje). */
  wakeClients(): Iterable<W>;
  /** Mostra uma fala da própria fila como mensagem na sessão (quem a estiver vendo). */
  postMessage(runnerId: string, sessionId: string, text: string): void;
  sessionTitle(runnerId: string, sessionId: string): string;
  log(event: string, data: Record<string, unknown>): void;
  now?(): number;
}

export interface SpeechBridgeOptions extends SpeechQueueOptions {
  /** Aparelho sem janela própria (listener do PC): por quanto tempo o "Hey Jarvis" seguinte ainda
   *  responde à sessão que falou. */
  deviceWindowMs?: number;
  localId?: string;
}

interface Payload<W> { frame: Record<string, unknown>; fallback: W[]; enqueuedAt: number }

export class SpeechBridge<W extends SpeechSocket> {
  readonly queue: SpeechQueue;
  /** Aparelho que fala: onde o dono falou (ou digitou com voz) por último. */
  private device: W | null = null;
  private capable = new WeakSet<W>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Falas tocando agora (monitoramento: quanto tocaram de verdade). */
  private playing = new Map<string, { at: number; sessionId: string; durationMs?: number }>();
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deviceWindowMs: number;
  private readonly localId: string;

  constructor(private deps: SpeechBridgeDeps<W>, opts: SpeechBridgeOptions = {}) {
    this.queue = new SpeechQueue(opts);
    this.deviceWindowMs = Math.max(3_000, opts.deviceWindowMs ?? 8_000);
    this.localId = opts.localId ?? "local";
  }

  key(runnerId: string, sessionId: string): string { return runnerId + "\0" + sessionId; }
  target(key: string): { runnerId: string; sessionId: string } {
    const i = key.indexOf("\0");
    return i < 0 ? { runnerId: this.localId, sessionId: key } : { runnerId: key.slice(0, i), sessionId: key.slice(i + 1) };
  }
  isOff(): boolean { return this.queue.isOff(); }

  /** O aparelho declarou que entende a fila (avisa "terminei", abre a janela de resposta). */
  markCapable(ws: W): void { this.capable.add(ws); }
  /** Digitou com a voz ligada: a resposta fala neste aparelho. */
  useDevice(ws: W): void { this.device = ws; }

  /** Põe uma fala na fila. `fallback` = quem tocaria antes da fila (usado sem aparelho de saída). */
  enqueue(runnerId: string, sessionId: string, frame: Record<string, unknown>, fallback: W[], kind: SpeechKind = "reply"): void {
    const audio = typeof frame.audio === "string" ? frame.audio : "";
    const item: SpeechItem = {
      id: randomUUID().slice(0, 12),
      session: this.key(runnerId, sessionId),
      kind,
      rid: typeof frame.rid === "string" ? frame.rid : undefined,
      more: frame.more === true,
      closing: frame.closing === true,
      // Sem áudio (trecho final vazio por falha de síntese): termina sozinho, não prende a fila.
      durationMs: wavDurationMs(audio) || 1,
      payload: { frame: { ...frame, t: "tts", runnerId, sessionId }, fallback, enqueuedAt: this.now() } satisfies Payload<W>,
    };
    this.run(this.queue.enqueue(item, this.now()));
  }

  played(qid: string): void {
    const p = this.playing.get(qid);
    if (p) {
      this.playing.delete(qid);
      this.deps.log("speech_played", { sessionId: p.sessionId, playMs: this.now() - p.at, durationMs: p.durationMs, by: "aparelho" });
    }
    this.run(this.queue.played(qid, this.now()));
  }
  windowClosed(runnerId: string, sessionId: string): void {
    this.deps.log("speech_window_closed", { sessionId, by: "aparelho" });
    this.run(this.queue.windowClosed(this.key(runnerId, sessionId), this.now()));
  }
  /** Falou por cima do agente no app (refino): para a voz e espera a resposta desta sessão. */
  bargeIn(ws: W): void {
    this.device = ws;
    const b = this.queue.bargeIn(this.now());
    if (b.session) this.deps.log("speech_barge_in", { sessionId: this.target(b.session).sessionId, via: "app" });
    this.run(b.commands);
  }

  /**
   * O dono FALOU (app ou "Hey Jarvis"). Vira o aparelho de saída; comando da fila ("espere",
   * "próxima", "encerrar a voz"…) é atendido aqui e devolve `handled`. Senão a fala conta como
   * resposta à sessão que tem a vez. `followFocus` (listener do PC): a fala vai para a sessão que tem
   * a vez, não para a voice. Devolve a sessão-alvo final.
   */
  heard(ws: W, runnerId: string, sessionId: string, text: string, followFocus: boolean): { handled: boolean; target: { runnerId: string; sessionId: string } } {
    this.device = ws;
    const now = this.now();
    let key = this.key(runnerId, sessionId);
    const focus = this.queue.focus();
    if (followFocus && focus) key = focus;
    const cmd = parseSpeechCommand(text, { expectingBring: this.queue.awaitingBring(key) });
    if (cmd) {
      this.deps.log("speech_command", { kind: cmd.kind });
      if (cmd.kind === "off") {
        this.run(this.queue.off());
        const t = this.target(key);
        void this.deps.synthesize("Voz encerrada. Para voltar, diga: ligar a voz.")
          .then((wav) => this.deps.send(ws, { t: "tts", runnerId: t.runnerId, sessionId: t.sessionId, audio: wav.toString("base64"), text: "Voz encerrada.", closing: true }))
          .catch(() => { /* fala acessória */ });
      } else if (cmd.kind === "on") {
        this.queue.on();
        void this.say(key, "Voz ligada.");
      } else if (cmd.kind === "next") this.run(this.queue.next(now));
      else if (cmd.kind === "wait") {
        if (this.queue.state().mode === "playing") this.run(this.queue.bargeIn(now).commands);
        this.run(this.queue.wait(key, now, cmd.minutes));
      } else this.run(this.queue.bringOthers(key, cmd.yes, now));
      return { handled: true, target: this.target(key) };
    }
    if (this.queue.state().mode === "playing") {
      const b = this.queue.bargeIn(now);
      if (b.session) this.deps.log("speech_barge_in", { sessionId: this.target(b.session).sessionId, via: followFocus ? "wake" : "app" });
      this.run(b.commands);
      if (followFocus && b.session) key = b.session;
    }
    this.run(this.queue.userSpoke(key, now));
    const target = this.target(key);
    // Para onde foi a fala: a sessão que tinha a vez (resposta a ela) ou a pedida.
    this.deps.log("speech_heard", { sessionId: target.sessionId, runnerId: target.runnerId, viaFocus: key !== this.key(runnerId, sessionId), source: followFocus ? "wake" : "app" });
    return { handled: false, target };
  }

  /** Para os timers (testes / desligamento). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.timer = this.windowTimer = null;
  }

  // ------------------------------------------------------------------ internos

  private now(): number { return this.deps.now ? this.deps.now() : Date.now(); }
  private output(): W | null { return this.device && this.device.readyState === this.device.OPEN ? this.device : null; }
  private isWake(ws: W): boolean {
    for (const w of this.deps.wakeClients()) if (w === ws) return true;
    return false;
  }
  private firstWake(): W | null {
    for (const w of this.deps.wakeClients()) if (w.readyState === w.OPEN) return w;
    return null;
  }

  /** Fala da própria fila ("posso trazer as outras?", "conseguiu pensar?"). */
  private async say(key: string, text: string): Promise<void> {
    const { runnerId, sessionId } = this.target(key);
    try {
      const wav = await this.deps.synthesize(text);
      this.deps.postMessage(runnerId, sessionId, text);
      this.enqueue(runnerId, sessionId, { audio: wav.toString("base64"), text }, [], "ask");
    } catch (error) { this.deps.log("speech_line_failed", { error: String(error) }); }
  }

  private run(cmds: SpeechCommand[]): void {
    for (const c of cmds) {
      if (c.type === "play") {
        const { frame, fallback } = c.item.payload as Payload<W>;
        const f = { ...frame, qid: c.item.id };
        // Sem aparelho de saída (ninguém falou desde o boot, ou ele desconectou): quem vê a sessão,
        // como antes; sem ninguém vendo, o listener do PC.
        const out = this.output();
        const alive = fallback.filter((w) => w.readyState === w.OPEN);
        const wake = this.firstWake();
        let device = "ninguem";
        if (out) { this.deps.send(out, f); device = this.isWake(out) ? "listener" : "saida"; }
        else if (alive.length) { for (const w of alive) this.deps.send(w, f); device = "quem_ve"; }
        else if (wake) { this.deps.send(wake, f); device = "listener"; }
        const target = this.target(c.item.session);
        this.playing.set(c.item.id, { at: this.now(), sessionId: target.sessionId, durationMs: c.item.durationMs });
        if (this.playing.size > 200) this.playing.delete(this.playing.keys().next().value as string);
        this.deps.log("speech_play", {
          sessionId: target.sessionId, runnerId: target.runnerId, kind: c.item.kind, device,
          queuedMs: this.now() - (c.item.payload as Payload<W>).enqueuedAt, durationMs: c.item.durationMs, more: c.item.more || undefined,
        });
      } else if (c.type === "window") {
        const out = this.output() || this.firstWake();
        const { runnerId, sessionId } = this.target(c.session);
        this.deps.log("speech_window", { sessionId, mode: out && this.capable.has(out) ? "aparelho" : "tempo" });
        if (out && this.capable.has(out)) this.deps.send(out, { t: "voice_window", runnerId, sessionId });
        else {
          // Aparelho sem janela (listener do PC): segura a vez um tempo curto para o "Hey Jarvis" de
          // resposta cair nesta sessão; depois a fila segue.
          if (this.windowTimer) clearTimeout(this.windowTimer);
          this.windowTimer = setTimeout(() => {
            this.windowTimer = null;
            this.deps.log("speech_window_closed", { sessionId, by: "tempo" });
            this.run(this.queue.windowClosed(c.session, this.now()));
          }, this.deviceWindowMs);
          this.windowTimer.unref?.();
        }
      } else if (c.type === "stop") {
        const out = this.output() || this.firstWake();
        if (out) this.deps.send(out, { t: "tts_stop", ...(this.queue.isOff() ? { off: true } : {}) });
      } else if (c.type === "ask_bring_others") {
        const min = c.minutes === 1 ? "1 minuto" : `${c.minutes} minutos`;
        void this.say(c.session, `Tudo bem, espero ${min}. Posso trazer atualizações de outras sessões enquanto isso?`);
      } else if (c.type === "checkin") {
        const { runnerId, sessionId } = this.target(c.session);
        const label = this.deps.sessionTitle(runnerId, sessionId);
        void this.say(c.session, label ? `Sobre ${label}: conseguiu pensar? Pode falar quando quiser.` : "Conseguiu pensar? Pode falar quando quiser.");
      } else if (c.type === "parked") {
        this.deps.log("speech_parked", { session: this.target(c.session) });
      } else if (c.type === "dropped") {
        this.deps.log("speech_dropped", { count: c.ids.length, reason: c.reason });
      }
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const at = this.queue.nextDeadline();
    if (!at) return;
    this.timer = setTimeout(() => { this.timer = null; this.run(this.queue.tick(this.now())); }, Math.max(0, at - this.now()) + 5);
    this.timer.unref?.();
  }
}
