/**
 * Framework validator: structural correctness of the canonical files against the documented Skill/
 * command contract (frontmatter fields, name/description limits, body size, reference integrity).
 * Distinct from framework-scan (security) — this catches "this won't work / won't be discovered"
 * rather than "this is dangerous". Pure text analysis. Errors block; warnings are advisory.
 */
import type { FrameworkFile } from "./framework.js";
import { parseFrontmatter } from "./framework-frontmatter.js";
import { classifyFramework, SKILL_BODY_LINE_BUDGET } from "./framework-inventory.js";

export type ValidationLevel = "error" | "warn";
export interface ValidationIssue { path: string; level: ValidationLevel; field?: string; message: string; }
export interface ValidationReport { issues: ValidationIssue[]; ok: boolean; errors: number; warnings: number; }

/** Documented Skill frontmatter limits (Anthropic skill-authoring spec). */
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
const NAME_CHARSET = /^[a-z0-9-]+$/;
const RESERVED = /\b(anthropic|claude)\b/i;
/** Os cinco topos do padrão. `flows/` e `reference/` entraram depois e ficaram de fora daqui por
 *  descuido — o resultado era o validador marcar como "fora do escopo" arquivo que o importador
 *  aceita de propósito, um contra o outro. Ver docs/framework-pack.md. */
const IN_SCOPE = /^(instructions\.md$|commands\/|skills\/|flows\/|reference\/)/;

function isSkillManifest(path: string): boolean {
  return path.startsWith("skills/") && path.endsWith("/SKILL.md");
}

/** Collect relative markdown links (target ending in .md) so we can check one-level references. */
function mdRefs(body: string): string[] {
  const out: string[] = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const target = m[1].split("#")[0].trim();
    if (target && !/^[a-z]+:\/\//i.test(target) && target.toLowerCase().endsWith(".md")) out.push(target);
  }
  return out;
}

function resolveRel(fromPath: string, ref: string): string {
  if (ref.startsWith("/")) return ref.slice(1);
  const base = fromPath.split("/").slice(0, -1);
  for (const seg of ref.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") { base.pop(); continue; }
    base.push(seg);
  }
  return base.join("/");
}

export function validateFramework(files: FrameworkFile[]): ValidationReport {
  const issues: ValidationIssue[] = [];
  const paths = new Set(files.map((f) => f.path));
  const skillNames = new Map<string, string>(); // name -> first path

  for (const f of files) {
    const path = f.path;
    if (!IN_SCOPE.test(path)) {
      issues.push({ path, level: "error", message: "fora do escopo do framework (esperado commands/…, skills/… ou instructions.md)." });
      continue;
    }
    const kind = classifyFramework(path);
    const { data, body, hasFrontmatter } = parseFrontmatter(f.content);

    if (isSkillManifest(path)) {
      if (!hasFrontmatter) issues.push({ path, level: "error", field: "frontmatter", message: "SKILL.md sem frontmatter `---`." });
      const name = data.name || "";
      if (!name) issues.push({ path, level: "error", field: "name", message: "campo `name` obrigatório ausente." });
      else {
        if (name.length > NAME_MAX) issues.push({ path, level: "error", field: "name", message: `name com ${name.length} chars (máx ${NAME_MAX}).` });
        if (!NAME_CHARSET.test(name)) issues.push({ path, level: "error", field: "name", message: "name deve conter só minúsculas, números e hífen." });
        if (RESERVED.test(name)) issues.push({ path, level: "error", field: "name", message: "name não pode conter palavras reservadas (anthropic/claude)." });
        const prior = skillNames.get(name);
        if (prior) issues.push({ path, level: "error", field: "name", message: `nome de skill duplicado com ${prior}.` });
        else skillNames.set(name, path);
      }
      const desc = data.description || "";
      if (!desc) issues.push({ path, level: "error", field: "description", message: "campo `description` obrigatório ausente — sem ele a skill não é descoberta." });
      else if (desc.length > DESCRIPTION_MAX) issues.push({ path, level: "error", field: "description", message: `description com ${desc.length} chars (máx ${DESCRIPTION_MAX}).` });
    } else if (kind === "command") {
      const desc = data.description || "";
      if (!desc) issues.push({ path, level: "warn", field: "description", message: "comando sem `description` no frontmatter — aparece sem explicação no menu “/”." });
      else if (desc.length > DESCRIPTION_MAX) issues.push({ path, level: "error", field: "description", message: `description com ${desc.length} chars (máx ${DESCRIPTION_MAX}).` });
    } else if (kind === "instructions") {
      if (!f.content.trim()) issues.push({ path, level: "warn", message: "instructions.md vazio." });
    }

    const bodyLines = body ? body.split(/\r?\n/).length : 0;
    if (isSkillManifest(path) && bodyLines > SKILL_BODY_LINE_BUDGET) {
      issues.push({ path, level: "warn", message: `corpo com ${bodyLines} linhas (acima de ${SKILL_BODY_LINE_BUDGET}); quebre em arquivos de referência.` });
    }
    for (const ref of mdRefs(body)) {
      const resolved = resolveRel(path, ref);
      if (!paths.has(resolved)) issues.push({ path, level: "warn", field: "reference", message: `referência para “${ref}” não existe no pacote.` });
    }
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  return { issues, ok: errors === 0, errors, warnings };
}
