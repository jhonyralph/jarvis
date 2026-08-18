/**
 * Vínculo do fluxo com TAREFAS de verdade (F1/F2 do plano "fluxo por tarefa").
 *
 * Três peças, todas agnósticas de provedor (decisão de projeto — o rastreador é texto livre):
 *  - `parseTaskInput`: o que o usuário COLA (chave, URL de Jira/GitHub/Linear, "linear PRI-824")
 *    vira uma TaskRef sem rede nenhuma;
 *  - `parseFeatureTask`: um arquivo local de feature (`docs/features/*.md`) vira tarefa para quem
 *    não usa gerenciador — frontmatter dá título/descrição, o caminho é a chave;
 *  - `ProjectTaskBindingStore` + `TaskMetaStore`: memória POR PASTA de qual fonte o projeto usa
 *    (projeto x = jira, y = github, z = nada) e cache leve de título/descrição/link/resumo por
 *    tarefa, para a UI não depender de rede a cada abertura.
 *
 * Segredo NUNCA aparece aqui: conexão de provedor (F2) guarda só nome de env var (`secretRef`),
 * seguindo o padrão já provado das fontes pessoais.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "./persist.js";
// A pasta padrão de features é UMA: quem resolve/contém o caminho (Hub e runner) já vem daqui.
import { DEFAULT_FEATURES_DIR } from "./task-local-cache.js";
import { normalizeTaskRef, type TaskRef, type WorkflowRun } from "./workflow-run.js";

/** Fontes com atalho na UI. O modelo continua aceitando qualquer slug — isto é sugestão, não cerca. */
export const KNOWN_TASK_TRACKERS = ["local", "mcp", "github", "jira", "linear", "gitlab", "azure"] as const;

const clean = (v: unknown, cap = 200): string => String(v ?? "").trim().slice(0, cap);
const slug = (v: unknown): string => clean(v, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, "");

/* ── colar uma referência ─────────────────────────────────────────────────────────────────────── */

/**
 * Interpreta o que foi colado/digitado como referência de tarefa. Sem rede: só reconhecimento de
 * forma. `defaultTracker` (o vínculo da pasta) preenche o rastreador quando o texto não o diz —
 * "PRI-824" num projeto vinculado ao Linear é do Linear sem o usuário repetir isso.
 */
export function parseTaskInput(text: string, opts: { defaultTracker?: string } = {}): TaskRef | null {
  const raw = clean(text, 500);
  if (!raw) return null;
  const fallback = slug(opts.defaultTracker);

  // URLs conhecidas primeiro — são o caso mais comum de "copiei do navegador".
  const url = /^https?:\/\/\S+$/i.test(raw) ? raw : undefined;
  if (url) {
    let m = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)/i.exec(raw);
    if (m) return normalizeTaskRef({ tracker: "github", key: `${m[1]}/${m[2]}#${m[3]}`, url: raw });
    m = /^https?:\/\/(?:www\.)?linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/i.exec(raw);
    if (m) return normalizeTaskRef({ tracker: "linear", key: m[1].toUpperCase(), url: raw });
    m = /^https?:\/\/[^/\s]*atlassian\.net\/(?:browse|jira\/[^\s]*?selectedIssue=)\/?([A-Za-z][A-Za-z0-9_]*-\d+)/i.exec(raw);
    if (m) return normalizeTaskRef({ tracker: "jira", key: m[1].toUpperCase(), url: raw });
    m = /^https?:\/\/(?:www\.)?gitlab\.com\/(.+?)\/-\/issues\/(\d+)/i.exec(raw);
    if (m) return normalizeTaskRef({ tracker: "gitlab", key: `${m[1]}#${m[2]}`, url: raw });
    // URL desconhecida: preserva o link; a chave vira o último pedaço legível do caminho.
    const tail = raw.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() || raw;
    return normalizeTaskRef({ tracker: fallback, key: tail, url: raw });
  }

  // Convenção já usada no diálogo antigo: "linear PRI-824", "github #42".
  const spaced = /^([a-z][a-z0-9_-]{1,20})\s+(.+)$/i.exec(raw);
  if (spaced && KNOWN_TASK_TRACKERS.includes(slug(spaced[1]) as any)) {
    return normalizeTaskRef({ tracker: slug(spaced[1]), key: clean(spaced[2], 120) });
  }

  // "owner/repo#123" é inequivocamente GitHub.
  if (/^[\w.-]+\/[\w.-]+#\d+$/.test(raw)) return normalizeTaskRef({ tracker: "github", key: raw });

  // Chave nua ("ABC-123", "#42"): o vínculo da pasta decide de quem ela é.
  return normalizeTaskRef({ tracker: fallback, key: raw });
}

