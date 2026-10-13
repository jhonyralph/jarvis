/**
 * Cartões de decisão — a parte PURA da detecção pós-turno (o Hub só chama o modelo e publica).
 *
 * Um modelo barato lê a resposta da IA e, se ela PEDE decisão ao usuário, devolve perguntas com opções
 * que viram o cartão. Três falhas reais motivaram este módulo (2026-10-13):
 *  1. O modelo recebia só os PRIMEIROS 4000 caracteres — e é no FIM que a resposta pergunta. ~27% das
 *     respostas passam disso: nelas, as perguntas eram cortadas e o cartão saía parcial ou inventado.
 *  2. O prompt mandava "GERAR opções plausíveis" quando a resposta não listava nenhuma — alucinação por
 *     instrução. Pergunta aberta agora fica sem cartão: o usuário responde digitando.
 *  3. O gatilho era "tem `?` em algum lugar" — `?.` de código e `?x=1` de URL disparavam a chamada.
 * E não havia rastro nenhum: o resultado de cada detecção e o que o usuário fez com o cartão agora
 * viram eventos no log (só metadados — índices e contagens, nunca o texto; ver logger.ts).
 */

export interface AskOption { label: string; desc: string }
export interface AskQuestion { header: string; question: string; multi: boolean; options: AskOption[] }

/** Teto do trecho da resposta enviado ao modelo, e quanto dele vem do COMEÇO (contexto). O resto é o fim. */
export const ASK_REPLY_BUDGET = 4000;
export const ASK_REPLY_HEAD = 800;
/** A mensagem do usuário entra só como contexto ("o que foi pedido") — curta de propósito. */
export const ASK_USER_BUDGET = 600;

