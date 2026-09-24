/**
 * Reconstrução de turnos que sumiram do histórico do Jarvis mas continuam no transcript do provedor.
 *
 * POR QUE EXISTE: o transcript nativo (rollout do codex, .jsonl do claude) é a fonte durável do que
 * realmente aconteceu — o store do Jarvis é uma projeção dele. Quando a projeção perde um turno, o
 * dado não morreu: ficou invisível. Já aconteceu por cancelamento (o `dropLast` apagava a pergunta
 * de um turno que a IA tinha trabalhado) e pode acontecer de novo por qualquer motivo — Hub morto no
 * meio, disco cheio, projeção que falha.
 *
 * `reconcileFromNative` no Hub/runner já cobre o caso da CAUDA: última mensagem é `user`, a resposta
 * existe no transcript, backfill. O que falta — e é o formato do incidente de 2026-09-23 — é o
 * buraco no MEIO: o turno inteiro (pergunta + resposta) sumiu, então não sobra nem a âncora que
 * aquele mecanismo exige.
 */

export interface GapMessage { role: "user" | "assistant"; text: string; ts: number; activity?: unknown[] }
export interface HistoryGap { user: GapMessage; assistant: GapMessage }

/**
 * Texto que NINGUÉM digitou: o Jarvis, a skill ou o próprio CLI injetaram no prompt.
 *
 * Isto é o coração da precisão desta funcionalidade. O transcript nativo guarda o prompt EXPANDIDO
 * — comando de skill resolvido, steering de fluxo, avisos de compactação —, enquanto o store guarda
 * o que a pessoa escreveu. Comparar os dois sem este filtro produz um falso positivo atrás do outro:
 * medido nesta instalação, 125 "turnos perdidos" caíram para ~20 depois de filtrar, e o resto eram
 * expansões. Restaurar um falso positivo é PIOR que o buraco — polui a conversa com ruído de
 * máquina e, pior, vira contexto do próximo turno.
 */
