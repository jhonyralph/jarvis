/**
 * Framework Jarvis — the canonical, provider-agnostic layer of commands/skills/instructions the user
 * configures ONCE and the Hub publishes to every machine, so behavior applies across AIs and hosts
 * without copying files into each provider's config. Jarvis is the source of truth; native provider
 * files (.claude, .codex, .gemini…) are adapters/cache.
 *
 * This module is the pure domain (filesystem + hashing, no network):
 *   - readCanonicalFramework(root)   → the on-disk tree as a hashed manifest
 *   - materializeFramework(manifest) → write a manifest onto a machine, idempotently (version receipt)
 * Distribution (Hub→Runner fan-out, offline queue) lives in the Hub/Runner and rides the protocol.
 * Keeping this side effect surface narrow means it unit-tests without a socket.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persist.js";

/** How a "/name" that exists both natively and in the framework resolves. `ask` = native-first at
 *  expansion; the composer surfaces both tagged and a per-pick override drives the choice. */
export type FrameworkPreference = "native" | "jarvis" | "ask";
export const FRAMEWORK_PREFERENCES: readonly FrameworkPreference[] = ["native", "jarvis", "ask"];
export function normalizeFrameworkPreference(v: unknown): FrameworkPreference {
  return v === "native" || v === "jarvis" || v === "ask" ? v : "ask";
}

/** One canonical file. `path` is POSIX-relative to the framework root and is confined to
 *  `commands/…`, `skills/…` or the top-level `instructions.md` (enforced on read and materialize). */
export interface FrameworkFile {
  path: string;
  content: string;
}

/** A content-addressed snapshot of the framework. `hash` is the identity; `version` is a monotonic
 *  label the Hub bumps on publish so machines can report "which version am I on". */
export interface FrameworkManifest {
  version: number;
  hash: string;
  files: FrameworkFile[];
}

export interface MaterializeResult {
  version: number;
  hash: string;
  /** files written this call (0 when skipped) */
  written: number;
  /** files removed because they left the manifest */
  removed: number;
  /** true when the machine was already on this hash — no disk writes happened */
  skipped: boolean;
}

interface FrameworkReceipt { version: number; hash: string; at: number }

/** Same resolution the rest of ~/.jarvis uses (JARVIS_HOME override), plus a dedicated
 *  JARVIS_FRAMEWORK_HOME for tests. commands.ts resolves the read path identically. */
export function frameworkRoot(): string {
  return process.env.JARVIS_FRAMEWORK_HOME || join(process.env.JARVIS_HOME || homedir(), ".jarvis", "framework");
}

const RECEIPT_FILE = ".receipt.json";

function sha256(text: string): string { return createHash("sha256").update(text).digest("hex"); }

function hashFiles(files: FrameworkFile[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) h.update(f.path).update("\0").update(f.content).update("\0");
  return h.digest("hex");
}
/** Content-addressed hash of a file set (same primitive the manifest uses). Exported so the importer
 *  can detect whether a re-fetched source drifted from what was last imported. */
export function hashFrameworkFiles(files: FrameworkFile[]): string { return hashFiles(files); }

/** Reject anything that could escape the framework root. Manifest paths arrive over the wire, so this
 *  is a security boundary: only POSIX, no absolute, no `..`, and only the three known top-levels.
 *  Exported so the archive importer enforces the SAME boundary on untrusted zip/tar entries. */
export function assertSafeRelPath(rel: string): string {
  const posix = String(rel || "").replace(/\\/g, "/");
  const segs = posix.split("/");
  if (!posix || posix.startsWith("/") || /^[A-Za-z]:/.test(posix) || segs.some((s) => s === ".." || s === "." || s === "")) {
    throw new Error(`caminho de framework inválido: ${rel}`);
  }
  if (!(posix === "instructions.md" || segs[0] === "commands" || segs[0] === "skills")) {
    throw new Error(`caminho de framework fora do escopo: ${rel}`);
  }
  return posix;
}

function toAbs(root: string, relPosix: string): string {
  return join(root, ...relPosix.split("/"));
}

