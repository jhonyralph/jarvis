/**
 * Modo prática de idioma (VOZ-00, fase F6 — UC-15, RN-H3..H7).
 *
 * O dono quer usar o Jarvis para praticar idiomas, começando por inglês e espanhol. No modo prática a
 * escuta aceita o idioma praticado e o português (para pedir ajuda), o agente responde no idioma
 * praticado e a voz fala esse idioma. A correção curta depois da resposta começa ligada.
 *
 * Funções puras: reconhecer o comando de troca, montar a instrução para o agente, a confirmação
 * falada e os marcadores que a fala usa no lugar de tabela/código.
 */
import type { ListenLanguage } from "./voice-policy.js";

/** Nome do idioma, em português (para a instrução do agente e a tela). */
export const LANGUAGE_NAMES_PT: Record<ListenLanguage, string> = {
  pt: "português", en: "inglês", es: "espanhol", fr: "francês", it: "italiano", de: "alemão",
};

/** Nome do idioma em inglês — é o que a voz da nuvem entende melhor na instrução de pronúncia. */
export const LANGUAGE_NAMES_EN: Record<ListenLanguage, string> = {
  pt: "Brazilian Portuguese", en: "English", es: "Spanish", fr: "French", it: "Italian", de: "German",
};

const NAME_TO_LANG: Array<[RegExp, ListenLanguage]> = [
  [/^(ingl[eê]s|english|ingl[eé]s)$/i, "en"],
  [/^(espanhol|spanish|espa[nñ]ol|castelhano)$/i, "es"],
  [/^(franc[eê]s|french|franc[eé]s)$/i, "fr"],
  [/^(italiano|italian)$/i, "it"],
  [/^(alem[aã]o|german|alem[aá]n)$/i, "de"],
];

function langFromName(name: string): ListenLanguage | undefined {
  const n = name.trim();
  for (const [rx, lang] of NAME_TO_LANG) if (rx.test(n)) return lang;
  return undefined;
}

export type LanguageCommand = { action: "practice"; lang: ListenLanguage } | { action: "native" };

// A FALA INTEIRA precisa ser o comando (com "Jarvis" e "agora/um pouco" opcionais): "como se diz
// 'vamos praticar inglês' em inglês?" não pode trocar o modo.
const LEAD = String.raw`^\s*(?:(?:ei|oi|ok|hey)\s+)?(?:jarvis[\s,]+)?`;
const TAIL = String.raw`(?:\s+(?:agora|now|ahora|um pouco|a little|un poco|comigo|with me|conmigo))*\s*[.!?]*\s*$`;
const LANG_WORD = String.raw`([a-zçãâêéíñ]+)`;
const PRACTICE_RX = [
  new RegExp(`${LEAD}(?:vamos|bora|quero|posso)\\s+(?:praticar|treinar|conversar\\s+em)\\s+${LANG_WORD}${TAIL}`, "i"),
  new RegExp(`${LEAD}(?:let'?s|i\\s+want\\s+to)\\s+(?:practi[cs]e|speak|talk\\s+in)\\s+${LANG_WORD}${TAIL}`, "i"),
  new RegExp(`${LEAD}(?:vamos\\s+a\\s+|quiero\\s+)?(?:practicar|hablar\\s+en)\\s+${LANG_WORD}${TAIL}`, "i"),
];
const NATIVE_RX = [
  new RegExp(`${LEAD}(?:volta|voltar|volte|vamos\\s+voltar)\\s+(?:pro|pra|para\\s+o|ao)\\s+portugu[eê]s${TAIL}`, "i"),
  new RegExp(`${LEAD}(?:parar|pare|chega)\\s+de\\s+(?:praticar|treinar)${TAIL}`, "i"),
  new RegExp(`${LEAD}(?:(?:let'?s\\s+)?(?:go\\s+)?back|switch(?:\\s+back)?)\\s+to\\s+portuguese${TAIL}`, "i"),
  new RegExp(`${LEAD}stop\\s+practi[cs]ing${TAIL}`, "i"),
  new RegExp(`${LEAD}(?:volver|vuelve|volvamos)\\s+al\\s+portugu[eé]s${TAIL}`, "i"),
];

/** Reconhece "vamos praticar inglês" / "volta pro português" (e equivalentes em inglês/espanhol). */
export function parseLanguageCommand(text: string): LanguageCommand | null {
  const t = (text || "").trim();
  if (!t || t.length > 80) return null;
  for (const rx of NATIVE_RX) if (rx.test(t)) return { action: "native" };
  for (const rx of PRACTICE_RX) {
    const m = t.match(rx);
    if (!m) continue;
    const lang = langFromName(m[1]);
    if (lang && lang !== "pt") return { action: "practice", lang };
  }
  return null;
}

/** RN-H6/H7: instrução que vai junto da fala para o agente responder no idioma praticado. */
export function practiceInstruction(lang: ListenLanguage, correct: boolean): string {
  const name = LANGUAGE_NAMES_PT[lang];
  const tip = lang === "es" ? "Consejo:" : lang === "fr" ? "Astuce :" : lang === "it" ? "Consiglio:" : lang === "de" ? "Tipp:" : "Tip:";
  return [
    `[Prática de idioma — ${name}] O usuário está praticando ${name} por voz com você.`,
    `Responda SEMPRE em ${name}, com frases curtas e naturais de conversa falada (a resposta vai ser ouvida, não lida).`,
    `Se ele falar em português, ajude-o a dizer aquilo em ${name}, respondendo em ${name} simples.`,
    correct
      ? `Depois da resposta, se a fala dele em ${name} tiver erro de gramática, vocabulário ou naturalidade, acrescente UMA frase curta começando com "${tip}" mostrando como dizer melhor. Sem erro, não acrescente nada.`
      : "Não corrija a fala dele; só converse.",
  ].join(" ");
}

/** RN-H4: confirmação curta, já no idioma novo. */
export function languageSwitchConfirmation(cmd: LanguageCommand): string {
  if (cmd.action === "native") return "Certo, voltamos ao português.";
  switch (cmd.lang) {
    case "en": return "Okay, let's practice English. Go ahead!";
    case "es": return "¡Vale, practiquemos español! Adelante.";
    case "fr": return "D'accord, pratiquons le français. Allez-y !";
    case "it": return "Va bene, pratichiamo l'italiano. Vai!";
    case "de": return "Okay, lass uns Deutsch üben. Los geht's!";
    default: return "Certo.";
  }
}

/** RN-H6: o que a fala diz no lugar de tabela, código, imagem e link — no idioma da conversa. */
export interface SpeechMarkers { table: string; codeBlock: string; inlineCode: string; image: string; imageNamed: (alt: string) => string; link: string }

const MARKERS: Partial<Record<ListenLanguage, SpeechMarkers>> = {
  pt: { table: "(tabela no chat)", codeBlock: "(trecho de código no chat)", inlineCode: "código no chat", image: "imagem no chat", imageNamed: (a) => `imagem ${a}, no chat`, link: "link" },
  en: { table: "(table in the chat)", codeBlock: "(code in the chat)", inlineCode: "code in the chat", image: "image in the chat", imageNamed: (a) => `image ${a}, in the chat`, link: "link" },
  es: { table: "(tabla en el chat)", codeBlock: "(código en el chat)", inlineCode: "código en el chat", image: "imagen en el chat", imageNamed: (a) => `imagen ${a}, en el chat`, link: "enlace" },
};

/** Marcadores do idioma; idiomas sem tradução própria usam os do inglês. */
export function speechMarkers(lang: ListenLanguage = "pt"): SpeechMarkers {
  return MARKERS[lang] || MARKERS.en!;
}
