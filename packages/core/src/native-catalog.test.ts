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
