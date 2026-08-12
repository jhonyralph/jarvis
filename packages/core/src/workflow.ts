/**
 * Fluxos de trabalho (F1): transformar o processo que hoje vive como PROSA numa skill em algo que o
 * Jarvis consiga acompanhar — passos, gates e onde você está.
 *
 * Por que é heurístico e HÍBRIDO: as skills reais não seguem uma convenção única. No framework do
 * usuário convivem, por exemplo:
 *   - `### 0 — Pick up & scope` … `### 10 — Reviewers` (evidence-driven-delivery)
 *   - `## Phase 0 — Context` + `## GATE_APPROACH (hard stop) ⛔` (discovery-breakdown)
 *   - seções livres, sem numeração (bugfix-evidence-process)
 * Então este módulo PROPÕE uma estrutura e o humano confirma/edita — nunca decide sozinho. É puro
 * (texto → objeto), sem filesystem nem rede, para ser testável e rodar igual em qualquer máquina.
 */

export const WORKFLOW_SCHEMA_VERSION = 1;

export type WorkflowStepKind = "step" | "gate";

export interface WorkflowStep {
  /** slug estável dentro do fluxo (usado pelo progresso; sobrevive a reordenação). */
  id: string;
  title: string;
  /** 0-based, na ordem em que aparece no documento. */
  order: number;
  /** `gate` é ponto de conferência: sinaliza, nunca bloqueia (decisão do desenho). */
  kind: WorkflowStepKind;
  /** o passo pede evidência (print, vídeo, link, log) para ser considerado completo. */
  requiresEvidence?: boolean;
  /** primeira linha útil do corpo do passo — contexto para o humano revisar a proposta. */
  hint?: string;
}

export interface WorkflowDefinition {
  schemaVersion: number;
  /** slug do fluxo — normalmente o nome da skill de origem. */
  id: string;
  name: string;
  /** de onde a proposta saiu; `manual` quando o humano montou do zero. */
  source: { kind: "skill" | "manual"; path?: string };
  steps: WorkflowStep[];
}

/** Título de passo numerado: "0 — Pick up", "3. Fix", "10 – Reviewers". */
const NUMBERED = /^(\d{1,2})\s*[—–\-.:)]\s*(.+)$/;
/** "Phase 2 — Approaches", "Fase 1", "Step 3", "Etapa 4". */
const PHASED = /^(?:phase|fase|step|etapa)\s*(\d{1,2})\s*[—–\-.:)]?\s*(.*)$/i;
/** Gate explícito: GATE_APPROACH, "Gate:", ou o ⛔ que as skills usam. */
const GATE = /\bGATE[_\s-]?[A-Z]*\b|⛔/;
/** O passo pede prova do que foi feito. */
const EVIDENCE = /evid[êe]nci|evidence|screenshot|captura de tela|v[íi]deo|print\b|before\s*\/?\s*after|antes e depois/i;

export function slugifyStep(value: string): string {
  const base = String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || "passo";
}

interface Heading { level: number; text: string; line: number }

/** Títulos markdown do corpo, ignorando blocos de código (onde `#` é comentário, não título). */
function headings(markdown: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  }
  return out;
}

/** Primeira linha de texto útil abaixo de um título (pula vazias, citações e listas de tabela). */
function firstBodyLine(lines: string[], from: number, to: number): string {
  for (let i = from + 1; i < to && i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith("#") || t.startsWith("|") || t.startsWith("```")) continue;
    return t.replace(/^[>*\-\s]+/, "").slice(0, 200);
  }
  return "";
}

