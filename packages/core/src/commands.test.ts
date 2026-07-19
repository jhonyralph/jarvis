/**
 * Slash-command / skill discovery + expansion. commands.ts reads ~/.claude by default; it honors
 * JARVIS_CLAUDE_HOME (set here before import) so we point it at a throwaway fixture. node --test runs
 * each file in its own process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "jarvis-cmd-"));
mkdirSync(join(HOME, "skills", "my-skill"), { recursive: true });
mkdirSync(join(HOME, "commands", "flow"), { recursive: true });
writeFileSync(join(HOME, "skills", "my-skill", "SKILL.md"), `---
name: my-skill
description: >-
  A test skill that does
  something useful.
---
Body of the skill.`);
writeFileSync(join(HOME, "commands", "flow", "discovery.md"), `---
description: Discovery phase — break an epic into features
argument-hint: <epic>
---
Run discovery for: $ARGUMENTS

- step one
- step two`);
writeFileSync(join(HOME, "commands", "plain.md"), `Just a body, no frontmatter, with $ARGUMENTS.`);
process.env.JARVIS_CLAUDE_HOME = HOME;

const { listCommands, listCommandsPublic, expandCommand } = await import("./commands.js");

test("listCommands finds skills and namespaced commands with metadata", () => {
  const all = listCommands();
  const skill = all.find((c) => c.name === "my-skill");
  assert.ok(skill, "skill discovered");
  assert.equal(skill!.kind, "skill");
  assert.match(skill!.description, /test skill that does something useful/);
  const cmd = all.find((c) => c.name === "flow:discovery");
  assert.ok(cmd, "namespaced command discovered as flow:discovery");
  assert.equal(cmd!.kind, "command");
  assert.equal(cmd!.argHint, "<epic>");
  assert.ok(all.find((c) => c.name === "plain"), "a frontmatter-less command still lists by filename");
});

test("listCommandsPublic strips filesystem paths", () => {
  assert.ok(listCommandsPublic().every((c) => !("path" in c)), "no path leaks to the client");
});

test("expandCommand substitutes $ARGUMENTS in a command body", () => {
  const r = expandCommand("/flow:discovery my epic here");
  assert.ok(r);
  assert.equal(r!.name, "flow:discovery");
  assert.match(r!.expanded, /Run discovery for: my epic here/);
  assert.match(r!.expanded, /step one/);
  assert.doesNotMatch(r!.expanded, /\$ARGUMENTS/, "no unsubstituted placeholder remains");
});

test("expandCommand turns a skill into a use-the-skill instruction", () => {
  const r = expandCommand("/my-skill some context");
  assert.ok(r);
  assert.match(r!.expanded, /Use the "my-skill" skill/);
  assert.match(r!.expanded, /some context/);
});

test("expandCommand returns null for non-commands and unknown names", () => {
  assert.equal(expandCommand("just a normal message"), null);
  assert.equal(expandCommand("/nope-not-real args"), null);
  assert.equal(expandCommand("email me at a/b"), null);
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));
