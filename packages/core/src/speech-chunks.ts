/**
 * Corte do texto falado em trechos (VOZ-00, fase F2).
 *
 * POR QUE EXISTE
 * A síntese recebia a resposta inteira e o primeiro som só saía depois de sintetizar TUDO. Cortando
 * em frases, a primeira é sintetizada sozinha e começa a tocar enquanto as seguintes são preparadas.
 *
 * RN-D2: o corte é em fronteira de sentido. Abreviações ("Sr.", "p. ex."), iniciais ("J. Silva"),
 * números ("3.5", "1.234"), versões ("0.40.0") e nomes de arquivo ("index.ts") não quebram frase.
 * Pontos sem espaço depois (números, versões, arquivos) nunca são fronteira; o resto é decidido
 * olhando a palavra antes do ponto.
 */

const ABBREVIATIONS = new Set([
  "sr", "sra", "srta", "dr", "dra", "prof", "profa", "eng", "ex", "exa", "etc", "obs", "aprox", "pág", "pag",
  "cap", "art", "fig", "nº", "n", "num", "vs", "av", "tel", "min", "máx", "max", "mín", "seg", "h",
  "mr", "mrs", "jr", "e.g", "i.e", "p.ex", "a.c", "d.c", "vol", "cit", "ref",
]);
// Sem meses abreviados de propósito: "mar", "set", "out" e "ago" (inglês) fecham frases de verdade.

/** Fronteira de frase no sinal `src[p]`, com `after` apontando para o que vem depois dele (já
 *  passadas aspas e parênteses de fechamento)? */
function isBoundary(src: string, p: number, after: number): boolean {
  const next = src[after];
  // Sem espaço depois ("3.5", "0.40.0", "index.ts") não é fim de frase — exceto no fim do texto.
  if (next !== undefined && !/\s/.test(next)) return false;
  if (src[p] !== ".") return true;
  if (src[p - 1] === ".") return true; // reticências em três pontos
  const raw = (src.slice(0, p).match(/(\S+)$/) || ["", ""])[1].replace(/^[("'“‘]+/, "");
  if (!raw) return true;
  if (ABBREVIATIONS.has(raw.toLowerCase())) return false;
  if (/^\p{Lu}$/u.test(raw)) return false; // inicial: "J. Silva"
  if (/^\d+$/.test(raw) && /^\s+\p{Ll}/u.test(src.slice(after))) return false; // "o passo 3. depois" segue
  return true;
}

/** Frases do texto, sem perder nada (a junção com espaço devolve o texto normalizado). */
export function splitSentences(text: string): string[] {
  const src = (text || "").replace(/\s+/g, " ").trim();
  if (!src) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (!/[.!?…]/.test(src[i])) continue;
    let p = i;
    while (p + 1 < src.length && /[.!?…]/.test(src[p + 1])) p++; // "?!", "..." fecham no último sinal
    let after = p + 1;
    while (after < src.length && /[)"'”’]/.test(src[after])) after++; // fechamentos ficam com a frase
    i = after - 1;
    if (!isBoundary(src, p, after)) continue;
    const piece = src.slice(start, after).trim();
    if (piece) out.push(piece);
    start = after;
  }
  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Trechos para sintetizar em sequência: a primeira frase sozinha (é ela que define o tempo até o
 * primeiro som) e o resto agrupado até `restMax` caracteres — trechos maiores pedem menos chamadas,
 * e a síntese de cada um acontece enquanto o anterior toca.
 *
 * Uma primeira frase muito curta ("Pronto.") ganha a seguinte junto: um som de meio segundo seguido
 * de silêncio enquanto o resto é sintetizado soa pior que esperar um pouco mais pelo primeiro trecho.
 */
export function speechChunks(text: string, opts: { firstMin?: number; restMax?: number } = {}): string[] {
  const firstMin = opts.firstMin ?? 24;
  const restMax = opts.restMax ?? 280;
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return sentences;
  let first = sentences.shift()!;
  while (first.length < firstMin && sentences.length) first += " " + sentences.shift()!;
  const chunks = [first];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > restMax) { chunks.push(cur); cur = s; }
    else cur = cur ? cur + " " + s : s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
