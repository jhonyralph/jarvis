/**
 * TTS bridge.
 *
 * - Piper remains the local/offline backend and keeps its persistent service warm.
 * - OpenAI TTS is an optional cloud backend used for richer voice personas. It is selected with
 *   voice ids like `openai:jarvis-br`; no API key means those voices are shown but disabled.
 */
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface, Interface } from "node:readline";

const SERVICE = fileURLToPath(new URL("../../../services/voice/piper_service.py", import.meta.url));
const PY = process.env.JARVIS_PYTHON || "python";
const VOICES = join(homedir(), ".jarvis", "voices");

// fluidity tuning (env-overridable): slightly slower + a pause after each sentence reads
// more naturally than Piper's default; noise-w adds a touch of prosody variation.
const LENGTH = Number(process.env.JARVIS_TTS_LENGTH || "1.06");
const SILENCE = Number(process.env.JARVIS_TTS_SILENCE || "0.32");
const NOISEW = Number(process.env.JARVIS_TTS_NOISEW || "0.9");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.JARVIS_OPENAI_API_KEY || "";
const OPENAI_TTS_MODEL = process.env.JARVIS_OPENAI_TTS_MODEL || "gpt-4o-mini-tts";

export interface VoiceInfo {
  id: string;
  label: string;
  provider: "piper" | "openai";
  locale?: string;
  accent?: string;
  description?: string;
  previewText?: string;
  available: boolean;
  local: boolean;
  requiresKey?: boolean;
}

interface OpenAiVoiceProfile {
  id: string;
  label: string;
  locale: string;
  accent: string;
  baseVoice: string;
  description: string;
  previewText: string;
  instructions: string;
}

