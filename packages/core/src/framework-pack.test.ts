/** O padrão do pacote: manifesto tolerante a lixo, e um modelo que precisa passar no próprio
 *  validador — se o padrão mudar e o modelo não acompanhar, é aqui que quebra. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePackManifest, isPackManifestPath, slugifyPackName, packTemplateFiles,
  PACK_MANIFEST_FILE, PACK_SCHEMA_VERSION,
} from "./framework-pack.js";
import { zipStore, unzip, extractFrameworkFiles, crc32 } from "./framework-archive.js";
import { validateFramework } from "./framework-validate.js";
import { checkConformance } from "./framework-conformance.js";
import { workflowFromFile } from "./workflow.js";

test("manifesto: lê o essencial e normaliza o nome", () => {
  const m = parsePackManifest(JSON.stringify({ name: " Meu Framework! ", title: "Meu Framework", version: "1.2.0", description: "x" }));
  assert.equal(m!.name, "meu-framework");
  assert.equal(m!.title, "Meu Framework");
  assert.equal(m!.version, "1.2.0");
  assert.equal(m!.schemaVersion, PACK_SCHEMA_VERSION, "assume a versão corrente quando omitida");
});

test("manifesto: o que não dá para usar vira 'sem manifesto', nunca exceção", () => {
  assert.equal(parsePackManifest("{lixo"), null);
  assert.equal(parsePackManifest("[]"), null, "array não é manifesto");
  assert.equal(parsePackManifest("null"), null);
  assert.equal(parsePackManifest('{"title":"sem nome"}'), null, "sem `name` não há identidade");
  assert.equal(parsePackManifest('{"name":"!!!"}'), null, "nome que não vira slug não conta");
});

test("manifesto: só http(s) vira link na interface", () => {
  assert.equal(parsePackManifest('{"name":"x","homepage":"javascript:alert(1)"}')!.homepage, undefined);
  assert.equal(parsePackManifest('{"name":"x","homepage":"https://ex.tld/p"}')!.homepage, "https://ex.tld/p");
});

test("o manifesto é procurado na raiz, tolerando UMA pasta-invólucro (tarball do GitHub)", () => {
  assert.equal(isPackManifestPath(PACK_MANIFEST_FILE), true);
  assert.equal(isPackManifestPath(`repo-abc123/${PACK_MANIFEST_FILE}`), true);
  assert.equal(isPackManifestPath(`a/b/${PACK_MANIFEST_FILE}`), false, "fundo demais é exemplo de outra pessoa");
  assert.equal(isPackManifestPath("skills/x/SKILL.md"), false);
  assert.equal(slugifyPackName("Ação Framework"), "acao-framework");
});

test("zip escrito aqui é lido de volta pelo leitor que já existe", () => {
  const files = [{ path: "commands/plan.md", content: "Plano para $ARGUMENTS." }, { path: "skills/x/SKILL.md", content: "---\nname: x\n---\nCorpo com acento: ação." }];
  const buf = zipStore(files);
  const back = unzip(buf);
  assert.deepEqual(back.map((e) => e.path).sort(), ["commands/plan.md", "skills/x/SKILL.md"]);
  assert.equal(back.find((e) => e.path === "skills/x/SKILL.md")!.data.toString("utf8"), files[1].content, "utf-8 preservado");
  assert.deepEqual(zipStore(files), buf, "mesmo conteúdo → mesmos bytes (datas fixas)");
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926, "CRC32 de referência");
});

/* ── projeção (`map`) ────────────────────────────────────────────────────────────────────────────
 * O repositório de fora não se reorganiza; ele DECLARA como entra no padrão. */

import { parsePackMap, applyPackMap } from "./framework-pack.js";

test("map: regras válidas entram ordenadas do mais específico para o mais genérico", () => {
  const { rules, errors } = parsePackMap({
    "core/skills": "reference/skills",
    "core/skills/process/writing-skills": "skills/writing-skills",
    "core/workflows": "commands",
  });
  assert.deepEqual(errors, []);
  // A ordenação é por tamanho da origem (decrescente). O que ela precisa garantir é uma coisa só:
  // um prefixo ANCESTRAL nunca vem antes do seu descendente — e um ancestral é sempre mais curto.
  // Entre origens não relacionadas a ordem é irrelevante; o que não pode é depender de quem escreveu primeiro.
  const pos = (p: string) => rules.findIndex((r) => r.from === p);
  assert.ok(pos("core/skills/process/writing-skills") < pos("core/skills"), "o específico é avaliado antes do genérico");
  assert.deepEqual(rules.map((r) => r.from).sort(), ["core/skills", "core/skills/process/writing-skills", "core/workflows"]);
});

