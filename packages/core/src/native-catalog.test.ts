/** Native skills catalog: enumerate each provider's INSTALLED skills/commands and collect them into
 *  framework files (which the Hub then imports into the universal framework, served under every AI). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listNativeCatalog, collectNativeCatalogFiles } from "./commands.js";
import { nativeSourceId } from "./framework-sources.js";

/** A throwaway ~/.claude home with one skill (2 files) and one command. */
function fixtureClaudeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "jf-cat-"));
  mkdirSync(join(home, "skills", "reviewer"), { recursive: true });
  writeFileSync(join(home, "skills", "reviewer", "SKILL.md"), "---\nname: reviewer\ndescription: Reviews code.\n---\nBody of reviewer.\n");
  writeFileSync(join(home, "skills", "reviewer", "notes.md"), "extra notes\n");
  mkdirSync(join(home, "commands"), { recursive: true });
  writeFileSync(join(home, "commands", "plan.md"), "---\ndescription: Plan carefully.\n---\nPlan $ARGUMENTS\n");
  return home;
}

/** Point discovery + framework root at fixtures so the catalog is hermetic against the real HOME. */
function withHome<T>(home: string, fn: () => T): T {
  const prevC = process.env.JARVIS_CLAUDE_HOME, prevH = process.env.JARVIS_HOME;
  process.env.JARVIS_CLAUDE_HOME = home;
  process.env.JARVIS_HOME = home;          // empty framework root here → no `jarvis` entries of our own
  try { return fn(); }
  finally { process.env.JARVIS_CLAUDE_HOME = prevC; process.env.JARVIS_HOME = prevH; rmSync(home, { recursive: true, force: true }); }
}

test("listNativeCatalog surfaces installed native skills/commands and never includes the universal framework", () => {
  withHome(fixtureClaudeHome(), () => {
    const cat = listNativeCatalog();
    assert.ok(cat.every((e) => e.provider !== "jarvis"), "universal framework entries must not appear in the native catalog");
    const skill = cat.find((e) => e.id === "claude:skill:reviewer");
    assert.ok(skill, "the installed skill must be listed");
    assert.equal(skill!.kind, "skill");
    assert.ok(cat.some((e) => e.id === "claude:command:plan"), "the installed command must be listed");
  });
});

test("collectNativeCatalogFiles maps a skill dir + a command to framework paths, per-entry hash, missing reported", () => {
  withHome(fixtureClaudeHome(), () => {
    const { entries, missing } = collectNativeCatalogFiles(["claude:skill:reviewer", "claude:command:plan", "claude:skill:ghost"]);
    assert.deepEqual(missing, ["claude:skill:ghost"], "an unresolved id is reported, not silently dropped");
    const skill = entries.find((e) => e.id === "claude:skill:reviewer");
    assert.ok(skill && skill.hash, "the entry carries a content hash for drift tracking");
    assert.deepEqual(skill!.files.map((f) => f.path).sort(), ["skills/reviewer/SKILL.md", "skills/reviewer/notes.md"], "the whole skill dir maps under skills/<slug>/");
    const cmd = entries.find((e) => e.id === "claude:command:plan");
    assert.ok(cmd && cmd.files.length === 1 && cmd.files[0].path === "commands/plan.md", "a command maps to commands/<name>.md");
  });
});

test("nativeSourceId is stable and namespaced (lowercased)", () => {
  assert.equal(nativeSourceId("claude:skill:Reviewer"), "native:claude:skill:reviewer");
});

test("o catálogo enxerga skills/commands vindos de PLUGINS (Claude e Codex) com o rótulo do pacote", () => {
  const home = mkdtempSync(join(tmpdir(), "jf-plug-"));
  // Claude: plugins/marketplaces/<mkt>/plugins/<plugin>/{skills,commands}
  const cPlug = join(home, "plugins", "marketplaces", "oficial", "plugins", "code-review");
  mkdirSync(join(cPlug, "skills", "revisor"), { recursive: true });
  writeFileSync(join(cPlug, "skills", "revisor", "SKILL.md"), "---\nname: revisor\ndescription: revisa PRs.\n---\nCorpo\n");
  mkdirSync(join(cPlug, "commands"), { recursive: true });
  writeFileSync(join(cPlug, "commands", "revisar.md"), "---\ndescription: revisa\n---\nRevise $ARGUMENTS\n");
  // Codex: plugins/cache/<mkt>/<plugin>/<versão>/skills — a versão no meio não pode virar o rótulo
  const xPlug = join(home, "codex", "plugins", "cache", "curated", "openai-templates", "0.1.1");
  mkdirSync(join(xPlug, "skills", "relatorio"), { recursive: true });
  writeFileSync(join(xPlug, "skills", "relatorio", "SKILL.md"), "---\nname: relatorio\ndescription: gera relatório.\n---\nCorpo\n");

  const prevC = process.env.JARVIS_CLAUDE_HOME, prevX = process.env.JARVIS_CODEX_HOME, prevH = process.env.JARVIS_HOME;
  process.env.JARVIS_CLAUDE_HOME = home;
  process.env.JARVIS_CODEX_HOME = join(home, "codex");
  process.env.JARVIS_HOME = home;
  try {
    const cat = listNativeCatalog();
    const skill = cat.find((e) => e.id === "claude:skill:revisor");
    assert.ok(skill, "skill de plugin do Claude aparece no catálogo");
    assert.equal(skill!.plugin, "code-review", "rotulada com o nome do plugin");
    const cmd = cat.find((e) => e.id === "claude:command:revisar");
    assert.ok(cmd && cmd.plugin === "code-review", "comando de plugin também entra");
    const codex = cat.find((e) => e.id === "codex:skill:relatorio");
    assert.ok(codex, "skill de plugin do Codex aparece");
    assert.equal(codex!.plugin, "openai-templates", "o diretório de versão não vira rótulo");

    // e o conteúdo é importável (mesmo caminho do import do catálogo)
    const { entries } = collectNativeCatalogFiles(["claude:skill:revisor"]);
    assert.deepEqual(entries[0].files.map((f) => f.path), ["skills/revisor/SKILL.md"]);
  } finally {
    process.env.JARVIS_CLAUDE_HOME = prevC; process.env.JARVIS_CODEX_HOME = prevX; process.env.JARVIS_HOME = prevH;
    rmSync(home, { recursive: true, force: true });
  }
});
