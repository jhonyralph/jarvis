/**
 * Aplicar o `instructions.md` do framework num turno — sem repetir o que a IA já lê sozinha.
 *
 * O buraco que isto fecha: `instructions.md` era guardado, versionado, publicado para a frota inteira
 * e vigiado no orçamento de tokens do inventário — e não era aplicado em turno NENHUM. Era a única
 * das cinco partes do padrão que prometia e não entregava. Só existia o caminho de entrada (ler o
 * CLAUDE.md/AGENTS.md da máquina para semear o arquivo), nunca a volta.
 *
 * Por que não basta prepender o arquivo: ele nasce da CONCATENAÇÃO dos arquivos nativos da máquina
 * (`collectNativeFrameworkFiles`), e o Claude Code já carrega o `~/.claude/CLAUDE.md` por conta
 * própria em todo turno. Prepender o conjunto mandaria o mesmo texto duas vezes no mesmo prompt —
 * custo dobrado para dizer a mesma coisa, e um modelo lendo instruções repetidas. Então descontamos
 * o que já é nativo e injetamos só o RESTO, que é exatamente o que aquela IA não veria de outro jeito.
 *
 * Puro: texto → texto. Sem filesystem e sem rede; quem lê os arquivos é o chamador.
 */

/** Trecho curto demais para casar com segurança — abaixo disso um "match" seria coincidência. */
const MIN_BLOCO = 40;

/** Cabeçalhos que `collectNativeFrameworkFiles` escreve ao concatenar as fontes nativas. */
const CABECALHO_FONTE = /^#\s+(Claude \(CLAUDE\.md\)|AGENTS\.md|Gemini \(GEMINI\.md\))\s*$/gm;
const EH_CABECALHO_FONTE = /^#\s+(Claude \(CLAUDE\.md\)|AGENTS\.md|Gemini \(GEMINI\.md\))\s*$/;
const EH_SEPARADOR = /^\s*---\s*$/;

/**
 * Descarta a seção cujo corpo sumiu no desconto — o cabeçalho sozinho é ruído.
 *
 * Encontrado em produção, não em teste: com o `# Claude (CLAUDE.md)` descontado e o `# AGENTS.md`
 * sobrando, o turno recebia "# Claude (CLAUDE.md)" seguido de "---" e nada mais. A guarda que eu
 * tinha só cobria o caso em que TUDO era nativo; a mistura (uma seção vazia, outra cheia) passava.
 */
function dropEmptySourceSections(texto: string): string {
  const linhas = texto.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < linhas.length && !EH_CABECALHO_FONTE.test(linhas[i])) { out.push(linhas[i]); i++; }   // preâmbulo
  while (i < linhas.length) {
    const cabecalho = linhas[i++];
    const corpo: string[] = [];
    while (i < linhas.length && !EH_CABECALHO_FONTE.test(linhas[i])) corpo.push(linhas[i++]);
    // "Tem conteúdo" ignora linhas vazias e separadores: é só a moldura que sobrou.
    if (corpo.some((l) => l.trim() && !EH_SEPARADOR.test(l))) out.push(cabecalho, ...corpo);
  }
  return out.join("\n");
}

function normalizarFim(texto: string): string {
  return texto
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    // separador solto no começo/fim não separa nada — sobra do bloco que saiu
    .replace(/^(?:\s*---\s*\n)+/, "")
    .replace(/(?:\n\s*---\s*)+$/, "")
    .trim();
}

/**
 * O que ainda precisa ser injetado, dado o que a IA já carrega nativamente.
 *
 * Cada conteúdo nativo presente no texto do framework é REMOVIDO — não marcado, não resumido: se a
 * IA já lê aquilo, repetir só gasta contexto. Sobrando apenas cabeçalhos de fonte órfãos e
 * separadores, devolve string vazia, e o chamador não injeta nada.
 */
export function pendingInstructions(frameworkInstructions: string, nativeContents: string[] = []): string {
  let out = String(frameworkInstructions ?? "");
  if (!out.trim()) return "";

  for (const raw of nativeContents) {
    const bloco = String(raw ?? "").trim();
    if (bloco.length < MIN_BLOCO) continue;
    // `split/join` remove TODAS as ocorrências e trata o bloco como texto literal (um `replace` com
    // string faria só a primeira, e um RegExp exigiria escapar o markdown inteiro).
    if (out.includes(bloco)) out = out.split(bloco).join("");
  }

  // Sobrou só a moldura? Então nada de novo restou para dizer.
  const semMoldura = out.replace(CABECALHO_FONTE, "").replace(/^\s*---\s*$/gm, "").trim();
  if (!semMoldura) return "";

  return normalizarFim(dropEmptySourceSections(out));
}

/** Cabeçalho que identifica a origem do texto no prompt — o modelo precisa saber que a regra é do
 *  dono do framework, e não algo que o usuário escreveu naquele turno. */
export function buildInstructionsSteering(pending: string): string {
  const corpo = String(pending ?? "").trim();
  if (!corpo) return "";
  return `Instruções universais do Framework Jarvis (valem para todo turno, em qualquer IA):\n\n${corpo}`;
}
