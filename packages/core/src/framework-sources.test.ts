/** F2 — atribuição de origem POR METADADO: o disco continua plano e quem sabe de onde cada arquivo
 *  veio é o registro de fontes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPackIndex, packOfSource, type FrameworkSource } from "./framework-sources.js";

const src = (over: Partial<FrameworkSource>): FrameworkSource => ({
  id: "zip:x", type: "zip", hash: "h", files: [], importedAt: 1, updatedAt: 1, ...over,
});

test("pacote que se identifica vira origem declarada", () => {
  const p = packOfSource(src({ id: "gh:eu/fw", type: "github", pack: { name: "meu-framework", title: "Meu Framework", version: "1.0.0" } }));
  assert.deepEqual(p, { name: "meu-framework", title: "Meu Framework", version: "1.0.0", declared: true, sourceId: "gh:eu/fw", sourceType: "github" });
});

test("sem manifesto a origem ainda é conhecida — só não é declarada pelo pacote", () => {
  const p = packOfSource(src({ id: "zip:pacote.zip", label: "pacote.zip" }));
  assert.equal(p.declared, false, "é isto que a UI usa para dizer 'sem identidade'");
  assert.equal(p.name, "pacote.zip");
  assert.equal(packOfSource(src({ id: "zip:sem-rotulo" })).name, "zip:sem-rotulo", "cai para o id quando nem rótulo existe");
});

test("o índice liga cada caminho ao pacote que o trouxe", () => {
  const idx = buildPackIndex([
    src({ id: "gh:eu/a", type: "github", updatedAt: 10, pack: { name: "pacote-a" }, files: ["skills/a/SKILL.md", "flows/a.json"] }),
    src({ id: "zip:b.zip", label: "b.zip", updatedAt: 20, files: ["skills/b/SKILL.md"] }),
  ]);
  assert.equal(idx["skills/a/SKILL.md"].name, "pacote-a");
  assert.equal(idx["flows/a.json"].name, "pacote-a", "o fluxo herda a origem do pacote que o trouxe");
  assert.equal(idx["skills/b/SKILL.md"].declared, false);
  assert.equal(idx["instructions.md"], undefined, "arquivo feito à mão não tem pacote — a UI mostra 'local'");
});

test("caminho contribuído por duas fontes fica com a importação MAIS RECENTE (é o que está no disco)", () => {
  const antiga = src({ id: "gh:eu/antigo", type: "github", updatedAt: 100, pack: { name: "antigo" }, files: ["skills/x/SKILL.md"] });
  const nova = src({ id: "zip:novo.zip", updatedAt: 200, pack: { name: "novo" }, files: ["skills/x/SKILL.md"] });
  assert.equal(buildPackIndex([antiga, nova])["skills/x/SKILL.md"].name, "novo");
  assert.equal(buildPackIndex([nova, antiga])["skills/x/SKILL.md"].name, "novo", "a ordem da lista de entrada não importa");
});
