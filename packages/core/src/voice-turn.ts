/**
 * Medição de ponta a ponta de um turno de voz (VOZ-00, fase F0).
 *
 * POR QUE EXISTE
 * Até aqui só a ENTRADA era medida (transcrição, locutor, correção+portão), num arquivo à parte. O
 * que o usuário sente — do fim da fala até ouvir a resposta — nunca foi medido, então nenhuma
 * melhoria de voz era verificável. Este rastreador junta as etapas de um turno num ÚNICO evento:
 * as do Hub (transcrição, roteamento, agente, preparo da fala, síntese) e as do aparelho (pausa
 * esperada até encerrar a gravação, tempo até o primeiro som).
 *
 * Como as duas metades se encontram: o aparelho gera um id (`vtid`) ao encerrar a gravação e o
 * manda junto do áudio; o Hub devolve esse id no primeiro áudio de resposta; o aparelho, quando o
 * som de fato começa, reporta as suas medidas com o mesmo id. Só DURAÇÕES atravessam a fronteira —
 * relógios de aparelhos diferentes nunca são comparados.
 *
 * Sem I/O e sem texto da fala: o evento carrega tempos e tamanhos, nunca o que foi dito.
 */

/** Como o turno terminou. `spoken` = houve resposta falada. */
export type VoiceTurnOutcome = "spoken" | "ignored" | "denied" | "error" | "queued" | "no_audio" | "superseded";

/** Por onde o turno foi despachado. Só os caminhos instrumentados aparecem; os demais ficam sem. */
export type VoiceTurnPath = "local" | "native" | "remote";

/** Medidas do aparelho. Todas são durações medidas no próprio aparelho. */
export interface VoiceTurnClientReport {
  /** Duração da gravação. */
  recMs?: number;
  /** Silêncio esperado depois da última fala até encerrar a gravação. */
  endpointMs?: number;
  /** Do fim da gravação até o áudio sair para o Hub (codificação). */
  encodeMs?: number;
  /** Do fim da gravação até o primeiro som da resposta começar a tocar. */
  stopToFirstAudioMs?: number;
}

export interface VoiceTurnEvent {
  id: string;
  runnerId: string;
  outcome: VoiceTurnOutcome;
  path?: VoiceTurnPath;
  bytes: number;
  sttMs?: number;
  speakerMs?: number;
  preflightMs?: number;
  relevant?: boolean;
  /** Do recebimento do áudio até o despacho ao agente (inclui transcrição, portão e roteamento). */
  dispatchMs?: number;
  /** Do despacho até o agente terminar. */
  agentMs?: number;
  /** Preparo do texto falado (limpeza e, se longo, resumo por IA). */
  prepMs?: number;
  /** A resposta passou pelo resumo por IA antes de virar fala. */
  summarized?: boolean;
  /** Síntese do áudio. */
  synthMs?: number;
  /** Tamanho do texto falado, em caracteres. */
  spokenChars?: number;
  /** Do recebimento do áudio até o Hub enviar o primeiro áudio de resposta. */
  firstAudioMs?: number;
  recMs?: number;
  endpointMs?: number;
  encodeMs?: number;
  stopToFirstAudioMs?: number;
  /** O que o usuário sente: da última fala até o primeiro som (pausa esperada + resto do caminho). */
  perceivedMs?: number;
}

interface Turn {
  ev: VoiceTurnEvent;
  owner: unknown;
  keys: Set<string>;
  t0: number;
  dispatchedAt?: number;
  audioSent: boolean;
  timer?: unknown;
}

export interface VoiceTurnTrackerOptions {
  emit: (event: VoiceTurnEvent) => void;
  now?: () => number;
  /** Quanto esperar o relato do aparelho depois do primeiro áudio. */
  clientWaitMs?: number;
  /** Teto de um turno sem áudio (agente pode demorar). */
  turnTtlMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  newId?: () => string;
}

const MAX_CLIENT_MS = 30 * 60_000;
const ID_RX = /^[A-Za-z0-9_-]{6,64}$/;

/** Aceita só duração plausível vinda do aparelho: número finito, não negativo, até 30 min. */
export function clampClientMs(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_CLIENT_MS) return undefined;
  return Math.round(v);
}

