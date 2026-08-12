/**
 * O PADRÃO de um pacote de framework Jarvis.
 *
 * Por que isto existe: até aqui o formato só vivia implícito, espalhado entre `assertSafeRelPath`,
 * `toFrameworkPath` e `classifyFramework`. Quem montava um framework por fora não tinha contrato a
 * seguir nem modelo a copiar — e o importador aceitava qualquer coisa que PARECESSE certa pelo nome
 * da pasta, enchendo o framework de arquivos que nenhuma IA carrega.
 *
 * Este módulo define as duas peças que faltavam:
 *   1. `jarvis.pack.json` — a IDENTIDADE do pacote (nome, versão), para que tudo que veio dele possa
 *      ser atribuído de volta a ele na interface.
 *   2. `packTemplateFiles()` — um pacote-modelo completo e válido, que a interface entrega como zip.
 *      Documentação sozinha não padroniza nada; um modelo pronto para copiar, sim.
 *
 * Puro (texto → objeto/bytes): sem filesystem e sem rede, para rodar igual em qualquer máquina.
 * O contrato em prosa vive em `docs/framework-pack.md` e viaja dentro do próprio modelo, em
 * `reference/como-construir-um-pacote.md`.
 */

export const PACK_MANIFEST_FILE = "jarvis.pack.json";
export const PACK_SCHEMA_VERSION = 1;

/**
 * Uma regra de projeção: o prefixo do repositório e onde ele entra no padrão (`null` = não entra).
 *
 * `as: "skill"` PROMOVE cada `.md` daquela árvore a uma skill de verdade (`skills/<slug>/SKILL.md`
 * com frontmatter), em vez de só reposicionar o caminho. Existe porque a descoberta de skills é
 * `skills/<nome>/SKILL.md` — contrato do Claude/Codex/Cursor, não do Jarvis — e sem promoção um
 * repositório com dezenas de `.md` soltos só teria duas saídas: reorganizar tudo, ou aceitar que
 * nenhuma das skills funcione. Com ela, material diverso vira skill utilizável em todas as máquinas
 * sem que o autor mova um arquivo.
 */
export interface PackMapRule { from: string; to: string | null; as?: "skill" }

/** O que uma regra decidiu para um caminho. `to: null` = não entra. */
export interface PackMapMatch { to: string | null; as?: "skill" }

export interface PackManifest {
  schemaVersion: number;
  /** slug estável — é a chave da atribuição de origem. */
  name: string;
  /** nome legível para a interface; cai para `name` quando ausente. */
  title?: string;
  version?: string;
  description?: string;
  homepage?: string;
  /**
   * PROJEÇÃO: como a estrutura deste repositório entra nos cinco topos do padrão.
   *
   * Existe porque um framework de verdade raramente nasce no formato do Jarvis. O caso que motivou:
   * um repositório com `core/skills/<categoria>/<arquivo>.md`, cujo `skills` no meio do caminho fazia
   * o importador ancorar 103 arquivos em `skills/` — nenhum deles carregável. Reorganizar as pastas
   * quebraria o composer do próprio repositório; então quem se adapta é o importador, e o repositório
   * ganha UM arquivo declarando a projeção. Já ordenado do mais específico para o mais genérico.
   */
  map?: PackMapRule[];
  /** Regras recusadas na leitura (alvo fora dos cinco topos, traversal). Aparecem na prévia em vez
   *  de sumirem: uma regra ignorada em silêncio faria o dono achar que projetou e não projetou. */
  mapErrors?: string[];
}

