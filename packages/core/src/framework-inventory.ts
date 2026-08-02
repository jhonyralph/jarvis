/**
 * Framework inventory: turn a canonical file set into a per-file view the owner can inspect —
 * kind, size, an estimated token cost, and whether it changed since the last published snapshot.
 * This is the "ver o que tem configurado e as alterações" surface, plus the token budget the
 * research flagged: instructions.md is the always-on bucket (once exported to native CLAUDE.md/
 * AGENTS.md it is injected every turn), command/skill bodies are on-demand, and each skill's
 * name+description is the always-loaded catalog cost. Pure — no filesystem, no network.
 */
import type { FrameworkFile } from "./framework.js";
import { parseFrontmatter } from "./framework-frontmatter.js";

/** Rough, dependency-free token estimate (~4 chars/token). NOT exact — a budget indicator only.
 *  We deliberately avoid a real tokenizer (per-model, heavy) since this drives a UI gauge. */
export function estimateTokens(text: string): number {
  const n = String(text ?? "").length;
  return n === 0 ? 0 : Math.max(1, Math.ceil(n / 4));
}

export type FrameworkFileKind = "command" | "skill" | "instructions" | "other";

export function classifyFramework(path: string): FrameworkFileKind {
  if (path === "instructions.md") return "instructions";
  if (path.startsWith("skills/")) return "skill";
  if (path.startsWith("commands/")) return "command";
  return "other";
}

export type FrameworkFileStatus = "new" | "modified" | "unchanged" | "removed";

export interface InventoryFile {
  path: string;
  kind: FrameworkFileKind;
  bytes: number;
  lines: number;
  tokens: number;
  /** Estimated metadata (name+description) tokens for a skill — the always-loaded catalog cost. 0 otherwise. */
  metadataTokens: number;
  status: FrameworkFileStatus;
}

export interface InventoryTotals {
  files: number;
  bytes: number;
  tokens: number;
  /** instructions.md — injected every turn once exported to native instruction files. The costly bucket. */
  alwaysOnTokens: number;
  /** command + skill bodies — loaded only when invoked/triggered. */
  onDemandTokens: number;
  /** sum of skill name+description — the catalog cost that is always loaded when skills are exported. */
  metadataTokens: number;
}

export interface BudgetWarning { level: "warn" | "info"; path?: string; message: string; }

export interface Inventory {
  files: InventoryFile[];
  totals: InventoryTotals;
  warnings: BudgetWarning[];
}

/** Research-backed budgets (see the framework design notes): the always-on bucket degrades model
 *  attention past ~2k tokens, and a skill body over 500 lines should be split into references. */
export const ALWAYS_ON_TOKEN_BUDGET = 2000;
export const SKILL_BODY_LINE_BUDGET = 500;

function bytesOf(text: string): number {
  return Buffer.byteLength(String(text ?? ""), "utf8");
}
function linesOf(text: string): number {
  const t = String(text ?? "");
  if (t === "") return 0;
  return t.split(/\r?\n/).length;
}
function metadataTokensOf(kind: FrameworkFileKind, content: string): number {
  if (kind !== "skill") return 0;
  const { data } = parseFrontmatter(content);
  return estimateTokens(`${data.name || ""} ${data.description || ""}`.trim());
}

/**
 * Build the inventory for `current`, diffed against `published` (the last snapshot the owner
 * published to the fleet). Files only in `published` appear as `removed` so the UI can show
 * pending deletions. When `published` is omitted every file is reported `new`.
 */
export function buildInventory(current: FrameworkFile[], published?: FrameworkFile[]): Inventory {
  const prev = new Map((published ?? []).map((f) => [f.path, f.content]));
  const curPaths = new Set(current.map((f) => f.path));
  const files: InventoryFile[] = [];

  for (const f of [...current].sort((a, b) => a.path.localeCompare(b.path))) {
    const kind = classifyFramework(f.path);
    const status: FrameworkFileStatus = !prev.has(f.path)
      ? "new"
      : prev.get(f.path) === f.content ? "unchanged" : "modified";
    files.push({
      path: f.path,
      kind,
      bytes: bytesOf(f.content),
      lines: linesOf(f.content),
      tokens: estimateTokens(f.content),
      metadataTokens: metadataTokensOf(kind, f.content),
      status,
    });
  }
  // Pending deletions: in the last publish but no longer present.
  for (const f of published ?? []) {
    if (curPaths.has(f.path)) continue;
    const kind = classifyFramework(f.path);
    files.push({
      path: f.path, kind,
      bytes: bytesOf(f.content), lines: linesOf(f.content), tokens: estimateTokens(f.content),
      metadataTokens: metadataTokensOf(kind, f.content), status: "removed",
    });
  }

  const live = files.filter((f) => f.status !== "removed");
  const alwaysOnTokens = live.filter((f) => f.kind === "instructions").reduce((s, f) => s + f.tokens, 0);
  const onDemandTokens = live.filter((f) => f.kind === "command" || f.kind === "skill").reduce((s, f) => s + f.tokens, 0);
  const metadataTokens = live.reduce((s, f) => s + f.metadataTokens, 0);
  const totals: InventoryTotals = {
    files: live.length,
    bytes: live.reduce((s, f) => s + f.bytes, 0),
    tokens: live.reduce((s, f) => s + f.tokens, 0),
    alwaysOnTokens, onDemandTokens, metadataTokens,
  };

  const warnings: BudgetWarning[] = [];
  if (alwaysOnTokens > ALWAYS_ON_TOKEN_BUDGET) {
    warnings.push({ level: "warn", path: "instructions.md", message: `instruções universais têm ~${alwaysOnTokens} tokens (acima do orçamento de ${ALWAYS_ON_TOKEN_BUDGET}); a atenção do modelo degrada quando o contexto sempre-ligado fica grande.` });
  }
  for (const f of live) {
    if (f.kind === "skill" && f.lines > SKILL_BODY_LINE_BUDGET) {
      warnings.push({ level: "warn", path: f.path, message: `skill com ${f.lines} linhas (acima de ${SKILL_BODY_LINE_BUDGET}); considere quebrar em arquivos de referência.` });
    }
  }
  return { files, totals, warnings };
}
