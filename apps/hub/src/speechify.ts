/**
 * speechify — turn agent markdown into speech-friendly text for TTS.
 *
 * The chat keeps the FULL rich text; only what we SPEAK is cleaned. Things that
 * make no sense read aloud (code blocks, tables, images, long inline code, URLs,
 * emojis, markdown symbols) are dropped or replaced by a short "no chat" cue —
 * so the voice stays natural and points you to the screen for the details.
 *
 * This is the deterministic layer. A smarter "spoken summary" (LLM pass) can sit
 * on top later; this alone fixes reading '**', '`', tables, images, etc.
 */

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{2122}\u{2139}]/gu;

function cleanInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, a) => (a ? `imagem: ${a}, no chat` : "imagem no chat"))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> text only
    .replace(/`([^`]+)`/g, (_m, c) => (c.length > 40 ? "código no chat" : c)) // inline code
    .replace(/^#{1,6}\s+/, "") // headers
    .replace(/^\s{0,3}(?:[>\-*+]|\d+[.)])\s+/, "") // list / quote markers
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/, "") // horizontal rule
    .replace(/(\*\*|__|\*|_|~~|`)/g, "") // emphasis / stray backticks
    .replace(/https?:\/\/\S+/g, "link") // don't read full URLs
    .replace(EMOJI, "")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

export function speechify(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  let tableRun = 0;

  const flushTable = () => {
    if (tableRun >= 2) out.push("(tabela no chat)");
    tableRun = 0;
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        flushTable();
        out.push("(trecho de código no chat)");
        inFence = true;
      } else {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue; // skip code content entirely
    if (/\|/.test(line) && /\S\s*\|\s*\S/.test(line)) {
      tableRun++; // looks like a table row
      continue;
    }
    flushTable();
    out.push(cleanInline(line));
  }
  flushTable();

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Cap for spoken length: speak a chunk, then point to the chat. */
export function speechifyCapped(md: string, max = 700): string {
  let s = speechify(md);
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "") + "… o restante está no chat.";
  return s;
}

// Self-test: `npx tsx apps/hub/src/speechify.ts`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("speechify.ts")) {
  const sample = [
    "## Resultado 🎯",
    "Encontrei **3 problemas** no arquivo `config.ts` (veja [o PR](https://x.com/pr/1)):",
    "",
    "| Item | Status |",
    "|------|--------|",
    "| auth | ✅ ok |",
    "| db   | ❌ erro |",
    "",
    "```ts",
    "const x = 42; // não falar isto",
    "```",
    "![diagrama](https://x/img.png)",
    "- primeiro ponto",
    "- segundo ponto com `umTrechoDeCodigoBemLongoQueNaoFazSentidoFalar()`",
  ].join("\n");
  console.log("--- ANTES ---\n" + sample + "\n\n--- FALADO ---\n" + speechify(sample));
}