export class VoiceTurnTracker {
  private readonly byKey = new Map<string, Turn>();
  private readonly byId = new Map<string, Turn>();
  private readonly emitFn: (event: VoiceTurnEvent) => void;
  private readonly now: () => number;
  private readonly clientWaitMs: number;
  private readonly turnTtlMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly newId: () => string;
  private seq = 0;

  constructor(opts: VoiceTurnTrackerOptions) {
    this.emitFn = opts.emit;
    this.now = opts.now || Date.now;
    this.clientWaitMs = opts.clientWaitMs ?? 60_000;
    this.turnTtlMs = opts.turnTtlMs ?? 30 * 60_000;
    this.setTimer = opts.setTimer || ((fn, ms) => { const h = setTimeout(fn, ms); (h as { unref?: () => void }).unref?.(); return h; });
    this.clearTimer = opts.clearTimer || ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.newId = opts.newId || (() => `h${this.now().toString(36)}${(++this.seq).toString(36)}`);
  }

  /** Turnos ainda abertos (para teste e diagnóstico). */
  get open(): number { return this.byId.size; }

  /** Começa um turno de voz na chave (máquina+sessão). Um turno anterior na mesma chave é encerrado
   *  como `superseded` — só existe um turno de voz por sessão de cada vez. Devolve o id do turno. */
  start(key: string, init: { id?: unknown; owner?: unknown; runnerId: string; bytes: number }): string {
    const prev = this.byKey.get(key);
    if (prev) this.finish(prev, "superseded");
    let id = typeof init.id === "string" && ID_RX.test(init.id) ? init.id : this.newId();
    if (this.byId.has(id)) id = this.newId();
    const turn: Turn = { ev: { id, runnerId: init.runnerId, outcome: "no_audio", bytes: Math.max(0, Math.round(init.bytes)) }, owner: init.owner, keys: new Set([key]), t0: this.now(), audioSent: false };
    this.byKey.set(key, turn); this.byId.set(id, turn);
    this.arm(turn, this.turnTtlMs);
    return id;
  }

  /** Mesma conversa sob outra chave (ex.: sessão nativa encaminhada com outro id na máquina). */
  alias(key: string, otherKey: string): void {
    const turn = this.byKey.get(key);
    if (!turn || key === otherKey) return;
    const other = this.byKey.get(otherKey);
    if (other && other !== turn) this.finish(other, "superseded");
    turn.keys.add(otherKey); this.byKey.set(otherKey, turn);
  }

  /** Etapas de entrada, medidas pelo Hub. */
  input(key: string, fields: { sttMs?: number; speakerMs?: number; preflightMs?: number; relevant?: boolean }): void {
    const turn = this.byKey.get(key); if (!turn) return;
    Object.assign(turn.ev, defined(fields));
  }

  /** O agente recebeu o pedido. Só o primeiro despacho conta. */
  dispatched(key: string, path: VoiceTurnPath): void {
    const turn = this.byKey.get(key); if (!turn || turn.dispatchedAt !== undefined) return;
    turn.dispatchedAt = this.now();
    turn.ev.path = path;
    turn.ev.dispatchMs = turn.dispatchedAt - turn.t0;
  }

  /** O agente terminou (com ou sem sucesso). */
  agentDone(key: string): void {
    const turn = this.byKey.get(key); if (!turn || turn.dispatchedAt === undefined || turn.ev.agentMs !== undefined) return;
    turn.ev.agentMs = this.now() - turn.dispatchedAt;
  }

  /** Preparo e síntese da resposta falada. Só a primeira resposta do turno conta. */
  speech(key: string, fields: { prepMs?: number; synthMs: number; spokenChars: number; summarized?: boolean }): void {
    const turn = this.byKey.get(key); if (!turn || turn.ev.synthMs !== undefined) return;
    Object.assign(turn.ev, defined(fields));
  }