function collectDir(dir: string, root: string, out: FrameworkFile[]): void {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    if (d.name.startsWith(".")) continue;
    const abs = join(dir, d.name);
    if (d.isDirectory()) { collectDir(abs, root, out); continue; }
    if (!d.isFile()) continue;
    const rel = abs.slice(root.length + 1).split(sep).join("/");
    let content: string;
    try { content = readFileSync(abs, "utf8"); } catch { continue; }
    out.push({ path: rel, content });
  }
}

/** Read the canonical framework tree (commands/, skills/, optional instructions.md) into a manifest.
 *  `version` is informational — the Hub owns the counter; the hash is what identifies the content. */
export function readCanonicalFramework(root = frameworkRoot(), version = 0): FrameworkManifest {
  const files: FrameworkFile[] = [];
  collectDir(join(root, "commands"), root, files);
  collectDir(join(root, "skills"), root, files);
  const instr = join(root, "instructions.md");
  if (existsSync(instr)) { try { files.push({ path: "instructions.md", content: readFileSync(instr, "utf8") }); } catch { /* unreadable */ } }
  files.sort((a, b) => a.path.localeCompare(b.path));
  // Validate every discovered path so a bad on-disk name can't later escape on a peer machine.
  for (const f of files) assertSafeRelPath(f.path);
  return { version, hash: hashFiles(files), files };
}

function receiptPath(root: string): string { return join(root, RECEIPT_FILE); }
export function readReceipt(root = frameworkRoot()): FrameworkReceipt | null {
  const r = readJson<FrameworkReceipt | null>(receiptPath(root), null);
  return r && typeof r.hash === "string" ? r : null;
}

/** Every framework-owned file currently on disk, as POSIX rel paths (for stale-file pruning). */
function existingRelPaths(root: string): string[] {
  const out: FrameworkFile[] = [];
  collectDir(join(root, "commands"), root, out);
  collectDir(join(root, "skills"), root, out);
  const rels = out.map((f) => f.path);
  if (existsSync(join(root, "instructions.md"))) rels.push("instructions.md");
  return rels;
}

/**
 * Write a manifest onto this machine under `root`. Idempotent: if the machine already carries this
 * hash (per its receipt) nothing is touched. Otherwise it prunes files that left the manifest, writes
 * the rest with crash-safe atomic writes, and records a new receipt. Never writes outside `root`.
 */
export function materializeFramework(manifest: FrameworkManifest, opts: { machineRoot?: string } = {}): MaterializeResult {
  const root = opts.machineRoot ?? frameworkRoot();
  for (const f of manifest.files) assertSafeRelPath(f.path);
  const prior = readReceipt(root);
  if (prior && prior.hash === manifest.hash) {
    return { version: prior.version, hash: prior.hash, written: 0, removed: 0, skipped: true };
  }
  const want = new Set(manifest.files.map((f) => assertSafeRelPath(f.path)));
  let removed = 0;
  for (const rel of existingRelPaths(root)) {
    if (want.has(rel)) continue;
    try { rmSync(toAbs(root, rel), { force: true }); removed++; } catch { /* best effort */ }
  }
  let written = 0;
  for (const f of manifest.files) { writeTextAtomic(toAbs(root, assertSafeRelPath(f.path)), f.content); written++; }
  writeJsonAtomic(receiptPath(root), { version: manifest.version, hash: manifest.hash, at: Date.now() } satisfies FrameworkReceipt, { pretty: true });
  return { version: manifest.version, hash: manifest.hash, written, removed, skipped: false };
}

export interface FrameworkPublishProvenance {
  at: number;
  runnerId: string;
  userId?: string;
  version: number;
  hash: string;
  written: number;
  removed: number;
  skipped: boolean;
}