const OPENAI_VOICE_PROFILES: OpenAiVoiceProfile[] = [
  {
    id: "openai:jarvis-br",
    label: "Homem BR - Jarvis",
    locale: "pt-BR",
    accent: "masculina, precisa",
    baseVoice: "onyx",
    description: "Assistente masculino, calmo, técnico e sofisticado em português brasileiro.",
    previewText: "Bom dia, senhor. Todos os sistemas estão operacionais e prontos para a próxima tarefa.",
    instructions: "Fale em português brasileiro com voz masculina, calma, sofisticada e precisa. Soe como um assistente técnico premium, com humor seco e discreto. Não imite personagens, atores ou dubladores específicos.",
  },
  {
    id: "openai:executivo-br",
    label: "Homem BR - Executivo",
    locale: "pt-BR",
    accent: "masculina, grave",
    baseVoice: "cedar",
    description: "Voz masculina mais grave, segura e objetiva para respostas executivas.",
    previewText: "Resumo executivo pronto. Os riscos principais estão mapeados e a próxima decisão é clara.",
    instructions: "Fale em português brasileiro com voz masculina grave, segura e objetiva. Use ritmo calmo, dicção limpa e tom executivo, sem teatralizar.",
  },
  {
    id: "openai:tecnico-br",
    label: "Homem BR - Técnico",
    locale: "pt-BR",
    accent: "masculina, direta",
    baseVoice: "ash",
    description: "Voz masculina direta, técnica e pragmática para desenvolvimento e operações.",
    previewText: "Validação concluída. O problema está no fluxo de autenticação e já temos o próximo passo.",
    instructions: "Fale em português brasileiro com voz masculina direta, técnica e pragmática. Priorize clareza, precisão e ritmo constante.",
  },
  {
    id: "openai:narrador-br",
    label: "Homem BR - Narrador",
    locale: "pt-BR",
    accent: "masculina, calorosa",
    baseVoice: "echo",
    description: "Voz masculina mais calorosa e explicativa para leituras longas.",
    previewText: "Vou explicar o cenário com calma, separando causa, impacto e recomendação.",
    instructions: "Fale em português brasileiro com voz masculina calorosa, articulada e didática. Mantenha naturalidade e evite exagero dramático.",
  },
  {
    id: "openai:athena-br",
    label: "Mulher BR - Athena",
    locale: "pt-BR",
    accent: "feminina, sofisticada",
    baseVoice: "coral",
    description: "Assistente feminina sofisticada, confiante e clara em português brasileiro.",
    previewText: "Bom dia. Analisei os sinais principais e já organizei as prioridades.",
    instructions: "Fale em português brasileiro com voz feminina sofisticada, confiante e clara. Use tom profissional, elegante e acolhedor, sem soar artificial.",
  },
  {
    id: "openai:clara-br",
    label: "Mulher BR - Clara",
    locale: "pt-BR",
    accent: "feminina, leve",
    baseVoice: "nova",
    description: "Voz feminina leve, ágil e amigável para uso diário.",
    previewText: "Pronto. Separei o que é urgente, o que pode esperar e o que precisa de decisão.",
    instructions: "Fale em português brasileiro com voz feminina leve, ágil e amigável. Mantenha energia moderada e boa clareza.",
  },
  {
    id: "openai:serena-br",
    label: "Mulher BR - Serena",
    locale: "pt-BR",
    accent: "feminina, suave",
    baseVoice: "shimmer",
    description: "Voz feminina suave e calma para respostas menos intrusivas.",
    previewText: "Tudo certo. Vou acompanhar em segundo plano e aviso quando houver uma atualização importante.",
    instructions: "Fale em português brasileiro com voz feminina suave, calma e discreta. Use ritmo levemente mais lento e tom sereno.",
  },
  {
    id: "openai:consultora-br",
    label: "Mulher BR - Consultora",
    locale: "pt-BR",
    accent: "feminina, analítica",
    baseVoice: "sage",
    description: "Voz feminina analítica, madura e consultiva.",
    previewText: "Minha recomendação é reduzir o escopo agora e validar a hipótese com um teste controlado.",
    instructions: "Fale em português brasileiro com voz feminina analítica, madura e consultiva. Seja precisa, ponderada e profissional.",
  },
  {
    id: "openai:jarvis-en",
    label: "Male EN - Jarvis",
    locale: "en-US",
    accent: "male, refined",
    baseVoice: "onyx",
    description: "Male technical assistant voice in English, polished and concise.",
    previewText: "Good morning, sir. All systems are online and ready for the next operation.",
    instructions: "Speak in English with a calm, refined male assistant style. Be precise, composed, technically fluent, and lightly dry. Do not imitate any specific character, actor, or public figure.",
  },
  {
    id: "openai:executive-en",
    label: "Male EN - Executive",
    locale: "en-US",
    accent: "male, authoritative",
    baseVoice: "cedar",
    description: "Deeper male voice for concise executive updates.",
    previewText: "Executive summary is ready. The main risks are contained and the next decision is clear.",
    instructions: "Speak in English with a deeper male voice, calm authority, and crisp pacing. Sound executive, direct, and composed.",
  },
  {
    id: "openai:engineer-en",
    label: "Male EN - Engineer",
    locale: "en-US",
    accent: "male, technical",
    baseVoice: "ash",
    description: "Direct male technical voice for engineering and operations.",
    previewText: "The check passed. The regression was isolated to the background task state machine.",
    instructions: "Speak in English with a direct male technical voice. Be pragmatic, precise, and steady, with minimal flourish.",
  },
  {
    id: "openai:narrator-en",
    label: "Male EN - Narrator",
    locale: "en-US",
    accent: "male, warm",
    baseVoice: "echo",
    description: "Warm male voice for longer explanations.",
    previewText: "I will walk through the context, the tradeoffs, and the recommended next step.",
    instructions: "Speak in English with a warm male narrator voice. Be clear, measured, and easy to follow.",
  },
  {
    id: "openai:athena-en",
    label: "Female EN - Athena",
    locale: "en-US",
    accent: "female, polished",
    baseVoice: "coral",
    description: "Polished female assistant voice for professional replies.",
    previewText: "I reviewed the signal and organized the next actions by priority.",
    instructions: "Speak in English with a polished female assistant voice. Be confident, clear, professional, and calm.",
  },
  {
    id: "openai:clara-en",
    label: "Female EN - Clara",
    locale: "en-US",
    accent: "female, bright",
    baseVoice: "nova",
    description: "Bright female voice for everyday interaction.",
    previewText: "Done. I separated what is urgent, what can wait, and what needs a decision.",
    instructions: "Speak in English with a bright female voice. Keep the delivery friendly, quick, and natural.",
  },
  {
    id: "openai:serena-en",
    label: "Female EN - Serena",
    locale: "en-US",
    accent: "female, soft",
    baseVoice: "shimmer",
    description: "Soft female voice for low-friction status updates.",
    previewText: "Everything is running quietly. I will let you know when something needs attention.",
    instructions: "Speak in English with a soft female voice. Use calm pacing, gentle tone, and restrained emphasis.",
  },
  {
    id: "openai:advisor-en",
    label: "Female EN - Advisor",
    locale: "en-US",
    accent: "female, analytical",
    baseVoice: "sage",
    description: "Analytical female voice for reviews, plans, and decisions.",
    previewText: "My recommendation is to narrow the scope and validate the assumption with a controlled test.",
    instructions: "Speak in English with an analytical female advisor voice. Be thoughtful, concise, and precise.",
  },
  {
    id: "openai:jarvis-es",
    label: "Hombre ES - Jarvis",
    locale: "es-ES",
    accent: "masculina, precisa",
    baseVoice: "onyx",
    description: "Asistente masculino, sereno, técnico y sofisticado en español.",
    previewText: "Buenos días, señor. Todos los sistemas están operativos y listos para la próxima tarea.",
    instructions: "Habla en español con voz masculina, serena, sofisticada y precisa. Suena como un asistente técnico premium, con humor seco y discreto. No imites personajes, actores ni dobladores específicos.",
  },
  {
    id: "openai:ejecutivo-es",
    label: "Hombre ES - Ejecutivo",
    locale: "es-ES",
    accent: "masculina, grave",
    baseVoice: "cedar",
    description: "Voz masculina más grave, segura y objetiva para respuestas ejecutivas.",
    previewText: "El resumen ejecutivo está listo. Los riesgos principales están mapeados y la siguiente decisión es clara.",
    instructions: "Habla en español con voz masculina grave, segura y objetiva. Usa un ritmo calmado, dicción limpia y tono ejecutivo, sin teatralizar.",
  },
  {
    id: "openai:tecnico-es",
    label: "Hombre ES - Técnico",
    locale: "es-ES",
    accent: "masculina, directa",
    baseVoice: "ash",
    description: "Voz masculina directa, técnica y pragmática para desarrollo y operaciones.",
    previewText: "La validación terminó. El problema está en el flujo de autenticación y ya tenemos el siguiente paso.",
    instructions: "Habla en español con voz masculina directa, técnica y pragmática. Prioriza claridad, precisión y ritmo constante.",
  },
  {
    id: "openai:narrador-es",
    label: "Hombre ES - Narrador",
    locale: "es-ES",
    accent: "masculina, cálida",
    baseVoice: "echo",
    description: "Voz masculina más cálida y explicativa para lecturas largas.",
    previewText: "Voy a explicar el escenario con calma, separando causa, impacto y recomendación.",
    instructions: "Habla en español con voz masculina cálida, articulada y didáctica. Mantén naturalidad y evita el drama exagerado.",
  },
  {
    id: "openai:athena-es",
    label: "Mujer ES - Athena",
    locale: "es-ES",
    accent: "femenina, sofisticada",
    baseVoice: "coral",
    description: "Asistente femenina sofisticada, segura y clara en español.",
    previewText: "Buenos días. Analicé las señales principales y ya organicé las prioridades.",
    instructions: "Habla en español con voz femenina sofisticada, segura y clara. Usa un tono profesional, elegante y cercano, sin sonar artificial.",
  },
  {
    id: "openai:clara-es",
    label: "Mujer ES - Clara",
    locale: "es-ES",
    accent: "femenina, ligera",
    baseVoice: "nova",
    description: "Voz femenina ligera, ágil y amable para uso diario.",
    previewText: "Listo. Separé lo urgente, lo que puede esperar y lo que necesita una decisión.",
    instructions: "Habla en español con voz femenina ligera, ágil y amable. Mantén energía moderada y buena claridad.",
  },
  {
    id: "openai:serena-es",
    label: "Mujer ES - Serena",
    locale: "es-ES",
    accent: "femenina, suave",
    baseVoice: "shimmer",
    description: "Voz femenina suave y tranquila para respuestas menos intrusivas.",
    previewText: "Todo está en orden. Voy a seguir en segundo plano y avisaré cuando haya una actualización importante.",
    instructions: "Habla en español con voz femenina suave, tranquila y discreta. Usa un ritmo un poco más lento y tono sereno.",
  },
  {
    id: "openai:consultora-es",
    label: "Mujer ES - Consultora",
    locale: "es-ES",
    accent: "femenina, analítica",
    baseVoice: "sage",
    description: "Voz femenina analítica, madura y consultiva.",
    previewText: "Mi recomendación es reducir el alcance ahora y validar la hipótesis con una prueba controlada.",
    instructions: "Habla en español con voz femenina analítica, madura y consultiva. Sé precisa, ponderada y profesional.",
  },
  {
    id: "openai:neutral-studio",
    label: "Neutral - Studio",
    locale: "multi",
    accent: "neutral",
    baseVoice: "marin",
    description: "Neutral studio voice tuned for high-quality general use.",
    previewText: "Olá. Esta é uma voz neutra de alta qualidade para respostas gerais do Jarvis.",
    instructions: "Speak naturally with a neutral, premium studio tone. Adapt to the language of the input and keep pronunciation clear.",
  },
  {
    id: "openai:neutral-calm",
    label: "Neutral - Calm",
    locale: "multi",
    accent: "neutral, calm",
    baseVoice: "alloy",
    description: "Neutral calm voice for balanced daily use.",
    previewText: "Olá. Esta voz mantém um tom neutro, calmo e claro para o uso diário.",
    instructions: "Speak naturally with a neutral, calm voice. Keep the pacing balanced and the tone unobtrusive.",
  },
  ...["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"].map((voice) => ({
    id: `openai:${voice}`,
    label: `Base - ${voice[0]!.toUpperCase() + voice.slice(1)}`,
    locale: "multi",
    accent: "OpenAI",
    baseVoice: voice,
    description: "Voz OpenAI TTS de uso geral.",
    previewText: "Olá. Esta é uma prévia da voz selecionada para o Jarvis.",
    instructions: "Speak naturally, clearly, and concisely as a helpful assistant.",
  })),
];

