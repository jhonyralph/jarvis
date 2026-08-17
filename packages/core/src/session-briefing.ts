/**
 * Ponte de contexto: o que o Jarvis publicou NA CONVERSA sem passar pela IA da sessão.
 *
 * Debate, Conselho e Torneio rodam como execuções one-shot FORA da sessão. O resultado é gravado no
 * transcript do Jarvis e aparece no chat, mas o provedor retoma o transcript NATIVO dele (`--resume`,
 * `sessionContinuity: "native_id"`), então aquelas mensagens nunca chegam nele. O efeito prático é o
 * que o usuário relatou: o debate termina, você pergunta "e aí, o que fazemos?" e a IA não faz ideia
 * do que você está falando — o trabalho aconteceu, mas não na cabeça dela.
 *
 * A ponte entrega esse resultado UMA vez, no próximo turno, como contexto. Não é histórico (não vira
 * transcript nativo) e não é pedido: é a resposta para "de que conversa nós dois estamos falando".
 *
 * Este módulo é PURO — só formata o bloco. Quem guarda a fila e decide quando entregar é o Hub, que é
 * quem tem sessão.
 */

/** Teto por resultado. Uma síntese de debate cabe folgada; um veredito gigante entra cortado e o corte
 *  é declarado, porque cortar em silêncio faria a IA responder sobre metade do material achando que
 *  viu tudo. */
export const SESSION_BRIEFING_MAX_CHARS = 4000;
/** Quantos resultados pendentes cabem num turno. Acima disso vencem os MAIS RECENTES. */
export const SESSION_BRIEFING_MAX_ITEMS = 3;

export interface SessionBriefingItem {
  /** rótulo curto do que rodou, com ícone — ex.: "🗣️ Debate", "🧠 Conselho". */
  kind: string;
  /** o texto que foi publicado na conversa (o mesmo que o usuário está vendo). */
  body: string;
}

/** Item como fica no disco: um briefing precisa sobreviver ao restart do Hub, que é justamente o que
 *  acontece entre o resultado sair e você voltar a falar. */
export interface StoredSessionBriefing extends SessionBriefingItem {
  at: number;
}

/** Depois disso, contexto vira ruído: ninguém foi buscar, a conversa seguiu. */
export const SESSION_BRIEFING_TTL_MS = 12 * 60 * 60 * 1000;
/** Tetos do arquivo. Um JSON sem teto já custou caro neste projeto — o limite é regra, não sorte. */
export const SESSION_BRIEFING_MAX_SESSIONS = 50;
export const SESSION_BRIEFING_MAX_PER_SESSION = 5;

/**
 * Saneia a fila persistida: descarta expirado e malformado, aplica os tetos e mantém o mais recente.
 *
 * Usado no MESMO ponto na leitura e na escrita de propósito — dois lugares aplicando "o mesmo" limite
 * é como um deles acaba aplicando outro, e aí o arquivo cresce pelo lado que ninguém olhou.
 */
export function pruneStoredBriefings(raw: unknown, now: number): Record<string, StoredSessionBriefing[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const limpo: Array<[string, StoredSessionBriefing[]]> = [];
  for (const [sessionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!sessionId || !Array.isArray(value)) continue;
    const items = value
      .filter((i: any): i is StoredSessionBriefing =>
        !!i && typeof i.body === "string" && !!i.body.trim() && Number.isFinite(Number(i.at)) && now - Number(i.at) < SESSION_BRIEFING_TTL_MS)
      .map((i) => ({ kind: String(i.kind || "Resultado"), body: i.body, at: Number(i.at) }))
      .slice(-SESSION_BRIEFING_MAX_PER_SESSION);
    if (items.length) limpo.push([sessionId, items]);
  }
  // Sessão mais recente primeiro: se algo tem de cair pelo teto, que seja a conversa mais parada.
  limpo.sort((a, b) => (b[1][b[1].length - 1]?.at || 0) - (a[1][a[1].length - 1]?.at || 0));
  return Object.fromEntries(limpo.slice(0, SESSION_BRIEFING_MAX_SESSIONS));
}

function clip(body: string): string {
  const t = body.trim();
  if (t.length <= SESSION_BRIEFING_MAX_CHARS) return t;
  return `${t.slice(0, SESSION_BRIEFING_MAX_CHARS)}\n[…cortado em ${SESSION_BRIEFING_MAX_CHARS} caracteres — o texto completo está na conversa]`;
}

/**
 * Bloco pronto para ser prependado ao turno. String vazia quando não há nada pendente, para o
 * chamador concatenar sem condicional.
 */
export function buildSessionBriefingBlock(items: SessionBriefingItem[]): string {
  const usable = items.filter((i) => i && String(i.body ?? "").trim());
  if (!usable.length) return "";
  const omitidos = Math.max(0, usable.length - SESSION_BRIEFING_MAX_ITEMS);
  const kept = usable.slice(-SESSION_BRIEFING_MAX_ITEMS);
  return [
    "CONTEXTO QUE VOCÊ NÃO VIU — o Jarvis rodou isto NESTA conversa, fora da sua sessão, então nada disso está no seu histórico.",
    'Se o usuário falar "o debate", "o conselho", "o resultado" ou "a conclusão", é disto que ele está falando.',
    ...(omitidos ? [`(${omitidos} resultado(s) mais antigo(s) omitido(s) — os mais recentes valem)`] : []),
    ...kept.flatMap((i) => ["", `### ${String(i.kind || "Resultado").trim()}`, clip(String(i.body))]),
    "",
    "Trate como contexto da conversa: não refaça o trabalho, não repita o texto inteiro de volta e não leia isto como um pedido novo. O pedido do usuário vem abaixo.",
  ].join("\n");
}