/** Append-only audit of framework materializations, mirroring MemoryProvenanceStore. */
export class FrameworkProvenanceStore {
  readonly path: string;
  constructor(dir = join(process.env.JARVIS_HOME || homedir(), ".jarvis")) {
    this.path = join(dir, "framework-provenance.jsonl");
  }
  append(record: FrameworkPublishProvenance): void {
    mkdirSync(dirname(this.path), { recursive: true });
    try {
      if (existsSync(this.path) && statSync(this.path).size >= 10 * 1024 * 1024) {
        const previous = this.path + ".1";
        try { if (existsSync(previous)) rmSync(previous, { force: true }); } catch { /* best effort */ }
        renameSync(this.path, previous);
      }
    } catch { /* rotation is best effort */ }
    appendFileSync(this.path, JSON.stringify(record) + "\n", "utf8");
  }
}

/** Utility for provenance/debug: the sha256 of a string (same primitive triggers.ts uses). */
export function frameworkContentHash(text: string): string { return sha256(text); }

/** Write one canonical file (path-guarded). Returns the normalized POSIX rel path actually written. */
export function writeFrameworkFile(relPath: string, content: string, root = frameworkRoot()): string {
  const safe = assertSafeRelPath(relPath);
  writeTextAtomic(toAbs(root, safe), content);
  return safe;
}

/** Delete one canonical file (path-guarded). No-op-safe. */
export function deleteFrameworkFile(relPath: string, root = frameworkRoot()): boolean {
  const safe = assertSafeRelPath(relPath);
  try { rmSync(toAbs(root, safe), { force: true }); return true; } catch { return false; }
}

export interface FrameworkImportResult { imported: string[]; skipped: string[] }