const INJECTED_PROMPT = [
  /^continue from where you left off/i,
  /^this session is being continued from a previous conversation/i,
  /^caveat: the messages below were generated/i,
  /^fluxo de trabalho ativo:/i,
  /^imagens? anexadas?\b/i,
  /^\[request interrupted/i,
  /^<local-command-(stdout|stderr)>/i,
  /^<[a-z][a-z0-9_-]*>/i,          // qualquer envelope em tag (<recommended_plugins>, <system-reminder>…)
  /^api error/i,
  /^load and follow the .{1,60} skill/i,
  /^approach this as the /i,        // output-style/persona do provedor, não pedido de ninguém
  /^modo:\s*[a-zçãéó]+\b[\s\S]*##\s*instru/i,
  // Preâmbulo de persona de skill: uma linha de parâmetros entre crases e o "You are …" logo
  // depois. É a cara do /code-review expandido ("`high effort → 3+5 angles …` You are …"), que no
  // dry-run era o último falso positivo de pé.
  /^`[^`]{0,160}`\s*you are\b/i,
];

/**
 * Marcas de skill/comando EXPANDIDO, em qualquer posição do texto.
 *
 * Separadas das de cima porque o caso é outro e foi o que quase estragou esta funcionalidade: a
 * pessoa digita `Na skill /jarvis:x, faça Y` e o transcript nativo guarda `Na skill Use a
 * competência "…" do Framework Jarvis. Instruções: …`. O começo é IGUAL, a expansão acontece no
 * MEIO — então nem o filtro de prefixo nem o casamento por cabeça salvavam, e o turno (que está
 * inteiro no store, só que na forma digitada) aparecia como perdido. No dry-run contra os
 * transcripts reais desta instalação isto era a maioria: 17 propostas caíram para 5 depois destas
 * regras, e as 12 removidas eram todas expansão, nenhuma perda de verdade.
 */
const EXPANDED_MARKERS = [
  /use a compet[êe]ncia\s+"[^"]+"\s+do framework jarvis/i,
  /base directory for this skill:/i,
  /#\s*path:\s*\.agent\//i,
  /##\s*instru[çc][õo]es para execu[çc][ãa]o/i,
];

/** Comprimento abaixo do qual não dá para distinguir prompt humano de fragmento do protocolo. */
const MIN_HUMAN_CHARS = 12;
/** Teto por sessão: um número alto aqui significa que o casamento está errado, não que houve perda
 *  em massa. Melhor restaurar pouco e certo do que despejar um transcript inteiro na conversa. */
export const MAX_GAPS_PER_SESSION = 20;

export function normalizePrompt(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function isInjectedPrompt(text: unknown): boolean {
  const t = normalizePrompt(text);
  if (t.length < MIN_HUMAN_CHARS) return true;
  if (INJECTED_PROMPT.some((re) => re.test(t))) return true;
  return EXPANDED_MARKERS.some((re) => re.test(t));
}

/** Cabeça usada para casar store × nativo.
 *
 *  CURTA de propósito (24, não 40): a expansão de comando acontece no MEIO da frase, então uma
 *  cabeça longa cai dentro do trecho expandido e declara perdido um turno que está ali. Uma cabeça
 *  curta erra para o outro lado — dois turnos que começam igual podem ser confundidos e o perdido
 *  não é restaurado. Esse é o erro que queremos: **falso negativo é um buraco que continua; falso
 *  positivo é lixo de máquina inserido na conversa, que ainda vira contexto do próximo turno.** */
const MATCH_HEAD = 24;

/** O store tem o texto DIGITADO; o nativo tem o EXPANDIDO. Casa nos dois sentidos, por cabeça, em
 *  vez de exigir igualdade — senão todo turno com skill ou comando parece perdido. */
function matchesAnyStored(nativeText: string, stored: string[]): boolean {
  const head = nativeText.slice(0, MATCH_HEAD);
  return stored.some((s) => {
    if (!s) return false;
    return s.startsWith(head) || nativeText.startsWith(s.slice(0, MATCH_HEAD)) || nativeText.includes(s.slice(0, 60));
  });
}

/**
 * Turnos presentes no transcript nativo e ausentes do store, em ordem cronológica.
 *
 * Só devolve turno COMPLETO (pergunta + resposta): um par é evidência de que o turno realmente
 * aconteceu, enquanto uma pergunta solta pode ser um prompt reenviado, um fragmento de retomada ou
 * uma falha de casamento. Restaurar metade de um turno é a forma mais fácil de transformar uma
 * recuperação em corrupção.
 */
export function findHistoryGaps(
  storeMessages: ReadonlyArray<{ role?: string; text?: string; ts?: number }>,
  nativeMessages: ReadonlyArray<{ role?: string; text?: string; ts?: number; activity?: unknown[] }>,
  limit = MAX_GAPS_PER_SESSION,
): HistoryGap[] {
  const stored = storeMessages.filter((m) => m?.role === "user").map((m) => normalizePrompt(m.text));
  const natives = nativeMessages.filter((m) => m?.role === "user" || m?.role === "assistant");
  const gaps: HistoryGap[] = [];

  for (let i = 0; i < natives.length; i++) {
    const m = natives[i];
    if (m.role !== "user") continue;
    const text = normalizePrompt(m.text);
    if (isInjectedPrompt(text) || matchesAnyStored(text, stored)) continue;

    // A resposta é o primeiro assistant ANTES do próximo turno de usuário: o que vier depois já
    // pertence a outra pergunta.
    let reply: typeof natives[number] | undefined;
    for (let j = i + 1; j < natives.length; j++) {
      if (natives[j].role === "user" && !isInjectedPrompt(natives[j].text)) break;
      if (natives[j].role === "assistant" && normalizePrompt(natives[j].text)) { reply = natives[j]; break; }
    }
    if (!reply) continue;

    const userTs = Number(m.ts) || 0, replyTs = Number(reply.ts) || 0;
    if (!userTs || !replyTs || replyTs < userTs) continue;   // sem tempo confiável não dá para ordenar

    gaps.push({
      user: { role: "user", text: String(m.text ?? ""), ts: userTs },
      assistant: { role: "assistant", text: String(reply.text ?? ""), ts: replyTs, activity: reply.activity },
    });
    if (gaps.length >= limit) break;
  }
  return gaps;
}

/** Mescla mensagens restauradas no histórico existente, em ordem de tempo. Não substitui nada: o
 *  que já estava no store é a verdade, o restaurado só preenche. */
export function mergeByTimestamp<T extends { ts?: number }>(existing: readonly T[], incoming: readonly T[]): T[] {
  if (!incoming.length) return [...existing];
  const out = [...existing, ...incoming];
  // Estável por construção: `sort` do V8 é estável, então um empate de ts preserva
  // "o que já estava" antes do "que chegou" — o restaurado nunca se intromete no meio de um par.
  return out.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
}