test("map: destino fora dos cinco topos é RECUSADO e reportado (nunca ignorado em silêncio)", () => {
  const { rules, errors } = parsePackMap({
    "core/rules": "reference/rules",
    "core/x": "qualquer/lugar",
    "core/y": "../fuga",
    "core/z": "reference/../../etc",
    "": "reference/vazio",
  });
  assert.deepEqual(rules.map((r) => r.from), ["core/rules"], "só a boa passa");
  assert.equal(errors.length, 4);
  assert.ok(errors.some((e) => /fora do padrão/.test(e)));
  assert.ok(errors.some((e) => /não pode conter/.test(e)));
});

test("map: destino nulo/vazio significa NÃO ENTRA — é como se exclui uma árvore inteira", () => {
  const { rules } = parsePackMap({ profiles: null, docs: "", legacy: false });
  assert.deepEqual(rules.map((r) => r.to), [null, null, null]);
  assert.equal(applyPackMap("profiles/frontend-react/skills/x.md", rules)!.to, null);
});

test("map: casa por fronteira de segmento e projeta o resto do caminho", () => {
  const { rules } = parsePackMap({ "core/skills": "reference/skills", "core/workflows": "commands" });
  assert.equal(applyPackMap("core/skills/quality/clean-code.md", rules)!.to, "reference/skills/quality/clean-code.md");
  assert.equal(applyPackMap("core/workflows/review.md", rules)!.to, "commands/review.md");
  assert.equal(applyPackMap("core/skillsets/x.md", rules), undefined, "'core/skills' NÃO pode pegar 'core/skillsets'");
  assert.equal(applyPackMap("outra/coisa.md", rules), undefined, "sem regra → ancoragem automática de sempre");
  assert.equal(applyPackMap("x.md", undefined), undefined, "pacote sem map segue o comportamento antigo");
});

test("map: origem que é ARQUIVO usa o destino tal e qual (promover um arquivo a skill)", () => {
  const { rules } = parsePackMap({ "core/skills/quality/clean-code.md": "skills/clean-code/SKILL.md" });
  assert.equal(applyPackMap("core/skills/quality/clean-code.md", rules)!.to, "skills/clean-code/SKILL.md");
});

test("map: promover UM arquivo específico — o destino é o prefixo, não um caminho .md", () => {
  // Regressão: a extensão era checada no DESTINO ("skills", sem .md), então a promoção não disparava
  // e o arquivo pousava literalmente em `skills`. Promover 4 arquivos avulsos de uma árvore que no
  // resto vira referência é exatamente o caso do framework real.
  const zip = unzip(zipStore([
    { path: PACK_MANIFEST_FILE, content: JSON.stringify({ name: "p", map: {
      "core/skills/quality/testing-patterns.md": { to: "skills", as: "skill" },
      "core/skills": "reference/skills",
    } }) },
    { path: "core/skills/quality/testing-patterns.md", content: "# Testes\n\nPadrões de teste por camada.\n" },
    { path: "core/skills/quality/outro.md", content: "# Outro\n\nchecklist\n" },
  ]));
  const r = extractFrameworkFiles(zip);
  assert.deepEqual(r.files.map((f) => f.path), ["reference/skills/quality/outro.md", "skills/testing-patterns/SKILL.md"]);
  assert.equal(checkConformance(r.files).loadableSkills, 1);
  assert.equal(validateFramework(r.files).errors, 0);
});

test("map: a regra mais específica vence a mais genérica", () => {
  const { rules } = parsePackMap({ "core/skills": "reference/skills", "core/skills/process/writing-skills": "skills/writing-skills" });
  assert.equal(applyPackMap("core/skills/process/writing-skills/SKILL.md", rules)!.to, "skills/writing-skills/SKILL.md");
  assert.equal(applyPackMap("core/skills/process/outro.md", rules)!.to, "reference/skills/process/outro.md");
});