const STARTER_FRAMEWORK_FILES: FrameworkFile[] = [
  {
    path: "commands/code-review.md",
    content: `---
description: Revisao tecnica profunda do codigo ou PR informado.
argument-hint: <diff, PR, branch, pasta ou objetivo>
---
Faca um code review rigoroso e agnostico de IA para: $ARGUMENTS

Priorize achados por severidade. Procure bugs, regressao comportamental, risco de seguranca, concorrencia, estado inconsistente, acessibilidade quando houver UI, e lacunas de teste. Cite arquivos e linhas quando existirem. Se nao houver achados relevantes, diga isso claramente e liste riscos residuais ou testes nao executados.
`,
  },
  {
    path: "commands/research.md",
    content: `---
description: Pesquisa tecnica estruturada com fontes, trade-offs e decisao.
argument-hint: <tema ou pergunta>
---
Pesquise e sintetize: $ARGUMENTS

Use fontes primarias quando o tema for tecnico, verifique informacoes temporais instaveis antes de concluir, separe fatos de inferencias e termine com opcoes praticas, trade-offs e uma recomendacao defensavel.
`,
  },
  {
    path: "commands/benchmark.md",
    content: `---
description: Comparativo profissional entre solucoes, modelos, abordagens ou implementacoes.
argument-hint: <cenario, concorrentes e criterios>
---
Monte um benchmark/comparativo para: $ARGUMENTS

Defina criterios, pesos, riscos, custo de execucao, tempo esperado, qualidade esperada e limites de cada alternativa. Quando houver codigo ou produto, proponha como validar com testes ou evidencias objetivas. Termine com ranking e decisao recomendada.
`,
  },
  {
    path: "commands/daily-digest.md",
    content: `---
description: Gera um digest operacional de repositorios, tarefas ou contexto informado.
argument-hint: <repos, pastas, sistemas ou periodo>
---
Gere um digest operacional para: $ARGUMENTS

Inclua mudancas importantes, riscos, bloqueios, proximas acoes, itens aguardando decisao e qualquer trabalho em background que precise acompanhamento. Mantenha formato escaneavel.
`,
  },
  {
    path: "commands/create-routine.md",
    content: `---
description: Transforma um objetivo recorrente em uma rotina agendada do Jarvis.
argument-hint: <objetivo recorrente e frequencia desejada>
---
Planeje uma rotina agendada do Jarvis para: $ARGUMENTS

Defina nome, prompt exato, maquina ideal, IA/modelo/esforco quando fizer sentido, pasta de trabalho, agenda cron de cinco campos, condicoes de parada, notificacoes e riscos. Se a automacao puder gerar custo ou alteracao de arquivos, destaque a politica de aprovacao.
`,
  },
  {
    path: "commands/solution-workspace.md",
    content: `---
description: Estrutura uma execucao no Espaco de Solucoes / Solution Workspace.
argument-hint: <objetivo, modo e IAs desejadas>
---
Estruture um trabalho para o Espaco de Solucoes (Solution Workspace): $ARGUMENTS

Escolha entre conselho, benchmark, revisao paralela ou auditoria. Defina participantes, modelo/esforco quando relevante, paralelismo, criterio de julgamento, artefatos esperados e como o resultado deve virar execucao ou ser direcionado para uma IA especifica.
`,
  },
  {
    path: "skills/code-review/SKILL.md",
    content: `---
name: code-review
description: Revisao tecnica rigorosa de diff, PR, branch ou implementacao.
---
Atue como revisor senior. Foque em problemas concretos, nao em elogios. Priorize bugs, regressao, seguranca, dados, concorrencia, compatibilidade, UX e testes. Use este formato: Achados, Perguntas abertas, Testes faltantes, Resumo. Cite arquivo/linha sempre que possivel. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/security-scan/SKILL.md",
    content: `---
name: security-scan
description: Auditoria de seguranca para codigo, configuracao, dependencias e fluxos.
---
Procure exposicao de segredo, autenticacao fraca, autorizacao incorreta, injecao, traversal, SSRF, XSS, CSRF, vazamento em logs, configuracao insegura e riscos de supply chain. Classifique severidade e proponha mitigacao pequena e verificavel. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/dependency-audit/SKILL.md",
    content: `---
name: dependency-audit
description: Analisa dependencias, versoes, risco de pacote e caminho de atualizacao.
---
Mapeie dependencias diretas e criticas. Verifique versoes, alternativas mantidas, risco de licenca quando aplicavel, impacto de upgrade e plano de migracao. Nao invente vulnerabilidades: confirme em fonte confiavel quando precisar. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/deep-research/SKILL.md",
    content: `---
name: deep-research
description: Pesquisa profunda com fontes, lacunas, opcoes e recomendacao.
---
Investigue de forma estruturada. Comece pela pergunta real, separe fatos de inferencias, use fontes primarias sempre que possivel, compare alternativas e feche com decisao recomendada, riscos e proximos passos. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/daily-digest/SKILL.md",
    content: `---
name: daily-digest
description: Resume mudancas, filas, bloqueios, riscos e proximas acoes.
---
Crie um resumo operacional curto. Agrupe por andamento, bloqueios, falhas, decisoes pendentes e proximas acoes. Destaque trabalhos em background e qualquer item que exija intervencao humana. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/compare-docs/SKILL.md",
    content: `---
name: compare-docs
description: Compara documentos, requisitos, PRDs, specs ou propostas.
---
Compare os documentos informados por objetivo, escopo, divergencias, lacunas, conflitos, decisoes implicitas e riscos de implementacao. Gere uma tabela curta quando ajudar e termine com recomendacao. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/data-analyze/SKILL.md",
    content: `---
name: data-analyze
description: Analise de dados com validacao, hipoteses e conclusoes praticas.
---
Analise os dados com postura critica. Verifique qualidade, schema, outliers, vieses, metrica principal, metricas auxiliares e conclusoes que os dados realmente suportam. Deixe claro o que nao pode ser concluido. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/meeting-notes/SKILL.md",
    content: `---
name: meeting-notes
description: Transforma conversa ou notas em decisoes, tarefas e follow-ups.
---
Extraia decisoes, tarefas, donos, prazos, riscos e perguntas abertas. Separe fatos de interpretacoes e preserve nomes/projetos importantes. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/todo-from-notes/SKILL.md",
    content: `---
name: todo-from-notes
description: Converte notas soltas em plano executavel e checklist.
---
Transforme as notas em um plano com tarefas atomicas, dependencias, criterios de aceite e ordem sugerida. Sinalize ambiguidades que bloqueiam execucao. Contexto: $ARGUMENTS
`,
  },
  {
    path: "skills/browser-flow-review/SKILL.md",
    content: `---
name: browser-flow-review
description: Revisa fluxo navegado/renderizado e conecta observacoes visuais a codigo quando houver source map.
---
Revise o fluxo de browser informado. Considere estado renderizado, selecoes visuais, console, network, acessibilidade, responsividade e source maps quando disponiveis. Envie para a IA tanto o que foi renderizado quanto os mapeamentos de origem relevantes. Contexto: $ARGUMENTS
`,
  },
];