/** Nomes das vozes Piper instaladas em ~/.jarvis/voices (arquivos *.onnx, sem extensão). */
export function listVoices(): string[] {
  try {
    return readdirSync(VOICES)
      .filter((f) => f.endsWith(".onnx"))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

export function listVoiceCatalog(): VoiceInfo[] {
  const piper = listVoices().map((voice) => ({
    id: voice,
    label: prettyPiperVoice(voice),
    provider: "piper" as const,
    locale: piperLocale(voice),
    accent: piperName(voice),
    description: "Voz local Piper instalada neste computador.",
    previewText: defaultPreviewForLocale(piperLocale(voice)),
    available: true,
    local: true,
  }));
  const openai = OPENAI_VOICE_PROFILES.map((voice) => ({
    id: voice.id,
    label: voice.label,
    provider: "openai" as const,
    locale: voice.locale,
    accent: voice.accent,
    description: voice.description,
    previewText: voice.previewText,
    available: !!OPENAI_API_KEY,
    local: false,
    requiresKey: !OPENAI_API_KEY,
  }));
  return [...openai, ...piper];
}

/** true se o modelo de voz existe localmente. */
export function hasVoice(voice: string): boolean {
  if (isOpenAiVoice(voice)) return !!OPENAI_API_KEY && !!openAiProfile(voice);
  return !!voice && existsSync(join(VOICES, `${voice}.onnx`));
}

function isOpenAiVoice(voice: string): boolean {
  return String(voice || "").startsWith("openai:");
}

function openAiProfile(voice: string): OpenAiVoiceProfile | undefined {
  return OPENAI_VOICE_PROFILES.find((v) => v.id === voice);
}

function fallbackPiperVoice(): string | undefined {
  const all = listVoices();
  return all.find((v) => v.toLowerCase().startsWith("pt_br"))
    || all.find((v) => v.toLowerCase().startsWith("pt"))
    || all[0];
}

function piperLocale(voice: string): string {
  const m = /^([a-z]{2})_([A-Za-z]{2})-/.exec(voice || "");
  return m ? `${m[1]}-${m[2].toUpperCase()}` : "local";
}

function piperName(voice: string): string {
  const m = /^[a-z]{2}_[A-Za-z]{2}-([^-]+)-/.exec(voice || "");
  return m ? m[1] : voice;
}

function prettyPiperVoice(voice: string): string {
  const m = /^([a-z]{2})_([A-Za-z]{2})-([^-]+)-(.+)$/.exec(voice || "");
  if (!m) return voice || "";
  const langs: Record<string, string> = { pt: "Português", en: "Inglês", es: "Espanhol", fr: "Francês", de: "Alemão", it: "Italiano", nl: "Holandês" };
  const quals: Record<string, string> = { x_low: "muito básica", low: "básica", medium: "média", high: "alta" };
  return `${langs[m[1]] || m[1].toUpperCase()} (${m[2].toUpperCase()}) · ${m[3]} · ${quals[m[4]] || m[4]}`;
}

function defaultPreviewForLocale(locale?: string): string {
  return String(locale || "").toLowerCase().startsWith("en")
    ? "Good morning, sir. All systems are online and ready for the next operation."
    : "Bom dia, senhor. Todos os sistemas estão operacionais e prontos para a próxima tarefa.";
}

interface Pending { resolve: (wav: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; }

let proc: ChildProcessWithoutNullStreams | null = null;
let rl: Interface | null = null;
let ready: Promise<void> | null = null;
const pending = new Map<number, Pending>();
let seq = 0;

// Mirrors stt.ts: se um pedido travar (processo Piper morto-vivo), matar + respawnar limpo em vez
// de deixar cada pedido seguinte enfileirar atrás dele até o próximo restart manual do hub.
function killProc(err: Error): void {
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); }
  pending.clear();
  try { rl?.close(); } catch { /* ignore */ }
  try { proc?.kill(); } catch { /* ignore */ }
  proc = null; rl = null; ready = null;
}

function ensureProc(): Promise<void> {
  if (proc && ready) return ready;
  const child = spawn(PY, [SERVICE], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  proc = child;
  let readyResolve!: () => void, readyReject!: (e: Error) => void;
  ready = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej; });
  let started = false;
  rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    line = line.trim(); if (!line) return;
    let o: any; try { o = JSON.parse(line); } catch { return; }
    if (!started && ("ready" in o)) { started = true; if (o.ready) readyResolve(); else killProc(new Error("TTS: " + (o.error || "serviço não iniciou"))); return; }
    const id = o.id; if (id == null) return;
    const p = pending.get(id); if (!p) return;
    pending.delete(id); clearTimeout(p.timer);
    if (o.error) p.reject(new Error("TTS: " + o.error)); else p.resolve(Buffer.from(String(o.wav_b64 || ""), "base64"));
  });
  child.stderr.on("data", () => { /* piper loga progresso no stderr — ignora */ });
  child.on("error", (e) => { if (!started) readyReject(e); killProc(e instanceof Error ? e : new Error(String(e))); });
  child.on("close", () => { if (!started) readyReject(new Error("TTS: serviço encerrou antes de ficar pronto")); killProc(new Error("TTS: serviço encerrou")); });
  return ready;
}

