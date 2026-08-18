/**
 * Gerenciar a FONTE de tarefas do projeto por uma frase do chat (fatia G do épico "fontes de tarefa").
 *
 * Três peças puras, para o Hub ficar sendo só o adaptador (quem tem store e socket):
 *  - `parseTaskSourceCommand`: texto → comando, ou `null` (que significa "isto não é comigo, deixe o
 *    turno seguir para a IA");
 *  - `planTaskSourceCommand`: comando + projeto + vínculo atual + conexões → o que gravar, ou uma
 *    recusa com motivo acionável;
 *  - `formatTaskSourceConfirmation`: a decisão JÁ GRAVADA → a frase que volta para o chat.
 *
 * ZERO LLM neste caminho, por decisão do épico: declarar a fonte das tarefas não pode gastar crédito
 * nem depender de um modelo estar disponível.
 *
 * O modo de falha que a gramática evita
 * ------------------------------------
 * Um classificador de intenção já marcou a palavra "consulta" como compromisso de calendário com 0,99
 * de confiança e prendeu a sessão inteira: a conversa normal virou comando. Aqui o risco é o mesmo —
 * "o jira caiu", "essa pasta tá uma bagunça", "qual é a fonte disso?" são frases COMUNS que citam
 * exatamente o vocabulário desta fatia. Por isso a gramática tem duas cercas independentes:
 *
 *  1. a frase precisa NOMEAR a configuração logo no começo ("fonte de tarefas...", "pasta de
 *     tarefas...", "as tarefas deste projeto vêm de..."). Menção no meio de um parágrafo não conta;
 *  2. o ALVO precisa ser reconhecido POR INTEIRO como pasta, servidor MCP ou provedor do catálogo.
 *     Reconhecer só um pedaço faria "vêm do Jira, mas o time usa Notion" virar comando.
 *
 * Na dúvida o resultado é `null` — e `null` aqui não é erro: é o turno seguindo normalmente para a IA,
 * que é o desfecho barato. Agir errado é o caro.
 */
import { relative } from "node:path";
import { resolveFeaturesRoot } from "./task-local-cache.js";
import { TASK_PROVIDERS } from "./task-providers.js";
import type { ProjectTaskBinding, TaskSourceDecision } from "./task-link.js";

export interface TaskSourceCommand {
  /** `set` declara a fonte; `clear` desliga o vínculo (o projeto volta a "não declarou nada"). */
  intent: "set" | "clear";
  /** slug da fonte: `local`, `mcp` ou o id de um provedor do catálogo. `""` só em `clear`. */
  tracker: string;
  /** Só em `local`: o caminho EXATAMENTE como foi dito, sem resolver e sem conter. A contenção mora
   *  em `resolveFeaturesRoot` (uma cópia só, no core) — e o parser precisa aceitar `..` e caminho
   *  absoluto justamente para que a RECUSA seja falada, em vez de o turno escorregar para a IA. */
  featuresDir?: string;
  /** Só em `mcp`: nome do servidor na allowlist da máquina do projeto. */
  mcpServer?: string;
  /** Só em provedor: como o usuário se referiu à conta ("trabalho", "Jira ACME"). Quem resolve isso
   *  contra o cofre é o `plan`, porque só ele conhece as conexões existentes. */
  connectionHint?: string;
}

/* ── vocabulário ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Fontes que uma frase pode nomear. Sai do CATÁLOGO de provedores (e não de `KNOWN_TASK_TRACKERS`)
 * porque o tracker gravado precisa bater com `connection.provider` — `resolveTaskSource` recusa por
 * `PROVIDER_MISMATCH` quando não bate. É por isso que "azure" vira `azure-devops`: gravar "azure"
 * criaria um projeto que declara uma fonte que conexão nenhuma do cofre consegue servir.
 */
const TRACKER_WORDS = new Map<string, string>([["local", "local"], ["mcp", "mcp"]]);
for (const p of TASK_PROVIDERS) TRACKER_WORDS.set(p.id, p.id);
TRACKER_WORDS.set("azure", "azure-devops");
TRACKER_WORDS.set("azure devops", "azure-devops");

