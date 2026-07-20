/**
 * Voice intent router — when Jarvis is triggered by voice, one cheap LLM pass
 * extracts any control directives (which agent / model / effort / folder) plus the
 * actual task from the spoken utterance, and whether the user explicitly asked to
 * start a new session or continue the current one. Deterministic dialog logic lives
 * in the Hub; this only EXTRACTS. Falls back to "the whole utterance is the task".
 */
import type { AgentRegistry } from "@jarvis/core";

export interface VoiceIntent {
  agent: string | null; // exact agent name, only if the user asked to switch AI
  model: string | null; // exact model id for the chosen agent
  effort: string | null; // exact effort level
  folder: string | null; // exact path from the recent list
  sessionAction: "new" | "continue" | null;
  task: string; // instruction to run (control phrases stripped), or "" if config-only
}

export function buildVoicePrompt(args: {
  text: string;
  catalog: string;
  recent: string[];
  inProgress: boolean;
  config: { agent: string; model?: string; effort?: string; cwd?: string };
}): string {
  const recentList = args.recent.map((p) => `  - ${p}`).join("\n") || "  (nenhuma)";
  return (
    `Você é o roteador de voz do Jarvis (controla agentes de código). O usuário FALOU um comando.\n` +
    `Extraia: qual IA/agente, modelo, esforço, pasta de trabalho e a TAREFA a executar.\n\n` +
    `AGENTES DISPONÍVEIS (nome — modelos — esforços):\n${args.catalog}\n\n` +
    `PASTAS RECENTES (devolva o caminho EXATO se ele indicar uma):\n${recentList}\n\n` +
    `CONFIG ATUAL: agente=${args.config.agent} modelo=${args.config.model ?? "-"} esforço=${args.config.effort ?? "-"} pasta=${args.config.cwd ?? "-"}\n` +
    `CONVERSA EM ANDAMENTO NESTA SESSÃO DE VOZ: ${args.inProgress ? "SIM" : "NÃO"}\n\n` +
    `Fala do usuário: "${args.text}"\n\n` +
    `Regras:\n` +
    `- agent: um nome EXATO da lista, só se o usuário mencionou trocar de IA; senão null.\n` +
    `- model/effort: valores EXATOS da lista do agente em uso; só se mencionados; senão null.\n` +
    `- folder: caminho EXATO de uma pasta recente, se ele indicou; senão null.\n` +
    `- sessionAction: "new" se pediu explicitamente nova/outra sessão; "continue" se pediu continuar/seguir; senão null.\n` +
    `- task: a instrução para o agente, SEM as partes de configuração/navegação; se a fala foi só configuração, task="".\n\n` +
    `Responda SOMENTE com JSON válido, nada fora dele:\n` +
    `{"agent":null,"model":null,"effort":null,"folder":null,"sessionAction":null,"task":""}`
  );
}

export async function parseVoiceIntent(opts: {
  text: string;
  catalog: string;
  recent: string[];
  inProgress: boolean;
  config: { agent: string; model?: string; effort?: string; cwd?: string };
  agents: AgentRegistry;
}): Promise<VoiceIntent> {
  const agent = opts.agents.searchAgent();
  const prompt = buildVoicePrompt(opts);
  const caps = await agent.capabilities();
  const requested = process.env.JARVIS_VOICE_INTENT_MODEL || process.env.JARVIS_SEARCH_MODEL;
  const model = requested && caps.models.some((m) => m.id === requested) ? requested : undefined;
  const modelInfo = model ? caps.models.find((m) => m.id === model) : undefined;
  const sendOpts = { model, effort: modelInfo?.efforts.includes("low") ? "low" : undefined };
  const fallback: VoiceIntent = { agent: null, model: null, effort: null, folder: null, sessionAction: null, task: opts.text };
  try {
    const reply = agent.oneShot ? await agent.oneShot(prompt, sendOpts) : await agent.send("__voice__", prompt, process.cwd(), sendOpts);
    const raw = reply.text || "";
    const parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || [raw])[0]);
    return {
      agent: typeof parsed.agent === "string" ? parsed.agent : null,
      model: typeof parsed.model === "string" ? parsed.model : null,
      effort: typeof parsed.effort === "string" ? parsed.effort : null,
      folder: typeof parsed.folder === "string" ? parsed.folder : null,
      sessionAction: parsed.sessionAction === "new" || parsed.sessionAction === "continue" ? parsed.sessionAction : null,
      task: typeof parsed.task === "string" ? parsed.task : opts.text,
    };
  } catch {
    return fallback;
  }
}
