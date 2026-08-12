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