/** Um comando é curto. Parágrafo é conversa — e conversa não configura projeto. */
const MAX_COMMAND_CHARS = 160;

/** "deste projeto", "do projeto", "aqui" — escopo opcional, nunca obrigatório. */
const SCOPE = "(?:\\s+(?:deste|desse|do|neste|nesse|no)\\s+projeto|\\s+daqui|\\s+aqui)?";
/** A cabeça que NOMEIA a configuração. É ela que separa comando de menção casual. */
const HEAD = "(?:fonte|pasta|diret(?:o|ó)rio)\\s+d(?:e|a|as|os)\\s+(?:tarefas|features|feature)";
/** Cópula: símbolo cola sem espaço (`fonte de tarefas: x`), palavra exige espaço dos dois lados
 *  (senão `e` casaria dentro de qualquer palavra e a âncora perderia o sentido). */
const COPULA = "(?:\\s*[:=]\\s*|\\s+(?:passa\\s+a\\s+ser|vai\\s+ser|agora\\s+(?:é|e|eh)|ser(?:á|a)|vira|é|eh|e)\\s+)";
const VERB = "(?:defin(?:a|e|ir)|configur(?:a|e|ar)|mud(?:a|e|ar)|troc(?:a|ar)|troque|us(?:a|e|ar)|apont(?:a|e|ar)|ajust(?:a|e|ar)|coloc(?:a|ar|que))";
/** Vocativo opcional. O chat já é com o Jarvis, mas "Jarvis, define..." é como gente escreve. */
const CALL = "(?:(?:jarvis|por\\s+favor)[,:]?\\s+){0,2}";

/** "a fonte de tarefas deste projeto é X" / "pasta de tarefas: X" */
const RX_DECLARATION = new RegExp(`^\\s*${CALL}(?:a\\s+|o\\s+)?${HEAD}${SCOPE}${COPULA}(.+)$`, "i");
/** "troca a fonte de tarefas deste projeto para X" / "usa a pasta de tarefas X" */
const RX_IMPERATIVE = new RegExp(`^\\s*${CALL}${VERB}\\s+(?:a\\s+|o\\s+)?${HEAD}${SCOPE}(?:\\s*[:=]\\s*|\\s+(?:para|pra|como)\\s+|\\s+)(.+)$`, "i");
/** "as tarefas deste projeto vêm de X" — a forma mais natural, e ainda assim ancorada no começo. */
const RX_ORIGIN = new RegExp(`^\\s*${CALL}(?:as\\s+)?tarefas\\s+(?:deste|desse|do|neste|nesse|no)\\s+projeto\\s+(?:v(?:ê|e)m|v(?:ê|e)em|saem|ficam|est(?:ã|a)o|s(?:ã|a)o|vir(?:ã|a)o)\\s+(?:d(?:e|a|o|as|os)\\s+|em\\s+|n(?:a|o)\\s+)?(.+)$`, "i");

/* ── alvo ─────────────────────────────────────────────────────────────────────────────────────── */

/** Caminho é token sem espaço nem caractere que o SO recusaria. Aspas já foram tiradas antes.
 *  Caractere de controle (NUL inclusive) sai aqui e não lá na frente: gravado no vínculo, ele só
 *  apareceria como erro cru de `readdir` na hora de listar, longe da frase que o causou. */