test("map: a projeção resgata o caso real que motivou tudo isto", () => {
  // Layout do ia-framework: `core/skills/<categoria>/<arquivo>.md` fazia o importador ancorar tudo em
  // skills/ — 103 arquivos, zero carregáveis. Com a projeção, nada se move no repositório.
  const manifest = parsePackManifest(JSON.stringify({
    name: "ia-framework",
    map: {
      "core/skills": "reference/skills",
      "core/skills/process/writing-skills": "skills/writing-skills",
      "core/workflows": "commands",
      "core/rules": "reference/rules",
      profiles: null,
    },
  }))!;
  const entradas = [
    { path: "core/skills/quality/clean-code.md", data: Buffer.from("# checklist") },
    { path: "core/skills/process/writing-skills/SKILL.md", data: Buffer.from("---\nname: writing-skills\ndescription: como escrever skills\n---\nB") },
    { path: "core/workflows/review.md", data: Buffer.from("---\ndescription: revisa\n---\nB") },
    { path: "core/rules/branching.md", data: Buffer.from("# regras") },
    { path: "profiles/frontend-react/skills/perf.md", data: Buffer.from("# react") },
    { path: "cli/README.md", data: Buffer.from("# cli") },
  ];
  const zip = unzip(zipStore([
    { path: PACK_MANIFEST_FILE, content: JSON.stringify({ name: "ia-framework", map: manifest.map!.reduce((acc, r) => ({ ...acc, [r.from]: r.to }), {} as Record<string, string | null>) }) },
    ...entradas.map((e) => ({ path: e.path, content: e.data.toString("utf8") })),
  ]));
  const r = extractFrameworkFiles(zip);

  assert.equal(r.manifest!.name, "ia-framework");
  assert.deepEqual(r.files.map((f) => f.path), [
    "commands/review.md",
    "reference/rules/branching.md",
    "reference/skills/quality/clean-code.md",
    "skills/writing-skills/SKILL.md",
  ]);
  assert.equal(r.mapped, 4);
  assert.equal(r.excluded, 1, "profiles/ foi excluído DE PROPÓSITO");
  assert.equal(r.outOfScope, 1, "cli/README.md não casou com regra nenhuma — acidente, não intenção");

  // e o que sobrou é conforme: uma skill carregável, zero arquivo inerte
  const c = checkConformance(r.files);
  assert.equal(c.loadableSkills, 1);
  assert.equal(c.inertSkillFiles, 0, "o checklist virou referência, então não é mais peso morto em skills/");
  assert.deepEqual(c.issues, []);
});

test("map: manifesto guarda a projeção e denuncia as regras recusadas", () => {
  const m = parsePackManifest('{"name":"x","map":{"core/rules":"reference/rules","core/x":"fora/do/padrao"}}')!;
  assert.deepEqual(m.map, [{ from: "core/rules", to: "reference/rules" }]);
  assert.equal(m.mapErrors!.length, 1);
  assert.equal(parsePackManifest('{"name":"x"}')!.map, undefined, "pacote sem map não ganha campo nenhum");
  assert.equal(parsePackManifest('{"name":"x","map":"lixo"}')!.map, undefined, "map que não é objeto é ignorado");
});

/* ── promoção a skill ────────────────────────────────────────────────────────────────────────────
 * Skills diversas, vindas de qualquer estrutura, têm de acabar funcionando NAS MÁQUINAS. Como a
 * descoberta é `skills/<nome>/SKILL.md` (contrato das IAs, não nosso), a saída é embrulhar. */

import { promoteToSkill, skillNameFromPath } from "./framework-pack.js";

test("promoção: nome sai do arquivo, ou da pasta quando o arquivo é SKILL.md", () => {
  assert.equal(skillNameFromPath("core/skills/quality/clean-code.md"), "clean-code");
  assert.equal(skillNameFromPath("core/skills/process/writing-skills/SKILL.md"), "writing-skills");
  assert.equal(skillNameFromPath("a/Revisão de Código.md"), "revisao-de-codigo");
  assert.equal(skillNameFromPath("a/claude-helper.md"), "helper", "palavra reservada é removida do nome");
});

test("promoção: arquivo cru vira skill válida e o CORPO é preservado inteiro", () => {
  const corpo = "# Clean Code\n\n## When to use\nAo revisar um PR com muita duplicação.\n\n## Passos\n1. Ler o diff.\n";
  const r = promoteToSkill("core/skills/quality/clean-code.md", corpo, new Set());
  assert.equal(r.path, "skills/clean-code/SKILL.md");
  assert.match(r.content, /^---\nname: clean-code\ndescription: Ao revisar um PR com muita duplicação\.\n---\n/,
    "a descrição sai do 'When to use' — é o que diz QUANDO acionar");
  assert.ok(r.content.includes(corpo), "nada do original se perde: o corpo vai inteiro depois do frontmatter");

  const v = validateFramework([{ path: r.path, content: r.content }]);
  assert.deepEqual(v.issues.filter((i) => i.level === "error"), [], "promovida já nasce válida");
});

test("promoção: sem 'When to use', usa a primeira prosa útil e ignora título/tabela/código", () => {
  const r = promoteToSkill("x/deploy.md", "# Deploy\n\n```sh\nnão sou descrição\n```\n\n| a | b |\n\n> citação\n\nRotina de publicação em produção.\n", new Set());
  assert.match(r.content, /description: Rotina de publicação em produção\./);
});

