/**
 * Motor do Debate iterativo — o laço, sem I/O.
 *
 * POR QUE EXISTE
 * Rodadas → réplica cruzada → juiz → convergência → síntese é o MESMO processo onde quer que o
 * debate rode: no Hub quando a sessão é dele, na máquina quando a sessão vive nela. O laço morava
 * dentro do Hub, então "Debate em todas as máquinas" só teria duas saídas: uma segunda cópia no
 * runner — que divergiria na primeira mudança — ou esta, uma implementação só. Cada lado entra
 * apenas com os seus efeitos colaterais.
 *
 * O que NÃO está aqui, de propósito: escolher os debatentes (depende dos CLIs daquela máquina),
 * store, broadcast, auditoria, TTS, contabilidade de uso e execução gerenciada. Tudo isso é do host,
 * e é exatamente o que difere entre Hub e Runner.
 */
import {
  buildDebateJudgePrompt,
  buildDebateOpeningPrompt,
  buildDebateRebuttalPrompt,
  buildDebateSynthesisPrompt,
  formatDebateFinalMessage,
  formatDebateRoundMessage,
  parseDebateVerdict,
  type DebateDebater,
  type DebateVerdict,
  type DebaterResponse,
} from "./debate.js";

/** Fase publicada no frame de progresso. `done` é emitido pelo host na limpeza, não pelo laço. */
export type DebatePhase = "debating" | "judging" | "synthesizing";

export interface DebateRoundOutcome {
  responses: DebaterResponse[];
  /** Algum debatente falhou nesta rodada — o texto final avisa que houve falha. */
  failed: boolean;
  /** Estado final por debatente, NA ORDEM de `debaters`. Alimenta o frame de "judging" no caminho
   *  gerenciado, onde os estados só se sabem depois do relatório. */
  states: string[];
}

export interface DebateHost {
  /** Publica no chat da máquina onde o debate roda. */
  postAssistant(text: string): void;
  emitProgress(p: { round: number; phase: DebatePhase; debaters: Array<{ label: string; state: string }>; interjected: number }): void;
  /** Recados desde a rodada anterior. DRENA: o mesmo recado nunca entra em duas rodadas. */
  drainInterjections(): string[];
  /** Tudo que o usuário disse no debate — a síntese responde até o que chegou tarde para virar rodada. */
  allInterjections(): string[];
  /** Fim das rodadas: não existe mais etapa para receber recado. */
  closeInterjections(): void;
  /** Roda UMA rodada com todos os debatentes. Cada lado escolhe entre execução gerenciada e one-shot;
   *  `onState` existe para o caminho one-shot pintar o card conforme cada IA responde. */
  runRound(input: { round: number; promptFor: (d: DebateDebater) => string; onState: (index: number, state: string) => void }): Promise<DebateRoundOutcome>;
  /** Juiz e sintetizador: meta-análise one-shot. */
  oneShotJudge(prompt: string): Promise<string>;
  /** Parecer do juiz na fase da rodada. No-op onde não há execução gerenciada. */
  publishRoundVerdict?(round: number, verdict: DebateVerdict): void;
  /** Cancelamento cooperativo, consultado no topo de cada rodada e antes do juiz. */
  readonly aborted: boolean;
}

export interface DebateRunResult {
  rounds: number;
  converged: boolean;
  failed: boolean;
  finalText: string;
  responses: DebaterResponse[];
}

export async function runDebate(
  host: DebateHost,
  input: { topic: string; debaters: DebateDebater[]; maxRounds: number },
): Promise<DebateRunResult> {
  const { topic, debaters, maxRounds } = input;
  let responses: DebaterResponse[] = [];
  let converged = false, failed = false, roundsDone = 0, interjected = 0;

  for (let round = 1; round <= maxRounds; round++) {
    if (host.aborted) { failed = true; break; }
    const prev = new Map(responses.map((r) => [r.id, r.text]));
    const prevResponses = responses;
    const roundState = debaters.map((d) => ({ label: d.label, state: "running" as string }));
    // Drenar AQUI, e não durante a rodada: todo mundo precisa debater o MESMO material. Injetar no
    // meio deixaria uma IA com o recado e as outras sem.
    const recados = host.drainInterjections();
    interjected = recados.length;
    const promptFor = (d: DebateDebater): string => round === 1
      ? buildDebateOpeningPrompt(topic, recados)
      : buildDebateRebuttalPrompt(topic, round, prev.get(d.id) || "", prevResponses.filter((r) => r.id !== d.id), recados);

    host.emitProgress({ round, phase: "debating", debaters: roundState.map((p) => ({ ...p })), interjected });
    const outcome = await host.runRound({
      round,
      promptFor,
      onState: (i, state) => {
        if (roundState[i]) roundState[i].state = state;
        host.emitProgress({ round, phase: "debating", debaters: roundState.map((p) => ({ ...p })), interjected });
      },
    });
    responses = outcome.responses;
    if (outcome.failed) failed = true;
    outcome.states.forEach((state, i) => { if (roundState[i]) roundState[i].state = state; });
    host.emitProgress({ round, phase: "judging", debaters: roundState.map((p) => ({ ...p })), interjected });
    roundsDone = round;

    // Cancelou no meio da rodada: chamar o juiz seria pagar para avaliar respostas canceladas, e o
    // parecer acabaria publicado numa etapa já morta. Registra o que a rodada produziu e encerra.
    if (host.aborted) { failed = true; host.postAssistant(formatDebateRoundMessage(round, responses)); break; }

    let verdict: DebateVerdict = { converged: false, confidence: 0, reason: "" };
    try { verdict = parseDebateVerdict(await host.oneShotJudge(buildDebateJudgePrompt(topic, round, responses))); }
    catch { verdict = { converged: false, confidence: 0, reason: "juiz indisponível" }; }
    host.publishRoundVerdict?.(round, verdict);
    host.postAssistant(formatDebateRoundMessage(round, responses, verdict));
    if (verdict.converged) { converged = true; break; }
  }

  // Acabaram as rodadas: a janela de recado fecha AQUI, antes de montar a síntese. Fechar depois
  // daria um ack mentiroso ("entra na próxima etapa") a quem escrevesse durante a síntese.
  host.closeInterjections();
  let summary: string | undefined;
  if (!host.aborted) {
    host.emitProgress({ round: roundsDone, phase: "synthesizing", debaters: [], interjected });
    // A síntese recebe TODOS os recados, não só os da última rodada: é o único lugar onde um recado
    // que chegou tarde demais para virar rodada ainda é respondido.
    try {
      const text = await host.oneShotJudge(buildDebateSynthesisPrompt(topic, responses, { converged, rounds: roundsDone, interjections: host.allInterjections() }));
      summary = text || undefined;
    } catch { summary = undefined; }
  }
  const finalText = formatDebateFinalMessage({
    rounds: roundsDone, maxRounds, converged,
    debaters: debaters.map((d) => d.label),
    summary, failed: failed || host.aborted,
  });
  host.postAssistant(finalText);
  return { rounds: roundsDone, converged, failed: failed || host.aborted, finalText, responses };
}