/** Seed a useful universal skill/command pack inspired by local-first assistants such as OpenJarvis.
 *  It is intentionally additive: existing files are never overwritten. */
export function installFrameworkStarterPack(root = frameworkRoot()): FrameworkImportResult {
  const imported: string[] = [], skipped: string[] = [];
  for (const f of STARTER_FRAMEWORK_FILES) {
    const safe = assertSafeRelPath(f.path);
    if (existsSync(toAbs(root, safe))) { skipped.push(`${safe} (já existe)`); continue; }
    writeTextAtomic(toAbs(root, safe), f.content);
    imported.push(safe);
  }
  return { imported, skipped };
}

/** The bundled starter pack as pure data, so callers can build an import preview (scan + diff) and let
 *  the owner confirm/exclude items BEFORE anything is written — instead of the old one-click install. */
export function starterFrameworkFiles(): FrameworkFile[] {
  return STARTER_FRAMEWORK_FILES.map((f) => ({ path: f.path, content: f.content }));
}

/** Read this machine's native global instruction files (CLAUDE.md / AGENTS.md / GEMINI.md) into a
 *  framework file set — pure, no writes. Returns [{path:"instructions.md", content}] when any native
 *  instruction exists, else []. Feeds the same preview/confirm flow as zip/GitHub imports. */
export function collectNativeFrameworkFiles(opts: { home?: string } = {}): FrameworkFile[] {
  const home = opts.home ?? homedir();
  const sources: Array<[string, string]> = [
    ["Claude (CLAUDE.md)", join(home, ".claude", "CLAUDE.md")],
    ["AGENTS.md", join(home, ".codex", "AGENTS.md")],
    ["Gemini (GEMINI.md)", join(home, ".gemini", "GEMINI.md")],
  ];
  const parts: string[] = [];
  for (const [label, p] of sources) { try { const c = readFileSync(p, "utf8").trim(); if (c) parts.push(`# ${label}\n\n${c}`); } catch { /* absent */ } }
  if (!parts.length) return [];
  return [{ path: "instructions.md", content: parts.join("\n\n---\n\n") + "\n" }];
}

/** Minimal, safe importer: seed instructions.md from this machine's existing global instruction files
 *  (CLAUDE.md / AGENTS.md / GEMINI.md), so a user's current behavior becomes the framework's starting
 *  point. Never overwrites an existing instructions.md. Commands/skills are added via the editor. */
export function importFrameworkFromNative(opts: { root?: string; home?: string } = {}): FrameworkImportResult {
  const root = opts.root ?? frameworkRoot();
  const home = opts.home ?? homedir();
  const imported: string[] = [], skipped: string[] = [];
  const instr = join(root, "instructions.md");
  if (existsSync(instr)) { skipped.push("instructions.md (já existe)"); return { imported, skipped }; }
  const sources: Array<[string, string]> = [
    ["Claude (CLAUDE.md)", join(home, ".claude", "CLAUDE.md")],
    ["AGENTS.md", join(home, ".codex", "AGENTS.md")],
    ["Gemini (GEMINI.md)", join(home, ".gemini", "GEMINI.md")],
  ];
  const parts: string[] = [];
  for (const [label, p] of sources) { try { const c = readFileSync(p, "utf8").trim(); if (c) parts.push(`# ${label}\n\n${c}`); } catch { /* absent */ } }
  if (parts.length) { writeTextAtomic(instr, parts.join("\n\n---\n\n") + "\n"); imported.push("instructions.md"); }
  else skipped.push("instructions.md (nenhuma instrução nativa encontrada)");
  return { imported, skipped };
}