test("promoção: o que o autor declarou vence a heurística", () => {
  const r = promoteToSkill("x/qualquer.md", "---\nname: nome-do-autor\ndescription: descrição do autor\nallowed-tools: Read\n---\nCorpo.", new Set());
  assert.equal(r.path, "skills/nome-do-autor/SKILL.md");
  assert.match(r.content, /description: descrição do autor/);
  assert.match(r.content, /allowed-tools: Read/, "campos extras do frontmatter original são mantidos");
  assert.ok(!/name: qualquer/.test(r.content));
});

test("promoção: nomes iguais em pastas diferentes não colidem", () => {
  const taken = new Set<string>();
  assert.equal(promoteToSkill("a/review.md", "x", taken).path, "skills/review/SKILL.md");
  assert.equal(promoteToSkill("b/review.md", "y", taken).path, "skills/review-2/SKILL.md");
  assert.equal(promoteToSkill("c/review.md", "z", taken).path, "skills/review-3/SKILL.md");
});

test("promoção: uma árvore inteira de .md soltos vira skills que as IAs carregam", () => {
  const zip = unzip(zipStore([
    { path: PACK_MANIFEST_FILE, content: JSON.stringify({ name: "diverso", map: { "material/skills": { to: "skills", as: "skill" }, "material/docs": "reference/docs" } }) },
    { path: "material/skills/quality/clean-code.md", content: "# Clean Code\n\nRevisar duplicação em PRs.\n" },
    { path: "material/skills/deploy/rollback.md", content: "# Rollback\n\nReverter uma publicação com problema.\n" },
    { path: "material/docs/adr.md", content: "# ADR" },
    { path: "material/skills/deploy/diagrama.png", content: "não é md" },
  ]));
  const r = extractFrameworkFiles(zip);
  assert.deepEqual(r.files.map((f) => f.path).sort(), [
    "reference/docs/adr.md",
    "skills/clean-code/SKILL.md",
    "skills/deploy/diagrama.png",   // não-.md segue reposicionado, sem virar skill
    "skills/rollback/SKILL.md",
  ]);
  const c = checkConformance(r.files);
  assert.equal(c.loadableSkills, 2, "as duas carregam de verdade — era zero antes da promoção");
  const v = validateFramework(r.files.filter((f) => f.path.endsWith("SKILL.md")));
  assert.equal(v.errors, 0);
});

test("promoção: destino fora de skills/ é recusado como regra inválida", () => {
  const { rules, errors } = parsePackMap({ "material/x": { to: "reference/x", as: "skill" }, "material/y": { to: "skills", as: "comando" } });
  assert.deepEqual(rules, []);
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => /exige destino em skills\//.test(e)));
  assert.ok(errors.some((e) => /modo "comando" desconhecido/.test(e)));
});

test("o pacote-modelo é um pacote válido — importável sem um único problema", () => {
  const template = packTemplateFiles();
  assert.ok(template.some((f) => f.path === PACK_MANIFEST_FILE), "traz a própria identidade");

  // Passa pelo mesmo caminho de uma importação real: zip → extração → validação → conformidade.
  const extracted = extractFrameworkFiles(unzip(zipStore(template)));
  assert.equal(extracted.manifest!.name, "meu-framework", "a identidade é lida na extração");
  assert.equal(extracted.outOfScope, 0, "nada no modelo cai fora do escopo — inclusive o manifesto");
  assert.deepEqual(extracted.skipped, []);
  assert.deepEqual(extracted.files.map((f) => f.path), [
    "commands/revisar.md", "flows/entrega-com-evidencia.json", "instructions.md",
    "reference/como-construir-um-pacote.md", "skills/entrega-com-evidencia/SKILL.md",
  ]);

  const v = validateFramework(extracted.files);
  assert.deepEqual(v.issues.filter((i) => i.level === "error"), [], "sem erro de validação");
  const c = checkConformance(extracted.files);
  assert.deepEqual(c.issues, [], "sem problema de conformidade");
  assert.equal(c.loadableSkills, 1);
  assert.equal(c.inertSkillFiles, 0);

  // e o fluxo declarado aponta para a skill que veio junto
  const flow = workflowFromFile(template.find((f) => f.path === "flows/entrega-com-evidencia.json")!.content);
  assert.equal(flow!.source.path, "skills/entrega-com-evidencia/SKILL.md");
  assert.ok(extracted.files.some((f) => f.path === flow!.source.path), "a origem existe no pacote");
  assert.ok(flow!.steps.some((s) => s.kind === "gate"), "demonstra um gate");
  assert.ok(flow!.steps.some((s) => s.requiresEvidence), "demonstra evidência exigida");
});