/* ── arquivo local de feature ─────────────────────────────────────────────────────────────────── */

export interface FeatureTask {
  /** TaskRef pronta: tracker "local", key = caminho relativo do arquivo. */
  task: TaskRef;
  title: string;
  description?: string;
}

/**
 * Um `.md` de feature vira tarefa. Título: frontmatter (`title:`/`name:`) ou o primeiro `# h1`;
 * descrição: `description:` do frontmatter ou o primeiro parágrafo útil. Nada é inventado — sem
 * título real, o nome do arquivo responde.
 */
export function parseFeatureTask(content: string, relPath: string): FeatureTask {
  const text = String(content || "");
  const path = clean(relPath, 300).replace(/\\/g, "/");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fmField = (name: string): string => {
    if (!fm) return "";
    const m = new RegExp(`(^|\\n)${name}:\\s*(.+)`, "i").exec(fm[1]);
    return m ? clean(m[2].replace(/^["']|["']$/g, ""), 300) : "";
  };
  const body = fm ? text.slice(fm[0].length) : text;
  const h1 = /^#\s+(.+?)\s*$/m.exec(body);
  const title = fmField("title") || fmField("name") || (h1 ? clean(h1[1], 300) : "") || (path.split("/").pop() || path).replace(/\.md$/i, "");
  let description = fmField("description");
  if (!description) {
    const lines = body.split(/\r?\n/);
    const start = h1 ? lines.findIndex((l) => l.trim() === h1[0].trim()) + 1 : 0;
    const para: string[] = [];
    for (let i = Math.max(0, start); i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) { if (para.length) break; continue; }
      if (/^#{1,6}\s|^```/.test(t)) { if (para.length) break; continue; }
      para.push(t);
    }
    description = clean(para.join(" "), 500);
  }
  return { task: normalizeTaskRef({ tracker: "local", key: path, title }), title, description: description || undefined };
}

/* ── memória por pasta: qual fonte de tarefas este projeto usa ────────────────────────────────── */

export interface ProjectTaskBinding {
  /** slug da fonte ("jira", "github", "linear", "local"); vazio = este projeto não usa nenhuma. */
  tracker: string;
  /** pasta dos arquivos de feature, relativa ao projeto (só faz sentido com tracker "local"). */
  featuresDir?: string;
  /** E: NOME do servidor MCP na allowlist da máquina do projeto (só com tracker "mcp"). O Hub nunca
   *  guarda comando nem segredo — só o nome; quem tem a receita é o disco daquela máquina. */
  mcpServer?: string;
  /** C2: a CONEXÃO (conta) vinculada — com várias contas do mesmo provedor, é ela que decide. */
  connectionId?: string;
  /** C2: allowlist de conexões que este projeto aceita; vazia/ausente = sem restrição extra. */
  allowed?: string[];
  /** C4: destino de ESCRITA no provedor (owner/repo, chave do projeto Jira, chave do time Linear). */
  target?: string;
  /** C4: ações de escrita liberadas SEM aprovação neste projeto (ex.: ["create"]) — a "política
   *  adaptativa" por projeto+conexão+ação. Ausente = toda escrita pede aprovação. */
  autoApprove?: string[];
  updatedAt: number;
}

/**
 * Caminho → chave estável. Barras normalizadas; no Windows o caminho é case-insensitive, então a
 * chave desce para minúsculas lá (e só lá — em FS sensível a caso, "Api" e "api" são projetos
 * diferentes de verdade).
 */
export function projectKeyFor(cwd: string, platform: NodeJS.Platform = process.platform): string {
  const norm = clean(cwd, 500).replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? norm.toLowerCase() : norm;
}

const JARVIS_HOME = process.env.JARVIS_HOME || homedir();

interface BindingFile { version: 1; projects: Record<string, ProjectTaskBinding> }

export class ProjectTaskBindingStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;
  private data: BindingFile = { version: 1, projects: {} };

  constructor(opts: { dir?: string; now?: () => number; platform?: NodeJS.Platform } = {}) {
    const dir = opts.dir || join(JARVIS_HOME, ".jarvis", "hub");
    this.file = join(dir, "project-tasks.json");
    this.now = opts.now || (() => Date.now());
    this.platform = opts.platform || process.platform;
    mkdirSync(dir, { recursive: true });
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf8"));
        if (raw?.version === 1 && raw.projects && typeof raw.projects === "object") this.data = { version: 1, projects: raw.projects };
      } catch { /* arquivo torto: recomeça vazio, nada além de preferências se perde */ }
    }
  }

  get(cwd: string): ProjectTaskBinding | undefined {
    const b = this.data.projects[projectKeyFor(cwd, this.platform)];
    return b ? { ...b } : undefined;
  }

  set(cwd: string, binding: { tracker: string; featuresDir?: string; mcpServer?: string; connectionId?: string; allowed?: string[]; target?: string; autoApprove?: string[] }): ProjectTaskBinding {
    const key = projectKeyFor(cwd, this.platform);
    if (!key) throw new Error("projeto sem caminho");
    const featuresDir = clean(binding.featuresDir, 200).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    // `..` aqui viraria leitura fora do projeto no listar de features — recusado na borda.
    if (featuresDir.split("/").includes("..")) throw new Error("pasta de features não pode sair do projeto");
    const row: ProjectTaskBinding = { tracker: slug(binding.tracker), updatedAt: this.now() };
    if (featuresDir) row.featuresDir = featuresDir;
    const mcpServer = clean(binding.mcpServer, 60);
    if (mcpServer) row.mcpServer = mcpServer;
    const connectionId = clean(binding.connectionId, 80);
    if (connectionId) row.connectionId = connectionId;
    const allowed = (binding.allowed || []).map((v) => clean(v, 80)).filter(Boolean).slice(0, 20);
    if (allowed.length) row.allowed = [...new Set(allowed)];
    // A conexão vinculada fora da própria allowlist seria uma contradição armada esperando a escrita.
    if (row.connectionId && row.allowed && !row.allowed.includes(row.connectionId)) throw new Error("a conexão vinculada precisa estar na lista de permitidas");
    const target = clean(binding.target, 200);
    if (target) row.target = target;
    const autoApprove = (binding.autoApprove || []).map((v) => slug(v)).filter(Boolean).slice(0, 10);
    if (autoApprove.length) row.autoApprove = [...new Set(autoApprove)];
    this.data.projects[key] = row;
    writeJsonAtomic(this.file, this.data, { pretty: true });
    return { ...row };
  }

  /** F: desfaz o vínculo de um projeto (a tela de gerenciar precisa desligar, não só trocar).
   *  Sem vínculo, o projeto volta a "não declarou fonte" — que é um estado honesto e visível, não
   *  um projeto órfão apontando para conexão que não existe mais. */
  remove(cwd: string): boolean {
    const key = projectKeyFor(cwd, this.platform);
    if (!this.data.projects[key]) return false;
    delete this.data.projects[key];
    writeJsonAtomic(this.file, this.data, { pretty: true });
    return true;
  }

  list(): Array<{ project: string; binding: ProjectTaskBinding }> {
    return Object.entries(this.data.projects).map(([project, binding]) => ({ project, binding: { ...binding } }));
  }
}

