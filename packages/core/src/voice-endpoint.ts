/**
 * Fim do turno de fala (VOZ-00, fases F4 e F5 — RN-A1..A3, DEC-01 D).
 *
 * POR QUE EXISTE
 * O aparelho encerrava a gravação depois de N segundos abaixo de um limiar de VOLUME. Isso corta a
 * pausa de raciocínio ("então… deixa eu pensar…") e mantém aberto quando há ruído. Agora o Hub recebe
 * o áudio enquanto você fala: um detector de voz por modelo diz quanto silêncio houve desde a última
 * FALA (não desde o último barulho), e uma transcrição parcial diz se a frase parece terminada.
 *
 * A regra: frase que soa completa fecha rápido; frase que termina em conector ou hesitação ("e",
 * "mas", "porque", "tipo", "né") espera mais — quem para depois de "mas" ainda vai falar. Silêncio
 * mínimo e máximo são assimétricos (RN-A3): há um teto que sempre encerra, e um prazo próprio para
 * desistir quando ninguém falou.
 */

export interface EndpointThresholds {
  /** Frase parcial soa completa (termina em . ! ?). */
  completeMs: number;
  /** Sem sinal claro (parcial ausente, desatualizada ou sem pontuação). */
  neutralMs: number;
  /** Frase termina em conector, vírgula ou hesitação — ainda vem coisa. */
  incompleteMs: number;
  /** Teto: com este silêncio depois de falar, sempre encerra. */
  maxSilenceMs: number;
  /** Ninguém falou: desiste depois disto. */
  noSpeechMs: number;
  /** Menos fala que isto não conta como "falou" (estalo, tosse curta). */
  minSpeechMs: number;
  /**
   * FALA LONGA (2026-10-27): depois de tanta fala acumulada, a pessoa está explicando, não pedindo.
   * Numa explicação toda frase termina em ponto — "frase completa" deixa de significar "acabou" — e
   * um gole d'água ou uma tosse no meio não podem encerrar. Valem então os prazos `long*`, mais
   * folgados; para encerrar rápido, a frase de fim ("pode mandar", "terminei").
   */
  longSpeechMs: number;
  longCompleteMs: number;
  longNeutralMs: number;
  longIncompleteMs: number;
  longMaxSilenceMs: number;
}

/** Proposta inicial — calibrar com a telemetria (o evento voice_turn registra o motivo do fim). */
export const DEFAULT_ENDPOINT_THRESHOLDS: EndpointThresholds = {
  completeMs: 700, neutralMs: 1_300, incompleteMs: 2_600, maxSilenceMs: 3_500, noSpeechMs: 6_000, minSpeechMs: 250,
  longSpeechMs: 10_000, longCompleteMs: 5_000, longNeutralMs: 6_000, longIncompleteMs: 8_000, longMaxSilenceMs: 10_000,
};

/** Frases que, no FIM da fala, dizem "pode mandar" — encerram já, em fala curta ou longa. Só as que
 *  quase nunca fecham uma frase comum ("é isso" ficou de fora: "o que eu quero é isso."). */