const isPathToken = (v: string): boolean => !!v && v.length <= 200 && !/[\s"'`<>|*?\u0000-\u001f]/.test(v);
/** Sem a palavra "pasta" na frente, só a FORMA de caminho identifica o alvo: uma palavra solta
 *  ("backlog", "produção") é ambígua demais para virar pasta do projeto sem o usuário ter dito. */
const looksLikePath = (v: string): boolean => isPathToken(v) && (/[\\/]/.test(v) || /^\.{1,2}$/.test(v));

const stripQuotes = (v: string): string => v.replace(/^["'`«»]+|["'`«»]+$/g, "").trim();

/**
 * O alvo da frase → o comando. Devolve `null` sempre que o alvo não for reconhecido POR INTEIRO:
 * é esta exigência (e não a cabeça da frase) que impede "vêm do Jira, mas o time usa Notion" de
 * configurar o projeto pela metade.
 */
function parseTarget(raw: string): TaskSourceCommand | null {
  const target = stripQuotes(stripQuotes(String(raw || "")).replace(/[.!;,]+$/, "").trim());
  if (!target) return null;
  const low = target.toLowerCase();

  // Desligar é gerenciar também: sem isto, o único jeito de tirar a fonte errada seria abrir a tela.
  if (/^(?:nenhuma|nenhum|nada|sem\s+fonte|nenhuma\s+fonte|desvincul(?:a|ar|e)|desligad[ao])$/.test(low)) {
    return { intent: "clear", tracker: "" };
  }

  // "pasta X": a palavra "pasta" é a permissão explícita para aceitar até um segmento só ("features"),
  // que sem ela seria indistinguível do nome de um provedor.
  // `(?!\w)` não é detalhe: sem ele, "dir" casava DENTRO de "direito" e
  // "configura a pasta de tarefas direito" virava a pasta "eito".
  const folder = /^(?:a\s+|o\s+)?(?:pasta|diret(?:o|ó)rio|dir)(?!\w)(?:\s+local)?(?:\s+de\s+features?)?\s*(.*)$/i.exec(target);
  if (folder) {
    const rest = stripQuotes(folder[1].trim());
    if (!rest) return { intent: "set", tracker: "local" };
    if (!isPathToken(rest)) return null;
    return { intent: "set", tracker: "local", featuresDir: rest };
  }

  // "mcp linear-local" / "servidor mcp" (sem nome: a máquina decide, se tiver um só).
  const mcp = /^(?:o\s+)?(?:servidor\s+)?mcp(?:\s+(?:chamado\s+)?([\w.@:-]{1,60}))?$/i.exec(target);
  if (mcp) return { intent: "set", tracker: "mcp", ...(mcp[1] ? { mcpServer: mcp[1] } : {}) };

  // Provedor, com a conta opcionalmente nomeada: "jira da conta trabalho", "linear (Linear ACME)".
  let head = target;
  let hint = "";
  const paren = /^(.*?)\s*[([]\s*(.+?)\s*[)\]]$/.exec(target);
  const spoken = /^(.*?)\s+d(?:a|e|o)\s+(?:conta|conex(?:ã|a)o|organiza(?:ç|c)(?:ã|a)o|org|time|workspace)\s+(.+)$/i.exec(target);
  if (paren) { head = paren[1].trim(); hint = paren[2].trim(); }
  else if (spoken) { head = spoken[1].trim(); hint = spoken[2].trim(); }
  const tracker = TRACKER_WORDS.get(head.replace(/^(?:o|a)\s+/i, "").trim().toLowerCase().replace(/\s+/g, " "));
  if (tracker === "local") return { intent: "set", tracker: "local" };
  if (tracker === "mcp") return { intent: "set", tracker: "mcp" };
  if (tracker) return { intent: "set", tracker, ...(hint ? { connectionHint: hint.slice(0, 80) } : {}) };

  // Caminho nu, por último: "docs/features", "../fora", "C:\Windows". Os dois últimos são aceitos de
  // propósito — a recusa por escapar do projeto precisa ser FALADA, e para isso o comando tem que
  // existir. Devolver `null` aqui mandaria "a pasta de tarefas é ../fora" direto para a IA.
  if (looksLikePath(target)) return { intent: "set", tracker: "local", featuresDir: target };
  return null;
}

/**
 * Texto do turno → comando de fonte de tarefas, ou `null` para "não é comigo".
 *
 * Guardas antes de qualquer regex, todas por um motivo de falso positivo já visto na prática:
 *  - texto longo ou de várias linhas é conversa (ou resposta de card), nunca comando;
 *  - terminar em "?" é PERGUNTA: "a fonte de tarefas deste projeto é o jira?" não pode reconfigurar
 *    nada — seria responder uma pergunta mudando o mundo;
 *  - `!` e `/` já são outros canais (shell e comandos) e não podem ser sequestrados aqui.
 */
export function parseTaskSourceCommand(text: string): TaskSourceCommand | null {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > MAX_COMMAND_CHARS) return null;
  if (/[\r\n]/.test(raw)) return null;
  if (raw.startsWith("!") || raw.startsWith("/")) return null;
  if (raw.endsWith("?")) return null;
  for (const rx of [RX_DECLARATION, RX_IMPERATIVE, RX_ORIGIN]) {
    const m = rx.exec(raw);
    if (m) return parseTarget(m[1]);
  }
  return null;
}

/* ── do comando para o que gravar ─────────────────────────────────────────────────────────────── */

export interface TaskSourcePlan {
  /** `true` = apagar o vínculo; `false` = gravar `binding`. */
  remove: boolean;
  /** Argumentos prontos para `ProjectTaskBindingStore.set` (ausente quando `remove`). */
  binding?: { tracker: string; featuresDir?: string; mcpServer?: string; connectionId?: string; allowed?: string[]; target?: string; autoApprove?: string[] };
}

export type TaskSourcePlanResult = { ok: true; plan: TaskSourcePlan } | { ok: false; error: string };

interface TaskSourceConnectionLike { id: string; provider: string; label?: string }

const lower = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/**
 * O que gravar para este comando, ou a recusa com motivo acionável.
 *
 * Duas decisões que não são óbvias:
 *
 *  - **o caminho é resolvido ANTES de gravar** (`resolveFeaturesRoot`, a mesma função que a listagem
 *    usa). Gravar primeiro e falhar depois deixaria o projeto apontando para uma pasta que ninguém
 *    consegue ler; e o que é gravado é o caminho JÁ RESOLVIDO, para o que a confirmação diz e o que
 *    a lista vai varrer serem literalmente a mesma string;
 *
 *  - **`allowed`/`target`/`autoApprove` só sobrevivem se o tracker NÃO mudou.** São de provedor:
 *    carregar o `autoApprove` do Jira para um projeto que agora é Linear liberaria escrita sem
 *    aprovação num board que nunca foi aprovado. Trocar de fonte é trocar de mundo.
 */
export function planTaskSourceCommand(input: {
  command: TaskSourceCommand;
  /** Pasta do projeto NA MÁQUINA da sessão. `""` = ainda não se sabe (e adivinhar seria o engano da fatia C). */
  projectDir: string;
  current?: ProjectTaskBinding | null;
  connections?: TaskSourceConnectionLike[];
}): TaskSourcePlanResult {
  const projectDir = String(input.projectDir || "").trim();
  if (!projectDir) return { ok: false, error: "ainda não sei em que pasta esta sessão está na máquina dela — abra a sessão nessa máquina para eu saber qual é o projeto" };

  const cmd = input.command;
  if (cmd.intent === "clear") return { ok: true, plan: { remove: true } };

  const current = input.current || undefined;
  const sameTracker = !!current && lower(current.tracker) === cmd.tracker;
  const kept = sameTracker
    ? { allowed: current?.allowed, target: current?.target, autoApprove: current?.autoApprove }
    : {};

  if (cmd.tracker === "local") {
    // Sem caminho dito, vale o que o projeto já usava (trocar de provedor para "pasta" não deve
    // esquecer a pasta que já estava configurada); sem nada, `resolveFeaturesRoot` aplica o padrão.
    const wanted = cmd.featuresDir ?? (sameTracker ? current?.featuresDir : undefined);
    let rel: string;
    try {
      const { root } = resolveFeaturesRoot(projectDir, wanted);
      rel = relative(projectDir, root).replace(/\\/g, "/") || ".";
    } catch {
      return { ok: false, error: `"${wanted}" fica fora do projeto (${projectDir}) — a pasta de tarefas precisa estar dentro dele; diga um caminho relativo, como "docs/features"` };
    }
    return { ok: true, plan: { remove: false, binding: { tracker: "local", featuresDir: rel, ...kept } } };
  }

  if (cmd.tracker === "mcp") {
    const mcpServer = cmd.mcpServer || (sameTracker ? current?.mcpServer : undefined);
    return { ok: true, plan: { remove: false, binding: { tracker: "mcp", ...(mcpServer ? { mcpServer } : {}), ...kept } } };
  }

  const ofProvider = (input.connections || []).filter((c) => lower(c.provider) === cmd.tracker);
  let connectionId = sameTracker ? current?.connectionId : undefined;
  if (cmd.connectionHint) {
    const hint = lower(cmd.connectionHint);
    const exact = ofProvider.filter((c) => lower(c.id) === hint || lower(c.label) === hint);
    // Exato vence parcial: um rótulo que é o nome inteiro de uma conta e pedaço de outra não é dúvida.
    const chosen = exact.length ? exact : ofProvider.filter((c) => lower(c.id).includes(hint) || lower(c.label).includes(hint));
    if (!chosen.length) {
      const known = ofProvider.length ? ` — as de ${cmd.tracker} no cofre são: ${ofProvider.map((c) => `${c.label || c.id} (${c.id})`).join(", ")}` : ` — não há nenhuma conta de ${cmd.tracker} no cofre; cadastre em Configurações → 🎯 Tarefas`;
      return { ok: false, error: `não achei conexão de ${cmd.tracker} para "${cmd.connectionHint}"${known}` };
    }
    if (chosen.length > 1) {
      return { ok: false, error: `"${cmd.connectionHint}" combina com ${chosen.length} conexões de ${cmd.tracker} (${chosen.map((c) => c.label || c.id).join(", ")}) — diga o rótulo exato` };
    }
    connectionId = chosen[0].id;
  }
  // A allowlist herdada mais a conta nomeada agora podem se contradizer; o store recusaria com um
  // erro cru. Recusar aqui deixa a frase dizer ONDE arrumar em vez de só "erro".
  if (connectionId && kept.allowed?.length && !kept.allowed.includes(connectionId)) {
    return { ok: false, error: `a conexão "${connectionId}" não está na lista de permitidas deste projeto — ajuste a lista em Configurações → 🎯 Tarefas` };
  }
  return { ok: true, plan: { remove: false, binding: { tracker: cmd.tracker, ...(connectionId ? { connectionId } : {}), ...kept } } };
}

/* ── a frase que volta ────────────────────────────────────────────────────────────────────────── */

/**
 * A confirmação é feita da decisão JÁ GRAVADA (`resolveTaskSource` lendo o vínculo persistido), e
 * nunca do que o usuário pediu. É a diferença entre "ok, configurado" e mostrar a pasta que de fato
 * ficou valendo: se algo tiver sido normalizado no caminho, quem lê vê a normalização.
 *
 * Quando a fonte não pode servir, o `reason` da própria decisão entra na frase — ele já é imperativo
 * e diz o que fazer. Fingir sucesso ("pronto!") num projeto que ainda não consegue listar seria a
 * resposta plausível e falsa que este épico inteiro existe para não dar.
 */
export function formatTaskSourceConfirmation(input: {
  projectDir: string;
  decision: TaskSourceDecision;
  /** Rótulo humano da conexão vinculada, quando o Hub souber (o cofre é dele). */
  connectionLabel?: string;
  removed?: boolean;
}): string {
  const dir = String(input.projectDir || "").trim();
  const d = input.decision;
  const head = `Fonte de tarefas de ${dir}`;
  if (input.removed || d.kind === "none") {
    return `${head}: nenhuma. O projeto volta a pedir que você declare de onde vêm as tarefas${d.reason && !input.removed ? ` — ${d.reason}` : ""}.`;
  }
  if (d.kind === "local") {
    return `${head}: pasta local "${d.featuresDir}" (relativa ao projeto). É de lá que a lista vem agora.`;
  }
  if (d.kind === "mcp") {
    return d.mcpServer
      ? `${head}: servidor MCP "${d.mcpServer}", executado na máquina do projeto.`
      : `${head}: servidor MCP, executado na máquina do projeto. Nenhum nome declarado — a máquina usa o único que tiver configurado, e com dois ou mais vai pedir que você diga qual.`;
  }
  const conta = input.connectionLabel || d.connectionId;
  if (!d.ready) return `${head}: ${d.tracker}. Ainda não dá para listar: ${d.reason || "a fonte não pode servir"}.`;
  return `${head}: ${d.tracker}${conta ? ` pela conexão "${conta}"` : ""}.`;
}
