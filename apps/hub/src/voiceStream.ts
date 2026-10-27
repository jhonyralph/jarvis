/**
 * Gravações em andamento (VOZ-00, fases F4 e F5).
 *
 * O aparelho manda o áudio em pedaços ENQUANTO você fala. O serviço de transcrição devolve o detector
 * de voz (silêncio desde a última fala) e transcrições parciais; aqui o Hub decide o fim do turno com
 * `endOfTurnDecision` (core) e manda o aparelho encerrar a gravação. A parcial também vai para a tela.
 *
 * Se o serviço não abre ou cai no meio, o aparelho recebe `voice_stream_failed` e volta ao fim de fala
 * pelo volume, como antes — a conversa nunca depende deste caminho para funcionar.
 */
import { endOfTurnDecision, partialShape, type EndpointThresholds } from "@jarvis/core";
import type { StreamEvent, TranscriptionStream } from "./stt.js";

const ID_RX = /^[A-Za-z0-9_-]{6,64}$/;
/** ~1,5 s de PCM 16 kHz em base64 — bem acima do pedaço de 250 ms que o aparelho manda. */
const MAX_CHUNK_B64 = 70_000;

export interface VoiceStreamDeps<S> {
  open(streamId: string, onEvent: (ev: StreamEvent) => void): Promise<TranscriptionStream>;
  send(socket: S, frame: Record<string, unknown>): void;
  thresholds?: () => EndpointThresholds | undefined;
  /** Monitoramento (2026-10-27): abertura, decisão de fim de fala (com os números que a decidiram),
   *  falha e fechamento de cada gravação. Nunca o texto — só o tamanho e o formato da parcial. */
  log?: (event: string, data: Record<string, unknown>) => void;
}

interface Live<S> {
  socket: S;
  streamId: string;
  stream?: TranscriptionStream;
  ended: boolean;
  partial: string;
  partialFresh: boolean;
  last?: { speechMs: number; silenceMs: number; durMs: number };
  openedAt: number;
  endedReason?: string;
}

export class VoiceStreams<S> {
  private readonly bySocket = new Map<S, Live<S>>();
  constructor(private readonly deps: VoiceStreamDeps<S>) {}

  /** Gravações abertas (para teste e diagnóstico). */
  get open(): number { return this.bySocket.size; }

  async start(socket: S, streamId: unknown): Promise<void> {
    if (typeof streamId !== "string" || !ID_RX.test(streamId)) return;
    this.stop(socket); // uma gravação por aparelho
    const live: Live<S> = { socket, streamId, ended: false, partial: "", partialFresh: false, openedAt: Date.now() };
    this.bySocket.set(socket, live);
    try {
      const stream = await this.deps.open(streamId, (ev) => this.onEvent(live, ev));
      if (this.bySocket.get(socket) !== live) { stream.close(); return; } // encerrada enquanto abria
      live.stream = stream;
      this.deps.log?.("voice_stream_open", { streamId, readyMs: Date.now() - live.openedAt });
      this.deps.send(socket, { t: "voice_stream_ready", streamId });
    } catch (error) {
      this.fail(live, String((error as Error)?.message || error));
    }
  }

  push(socket: S, streamId: unknown, pcm: unknown): void {
    const live = this.bySocket.get(socket);
    if (!live || live.streamId !== streamId || live.ended || typeof pcm !== "string" || !pcm || pcm.length > MAX_CHUNK_B64) return;
    live.stream?.push(pcm);
  }

  /** O aparelho parou de gravar (ou desconectou). */
  stop(socket: S, streamId?: unknown): void {
    const live = this.bySocket.get(socket);
    if (!live || (streamId !== undefined && live.streamId !== streamId)) return;
    this.bySocket.delete(socket);
    live.stream?.close();
    this.deps.log?.("voice_stream_closed", {
      streamId: live.streamId, endpointed: live.ended, reason: live.endedReason, openMs: Date.now() - live.openedAt,
      speechMs: live.last?.speechMs, durMs: live.last?.durMs,
    });
  }

  private onEvent(live: Live<S>, ev: StreamEvent): void {
    if (this.bySocket.get(live.socket) !== live) return;
    if (ev.event === "error") { this.fail(live, ev.error || "erro no serviço de transcrição"); return; }
    if (ev.event === "partial") {
      live.partial = String(ev.text || "");
      if (ev.fresh) live.partialFresh = true;
      this.deps.send(live.socket, { t: "voice_partial", streamId: live.streamId, text: live.partial });
      if (ev.fresh) this.decide(live); // a parcial que cobre a pausa pode já fechar o turno
      return;
    }
    live.last = { speechMs: Number(ev.speechMs) || 0, silenceMs: Number(ev.silenceMs) || 0, durMs: Number(ev.durMs) || 0 };
    live.partialFresh = !!ev.partialFresh;
    this.decide(live);
  }

  private decide(live: Live<S>): void {
    if (live.ended || !live.last) return;
    const d = endOfTurnDecision({
      silenceMs: live.last.silenceMs, speechMs: live.last.speechMs, elapsedMs: live.last.durMs,
      partial: live.partial, partialFresh: live.partialFresh,
    }, this.deps.thresholds?.());
    if (!d.end) return;
    live.ended = true;
    live.endedReason = d.reason;
    this.deps.log?.("voice_stream_endpoint", {
      streamId: live.streamId, reason: d.reason, waitMs: d.waitMs,
      speechMs: live.last.speechMs, silenceMs: live.last.silenceMs, durMs: live.last.durMs,
      partialChars: live.partial.length, partialFresh: live.partialFresh, shape: live.partialFresh ? partialShape(live.partial) : "unknown",
    });
    this.deps.send(live.socket, {
      t: "voice_endpoint", streamId: live.streamId, reason: d.reason,
      silenceMs: live.last.silenceMs, spoke: d.reason !== "sem_fala",
    });
  }

  private fail(live: Live<S>, error: string): void {
    this.deps.log?.("voice_stream_failed", { streamId: live.streamId, error: error.slice(0, 200), openMs: Date.now() - live.openedAt });
    if (this.bySocket.get(live.socket) === live) this.bySocket.delete(live.socket);
    live.stream?.close();
    this.deps.send(live.socket, { t: "voice_stream_failed", streamId: live.streamId, error });
  }
}
