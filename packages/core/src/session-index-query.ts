/**
 * Busca entre sessões — a parte PURA (sem disco, sem SQLite): o que o usuário digita vira consulta
 * do índice FTS5, e o título casa pelas mesmas regras. Vive separada da worker para ser testável
 * e para o Hub/Runner usarem as mesmas regras na hora de destacar e de casar título.
 *
 * Regras (o que a busca antiga não fazia):
 *  - sem acento e sem caixa: "sessao" acha "Sessão" (o tokenizer do índice usa remove_diacritics 2,
 *    e `foldText` faz o mesmo para o título);
 *  - cada palavra vale como COMEÇO de palavra ("refat" acha "refatoração"), todas obrigatórias;
 *  - "entre aspas" é frase exata, na ordem;
 *  - termo com pontuação ("PRI-16", "a2p.ts") vira frase dos pedaços — o tokenizer também o corta.
 */

/** Marcadores de destaque que o índice devolve no trecho (o cliente troca por <mark>). */
export const SEARCH_MARK_START = "\u0001";
export const SEARCH_MARK_END = "\u0002";

/** Minúsculas, sem acento — o mesmo efeito do `remove_diacritics 2` do tokenizer. */
export function foldText(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface ParsedSearchQuery {
  /** palavras soltas, já dobradas (sem acento, minúsculas) */
  terms: string[];
  /** frases entre aspas, já dobradas */
  phrases: string[];
}

const MAX_QUERY_CHARS = 500;
const MAX_PARTS = 12;

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const q = String(raw || "").slice(0, MAX_QUERY_CHARS);
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]*)"/g, (_m, p: string) => {
    const f = foldText(p).replace(/\s+/g, " ").trim();
    if (f) phrases.push(f);
    return " ";
  });
  // Aspas sem par sobram no resto: viram espaço, não erro de sintaxe do FTS5.
  const terms = foldText(rest.replace(/"/g, " ")).split(/\s+/).map((t) => t.trim()).filter(Boolean);
  return { terms: dedupe(terms).slice(0, MAX_PARTS), phrases: dedupe(phrases).slice(0, MAX_PARTS) };
}

function dedupe(xs: string[]): string[] { return [...new Set(xs)]; }

/**
 * Consulta FTS5 para `raw`, ou null quando não sobra nada pesquisável. Cada parte vai entre aspas
 * (aspas internas dobradas) — assim nada que o usuário digita é interpretado como operador do
 * FTS5 (AND/OR/NOT/NEAR, parênteses, `:` de coluna, `*`, `^`).
 *
 * Palavra com menos de 2 letras/dígitos fica de fora: como prefixo ela casa quase tudo — medido no
 * índice real, "a" levava 4 s (todas as mensagens, ordenadas) e não filtrava nada. Se só sobrar
 * isso, não há consulta (o cliente pede pelo menos 2 letras).
 */
export function buildFtsQuery(raw: string): string | null {
  const { terms, phrases } = parseSearchQuery(raw);
  const quote = (s: string): string => '"' + s.replace(/"/g, '""') + '"';
  const parts: string[] = [];
  for (const p of phrases) if (searchableLength(p) >= 2) parts.push(quote(p));
  for (const t of terms) if (searchableLength(t) >= 2) parts.push(quote(t) + "*");
  return parts.length ? parts.join(" AND ") : null;
}

/** Quantas letras/dígitos a parte tem (pontuação não conta: o tokenizer a descarta). */
export function searchableLength(s: string): number {
  return [...String(s || "").replace(/[^\p{L}\p{N}]/gu, "")].length;
}

/** O título contém TODAS as palavras e frases (como trecho, sem acento)? Mesmo critério da busca antiga. */
export function titleMatches(title: string, parsed: ParsedSearchQuery): boolean {
  const all = [...parsed.terms, ...parsed.phrases];
  if (!all.length) return false;
  const t = foldText(title);
  return all.every((x) => t.includes(x));
}

/** Caminho comparável: barras normais, sem barra no fim, minúsculo. */
export function searchCwdKey(cwd: string): string {
  return String(cwd || "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** A sessão (pasta `cwd`) está no projeto `dir` — a própria pasta ou uma subpasta? (o filtro "projeto") */
export function sessionCwdWithin(cwd: string, dir: string): boolean {
  const a = searchCwdKey(cwd), b = searchCwdKey(dir);
  return !!b && (a === b || a.startsWith(b + "/"));
}

/** Tira os marcadores de destaque (para quem só quer o texto). */
export function stripSearchMarks(s: string): string {
  return String(s || "").split(SEARCH_MARK_START).join("").split(SEARCH_MARK_END).join("");
}

/**
 * Nota de uma sessão a partir dos trechos que casaram. `bestRank` é o bm25 do FTS5 (negativo:
 * quanto MENOR, melhor). Mais trechos ajudam pouco (log); sessão recente ganha até 50% (meia-vida
 * de ~30 dias) — empate de relevância desempata pela data, sem enterrar uma sessão antiga muito boa.
 */
export function sessionScore(bestRank: number, matches: number, updatedAt: number, now = Date.now()): number {
  const relevance = Math.max(0, -bestRank) * (1 + 0.15 * Math.log1p(Math.max(0, matches - 1)));
  const ageDays = Math.max(0, (now - (updatedAt || 0)) / 86_400_000);
  return relevance * (1 + 0.5 * Math.exp(-ageDays / 30));
}
