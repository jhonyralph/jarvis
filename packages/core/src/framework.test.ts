/**
 * Framework domain: read the canonical tree into a hashed manifest, and materialize it onto a
 * machine idempotently and safely (no path escapes). Pure filesystem — no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  readCanonicalFramework, materializeFramework, readReceipt,
  normalizeFrameworkPreference, FRAMEWORK_PREFERENCES, installFrameworkStarterPack,
  deleteFrameworkFolder, assertSafeFolderPath,
} = await import("./framework.js");

function seedCanonical(root: string): void {
  mkdirSync(join(root, "commands"), { recursive: true });
  mkdirSync(join(root, "skills", "review"), { recursive: true });
  writeFileSync(join(root, "commands", "plan.md"), "Plan for $ARGUMENTS.");
  writeFileSync(join(root, "skills", "review", "SKILL.md"), "---\nname: review\n---\nBody.");
  writeFileSync(join(root, "instructions.md"), "Global rules.");
}

test("readCanonicalFramework captures commands/skills/instructions with a stable hash", () => {
  const src = mkdtempSync(join(tmpdir(), "jf-src-"));
  try {
    seedCanonical(src);
    const m = readCanonicalFramework(src);
    const paths = m.files.map((f) => f.path).sort();
    assert.deepEqual(paths, ["commands/plan.md", "instructions.md", "skills/review/SKILL.md"]);
    assert.match(m.hash, /^[0-9a-f]{64}$/);
    // hash is content-addressed and order-independent
    assert.equal(readCanonicalFramework(src).hash, m.hash, "same content → same hash");
  } finally { rmSync(src, { recursive: true, force: true }); }
});

test("materializeFramework writes the tree, is idempotent, and prunes stale files", () => {
  const src = mkdtempSync(join(tmpdir(), "jf-src-"));
  const dst = mkdtempSync(join(tmpdir(), "jf-dst-"));
  try {
    seedCanonical(src);
    const m1 = readCanonicalFramework(src, 1);
    const r1 = materializeFramework(m1, { machineRoot: dst });
    assert.equal(r1.skipped, false);
    assert.ok(r1.written >= 3);
    assert.equal(readFileSync(join(dst, "commands", "plan.md"), "utf8"), "Plan for $ARGUMENTS.");
    assert.equal(readReceipt(dst)!.hash, m1.hash);

    // second apply of the same hash → no-op
    const r2 = materializeFramework(m1, { machineRoot: dst });
    assert.equal(r2.skipped, true);
    assert.equal(r2.written, 0);

    // remove a file from the source, republish → the stale file is pruned on the target
    rmSync(join(src, "commands", "plan.md"));
    const m2 = readCanonicalFramework(src, 2);
    const r3 = materializeFramework(m2, { machineRoot: dst });
    assert.equal(r3.skipped, false);
    assert.equal(r3.removed, 1);
    assert.equal(existsSync(join(dst, "commands", "plan.md")), false, "pruned");
    assert.equal(existsSync(join(dst, "skills", "review", "SKILL.md")), true, "kept");
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dst, { recursive: true, force: true }); }
});

test("materializeFramework refuses path traversal and out-of-scope files", () => {
  const dst = mkdtempSync(join(tmpdir(), "jf-dst-"));
  try {
    assert.throws(() => materializeFramework({ version: 1, hash: "x", files: [{ path: "../evil.txt", content: "x" }] }, { machineRoot: dst }), /inválido/);
    assert.throws(() => materializeFramework({ version: 1, hash: "x", files: [{ path: "/etc/passwd", content: "x" }] }, { machineRoot: dst }), /inválido/);
    assert.throws(() => materializeFramework({ version: 1, hash: "x", files: [{ path: "secrets/keys.txt", content: "x" }] }, { machineRoot: dst }), /fora do escopo/);
    assert.equal(existsSync(join(dst, ".receipt.json")), false, "nothing was written");
  } finally { rmSync(dst, { recursive: true, force: true }); }
});

test("normalizeFrameworkPreference coerces junk to 'ask'", () => {
  assert.equal(normalizeFrameworkPreference("jarvis"), "jarvis");
  assert.equal(normalizeFrameworkPreference("native"), "native");
  assert.equal(normalizeFrameworkPreference("ask"), "ask");
  assert.equal(normalizeFrameworkPreference("nonsense"), "ask");
  assert.equal(normalizeFrameworkPreference(undefined), "ask");
  assert.deepEqual([...FRAMEWORK_PREFERENCES], ["native", "jarvis", "ask"]);
});

test("installFrameworkStarterPack seeds universal skills/commands without overwriting user files", () => {
  const root = mkdtempSync(join(tmpdir(), "jf-starter-"));
  try {
    mkdirSync(join(root, "commands"), { recursive: true });
    writeFileSync(join(root, "commands", "code-review.md"), "custom review");
    const r1 = installFrameworkStarterPack(root);
    assert.ok(r1.imported.includes("commands/benchmark.md"), "benchmark command seeded");
    assert.ok(r1.imported.includes("skills/security-scan/SKILL.md"), "security skill seeded");
    assert.ok(r1.skipped.includes("commands/code-review.md (já existe)"), "custom command skipped");
    assert.equal(readFileSync(join(root, "commands", "code-review.md"), "utf8"), "custom review", "custom file preserved");

    const r2 = installFrameworkStarterPack(root);
    assert.equal(r2.imported.length, 0, "second install is idempotent");
    assert.ok(r2.skipped.length >= r1.imported.length, "existing starter files are skipped");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("deleteFrameworkFolder remove a pasta inteira e reporta os arquivos que saíram", () => {
  const root = mkdtempSync(join(tmpdir(), "jf-delfolder-"));
  try {
    mkdirSync(join(root, "skills", "review"), { recursive: true });
    writeFileSync(join(root, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: x\n---\nBody\n");
    writeFileSync(join(root, "skills", "review", "notes.md"), "notas\n");
    mkdirSync(join(root, "skills", "outra"), { recursive: true });
    writeFileSync(join(root, "skills", "outra", "SKILL.md"), "---\nname: outra\ndescription: y\n---\nB\n");
    writeFileSync(join(root, "instructions.md"), "instruções\n");

    const r = deleteFrameworkFolder("skills/review", root);
    assert.deepEqual(r.removed.sort(), ["skills/review/SKILL.md", "skills/review/notes.md"]);
    assert.equal(existsSync(join(root, "skills", "review")), false, "a pasta some do disco");
    assert.ok(existsSync(join(root, "skills", "outra", "SKILL.md")), "as outras skills ficam intactas");
    assert.ok(existsSync(join(root, "instructions.md")), "instructions.md fica intacto");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("deleteFrameworkFolder recusa caminho fora do escopo, traversal e pasta inexistente", () => {
  const root = mkdtempSync(join(tmpdir(), "jf-delfolder2-"));
  try {
    mkdirSync(join(root, "skills", "ok"), { recursive: true });
    writeFileSync(join(root, "skills", "ok", "SKILL.md"), "---\nname: ok\ndescription: z\n---\nB\n");
    assert.throws(() => deleteFrameworkFolder("../..", root), /inválido|escopo/i);
    assert.throws(() => deleteFrameworkFolder("skills/../../etc", root), /inválido|escopo/i);
    assert.throws(() => deleteFrameworkFolder("C:/Windows", root), /inválido|escopo/i);
    assert.throws(() => deleteFrameworkFolder("instructions.md", root), /escopo/i, "instructions.md é arquivo, não pasta");
    assert.throws(() => deleteFrameworkFolder("skills/naoexiste", root), /não encontrada/i);
    assert.ok(existsSync(join(root, "skills", "ok", "SKILL.md")), "nada foi apagado nas recusas");
    // aceita e normaliza a barra final
    assert.equal(assertSafeFolderPath("skills/ok/"), "skills/ok");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("flows/ é um topo válido do framework: lido, publicado e podável como os demais", () => {
  const src = mkdtempSync(join(tmpdir(), "jf-wf-src-"));
  const dst = mkdtempSync(join(tmpdir(), "jf-wf-dst-"));
  try {
    seedCanonical(src);
    mkdirSync(join(src, "flows"), { recursive: true });
    writeFileSync(join(src, "flows", "entrega.json"), '{"schemaVersion":1,"id":"entrega","name":"Entrega","source":{"kind":"manual"},"steps":[]}\n');

    const m = readCanonicalFramework(src, 1);
    assert.ok(m.files.some((f) => f.path === "flows/entrega.json"), "o fluxo entra no manifesto");

    // publica numa segunda máquina: o fluxo viaja junto (é isso que faz o acompanhamento ser igual em todas)
    materializeFramework(m, { machineRoot: dst });
    assert.equal(existsSync(join(dst, "flows", "entrega.json")), true);

    // e é podado quando some da origem, como qualquer arquivo do framework
    rmSync(join(src, "flows", "entrega.json"));
    const r = materializeFramework(readCanonicalFramework(src, 2), { machineRoot: dst });
    assert.equal(r.removed, 1);
    assert.equal(existsSync(join(dst, "flows", "entrega.json")), false);
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dst, { recursive: true, force: true }); }
});

test("a fronteira de segurança continua valendo para workflows/", () => {
  const dst = mkdtempSync(join(tmpdir(), "jf-wf-sec-"));
  try {
    assert.throws(() => materializeFramework({ version: 1, hash: "x", files: [{ path: "flows/../evil.json", content: "{}" }] }, { machineRoot: dst }), /inválido/);
    assert.throws(() => materializeFramework({ version: 1, hash: "x", files: [{ path: "fluxos/x.json", content: "{}" }] }, { machineRoot: dst }), /fora do escopo/, "um topo parecido mas não previsto continua barrado");
    // e a pasta de fluxos é gerenciável como as outras (remover pelo inventário)
    mkdirSync(join(dst, "flows"), { recursive: true });
    writeFileSync(join(dst, "flows", "x.json"), "{}");
    assert.deepEqual(deleteFrameworkFolder("flows", dst).removed, ["flows/x.json"]);
    assert.equal(existsSync(join(dst, "flows")), false);
  } finally { rmSync(dst, { recursive: true, force: true }); }
});
