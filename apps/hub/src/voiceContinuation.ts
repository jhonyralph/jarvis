/**
 * Continuação de fala cortada (2026-10-27).
 *
 * O fim da fala pode chegar cedo demais — um gole d'água, uma tosse, uma pausa para pensar. Quando o
 * dono volta a falar logo depois (até `windowMs`) e o turno daquela fala ainda está rodando, o turno é
 * interrompido e a fala INTEIRA vai num turno só. Antes a continuação esperava na fila: a IA
 * trabalhava na primeira metade (às vezes agindo com a instrução incompleta) e só depois via o resto.
 *
 * Interromper não apaga o que a IA já fez: o Hub preserva o parcial do turno cancelado.
 */
export interface VoiceContinuationDeps {
  /** Tempo, depois de a fala ir para a sessão, em que voltar a falar conta como continuação (0 desliga). */
  windowMs: number;
  /** A sessão ainda está com um turno rodando? */
  busy(sessionId: string): boolean;
  /** Interrompe o turno em andamento; false = nada cancelável (aí a fala segue como mensagem nova). */
  abort(sessionId: string): boolean;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  /** Teto da espera pelo turno interrompido sair. */
  settleMs?: number;
}

/** Por que a fala foi (ou não) juntada à anterior — para o monitoramento calibrar a janela. */
export type ContinuationReason = "joined" | "no_previous" | "disabled" | "window_expired" | "turn_finished" | "not_cancellable";

export interface ContinuationResult {
  text: string;
  joined: boolean;
  reason: ContinuationReason;
  /** Tempo desde a fala anterior da sessão (ausente quando não havia). */
  gapMs?: number;
  /** Quanto o turno interrompido levou para sair. */
  settleMs?: number;
}

export class VoiceContinuation {
  private readonly last = new Map<string, { text: string; at: number }>();
  constructor(private readonly deps: VoiceContinuationDeps) {}

  /** A fala `text` acabou de ir para a sessão (virou um turno). */
  note(sessionId: string, text: string): void {
    this.last.set(sessionId, { text, at: this.now() });
  }

  /** Se `text` continua a fala anterior da sessão, interrompe o turno dela e devolve a fala inteira. */
  async join(sessionId: string, text: string): Promise<ContinuationResult> {
    const prev = this.last.get(sessionId);
    if (!prev) return { text, joined: false, reason: "no_previous" };
    const gapMs = this.now() - prev.at;
    if (!this.deps.windowMs) return { text, joined: false, reason: "disabled", gapMs };
    if (gapMs > this.deps.windowMs) return { text, joined: false, reason: "window_expired", gapMs };
    if (!this.deps.busy(sessionId)) return { text, joined: false, reason: "turn_finished", gapMs };
    if (!this.deps.abort(sessionId)) return { text, joined: false, reason: "not_cancellable", gapMs };
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const t0 = this.now();
    const until = t0 + (this.deps.settleMs ?? 8_000);
    while (this.deps.busy(sessionId) && this.now() < until) await sleep(150);
    return { text: `${prev.text} ${text}`, joined: true, reason: "joined", gapMs, settleMs: this.now() - t0 };
  }

  private now(): number { return this.deps.now ? this.deps.now() : Date.now(); }
}