  /** O Hub está enviando um áudio de resposta nesta chave. Devolve o id do turno para marcar o
   *  quadro, ou `undefined` quando não há turno de voz aberto (a maioria dos casos). */
  audioSent(key: string): string | undefined {
    const turn = this.byKey.get(key); if (!turn) return undefined;
    if (!turn.audioSent) {
      turn.audioSent = true;
      turn.ev.outcome = "spoken";
      turn.ev.firstAudioMs = this.now() - turn.t0;
      // Daqui em diante só falta o relato do aparelho; sem ele, o evento sai assim mesmo.
      this.arm(turn, this.clientWaitMs);
    }
    return turn.ev.id;
  }

  /** Encerramento sem resposta falada (fala ignorada, voz negada, erro, fila). */
  end(key: string, outcome: Exclude<VoiceTurnOutcome, "spoken" | "superseded">): void {
    const turn = this.byKey.get(key); if (!turn || turn.audioSent) return;
    this.finish(turn, outcome);
  }

  /** Relato do aparelho. Só o MESMO dono que abriu o turno pode completá-lo. */
  client(id: unknown, owner: unknown, report: VoiceTurnClientReport): boolean {
    if (typeof id !== "string") return false;
    const turn = this.byId.get(id);
    if (!turn || turn.owner !== owner) return false;
    const r: VoiceTurnClientReport = {
      recMs: clampClientMs(report.recMs), endpointMs: clampClientMs(report.endpointMs),
      encodeMs: clampClientMs(report.encodeMs), stopToFirstAudioMs: clampClientMs(report.stopToFirstAudioMs),
    };
    Object.assign(turn.ev, defined(r));
    if (r.stopToFirstAudioMs !== undefined) turn.ev.perceivedMs = (r.endpointMs ?? 0) + r.stopToFirstAudioMs;
    // O som já começou: o turno está completo do ponto de vista de quem fala.
    if (turn.audioSent && r.stopToFirstAudioMs !== undefined) this.finish(turn, "spoken");
    return true;
  }

  private arm(turn: Turn, ms: number): void {
    if (turn.timer !== undefined) this.clearTimer(turn.timer);
    turn.timer = this.setTimer(() => { turn.timer = undefined; this.finish(turn, turn.audioSent ? "spoken" : "no_audio"); }, ms);
  }

  private finish(turn: Turn, outcome: VoiceTurnOutcome): void {
    if (!this.byId.has(turn.ev.id)) return;
    if (turn.timer !== undefined) { this.clearTimer(turn.timer); turn.timer = undefined; }
    this.byId.delete(turn.ev.id);
    for (const k of turn.keys) if (this.byKey.get(k) === turn) this.byKey.delete(k);
    turn.ev.outcome = outcome;
    try { this.emitFn({ ...turn.ev }); } catch { /* medição nunca derruba a conversa */ }
  }
}

function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Etapas resumidas pelo relatório, na ordem do caminho de um turno. */
export const VOICE_TURN_STAGES = ["endpointMs", "encodeMs", "sttMs", "speakerMs", "preflightMs", "dispatchMs", "agentMs", "prepMs", "synthMs", "firstAudioMs", "stopToFirstAudioMs", "perceivedMs"] as const;
export type VoiceTurnStage = typeof VOICE_TURN_STAGES[number];

export interface StageSummary { n: number; min: number; p50: number; p90: number; max: number }

/** Percentis por etapa sobre eventos `voice_turn` (RN-K2: metas verificadas pela telemetria). */
export function summarizeVoiceTurns(events: Array<Partial<VoiceTurnEvent>>): { turns: number; outcomes: Record<string, number>; stages: Partial<Record<VoiceTurnStage, StageSummary>> } {
  const outcomes: Record<string, number> = {};
  const stages: Partial<Record<VoiceTurnStage, StageSummary>> = {};
  for (const e of events) { const o = String(e.outcome || "?"); outcomes[o] = (outcomes[o] || 0) + 1; }
  for (const stage of VOICE_TURN_STAGES) {
    const xs = events.map((e) => e[stage]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
    if (!xs.length) continue;
    const pick = (q: number): number => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(q * xs.length) - 1))];
    stages[stage] = { n: xs.length, min: xs[0], p50: pick(0.5), p90: pick(0.9), max: xs[xs.length - 1] };
  }
  return { turns: events.length, outcomes, stages };
}
