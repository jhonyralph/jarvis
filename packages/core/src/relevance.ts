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

/**
 * Combined voice preflight: ONE fast-model call that BOTH corrects the transcript AND judges relevance,
 * instead of two separate calls. On a CPU-bound box two simultaneous CLI spawns contend and each gets
 * SLOWER (measured: ~7.5s for the pair vs ~3.8s for one), so a single call is the faster path. Returns
 * {text, relevant}. FAIL-OPEN — a garbled/absent JSON keeps the raw text and lets it through.
 */
export function buildVoicePreflightPrompt(text: string, context?: string): string {
  const hasCtx = !!(context && context.trim());
  return (
    "Você é um pré-processador de VOZ para o assistente de desenvolvimento Jarvis. Faça DUAS coisas com " +
    "a transcrição abaixo, numa ÚNICA resposta:\n" +
    "1) CORRIJA apenas erros de reconhecimento — em especial termos técnicos em inglês ditos dentro do " +
    "português (Docker, Kubernetes, git, commit, push, deploy, runner, hub, endpoint, API, Claude, Codex, " +
    "PowerShell...). NÃO responda, NÃO comente, NÃO traduza — só conserte o texto, no mesmo idioma.\n" +
    "2) DECIDA se é um comando/pedido/pergunta dirigido ao Jarvis" +
    (hasCtx ? ", ou uma continuação relacionada à conversa atual" : "") +
    " (relevante=true), ou apenas RUÍDO / conversa com outra pessoa / fala solta sem intenção (relevante=false).\n" +
    "Responda SOMENTE com JSON, sem texto extra: {\"texto\": \"<transcrição corrigida>\", \"relevante\": true|false}.\n" +
    (hasCtx ? "\nContexto da conversa atual:\n" + context!.trim() + "\n" : "") +
    "\nTranscrição:\n" + text
  );
}

/** Parse the combined preflight. FAIL-OPEN: unparseable → keep the raw fallback text, relevant=true. */
export function parseVoicePreflight(reply: string, fallbackText: string): { text: string; relevant: boolean } {
  const m = (reply || "").match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      const v = o.relevante ?? o.relevant ?? o.relevance;
      const relevant = typeof v === "boolean" ? v : typeof v === "string" ? !/^(false|n[aã]o|no|0)$/i.test(v.trim()) : true;
      const corrected = typeof o.texto === "string" && o.texto.trim() ? o.texto.trim() : typeof o.text === "string" && o.text.trim() ? o.text.trim() : fallbackText;
      return { text: corrected, relevant };
    } catch { /* fall through to fail-open */ }
  }
  return { text: fallbackText, relevant: true };
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
