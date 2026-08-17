import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretVault, secretNameFor } from "./secret-vault.js";

test("secretNameFor deriva nomes de env var estáveis e válidos", () => {
  assert.equal(secretNameFor("github:github-acme"), "JARVIS_SECRET_GITHUB_GITHUB_ACME");
  assert.equal(secretNameFor("github:github-acme", "2"), "JARVIS_SECRET_GITHUB_GITHUB_ACME_2");
  assert.equal(secretNameFor("!!!"), "JARVIS_SECRET_SEGREDO");
});

test("cofre: set/remove/persistência; names() nunca expõe valor", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-secrets-"));
  try {
    const vault = new SecretVault({ dir });
    vault.set("JARVIS_SECRET_GH", "tok-123");
    assert.deepEqual(vault.names(), ["JARVIS_SECRET_GH"]);
    assert.equal(vault.has("JARVIS_SECRET_GH"), true);
    assert.throws(() => vault.set("minusculo", "x"), /nome inválido/);
    assert.throws(() => vault.set("JARVIS_SECRET_X", "  "), /vazio/);
    assert.throws(() => vault.set("JARVIS_SECRET_X", "a\nb"), /quebra de linha/);
    assert.throws(() => vault.set("JARVIS_SECRET_X", "x".repeat(5000)), /grande demais/);

    const reread = new SecretVault({ dir });
    assert.equal(reread.has("JARVIS_SECRET_GH"), true, "sobrevive a restart");
    assert.equal(reread.remove("JARVIS_SECRET_GH"), true);
    assert.equal(reread.remove("JARVIS_SECRET_GH"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("loadIntoEnv injeta o que falta e NUNCA atropela ambiente explícito", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-secrets-env-"));
  try {
    const vault = new SecretVault({ dir });
    vault.set("JARVIS_SECRET_A", "do-cofre");
    vault.set("JARVIS_SECRET_B", "tambem-do-cofre");
    const env: Record<string, string | undefined> = { JARVIS_SECRET_A: "do-ambiente" };
    const r = vault.loadIntoEnv(env as NodeJS.ProcessEnv);
    assert.deepEqual(r, { loaded: ["JARVIS_SECRET_B"], skipped: ["JARVIS_SECRET_A"] });
    assert.equal(env.JARVIS_SECRET_A, "do-ambiente", "ambiente explícito vence o cofre");
    assert.equal(env.JARVIS_SECRET_B, "tambem-do-cofre");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