/* ── fonte ÚNICA declarada por projeto (D) ────────────────────────────────────────────────────── */

export type TaskSourceKind = "none" | "local" | "mcp" | "provider";

export interface TaskSourceDecision {
  kind: TaskSourceKind;
  /** slug declarado no vínculo ("" quando o projeto não declarou nada). */
  tracker: string;
  /** `true` = esta fonte pode servir a lista AGORA. `false` = há um motivo acionável em `reason`. */
  ready: boolean;
  /** só em `local`: pasta relativa das features (já com o default aplicado). */
  featuresDir?: string;
  /** só em `mcp`: nome do servidor na allowlist da máquina ("" = a máquina decide, se tiver um só). */
  mcpServer?: string;
  /** só em `provider`: conexão vinculada, quando existe. */
  connectionId?: string;
  code?: "UNKNOWN_PROJECT" | "NO_SOURCE" | "NO_CONNECTION" | "CONNECTION_MISSING" | "PROVIDER_MISMATCH";
  /** frase para o dono, no imperativo: sempre diz o que FAZER, não só o que faltou. */
  reason?: string;
}

/**
 * De onde vêm as tarefas DESTE projeto — uma fonte, declarada, sem ambiguidade.
 *
 * O problema que isto resolve: a mesma lista podia misturar arquivos de feature do disco com
 * tarefas de um provedor, e "nenhuma fonte declarada" se comportava como "pasta local por padrão".
 * Duas fontes na mesma lista significam que ninguém sabe de onde a tarefa veio — e um default
 * implícito faz o projeto "funcionar" pela fonte errada, calado. Aqui a resposta é sempre uma só, e
 * quando não dá para servir, o motivo diz o que fazer (declarar a fonte / vincular a conta).
 *
 * NÃO conhece o cofre de propósito (`task-connections.ts` é que importa este módulo, não o
 * contrário): recebe as conexões existentes como dado e só confere presença/provedor.
 */
