/**
 * Políticas da conversa por voz (VOZ-00, fase F1): idioma de escuta e rigor do portão de relevância.
 *
 * Funções puras — o Hub lê a configuração, chama estas funções e só então decide se chama um modelo.
 * Ficam fora do Hub para serem testáveis sem microfone, e para que a regra de "quando gastar uma
 * chamada de IA antes de despachar" exista em um lugar só.
 */

/** Idiomas que a escuta oferece. Códigos ISO-639-1, os mesmos que a transcrição usa. */
export const LISTEN_LANGUAGES = ["pt", "en", "es", "fr", "it", "de"] as const;
export type ListenLanguage = typeof LISTEN_LANGUAGES[number];

export const LISTEN_LANGUAGE_LABELS: Record<ListenLanguage, string> = {
  pt: "Português", en: "Inglês", es: "Espanhol", fr: "Francês", it: "Italiano", de: "Alemão",
};

/** RN-H3: fixo (um idioma), conjunto (detecção restrita) ou prática (idioma praticado + português). */
export type ListenMode = "fixed" | "set" | "practice";

export interface ListenConfig {
  mode: ListenMode;
  /** Idioma do modo fixo. */
  lang: ListenLanguage;
  /** Idiomas do modo conjunto. */
  langs: ListenLanguage[];
  /** Idioma praticado. */
  practice: ListenLanguage;
  /** RN-H7: no modo prática, apontar o que poderia ser dito melhor. Padrão ligado (decisão do dono). */
  correct: boolean;
}

export const DEFAULT_LISTEN_CONFIG: ListenConfig = { mode: "fixed", lang: "pt", langs: ["pt", "en"], practice: "en", correct: true };

const isLang = (v: unknown): v is ListenLanguage => typeof v === "string" && (LISTEN_LANGUAGES as readonly string[]).includes(v);

/** Normaliza o que veio do disco ou do aparelho: valor desconhecido cai no padrão, nunca quebra. */
export function normalizeListenConfig(raw: unknown): ListenConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode: ListenMode = r.mode === "set" || r.mode === "practice" ? r.mode : "fixed";
  const lang = isLang(r.lang) ? r.lang : DEFAULT_LISTEN_CONFIG.lang;
  const langs: ListenLanguage[] = Array.isArray(r.langs) ? [...new Set(r.langs.filter(isLang))] : [];
  // Conjunto com menos de dois idiomas não é conjunto: completa com português e inglês.
  for (const fill of ["pt", "en"] as const) if (langs.length < 2 && !langs.includes(fill)) langs.push(fill);
  const practice = isLang(r.practice) && r.practice !== "pt" ? r.practice : DEFAULT_LISTEN_CONFIG.practice;
  return {
    mode, lang, langs, practice,
    correct: typeof r.correct === "boolean" ? r.correct : DEFAULT_LISTEN_CONFIG.correct,
  };
}

/** O que pedir à transcrição: um idioma fixo, ou um conjunto onde ela escolhe o mais provável. */
export function listenLanguages(cfg: ListenConfig): { lang: ListenLanguage } | { langs: ListenLanguage[] } {
  if (cfg.mode === "fixed") return { lang: cfg.lang };
  if (cfg.mode === "practice") return { langs: [cfg.practice, "pt"] };
  return { langs: cfg.langs };
}

/** Idioma em que o Jarvis deve RESPONDER e falar (RN-H6). Fora do modo prática é o português. */
export function replyLanguage(cfg: ListenConfig): ListenLanguage {
  return cfg.mode === "practice" ? cfg.practice : "pt";
}

/** RN-C5: quanto rigor antes de despachar uma fala. */
export type VoiceGateLevel = "fast" | "balanced" | "strict";