function pushStep(steps: WorkflowStep[], title: string, kind: WorkflowStepKind, body: string, seen: Set<string>): void {
  let id = slugifyStep(title);
  if (seen.has(id)) { let n = 2; while (seen.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
  seen.add(id);
  const step: WorkflowStep = { id, title: title.trim(), order: steps.length, kind };
  if (EVIDENCE.test(title) || EVIDENCE.test(body)) step.requiresEvidence = true;
  const hint = body.trim();
  if (hint) step.hint = hint;
  steps.push(step);
}

export interface ParseWorkflowOptions {
  /** id/nome do fluxo; por padrão sai do frontmatter `name` ou do caminho. */
  id?: string;
  name?: string;
  /** caminho de origem no framework (ex.: skills/evidence-driven-delivery/SKILL.md). */
  path?: string;
}

/**
 * Propõe um fluxo a partir do markdown de uma skill. Estratégia, em ordem:
 *   1. títulos numerados/fasados (`### 0 — …`, `## Phase 1 …`) + títulos de GATE, na ordem do texto;
 *   2. se não houver ao menos 2, cai para os checkboxes `- [ ]` (o formato do "Checklist");
 *   3. se nada disso existir, devolve zero passos — o cliente então oferece montar na mão.
 * Nunca inventa passo: tudo que volta tem origem literal no texto.
 */
export function parseWorkflowFromSkill(markdown: string, opts: ParseWorkflowOptions = {}): WorkflowDefinition {
  const text = String(markdown || "");
  const lines = text.split(/\r?\n/);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fmName = fm ? /(^|\n)name:\s*(.+)/.exec(fm[1])?.[2]?.trim() : undefined;
  const name = opts.name || fmName || opts.id || "fluxo";
  const id = slugifyStep(opts.id || fmName || name);

  const hs = headings(text);
  const steps: WorkflowStep[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    const isGate = GATE.test(h.text);
    const numbered = NUMBERED.test(h.text) || PHASED.test(h.text);
    if (!isGate && !numbered) continue;
    const end = i + 1 < hs.length ? hs[i + 1].line : lines.length;
    pushStep(steps, h.text, isGate ? "gate" : "step", firstBodyLine(lines, h.line, end), seen);
  }

  if (steps.length < 2) {
    steps.length = 0; seen.clear();
    let fenced = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      const m = /^\s*[-*]\s*\[[ xX]\]\s*(.+?)\s*$/.exec(line);
      if (m) pushStep(steps, m[1], GATE.test(m[1]) ? "gate" : "step", "", seen);
    }
    if (steps.length < 2) steps.length = 0;   // nada confiável: melhor admitir do que inventar
  }

  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id, name,
    source: opts.path ? { kind: "skill", path: opts.path } : { kind: "manual" },
    steps,
  };
}

/** Saneia o que voltou do cliente (o humano pode ter editado/reordenado/removido). */
export function normalizeWorkflowDefinition(input: unknown, fallbackId = "fluxo"): WorkflowDefinition {
  const raw = (input ?? {}) as Partial<WorkflowDefinition>;
  const id = slugifyStep(String(raw.id || fallbackId));
  const seen = new Set<string>();
  const steps: WorkflowStep[] = [];
  for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
    const title = String((s as WorkflowStep)?.title || "").trim();
    if (!title) continue;
    let sid = slugifyStep(String((s as WorkflowStep)?.id || title));
    if (seen.has(sid)) { let n = 2; while (seen.has(`${sid}-${n}`)) n++; sid = `${sid}-${n}`; }
    seen.add(sid);
    const step: WorkflowStep = {
      id: sid, title, order: steps.length,
      kind: (s as WorkflowStep)?.kind === "gate" ? "gate" : "step",
    };
    if ((s as WorkflowStep)?.requiresEvidence) step.requiresEvidence = true;
    const hint = String((s as WorkflowStep)?.hint || "").trim();
    if (hint) step.hint = hint.slice(0, 200);
    steps.push(step);
  }
  const srcPath = (raw.source as WorkflowDefinition["source"])?.path;
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id,
    name: String(raw.name || id),
    source: srcPath ? { kind: "skill", path: String(srcPath) } : { kind: "manual" },
    steps,
  };
}

/** Caminho canônico do fluxo dentro do framework (publicado junto com skills/commands). */
export function workflowPath(id: string): string {
  return `flows/${slugifyStep(id)}.json`;
}

/** Serializa para arquivo de framework (JSON estável e legível — o humano pode editar à mão). */
export function workflowToFile(def: WorkflowDefinition): { path: string; content: string } {
  return { path: workflowPath(def.id), content: JSON.stringify(def, null, 2) + "\n" };
}

/** Lê um fluxo de um arquivo do framework; devolve null quando o conteúdo não é utilizável. */
export function workflowFromFile(content: string): WorkflowDefinition | null {
  try {
    const parsed = JSON.parse(String(content));
    const def = normalizeWorkflowDefinition(parsed);
    return def.steps.length ? def : null;
  } catch { return null; }
}