function text(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Slug do pacote: mesma disciplina dos nomes de skill (minúsculas, números, hífen). */
export function slugifyPackName(value: string): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

/** Só http(s) chega à interface — um `javascript:` no manifesto de um pacote de terceiro não vira link. */
function safeUrl(value: unknown): string | undefined {
  const raw = text(value, 300);
  return /^https?:\/\//i.test(raw) ? raw : undefined;
}

/** Topos válidos de destino de uma projeção — os mesmos do padrão, nada além. */
const MAP_TARGET_TOPS = new Set(["commands", "skills", "flows", "reference"]);

function normalizeMapPath(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

/**
 * Lê `map` do manifesto. Uma regra só é aceita se o destino cair dentro do padrão: um alvo livre
 * seria um caminho para escrever fora do escopo, e é justamente a fronteira que o importador defende.
 * Devolve as regras ordenadas da mais específica para a mais genérica, para `core/skills/process`
 * poder sobrepor `core/skills` de forma determinística (não pela ordem em que foram escritas).
 */
export function parsePackMap(raw: unknown): { rules: PackMapRule[]; errors: string[] } {
  const rules: PackMapRule[] = [];
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { rules, errors };
  for (const [rawFrom, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const from = normalizeMapPath(rawFrom);
    if (!from) { errors.push(`regra com origem vazia`); continue; }
    if (from.split("/").includes("..")) { errors.push(`${rawFrom}: origem não pode conter ".."`); continue; }
    // Valor pode ser o destino direto ou { to, as } — a forma longa só é necessária para promover.
    const objForm = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? (rawValue as Record<string, unknown>) : null;
    const rawTo = objForm ? objForm.to : rawValue;
    const rawAs = objForm ? normalizeMapPath(objForm.as) : "";
    if (rawAs && rawAs !== "skill") { errors.push(`${rawFrom}: modo "${rawAs}" desconhecido (só "skill")`); continue; }
    // `null`/`false`/"" = não entra no framework. É o que permite excluir uma árvore inteira.
    if (rawTo === null || rawTo === false || normalizeMapPath(rawTo) === "") { rules.push({ from, to: null }); continue; }
    const to = normalizeMapPath(rawTo);
    if (to.split("/").includes("..")) { errors.push(`${rawFrom}: destino não pode conter ".."`); continue; }
    if (to !== "instructions.md" && !MAP_TARGET_TOPS.has(to.split("/")[0])) {
      errors.push(`${rawFrom} → ${to}: destino fora do padrão (esperado commands/, skills/, flows/, reference/ ou instructions.md)`);
      continue;
    }
    if (rawAs === "skill" && to.split("/")[0] !== "skills") {
      errors.push(`${rawFrom} → ${to}: promover para skill exige destino em skills/`);
      continue;
    }
    rules.push(rawAs === "skill" ? { from, to, as: "skill" } : { from, to });
  }
  rules.sort((a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from));
  return { rules, errors };
}

/**
 * Projeta um caminho do repositório para o padrão.
 *   - string     → caminho projetado;
 *   - `null`     → regra explícita de exclusão (não entra, e isso foi intencional);
 *   - `undefined`→ nenhuma regra casou; o chamador segue com a ancoragem automática de sempre.
 * O casamento respeita fronteira de segmento: `core/skill` NÃO pega `core/skills/…`.
 */
export function applyPackMap(path: string, rules: PackMapRule[] | undefined): PackMapMatch | undefined {
  if (!rules?.length) return undefined;
  const p = normalizeMapPath(path);
  for (const r of rules) {
    if (p === r.from) return { to: r.to, as: r.as };                 // origem é um ARQUIVO: destino tal e qual
    if (p.startsWith(r.from + "/")) {
      return r.to === null ? { to: null } : { to: `${r.to}/${p.slice(r.from.length + 1)}`, as: r.as };
    }
  }
  return undefined;
}

/* ── promoção a skill ────────────────────────────────────────────────────────────────────────────
 * Embrulhar um `.md` qualquer numa skill que as IAs realmente carregam. Regra inegociável: o CORPO
 * original é preservado byte a byte — só ganha um frontmatter na frente. Promover não pode perder
 * conteúdo, senão vira uma conversão destrutiva disfarçada de conveniência.
 */

/** `description` é o que faz a skill ser ACIONADA; sem ela a skill nunca é escolhida. Tiramos a
 *  melhor frase disponível: a que o autor escreveu, ou a primeira linha de prosa útil do corpo. */
function deriveDescription(body: string, fallback: string): string {
  const lines = body.split(/\r?\n/);
  let fenced = false;
  let afterWhen = false;
  const candidates: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line) continue;
    if (/^#{1,6}\s/.test(line)) { afterWhen = /when to use|quando usar|use when/i.test(line); continue; }
    if (/^[|>]/.test(line)) continue;                                  // tabela ou citação não descreve
    const clean = line.replace(/^[-*+]\s+/, "").replace(/[*_`]/g, "").trim();
    if (!clean) continue;
    if (afterWhen) return clean.slice(0, DESCRIPTION_LIMIT);           // "When to use" é a melhor fonte possível
    candidates.push(clean);
  }
  return (candidates[0] || fallback).slice(0, DESCRIPTION_LIMIT);
}

const DESCRIPTION_LIMIT = 1024;   // igual ao limite do validador

/** Nome de skill válido a partir de um caminho: minúsculas, números e hífen, sem palavra reservada. */
export function skillNameFromPath(path: string): string {
  const segs = normalizeMapPath(path).split("/");
  const last = segs[segs.length - 1] || "";
  const base = /^skill\.md$/i.test(last) ? (segs[segs.length - 2] || last) : last.replace(/\.md$/i, "");
  const slug = slugifyPackName(base).replace(/\b(anthropic|claude)\b/gi, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "skill";
}

/**
 * Converte um arquivo em `skills/<slug>/SKILL.md`. Se o arquivo JÁ tem frontmatter com `name` e
 * `description`, nada é reescrito além do caminho — respeitar o que o autor declarou vem antes de
 * qualquer heurística nossa. `taken` garante slug único quando dois arquivos têm o mesmo nome.
 */
export function promoteToSkill(path: string, content: string, taken: Set<string>): { path: string; content: string } {
  const text = String(content ?? "");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const head = fm ? fm[1] : "";
  const body = fm ? fm[2] : text;
  const declaredName = /(^|\n)name:\s*(.+)/.exec(head)?.[2]?.trim();
  const declaredDesc = /(^|\n)description:\s*(.+)/.exec(head)?.[2]?.trim();

  let name = slugifyPackName(declaredName || "") || skillNameFromPath(path);
  if (taken.has(name)) { let n = 2; while (taken.has(`${name}-${n}`)) n++; name = `${name}-${n}`; }
  taken.add(name);

  const description = (declaredDesc || deriveDescription(body, `Material de ${name} importado para o framework universal.`))
    .replace(/\r?\n/g, " ").slice(0, DESCRIPTION_LIMIT);

  // Reescreve só `name`/`description`; qualquer outro campo do frontmatter original é mantido.
  const extras = head.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(name|description)\s*:/i.test(l));
  const front = ["---", `name: ${name}`, `description: ${description}`, ...extras, "---"].join("\n");
  return { path: `skills/${name}/SKILL.md`, content: `${front}\n${body.startsWith("\n") ? "" : "\n"}${body}` };
}

/**
 * Lê o manifesto. Devolve `null` para qualquer coisa inutilizável (JSON quebrado, sem `name`) — um
 * pacote sem identidade legível é tratado como pacote SEM manifesto, nunca como erro de importação:
 * a decisão do desenho é aceitar e avisar, não recusar.
 */
export function parsePackManifest(content: string): PackManifest | null {
  let raw: any;
  try { raw = JSON.parse(String(content)); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const name = slugifyPackName(text(raw.name, 64));
  if (!name) return null;
  const schemaVersion = Number.isFinite(Number(raw.schemaVersion)) && Number(raw.schemaVersion) > 0
    ? Math.floor(Number(raw.schemaVersion)) : PACK_SCHEMA_VERSION;
  const out: PackManifest = { schemaVersion, name };
  const title = text(raw.title, 120); if (title) out.title = title;
  const version = text(raw.version, 40); if (version) out.version = version;
  const description = text(raw.description, 500); if (description) out.description = description;
  const homepage = safeUrl(raw.homepage); if (homepage) out.homepage = homepage;
  const { rules, errors } = parsePackMap(raw.map);
  if (rules.length) out.map = rules;
  if (errors.length) out.mapErrors = errors;
  return out;
}

/** O manifesto está na RAIZ do pacote — aceitamos no máximo uma pasta-invólucro (o `repo-<sha>/` que
 *  o GitHub põe no tarball). Mais fundo que isso é arquivo de exemplo de outra pessoa, não a identidade. */
export function isPackManifestPath(entryPath: string): boolean {
  const segs = String(entryPath).replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
  return segs.length > 0 && segs.length <= 2 && segs[segs.length - 1] === PACK_MANIFEST_FILE;
}

export function packManifestToFile(manifest: PackManifest): { path: string; content: string } {
  return { path: PACK_MANIFEST_FILE, content: JSON.stringify(manifest, null, 2) + "\n" };
}

/* ── o pacote-modelo ─────────────────────────────────────────────────────────────────────────────
 * Regra de ouro deste modelo: importá-lo tem de produzir uma prévia LIMPA — zero arquivo fora de
 * escopo, zero problema de conformidade. Ele é a demonstração executável do padrão, então não pode
 * conter nada que o próprio importador reclamaria (um `README.md` na raiz, por exemplo, cairia como
 * "fora do escopo" e ensinaria o formato errado logo na primeira impressão).
 */

const TEMPLATE_MANIFEST: PackManifest = {
  schemaVersion: PACK_SCHEMA_VERSION,
  name: "meu-framework",
  title: "Meu framework",
  version: "0.1.0",
  description: "Modelo de pacote de framework Jarvis — troque este conteúdo pelo seu.",
};

const TEMPLATE_INSTRUCTIONS = `# Instruções universais

> Este arquivo é o balde SEMPRE-LIGADO: uma vez exportado para o CLAUDE.md/AGENTS.md nativo, ele
> entra em TODO turno de TODA IA. Orçamento: ~2000 tokens. Acima disso a atenção do modelo degrada.
> Processo detalhado é skill (carrega sob demanda), não instrução.

- Responda em português.
- Antes de mudar código, leia os arquivos afetados; não deduza comportamento sem ler.
- Nunca invente caminho de arquivo, API ou resultado de teste. Se não rodou, diga que não rodou.
- Commit só com autorização explícita.
`;

const TEMPLATE_COMMAND = `---
description: Revisa o diff atual em busca de regressões, com evidência do que foi verificado.
---

# Revisar

Revise as mudanças pendentes de: $ARGUMENTS

1. Rode \`git diff\` e leia cada arquivo tocado por inteiro, não só o trecho alterado.
2. Para cada achado, aponte \`arquivo:linha\` e descreva o cenário concreto que quebra.
3. Feche com o que foi verificado e o que ficou sem verificar.
`;

const TEMPLATE_SKILL = `---
name: entrega-com-evidencia
description: Levar uma tarefa até o fim com prova do que foi feito. Use quando pegar um ticket, bug ou ajuste que termina em PR revisado e precisa de evidência antes/depois.
---

# Entrega com evidência

O \`description\` acima é o que faz a skill ser encontrada — ele diz QUANDO usar, não só o que é.
Sem ele a skill nunca é acionada.

## 1 — Escopo

Leia a tarefa e escreva, em uma frase, o que estará feito no fim. Se couberem duas leituras, pergunte.

## 2 — Diagnóstico

Reproduza contra o sistema vivo antes de propor correção. Palpite sem reprodução não é diagnóstico.

## 3 — Evidência (antes e depois)

Capture a prova do estado quebrado e do estado corrigido. Este passo exige anexo.

## GATE — revisão humana

Ponto de conferência: mostre o diff e o que foi validado. O gate sinaliza, não bloqueia.

## 4 — Fechamento

Abra o PR, ligue à tarefa e registre o que ficou de fora.
`;

const TEMPLATE_FLOW = JSON.stringify({
  schemaVersion: 1,
  id: "entrega-com-evidencia",
  name: "Entrega com evidência",
  source: { kind: "skill", path: "skills/entrega-com-evidencia/SKILL.md" },
  steps: [
    { id: "1-escopo", title: "1 — Escopo", order: 0, kind: "step", hint: "Uma frase sobre o que estará feito no fim." },
    { id: "2-diagnostico", title: "2 — Diagnóstico", order: 1, kind: "step", hint: "Reproduzir antes de corrigir." },
    { id: "3-evidencia-antes-e-depois", title: "3 — Evidência (antes e depois)", order: 2, kind: "step", requiresEvidence: true, hint: "Prova do estado quebrado e do corrigido." },
    { id: "gate-revisao-humana", title: "GATE — revisão humana", order: 3, kind: "gate", hint: "Conferência: sinaliza, não bloqueia." },
    { id: "4-fechamento", title: "4 — Fechamento", order: 4, kind: "step", hint: "PR aberto e ligado à tarefa." },
  ],
}, null, 2) + "\n";

const TEMPLATE_GUIDE = `# Como construir um pacote de framework Jarvis

Este arquivo veio dentro do modelo. Ele descreve o contrato que o importador do Jarvis aplica.
A versão completa vive em \`docs/framework-pack.md\`, no repositório do Jarvis.

## O que é um pacote

Uma pasta (ou repositório, ou zip) com esta forma na RAIZ:

\`\`\`
jarvis.pack.json          # identidade do pacote (opcional, mas recomendado)
instructions.md           # instruções universais — sempre-ligadas
commands/<nome>.md        # um comando "/" por arquivo
skills/<nome>/SKILL.md    # UMA pasta por skill, com o manifesto dentro
flows/<id>.json           # fluxos de trabalho declarados
reference/**              # material de apoio, em qualquer estrutura
\`\`\`

**Só estes cinco topos entram.** Qualquer outra coisa na raiz (\`core/\`, \`profiles/\`, \`docs/\`,
\`README.md\`) é ignorada na importação e reportada como "fora do escopo".

## A regra que mais pega quem migra

Skill é **pasta com \`SKILL.md\` dentro, um nível só**:

- ✅ \`skills/entrega-com-evidencia/SKILL.md\`
- ❌ \`skills/quality/clean-code.md\` — arquivo solto: entra no framework e nunca é carregado
- ❌ \`skills/process/writing-skills/SKILL.md\` — fundo demais: a descoberta não enxerga

Um arquivo sob \`skills/\` que não seja \`skills/<nome>/SKILL.md\` (ou apoio ao lado de um) é peso
morto: viaja para todas as máquinas e nenhuma IA usa. O relatório de conformidade da prévia acusa
isso antes de você aplicar.

Se o seu material é documentação de apoio e não skill acionável, o lugar dele é \`reference/\`.

## Frontmatter obrigatório da skill

\`\`\`yaml
---
name: minha-skill          # minúsculas, números e hífen; igual ao nome da pasta
description: O que faz E quando usar. Sem isto a skill nunca é acionada.
---
\`\`\`

## Fluxos

Um fluxo pode ser **declarado** (\`flows/<id>.json\`, versionado junto com o pacote — autoritativo)
ou **detectado** (o Jarvis lê os títulos numerados e os GATE da sua skill e PROPÕE os passos, que
você revisa antes de salvar). Declare quando o processo importa; deixe detectar quando for rascunho.

## Limites

512 KB por arquivo, 8 MB por pacote, 1000 arquivos. Binário é recusado.
`;

/**
 * O pacote-modelo, como dados. O Hub embrulha em zip (`zipStore`) e a interface entrega no botão
 * "Baixar modelo"; os testes usam a mesma função para provar que o modelo passa no próprio validador
 * e no relatório de conformidade — se o padrão mudar e o modelo não acompanhar, a suíte quebra.
 */
export function packTemplateFiles(): { path: string; content: string }[] {
  return [
    packManifestToFile(TEMPLATE_MANIFEST),
    { path: "instructions.md", content: TEMPLATE_INSTRUCTIONS },
    { path: "commands/revisar.md", content: TEMPLATE_COMMAND },
    { path: "skills/entrega-com-evidencia/SKILL.md", content: TEMPLATE_SKILL },
    { path: "flows/entrega-com-evidencia.json", content: TEMPLATE_FLOW },
    { path: "reference/como-construir-um-pacote.md", content: TEMPLATE_GUIDE },
  ];
}

/** Nome do arquivo entregue ao usuário. */
export const PACK_TEMPLATE_FILENAME = "jarvis-framework-modelo.zip";
