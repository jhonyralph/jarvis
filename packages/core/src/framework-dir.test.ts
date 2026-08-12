/** Importar um pacote direto de uma pasta: mesmos limites do zip, e o mesmo caminho de extração
 *  daí para frente. É o que torna a reimportação repetível para um framework que só vive em disco. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPackDir, packDirLabel } from "./framework-dir.js";
import { extractFrameworkFiles, MAX_FILE_BYTES } from "./framework-archive.js";
import { PACK_MANIFEST_FILE } from "./framework-pack.js";

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), "jf-dir-"));
  mkdirSync(join(root, "core", "skills", "quality"), { recursive: true });
  mkdirSync(join(root, "core", "workflows"), { recursive: true });
  mkdirSync(join(root, "node_modules", "lixo"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, PACK_MANIFEST_FILE), JSON.stringify({ name: "meu-fw", map: { "core/skills": "reference/skills", "core/workflows": "commands" } }));
  writeFileSync(join(root, "core", "skills", "quality", "clean-code.md"), "# Clean Code\n\nRevisar duplicação.\n");
  writeFileSync(join(root, "core", "workflows", "review.md"), "---\ndescription: revisa\n---\nCorpo.");
  writeFileSync(join(root, "node_modules", "lixo", "index.js"), "module.exports=1");
  writeFileSync(join(root, ".git", "config"), "[core]");
  writeFileSync(join(root, "README.md"), "# leia");
  return root;
}

test("varre a pasta e ignora ferramental (.git, node_modules)", () => {
  const root = seed();
  try {
    const r = readPackDir(root);
    // Ordenação por localeCompare (a mesma do resto do importador): ignora caixa, então README fica
    // depois de `core/…` e `jarvis.pack.json`. O que importa é ser DETERMINÍSTICA.
    assert.deepEqual(r.entries.map((e) => e.path), [
      "core/skills/quality/clean-code.md", "core/workflows/review.md", PACK_MANIFEST_FILE, "README.md",
    ], "ordem estável: mesmo disco → mesmo pacote");
    assert.deepEqual(readPackDir(root).entries.map((e) => e.path), r.entries.map((e) => e.path), "duas leituras, mesma ordem");
    assert.equal(r.truncated, false);
    assert.deepEqual(r.skipped, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a pasta entra no MESMO caminho do zip — projeção e identidade valem igual", () => {
  const root = seed();
  try {
    const out = extractFrameworkFiles(readPackDir(root).entries);
    assert.equal(out.manifest!.name, "meu-fw");
    assert.deepEqual(out.files.map((f) => f.path), ["commands/review.md", "reference/skills/quality/clean-code.md"]);
    assert.equal(out.mapped, 2);
    assert.equal(out.outOfScope, 1, "o README não casou com regra nenhuma");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("respeita os tetos do pacote e diz o que ficou de fora", () => {
  const root = mkdtempSync(join(tmpdir(), "jf-dir-lim-"));
  try {
    mkdirSync(join(root, "reference"), { recursive: true });
    writeFileSync(join(root, "reference", "gigante.md"), "x".repeat(MAX_FILE_BYTES + 1));
    writeFileSync(join(root, "reference", "ok.md"), "cabe");
    const r = readPackDir(root);
    assert.deepEqual(r.entries.map((e) => e.path), ["reference/ok.md"]);
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0], /gigante\.md .*excede/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("teto de arquivos interrompe a varredura e AVISA (recorte não pode passar por 'tudo')", () => {
  const root = mkdtempSync(join(tmpdir(), "jf-dir-max-"));
  try {
    mkdirSync(join(root, "reference"), { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(join(root, "reference", `a${i}.md`), "x");
    const r = readPackDir(root, { maxEntries: 3 });
    assert.equal(r.entries.length, 3);
    assert.equal(r.truncated, true);
    assert.match(r.skipped.join(" "), /interrompida em 3/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pasta inexistente ou arquivo no lugar de pasta é erro do chamador, não silêncio", () => {
  assert.throws(() => readPackDir(join(tmpdir(), "nao-existe-jf-" + process.pid)));
  const root = mkdtempSync(join(tmpdir(), "jf-dir-f-"));
  try {
    writeFileSync(join(root, "x.md"), "a");
    assert.throws(() => readPackDir(join(root, "x.md")), /não é uma pasta/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("o rótulo da fonte é o nome da pasta", () => {
  assert.equal(packDirLabel("C:/Users/x/Workspace/ia-framework"), "ia-framework");
  assert.equal(packDirLabel("/a/b/profiles/frontend-react/"), "frontend-react");
});