const FENCE_RE = /(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;

/** Blocos cercados (```/~~~) viram um marcador: código não é pergunta e é o que mais pesa no trecho. */
export function stripFencedCode(text: string): string {
  return String(text || "").replace(FENCE_RE, (_m, lead: string) => `${lead}[código omitido]`);
}

/** Há pergunta em PROSA? Ignora código (cercado e inline) e URLs — `a?.b` e `?q=1` não são perguntas. */
export function hasProseQuestion(text: string): boolean {
  const prose = stripFencedCode(text).replace(/`[^`\n]*`/g, " ").replace(/\bhttps?:\/\/\S+/gi, " ");
  return prose.includes("?");
}

/** Corta preservando começo E fim: o começo diz do que se trata, o fim é onde a resposta pergunta. */
export function excerptKeepingEnd(text: string, budget = ASK_REPLY_BUDGET, head = ASK_REPLY_HEAD): { text: string; truncated: boolean } {
  const t = String(text || "");
  if (t.length <= budget) return { text: t, truncated: false };
  const h = Math.max(0, Math.min(head, budget));
  const tail = budget - h;
  return { text: `${t.slice(0, h)}\n\n[… trecho do meio omitido …]\n\n${tail > 0 ? t.slice(-tail) : ""}`, truncated: true };
}

export interface AskInput {
  skip?: "short" | "no_question";
  prompt?: string;
  replyChars: number;
  sentChars: number;
  truncated: boolean;
}

export function buildAskPrompt(replyText: string, userText?: string): AskInput {
  const reply = String(replyText || "").trim();
  if (reply.length < 12) return { skip: "short", replyChars: reply.length, sentChars: 0, truncated: false };
  if (!hasProseQuestion(reply)) return { skip: "no_question", replyChars: reply.length, sentChars: 0, truncated: false };
  const ex = excerptKeepingEnd(stripFencedCode(reply));
  const user = excerptKeepingEnd(String(userText || "").trim(), ASK_USER_BUDGET, ASK_USER_BUDGET / 2).text;
  const prompt =
    "Você analisa a RESPOSTA de um assistente de desenvolvimento e detecta se ela PEDE decisões ao usuário (escolher alternativas, priorizar itens, confirmar rumo).\n" +
    'Se SIM, devolva JSON estrito: {"questions":[{"header":"título curto","question":"a pergunta, clara e autoexplicativa","multi":false,"options":[{"label":"opção curta, com \\"(Recomendado)\\" no fim SE a resposta recomendar essa","desc":"detalhe"}]}]}\n' +
    "Regras:\n" +
    "- Só conta pergunta DIRIGIDA AO USUÁRIO, que espera a resposta dele para seguir. NÃO conta: pergunta retórica, pergunta que a própria resposta já respondeu, pergunta citada como exemplo, e oferta genérica de ajuda sem ação concreta.\n" +
    "- Extraia TODAS as decisões pedidas — se ela pede 5, gere as 5 (não corte nem junte). As perguntas costumam estar no FIM da resposta.\n" +
    "- Opções (2 a 6): use as que a resposta oferece, com o sentido dela. Se a pergunta é de confirmação (posso seguir? implemento?), use opções curtas de confirmar e de recusar. Se a pergunta é ABERTA (pede um nome, um valor, uma explicação) e a resposta não oferece opções, NÃO a inclua — o usuário responde digitando. Nunca invente alternativas que a resposta não sustenta.\n" +
    "- \"(Recomendado)\" só na opção que a RESPOSTA recomenda; se ela não recomenda nenhuma, não marque nenhuma.\n" +
    "- header ~2-5 palavras; question 1-2 linhas — curtos, entendíveis sem abrir o histórico.\n" +
    "- label: curto (uma linha). desc: o que a resposta já diz dessa opção (o que faz, custo, consequência); se ela não explicou, deixe curto ou vazio. NÃO invente justificativa.\n" +
    "- multi=true SOMENTE quando o usuário escolhe VÁRIOS itens de uma lista; multi=false quando é UMA alternativa entre outras.\n" +
    "- NÃO inclua 'Outros' (a UI adiciona).\n" +
    'Se a resposta NÃO pede decisão, devolva {"questions":[]}. Responda APENAS o JSON.\n\n' +
    (user ? `MENSAGEM DO USUÁRIO (só contexto do que foi pedido — NÃO extraia decisões daqui):\n${user}\n\n` : "") +
    `RESPOSTA${ex.truncated ? " (longa: o meio foi omitido; começo e fim estão íntegros)" : ""}:\n${ex.text}`;
  return { prompt, replyChars: reply.length, sentChars: ex.text.length, truncated: ex.truncated };
}

/** JSON do modelo → perguntas válidas, com os mesmos tetos que o cartão sempre teve. */
export function parseAskQuestions(raw: string): { questions: AskQuestion[]; error?: "no_json" | "bad_json" | "bad_shape" } {
  const m = String(raw ?? "").match(/\{[\s\S]*\}/);
  if (!m) return { questions: [], error: "no_json" };
  let qs: unknown;
  try { qs = JSON.parse(m[0])?.questions; } catch { return { questions: [], error: "bad_json" }; }
  if (!Array.isArray(qs)) return { questions: [], error: "bad_shape" };
  const questions = qs
    .filter((q: any) => q && q.question && Array.isArray(q.options) && q.options.length)
    .slice(0, 6)
    .map((q: any) => ({
      header: String(q.header || "").slice(0, 40),
      question: String(q.question).slice(0, 300),
      multi: !!q.multi,
      options: q.options.slice(0, 8).map((o: any) => ({ label: String(o?.label ?? o ?? "").slice(0, 100), desc: String(o?.desc ?? "").slice(0, 500) })).filter((o: AskOption) => o.label),
    }))
    .filter((q: AskQuestion) => q.options.length);
  return { questions };
}

const RECOMMENDED_RE = /\(recomendad[oa]\)/i;

/** Formato das perguntas para o log: só números (quantas opções, qual era a recomendada, se é múltipla). */
export function askShape(questions: unknown[]): Array<{ n: number; rec: number; multi: boolean }> {
  return (Array.isArray(questions) ? questions : []).map((q: any) => {
    const opts: any[] = Array.isArray(q?.options) ? q.options : [];
    return { n: opts.length, rec: opts.findIndex((o) => RECOMMENDED_RE.test(String(o?.label ?? ""))), multi: !!q?.multi };
  });
}

export type AskOutcomeKind = "answered" | "dismissed" | "typed" | "superseded" | "cleared";
const OUTCOME_KINDS: readonly AskOutcomeKind[] = ["answered", "dismissed", "typed", "superseded", "cleared"];

/**
 * O que o usuário fez com o cartão, reduzido a métricas: respondeu? escolheu a recomendada? precisou
 * do "Outros" (sinal de opções ruins)? O payload vem do cliente — tudo é saneado e limitado aqui.
 *  - answered: enviou pelo cartão;  typed: ignorou o cartão e escreveu no composer;
 *  - dismissed: parou o cartão;  superseded: um turno novo começou com o cartão pendente;
 *  - cleared: cliente antigo, que limpa sem dizer por quê.
 */
export function summarizeAskOutcome(questions: unknown[], raw: unknown): Record<string, unknown> {
  const o: any = raw && typeof raw === "object" ? raw : {};
  const kind: AskOutcomeKind = OUTCOME_KINDS.includes(o.kind) ? o.kind : "cleared";
  const shape = askShape(questions);
  const out: Record<string, unknown> = { kind, questions: shape.length, shape };
  if (kind !== "answered") return out;
  const picks: number[][] = shape.map((s, i) => {
    const p = Array.isArray(o.picks) ? o.picks[i] : undefined;
    return Array.isArray(p) ? [...new Set(p.filter((x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < s.n) as number[])].slice(0, 8) : [];
  });
  const other: boolean[] = shape.map((_s, i) => Array.isArray(o.other) ? o.other[i] === true : false);
  out.picks = picks;
  out.other = other.filter(Boolean).length;
  // Das perguntas que TINHAM recomendada, em quantas o usuário ficou com ela.
  const withRec = shape.map((s, i) => ({ s, i })).filter(({ s }) => s.rec >= 0);
  out.withRecommended = withRec.length;
  out.pickedRecommended = withRec.filter(({ s, i }) => picks[i].includes(s.rec)).length;
  return out;
}