export function resolveTaskSource(input: {
  /** Pasta do projeto NA MÁQUINA onde a sessão roda. Passe `""` quando ainda não se sabe qual é —
   *  responder pela pasta de outra máquina é o engano que a fatia C tirou da listagem. Omitir o
   *  campo (undefined) significa "não me pergunte isso", para quem só quer avaliar o vínculo. */
  projectDir?: string;
  binding?: Pick<ProjectTaskBinding, "tracker" | "featuresDir" | "mcpServer" | "connectionId"> | null;
  connections?: Array<{ id: string; provider: string; label?: string }>;
}): TaskSourceDecision {
  if (input.projectDir !== undefined && !clean(input.projectDir, 500)) {
    return { kind: "none", tracker: "", ready: false, code: "UNKNOWN_PROJECT",
      reason: "ainda não sei em que pasta esta sessão está na máquina dela — abra a sessão na máquina para o Jarvis saber o projeto" };
  }
  const tracker = slug(input.binding?.tracker);
  if (!tracker) {
    return { kind: "none", tracker: "", ready: false, code: "NO_SOURCE",
      reason: "este projeto ainda não declarou de onde vêm as tarefas — escolha a fonte (pasta local ou um provedor)" };
  }
  if (tracker === "local") {
    const featuresDir = clean(input.binding?.featuresDir, 200).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || DEFAULT_FEATURES_DIR;
    return { kind: "local", tracker, ready: true, featuresDir };
  }
  // E — MCP: quem sabe se o servidor existe é a MÁQUINA do projeto (o Hub guarda só o nome). Por
  // isso a fonte sai daqui "pronta para perguntar": a recusa acionável ("esta máquina não tem esse
  // servidor") nasce lá, com a lista do que existe — informação que o Hub não tem para inventar.
  if (tracker === "mcp") {
    const mcpServer = clean(input.binding?.mcpServer, 60);
    return { kind: "mcp", tracker, ready: true, ...(mcpServer ? { mcpServer } : {}) };
  }
  const connectionId = clean(input.binding?.connectionId, 80);
  if (!connectionId) {
    return { kind: "provider", tracker, ready: false, code: "NO_CONNECTION",
      reason: `este projeto declara ${tracker} como fonte, mas nenhuma conta está vinculada — vincule a conexão` };
  }
  const connection = (input.connections || []).find((c) => c.id === connectionId);
  if (!connection) {
    return { kind: "provider", tracker, connectionId, ready: false, code: "CONNECTION_MISSING",
      reason: `a conexão vinculada (${connectionId}) não existe mais no cofre — vincule outra conta de ${tracker}` };
  }
  // Vínculo apontando para conta de outro provedor: listar por ele contradiz o que o projeto declara.
  if (slug(connection.provider) !== tracker) {
    return { kind: "provider", tracker, connectionId, ready: false, code: "PROVIDER_MISMATCH",
      reason: `a conexão vinculada é de ${connection.provider}, mas este projeto declara ${tracker} — vincule uma conta de ${tracker} ou troque a fonte` };
  }
  return { kind: "provider", tracker, connectionId, ready: true };
}