/** Nível salvo; na ausência, migra da chave antiga `relevance` (desligada → rápido). */
export function normalizeGateLevel(cfg: { gateLevel?: unknown; relevance?: unknown }): VoiceGateLevel {
  if (cfg.gateLevel === "fast" || cfg.gateLevel === "balanced" || cfg.gateLevel === "strict") return cfg.gateLevel;
  return cfg.relevance === "off" ? "fast" : "balanced";
}

/** Abaixo desta confiança da transcrição, vale pagar a correção por IA (proposta; ajustar com F0). */
export const DEFAULT_CORRECT_BELOW = 0.45;

const FILLER_ONLY = /^(h+u+m+|h+m+|a+h+n*|[eé]+h*|u+h+|u+h*u+m+|[ãa]+h+|tipo|ent[ãa]o|t[áa])[\s.,!?…]*$/i;
const ADDRESSES_JARVIS = /^\s*(ei\s+|oi\s+|ok\s+|hey\s+)?jarvis\b/i;

export interface VoiceGateInput {
  text: string;
  level: VoiceGateLevel;
  /** A gravação abriu sozinha (escuta contínua / reabertura depois de responder), não por toque. */
  handsFree: boolean;
  /** A conversa foi aberta pela palavra de ativação ("Hey Jarvis") — isso já é se dirigir ao Jarvis. */
  wakeWord?: boolean;
  /** A identificação de falante reconheceu o dono. */
  speakerKnown: boolean;
  /** Confiança da transcrição, 0..1. Ausente quando o serviço não informa. */
  confidence?: number;
  /** Frase de controle já reconhecida (confirmar, abortar, encerrar). */
  isControl?: boolean;
  correctBelow?: number;
}

export interface VoiceGateDecision {
  /** Descartar sem chamar nada. */
  drop: boolean;
  /** Chamar o modelo de correção + relevância. */
  callModel: boolean;
  /** O veredito de relevância do modelo pode descartar a fala. Falso = o modelo só corrige o texto. */
  modelMayDrop: boolean;
  /** Por que — vai para a telemetria e ajuda a calibrar o que conta como "ambíguo". */
  reason: string;
}

/**
 * Decide se uma fala vai direto, é descartada ou precisa do modelo — o modelo custava de 1,4 s a
 * 98,8 s (mediana 4,6 s) em TODA fala antes desta regra.
 *
 * Sinais de intenção explícita dispensam o portão no nível equilibrado: tocar no microfone, dizer
 * "Jarvis", uma frase de controle, ou a voz reconhecida do dono. O caso que sobra para o modelo é o
 * que o portão existe para pegar: escuta aberta sozinha, voz não reconhecida — conversa ambiente.
 */
export function voiceGateDecision(input: VoiceGateInput): VoiceGateDecision {
  const text = (input.text || "").trim();
  if (text.length < 2) return { drop: true, callModel: false, modelMayDrop: false, reason: "vazia" };
  const lowConfidence = typeof input.confidence === "number" && input.confidence < (input.correctBelow ?? DEFAULT_CORRECT_BELOW);
  if (input.level === "strict") return { drop: false, callModel: true, modelMayDrop: true, reason: "rigoroso" };
  if (input.level === "fast") return { drop: false, callModel: false, modelMayDrop: false, reason: "rapido" };
  // Equilibrado.
  if (input.isControl) return { drop: false, callModel: false, modelMayDrop: false, reason: "controle" };
  if (FILLER_ONLY.test(text)) return { drop: true, callModel: false, modelMayDrop: false, reason: "so_hesitacao" };
  const why = input.wakeWord ? "palavra_de_ativacao" : !input.handsFree ? "toque" : input.speakerKnown ? "dono_reconhecido" : ADDRESSES_JARVIS.test(text) ? "chamou_jarvis" : "";
  if (why) return lowConfidence
    ? { drop: false, callModel: true, modelMayDrop: false, reason: "baixa_confianca" }
    : { drop: false, callModel: false, modelMayDrop: false, reason: why };
  return { drop: false, callModel: true, modelMayDrop: true, reason: "ambigua" };
}
