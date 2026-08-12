/**
 * Conformidade estrutural de um pacote: dos arquivos que ENTRAM no escopo, quais realmente vão
 * funcionar.
 *
 * Por que é um módulo separado dos dois que já existem:
 *   - `framework-scan`   → "isto é perigoso" (segurança);
 *   - `framework-validate` → "este SKILL.md está malformado" (frontmatter, limites, referências);
 *   - aqui                → "este arquivo está no lugar errado e nenhuma IA vai carregá-lo".
 *
 * O caso concreto que motivou: um framework com `core/skills/quality/clean-code.md` importa 103
 * arquivos para dentro de `skills/`, e ZERO viram skill — a descoberta é `skills/<nome>/SKILL.md`,
 * um nível só (ver `commands.ts`). Antes disso a prévia mostrava "103 arquivos novos" e nada mais;
 * o dono só descobria o problema depois de publicar para a frota inteira. O validador também não
 * pegava: sem frontmatter e sem ser `SKILL.md`, o arquivo não casa com nenhuma das regras dele.
 *
 * Puro: texto → relatório. Sem filesystem, sem rede.
 */
import type { FrameworkFile } from "./framework.js";
import { workflowFromFile } from "./workflow.js";

export type ConformanceLevel = "error" | "warn";

export type ConformanceCode =
  | "skill-arquivo-solto"
  | "skill-sem-manifesto"
  | "skill-profunda"
  | "comando-nao-md"
  | "fluxo-invalido"
  | "pacote-sem-manifesto";

export interface ConformanceIssue {
  level: ConformanceLevel;
  code: ConformanceCode;
  /** caminho ou pasta a que o problema se refere (a UI usa para navegar). */
  path: string;
  message: string;
  /** quantos arquivos são afetados por este problema (uma pasta inteira conta junto). */
  files: number;
  /** amostra dos caminhos afetados, para a prévia mostrar sem virar parede de texto. */
  sample: string[];
}

export interface ConformanceReport {
  issues: ConformanceIssue[];
  errors: number;
  warnings: number;
  /** skills que a descoberta realmente enxerga (`skills/<nome>/SKILL.md`). */
  loadableSkills: number;
  /** arquivos sob `skills/` que nenhuma IA vai carregar — peso morto publicado para a frota. */
  inertSkillFiles: number;
  commands: number;
  flows: number;
  reference: number;
  ok: boolean;
}

const SAMPLE = 6;

/** Uma skill é descoberta em `skills/<nome>/SKILL.md` — um nível, nome exato. */
export function isLoadableSkill(path: string): boolean {
  const segs = path.split("/");
  return segs.length === 3 && segs[0] === "skills" && segs[2] === "SKILL.md";
}

export function checkConformance(files: FrameworkFile[]): ConformanceReport {
  const issues: ConformanceIssue[] = [];
  const paths = files.map((f) => f.path);

  // ── skills: agrupadas por pasta, para que 46 arquivos errados virem UM problema legível por pasta
  const looseSkillFiles: string[] = [];
  const folders = new Map<string, string[]>();
  for (const p of paths) {
    if (!p.startsWith("skills/")) continue;
    const segs = p.split("/");
    if (segs.length === 2) { looseSkillFiles.push(p); continue; }   // skills/arquivo.md
    const folder = `skills/${segs[1]}`;
    const bucket = folders.get(folder);
    if (bucket) bucket.push(p); else folders.set(folder, [p]);
  }

  let loadableSkills = 0;
  let inertSkillFiles = looseSkillFiles.length;

  if (looseSkillFiles.length) {
    issues.push({
      level: "error", code: "skill-arquivo-solto", path: "skills",
      files: looseSkillFiles.length, sample: looseSkillFiles.slice(0, SAMPLE),
      message: `${looseSkillFiles.length} arquivo(s) soltos direto em skills/. Uma skill é uma PASTA com SKILL.md dentro (skills/<nome>/SKILL.md); arquivo solto é publicado para a frota e nunca carregado.`,
    });
  }

  for (const [folder, inside] of [...folders].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (inside.includes(`${folder}/SKILL.md`)) { loadableSkills++; continue; }   // apoio ao lado do manifesto é legítimo
    inertSkillFiles += inside.length;
    const deep = inside.filter((p) => p.endsWith("/SKILL.md"));
    if (deep.length) {
      issues.push({
        level: "error", code: "skill-profunda", path: folder,
        files: inside.length, sample: deep.slice(0, SAMPLE),
        message: `${folder}/ tem SKILL.md em nível mais fundo (${deep[0]}). A descoberta só enxerga skills/<nome>/SKILL.md — suba a pasta um nível, ou projete no jarvis.pack.json sem mover nada.`,
      });
    } else {
      issues.push({
        level: "error", code: "skill-sem-manifesto", path: folder,
        files: inside.length, sample: inside.slice(0, SAMPLE),
        message: `${folder}/ não tem SKILL.md — seus ${inside.length} arquivo(s) não serão carregados por nenhuma IA. Duas saídas no jarvis.pack.json: se são skills, projete com {"to":"skills","as":"skill"} e o Jarvis embrulha cada .md numa skill válida; se é material de apoio, mande para reference/.`,
      });
    }
  }

  // ── comandos: um arquivo .md por comando
  const badCommands = paths.filter((p) => p.startsWith("commands/") && !p.endsWith(".md"));
  if (badCommands.length) {
    issues.push({
      level: "warn", code: "comando-nao-md", path: "commands",
      files: badCommands.length, sample: badCommands.slice(0, SAMPLE),
      message: `${badCommands.length} arquivo(s) em commands/ que não são .md — não viram comando "/".`,
    });
  }

  // ── fluxos: JSON que o Jarvis consiga ler de volta
  const badFlows = files.filter((f) => f.path.startsWith("flows/") && !workflowFromFile(f.content)).map((f) => f.path);
  if (badFlows.length) {
    issues.push({
      level: "error", code: "fluxo-invalido", path: "flows",
      files: badFlows.length, sample: badFlows.slice(0, SAMPLE),
      message: `${badFlows.length} arquivo(s) em flows/ não são definições de fluxo válidas (JSON com ao menos um passo).`,
    });
  }

  const errors = issues.filter((i) => i.level === "error").length;
  return {
    issues, errors, warnings: issues.length - errors,
    loadableSkills, inertSkillFiles,
    commands: paths.filter((p) => p.startsWith("commands/") && p.endsWith(".md")).length,
    flows: paths.filter((p) => p.startsWith("flows/")).length - badFlows.length,
    reference: paths.filter((p) => p.startsWith("reference/")).length,
    ok: errors === 0,
  };
}

/** Aviso de pacote sem identidade — separado porque não depende dos arquivos, e sim da fonte. */
export function missingManifestIssue(): ConformanceIssue {
  return {
    level: "warn", code: "pacote-sem-manifesto", path: "jarvis.pack.json", files: 0, sample: [],
    message: "pacote sem jarvis.pack.json: importa normalmente, mas a origem dos arquivos fica inferida da fonte em vez de identificada pelo pacote.",
  };
}
