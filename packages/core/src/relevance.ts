/**
 * Voice relevance gate. The mic captures whatever is around — background noise, you talking to someone
 * else, a half-sentence — and without a filter that all gets transcribed and dispatched as a command
 * to a session. This builds the prompt for a FAST model to decide "is this actually a request for
 * Jarvis (or an on-topic follow-up)?" and parses its verdict. Complements the SPEAKER gate (voiceprint
 * = who spoke): this one judges whether what was said is meant for the assistant at all.
 *
 * Design: FAIL-OPEN. A missing/garbled verdict returns `relevant: true` — the gate is a best-effort
 * filter, never a hard wall, so a model glitch can never swallow a real command. Pure (no I/O) so the
 * prompt + parser are unit-tested; the hub supplies the model call.
 */
export function buildRelevancePrompt(text: string, context?: string): string {
  const hasCtx = !!(context && context.trim());
  return (
    "Você é um FILTRO de voz para o assistente de desenvolvimento Jarvis. O microfone pode ter captado " +
    "RUÍDO, uma conversa com OUTRA pessoa, ou uma fala solta que NÃO é um comando. Decida se a " +
    "transcrição abaixo é REALMENTE um pedido/comando/pergunta dirigido ao Jarvis" +
    (hasCtx ? ", ou uma continuação relacionada à conversa atual" : "") +
    ".\n\nResponda SOMENTE com JSON, sem texto extra: {\"relevante\": true} ou {\"relevante\": false}.\n" +
    "IRRELEVANTE (false): ruído/gaguejo, saudação ou conversa com outra pessoa, fragmento incompleto sem " +
    "intenção, ou fala sobre assunto totalmente alheio" + (hasCtx ? " ao tema da conversa" : "") + ".\n" +
    "RELEVANTE (true): um comando/pedido/pergunta claro para o assistente" +
    (hasCtx ? ", ou um follow-up ligado ao tema" : "") + ".\n" +
    (hasCtx ? "\nTema/contexto da conversa atual:\n" + context!.trim() + "\n" : "") +
    "\nTranscrição:\n" + text
  );
}

/** Parse the fast model's verdict. FAIL-OPEN: anything unparseable → { relevant: true }. */
export function parseRelevanceVerdict(reply: string): { relevant: boolean; reason?: string } {
  const raw = (reply || "").trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      const v = o.relevante ?? o.relevant ?? o.relevance;
      if (typeof v === "boolean") return { relevant: v, reason: o.motivo ?? o.reason };
      if (typeof v === "string") return { relevant: !/^(false|n[aã]o|no|0)$/i.test(v.trim()) };
    } catch { /* fall through to heuristic */ }
  }
  // No parseable JSON: only an explicit bare negative counts as ignore; otherwise let it through.
  if (/^(false|n[aã]o|no|irrelevante)\.?$/i.test(raw)) return { relevant: false };
  return { relevant: true };
}
