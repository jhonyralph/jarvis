/** F3 — o relatório que faltava: dos arquivos que ENTRAM, quais não vão funcionar. O caso central é
 *  reproduzido do framework real que motivou tudo isto (`core/skills/<categoria>/<arquivo>.md`). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConformance, isLoadableSkill, missingManifestIssue } from "./framework-conformance.js";
import { buildImportPreview } from "./framework-import.js";
import type { FrameworkFile } from "./framework.js";

const f = (path: string, content = "x"): FrameworkFile => ({ path, content });
const SKILL = "---\nname: entrega\ndescription: faz algo e diz quando usar\n---\nCorpo.";

test("skills/<nome>/SKILL.md é o único formato que a descoberta enxerga", () => {
  assert.equal(isLoadableSkill("skills/entrega/SKILL.md"), true);
  assert.equal(isLoadableSkill("skills/a/b/SKILL.md"), false, "um nível a mais e some");
  assert.equal(isLoadableSkill("skills/entrega/notas.md"), false);
  assert.equal(isLoadableSkill("skills/clean-code.md"), false);
});

test("pacote no padrão não gera nenhum problema", () => {
  const r = checkConformance([
    f("instructions.md"), f("commands/plan.md"), f("skills/entrega/SKILL.md", SKILL),
    f("skills/entrega/referencia.md"),           // apoio ao lado do manifesto: legítimo
    f("flows/entrega.json", '{"id":"entrega","name":"E","steps":[{"title":"1 — a"}]}'),
    f("reference/qualquer/coisa.md"),
  ]);
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
  assert.equal(r.loadableSkills, 1);
  assert.equal(r.inertSkillFiles, 0);
  assert.equal(r.commands, 1);
  assert.equal(r.flows, 1);
  assert.equal(r.reference, 1);
});

test("o caso real: pasta de categoria sob skills/ — entra tudo e não carrega nada", () => {
  const files = [
    ...["clean-code", "code-review-checklist", "systematic-debugging"].map((n) => f(`skills/quality/${n}.md`, "# Skill: " + n)),
    ...["deploy-checklist", "rollback"].map((n) => f(`skills/deploy/${n}.md`, "# " + n)),
  ];
  const r = checkConformance(files);
  assert.equal(r.loadableSkills, 0, "nenhuma skill carregável");
  assert.equal(r.inertSkillFiles, 5, "os cinco arquivos são peso morto publicado para a frota");
  assert.equal(r.issues.length, 2, "um problema por PASTA, não por arquivo — senão vira parede de texto");
  assert.deepEqual(r.issues.map((i) => i.path).sort(), ["skills/deploy", "skills/quality"]);
  assert.equal(r.issues[0].code, "skill-sem-manifesto");
  assert.match(r.issues[0].message, /reference\//, "aponta o destino certo para material de apoio");
  assert.equal(r.issues.find((i) => i.path === "skills/quality")!.files, 3);
  assert.equal(r.ok, false);
});

test("SKILL.md fundo demais é acusado com o caminho exato", () => {
  const r = checkConformance([f("skills/process/writing-skills/SKILL.md", SKILL), f("skills/process/outro.md")]);
  assert.equal(r.loadableSkills, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, "skill-profunda");
  assert.deepEqual(r.issues[0].sample, ["skills/process/writing-skills/SKILL.md"]);
  assert.equal(r.issues[0].files, 2, "a pasta inteira é inerte, não só o SKILL.md perdido");
});

test("arquivo solto direto em skills/ é um problema à parte", () => {
  const r = checkConformance([f("skills/clean-code.md"), f("skills/entrega/SKILL.md", SKILL)]);
  assert.equal(r.loadableSkills, 1, "a skill correta ao lado continua valendo");
  assert.equal(r.inertSkillFiles, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, "skill-arquivo-solto");
});

test("fluxo ilegível e comando que não é .md são acusados", () => {
  const r = checkConformance([
    f("flows/bom.json", '{"id":"b","name":"B","steps":[{"title":"1 — a"}]}'),
    f("flows/quebrado.json", "{lixo"),
    f("flows/vazio.json", '{"id":"v","steps":[]}'),
    f("commands/notas.txt"),
  ]);
  assert.equal(r.flows, 1, "só o legível conta");
  const flow = r.issues.find((i) => i.code === "fluxo-invalido")!;
  assert.equal(flow.files, 2);
  assert.equal(flow.level, "error");
  assert.equal(r.issues.find((i) => i.code === "comando-nao-md")!.level, "warn", "comando torto avisa, não impede");
});

test("a prévia de importação carrega a conformidade, e pacote sem manifesto só AVISA", () => {
  const incoming = [f("skills/quality/clean-code.md"), f("skills/entrega/SKILL.md", SKILL)];
  const sem = buildImportPreview(incoming, [], []);
  assert.ok(sem.conformance.issues.some((i) => i.code === "pacote-sem-manifesto"));
  assert.equal(sem.conformance.issues.find((i) => i.code === "pacote-sem-manifesto")!.level, "warn", "aceitar e avisar");
  assert.equal(sem.manifest, null);
  assert.equal(sem.files.length, 2, "nada é barrado por falta de manifesto");

  const com = buildImportPreview(incoming, [], [], { schemaVersion: 1, name: "meu-framework" });
  assert.ok(!com.conformance.issues.some((i) => i.code === "pacote-sem-manifesto"));
  assert.equal(com.manifest!.name, "meu-framework");
  assert.equal(com.conformance.errors, 1, "o problema estrutural continua sendo acusado nos dois casos");
  assert.equal(missingManifestIssue().level, "warn");
});
