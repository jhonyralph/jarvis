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
const CLAUDE = join(HOME, "claude"), CODEX = join(HOME, "codex");
mkdirSync(join(CLAUDE, "skills", "my-skill"), { recursive: true });
mkdirSync(join(CLAUDE, "commands", "flow"), { recursive: true });
mkdirSync(join(CODEX, "prompts"), { recursive: true });
writeFileSync(join(CLAUDE, "skills", "my-skill", "SKILL.md"), `---
name: my-skill
description: >-
  A test skill that does
  something useful.
---
Body of the skill.`);
writeFileSync(join(CLAUDE, "commands", "flow", "discovery.md"), `---
description: Discovery phase — break an epic into features
argument-hint: <epic>
---
Run discovery for: $ARGUMENTS

- step one
- step two`);
writeFileSync(join(CLAUDE, "commands", "plain.md"), `Just a body, no frontmatter, with $ARGUMENTS.`);
// A Codex prompt: flat file (no frontmatter), plus one whose NAME CLASHES with a Claude command.
writeFileSync(join(CODEX, "prompts", "cx-only.md"), `Codex-only prompt for $ARGUMENTS here.`);
writeFileSync(join(CODEX, "prompts", "plain.md"), `CODEX version of plain — should lose to Claude.`);
writeFileSync(join(HOME, "claude.json"), JSON.stringify({ mcpServers: { "my-mcp": { type: "http", url: "https://x" } } }));
process.env.JARVIS_CLAUDE_HOME = CLAUDE;
process.env.JARVIS_CODEX_HOME = CODEX;
process.env.JARVIS_CLAUDE_JSON = join(HOME, "claude.json");

const { listCommands, listCommandsPublic, expandCommand, cmdAgentOf } = await import("./commands.js");

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

test("Codex prompts are discovered (flat, first-line description) alongside Claude", () => {
  const all = listCommands();
  const cx = all.find((c) => c.name === "cx-only");
  assert.ok(cx, "codex prompt discovered");
  assert.equal(cx!.agent, "codex");
  assert.equal(cx!.kind, "command");
  assert.match(cx!.description, /Codex-only prompt/, "first body line used as description");
  const skill = all.find((c) => c.name === "my-skill");
  assert.equal(skill!.agent, "claude");
});

test("on a name clash Claude wins; expanding it uses the Claude file", () => {
  const plain = listCommands().filter((c) => c.name === "plain");
  assert.equal(plain.length, 1, "deduped to a single 'plain'");
  assert.equal(plain[0].agent, "claude", "Claude takes preference over Codex");
  assert.match(expandCommand("/plain X")!.expanded, /no frontmatter, with X/, "the Claude body is expanded, not Codex's");
});

test("expandCommand is name-tolerant (leaf name resolves a namespaced command)", () => {
  const r = expandCommand("/discovery my epic");
  assert.ok(r, "/discovery resolves flow:discovery by leaf name");
  assert.equal(r!.name, "flow:discovery");
  assert.match(r!.expanded, /Run discovery for: my epic/);
});

test("cmdAgentOf maps adapter names to the command-owning agent", () => {
  assert.equal(cmdAgentOf("claude-code"), "claude");
  assert.equal(cmdAgentOf("codex"), "codex");
  assert.equal(cmdAgentOf("aider"), null);
  assert.equal(cmdAgentOf(undefined), null);
});

test("expandCommand is agent-scoped: a Codex turn never runs a Claude command", () => {
  assert.equal(expandCommand("/flow:discovery x", undefined, "codex"), null, "Claude command not offered under Codex");
  assert.match(expandCommand("/cx-only y", undefined, "codex")!.expanded, /Codex-only prompt for y/, "Codex prompt resolves under Codex");
  assert.match(expandCommand("/flow:discovery x", undefined, "claude")!.expanded, /Run discovery for: x/, "and resolves under Claude");
  assert.equal(expandCommand("/flow:discovery x", undefined, null), null, "an adapter with no command system expands nothing");
});

test("MCP servers from ~/.claude.json are listed (kind:mcp, Claude) and expand to a hint", () => {
  const mcp = listCommands().find((c) => c.name === "my-mcp");
  assert.ok(mcp, "mcp server listed");
  assert.equal(mcp!.kind, "mcp");
  assert.equal(mcp!.agent, "claude");
  assert.match(expandCommand("/my-mcp do X", undefined, "claude")!.expanded, /Use the "my-mcp" MCP server/);
  assert.equal(expandCommand("/my-mcp", undefined, "codex"), null, "not offered under Codex");
});

test("expandCommand returns null for non-commands and unknown names", () => {
  assert.equal(expandCommand("just a normal message"), null);
  assert.equal(expandCommand("/nope-not-real args"), null);
  assert.equal(expandCommand("email me at a/b"), null);
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));