const END_PHRASES = [
  "pode mandar", "pode enviar", "manda ver", "terminei", "acabei", "cambio", "e so isso", "era isso", "era so isso",
  "that's all", "thats all", "send it", "i'm done", "im done",
  "eso es todo", "puedes enviar", "termine",
];
function endsWithEndPhrase(partial?: string): boolean {
  const t = (partial || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  return !!t && END_PHRASES.some((p) => t === p || t.endsWith(" " + p));
}

/** Palavras que, no FIM da frase, indicam que ela não acabou (pt, en, es). Ficam de fora as que
 *  fecham frase de verdade: "faz isso", "é assim", "eu também", "I think so". */
const TRAILING_INCOMPLETE = new Set([
  // português
  "e", "mas", "porém", "então", "porque", "pq", "que", "tipo", "né", "aí", "daí", "ou", "se", "quando", "como", "pra", "para",
  "com", "de", "do", "da", "dos", "das", "no", "na", "em", "o", "a", "os", "as", "um", "uma", "uns", "umas", "meu", "minha",
  "seu", "sua", "esse", "essa", "aquele", "aquela", "inclusive", "sobre", "até", "entre",
  "eh", "éh", "hum", "hmm", "ahn", "ah", "uh",
  // inglês
  "and", "but", "because", "or", "if", "when", "the", "an", "to", "of", "with", "for", "like", "um", "uh", "my", "your", "about",
  // espanhol
  "y", "pero", "entonces", "porque", "o", "si", "cuando", "el", "la", "los", "las", "un", "una", "con", "para", "por", "mi", "tu", "eh",
]);

export type EndpointReason = "frase_completa" | "pausa_neutra" | "frase_incompleta" | "teto_de_silencio" | "sem_fala" | "frase_de_fim";

export interface EndpointInput {
  /** Silêncio desde a última fala detectada pelo modelo. */
  silenceMs: number;
  /** Fala acumulada na gravação. */
  speechMs: number;
  /** Duração total da gravação até agora. */
  elapsedMs: number;
  /** Transcrição parcial mais recente. */
  partial?: string;
  /** A parcial foi feita DEPOIS da última fala (cobre tudo o que foi dito). Parcial velha não decide. */
  partialFresh?: boolean;
}

export interface EndpointDecision { end: boolean; reason?: EndpointReason; waitMs: number }

/** Como a frase parcial termina: completa, incompleta ou sem sinal. */
export function partialShape(partial?: string): "complete" | "incomplete" | "unknown" {
  const t = (partial || "").trim();
  if (!t) return "unknown";
  if (/[,;:\-–—]$/.test(t) || /(\.\.\.|…)$/.test(t)) return "incomplete";
  const last = (t.replace(/[.!?¿¡"'”’)\s]+$/u, "").match(/([\p{L}']+)$/u) || ["", ""])[1].toLowerCase();
  if (last && TRAILING_INCOMPLETE.has(last)) return "incomplete";
  if (/[.!?]["'”’)]*$/.test(t)) return "complete";
  return "unknown";
}

export function endOfTurnDecision(input: EndpointInput, th: EndpointThresholds = DEFAULT_ENDPOINT_THRESHOLDS): EndpointDecision {
  if (input.speechMs < th.minSpeechMs) {
    return input.elapsedMs >= th.noSpeechMs ? { end: true, reason: "sem_fala", waitMs: th.noSpeechMs } : { end: false, waitMs: th.noSpeechMs };
  }
  // "Pode mandar" no fim encerra já, mesmo no meio de uma explicação longa.
  if (input.partialFresh && endsWithEndPhrase(input.partial)) {
    return input.silenceMs >= th.completeMs ? { end: true, reason: "frase_de_fim", waitMs: th.completeMs } : { end: false, waitMs: th.completeMs };
  }
  const long = input.speechMs >= th.longSpeechMs;
  const maxSilence = long ? th.longMaxSilenceMs : th.maxSilenceMs;
  if (input.silenceMs >= maxSilence) return { end: true, reason: "teto_de_silencio", waitMs: maxSilence };
  const shape = input.partialFresh ? partialShape(input.partial) : "unknown";
  const waitMs = long
    ? (shape === "complete" ? th.longCompleteMs : shape === "incomplete" ? th.longIncompleteMs : th.longNeutralMs)
    : (shape === "complete" ? th.completeMs : shape === "incomplete" ? th.incompleteMs : th.neutralMs);
  const reason: EndpointReason = shape === "complete" ? "frase_completa" : shape === "incomplete" ? "frase_incompleta" : "pausa_neutra";
  return input.silenceMs >= waitMs ? { end: true, reason, waitMs } : { end: false, waitMs };
}
