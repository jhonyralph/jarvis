/**
 * Cross-session search: answer meta-questions ("sobre a sessão X, como está o
 * progresso?") by reasoning ONCE over a cheap digest of the last N sessions
 * (any agent) — never opening each session's agent. Bounded token cost.
 */
import type { Store, AgentRegistry } from "@jarvis/core";

// Conservative pt-BR triggers — must mention "sess" so normal chat is never hijacked.
const TRIGGERS = [
  /\bbuscar\s+(entre|nas?|em)\s+(as\s+)?sess/i,
  /\bqual\s+sess[aã]o\b/i,
  /\bsobre\s+a\s+sess[aã]o\b/i,
  /\bprogress[oa]\b[\s\S]*\bsess/i,
  /\bentre\s+(as\s+)?sess[oõ]es\b/i,
  /\bem\s+quais?\s+sess/i,
];

export function looksLikeCrossSessionQuery(text: string): boolean {
  return /sess/i.test(text) && TRIGGERS.some((r) => r.test(text));
}

export function buildSearchPrompt(query: string, digest: ReturnType<Store["digest"]>): string {
  const list = digest
    .map((d) => `[${d.id}] agente=${d.agent} pasta=${d.cwd} título="${d.title}"\n  último(usuário): ${d.lastUser}\n  último(assistente): ${d.lastAssistant}`)
    .join("\n\n");
  return (
    `Você roteia entre sessões de trabalho de agentes de código. Pergunta do usuário: "${query}".\n\n` +
    `SESSÕES RECENTES (de vários agentes):\n${list || "(nenhuma)"}\n\n` +
    `Responda SOMENTE com um bloco JSON válido, sem texto fora dele:\n` +
    `{"answer":"resposta curta em pt-BR sobre o progresso/estado do que foi perguntado","matches":[{"id":"<id exato de uma sessão acima>","why":"por que é relevante","progress":"estado atual"}],"action":null}\n` +
    `Use apenas ids que aparecem acima. Se nada casar, matches:[] e explique em answer.`
  );
}

export interface SearchResult {
  answer: string;
  matches: Array<{ id: string; why?: string; progress?: string; title?: string; agent?: string; cwd?: string }>;
  action: string | null;
}

export async function runSessionSearch(opts: { query: string; store: Store; agents: AgentRegistry; model?: string }): Promise<SearchResult> {
  const digest = opts.store.digest(Number(process.env.JARVIS_DIGEST_N) || 8, 220);
  const agent = opts.agents.searchAgent();
  const prompt = buildSearchPrompt(opts.query, digest);
  const sendOpts = { model: opts.model || process.env.JARVIS_SEARCH_MODEL || "haiku", effort: "low" };
  let answer = "";
  let matches: SearchResult["matches"] = [];
  let action: string | null = null;
  try {
    const reply = agent.oneShot ? await agent.oneShot(prompt, sendOpts) : await agent.send("__search__", prompt, process.cwd(), sendOpts);
    const raw = reply.text || "";
    const jsonStr = (raw.match(/\{[\s\S]*\}/) || [raw])[0];
    const parsed = JSON.parse(jsonStr);
    answer = parsed.answer || raw;
    const ids = new Set(digest.map((d) => d.id));
    matches = (parsed.matches || [])
      .filter((m: any) => m && ids.has(m.id))
      .map((m: any) => {
        const s = digest.find((d) => d.id === m.id)!;
        return { id: m.id, why: m.why, progress: m.progress, title: s.title, agent: s.agent, cwd: s.cwd };
      });
    action = parsed.action ?? null;
  } catch {
    answer = answer || "Não consegui interpretar a busca entre sessões.";
  }
  return { answer, matches, action };
}