/* ── cache de metadados por tarefa ────────────────────────────────────────────────────────────── */

export interface TaskMeta {
  title?: string;
  description?: string;
  url?: string;
  /** resumo produzido sob demanda (botão "Resumir"); cacheado para não pagar duas vezes. */
  summary?: string;
  updatedAt: number;
}

const META_CAP = 300;
const metaKey = (tracker: string, key: string): string => `${slug(tracker)} ${clean(key, 300)}`;

export class TaskMetaStore {
  private readonly file: string;
  private readonly now: () => number;
  private data: { version: 1; tasks: Record<string, TaskMeta> } = { version: 1, tasks: {} };

  constructor(opts: { dir?: string; now?: () => number } = {}) {
    const dir = opts.dir || join(JARVIS_HOME, ".jarvis", "hub");
    this.file = join(dir, "task-meta.json");
    this.now = opts.now || (() => Date.now());
    mkdirSync(dir, { recursive: true });
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf8"));
        if (raw?.version === 1 && raw.tasks && typeof raw.tasks === "object") this.data = { version: 1, tasks: raw.tasks };
      } catch { /* cache é descartável por definição */ }
    }
  }

  get(tracker: string, key: string): TaskMeta | undefined {
    const m = this.data.tasks[metaKey(tracker, key)];
    return m ? { ...m } : undefined;
  }

  /** Mescla campos novos por cima do cache (campo ausente não apaga o que já se sabia). */
  merge(tracker: string, key: string, patch: Partial<Omit<TaskMeta, "updatedAt">>): TaskMeta | undefined {
    const k = metaKey(tracker, key);
    if (!clean(key)) return undefined;
    const prev = this.data.tasks[k] || { updatedAt: 0 };
    const next: TaskMeta = { ...prev, updatedAt: this.now() };
    if (clean(patch.title)) next.title = clean(patch.title, 300);
    if (clean(patch.description)) next.description = clean(patch.description, 4000);
    if (clean(patch.url)) next.url = clean(patch.url, 500);
    if (clean(patch.summary)) next.summary = clean(patch.summary, 4000);
    this.data.tasks[k] = next;
    // Cache com teto: os mais antigos saem primeiro. Perder cache não perde verdade — só re-busca.
    const entries = Object.entries(this.data.tasks);
    if (entries.length > META_CAP) {
      entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
      this.data.tasks = Object.fromEntries(entries.slice(0, META_CAP));
    }
    writeJsonAtomic(this.file, this.data, { pretty: true });
    return { ...next };
  }
}

/* ── multi-tarefa: a linha de status das OUTRAS tarefas da sessão ─────────────────────────────── */

/**
 * Uma linha curta sobre as tarefas que NÃO estão em foco. O steering completo é só do foco — injetar
 * N fluxos inteiros por turno poluiria a sessão principal exatamente com o que a delegação existe
 * para evitar. Vazio quando não há outras.
 */
export function formatParallelRunsLine(runs: Array<Pick<WorkflowRun, "workflowName" | "task" | "steps" | "currentStepId">>): string {
  if (!runs.length) return "";
  const bits = runs.slice(0, 6).map((r) => {
    const cur = r.steps.find((s) => s.id === r.currentStepId);
    const done = r.steps.filter((s) => s.state === "done" || s.state === "skipped").length;
    const label = r.task.key || r.task.title || r.workflowName;
    return `${label} (${cur ? cur.title : "concluído"}, ${done}/${r.steps.length})`;
  });
  const extra = runs.length > 6 ? ` e mais ${runs.length - 6}` : "";
  return `Outras tarefas acompanhadas nesta sessão (não são o assunto deste turno): ${bits.join("; ")}${extra}.`;
}