export async function synthesize(text: string, voice = "en_GB-alan-medium", opts: { fallback?: boolean } = {}): Promise<Buffer> {
  if (isOpenAiVoice(voice)) {
    try {
      return await synthesizeOpenAi(text, voice);
    } catch (error) {
      // Falar uma RESPOSTA prefere dizer ALGO (cai numa voz local). Mas uma PRÉVIA (fallback:false)
      // não pode fingir: o usuário pediu para ouvir ESTA voz — se a OpenAI falha (ex.: sem quota),
      // propaga o erro em vez de tocar a voz local por baixo (o que fazia todas soarem iguais).
      if (opts.fallback === false) throw error;
      const fallback = fallbackPiperVoice();
      if (fallback) return await synthesizePiper(text, fallback);
      throw error;
    }
  }
  return await synthesizePiper(text, voice);
}

async function synthesizePiper(text: string, voice = "en_GB-alan-medium"): Promise<Buffer> {
  if (!hasVoice(voice)) throw new Error(`voice model not found: ${join(VOICES, `${voice}.onnx`)}`);
  await ensureProc();
  const id = ++seq;
  const req = JSON.stringify({ id, text, voice, length_scale: LENGTH, sentence_silence: SILENCE, noise_w_scale: NOISEW }) + "\n";
  return await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => { killProc(new Error("TTS: tempo esgotado")); }, 60000);
    pending.set(id, { resolve, reject, timer });
    try { proc!.stdin.write(req); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); }
  });
}

async function synthesizeOpenAi(text: string, voice: string): Promise<Buffer> {
  const profile = openAiProfile(voice);
  if (!profile) throw new Error(`voz OpenAI desconhecida: ${voice}`);
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY nao configurada para OpenAI TTS");
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: profile.baseVoice,
      input: text,
      instructions: profile.instructions,
      response_format: "wav",
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI TTS HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
