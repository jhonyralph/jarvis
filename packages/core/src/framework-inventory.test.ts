/** Inventory: per-file status diff vs. last publish + token budget buckets. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInventory, estimateTokens, classifyFramework, ALWAYS_ON_TOKEN_BUDGET } from "./framework-inventory.js";
import type { FrameworkFile } from "./framework.js";

const skill = (name: string, desc: string, body = "Body."): FrameworkFile => ({
  path: `skills/${name}/SKILL.md`, content: `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`,
});

test("classifyFramework maps paths to kinds", () => {
  assert.equal(classifyFramework("instructions.md"), "instructions");
  assert.equal(classifyFramework("commands/plan.md"), "command");
  assert.equal(classifyFramework("skills/review/SKILL.md"), "skill");
});

test("estimateTokens is ~chars/4 with a floor", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("a"), 1);
  assert.equal(estimateTokens("a".repeat(40)), 10);
});

test("buildInventory diffs against the published snapshot", () => {
  const published: FrameworkFile[] = [
    { path: "commands/plan.md", content: "old" },
    { path: "instructions.md", content: "rules" },
    { path: "commands/gone.md", content: "bye" },
  ];
  const current: FrameworkFile[] = [
    { path: "commands/plan.md", content: "new content" }, // modified
    { path: "instructions.md", content: "rules" },          // unchanged
    { path: "commands/fresh.md", content: "hi" },            // new
  ];
  const inv = buildInventory(current, published);
  const byPath = Object.fromEntries(inv.files.map((f) => [f.path, f.status]));
  assert.equal(byPath["commands/plan.md"], "modified");
  assert.equal(byPath["instructions.md"], "unchanged");
  assert.equal(byPath["commands/fresh.md"], "new");
  assert.equal(byPath["commands/gone.md"], "removed");
  assert.equal(inv.totals.files, 3, "removed files are not counted in live totals");
});

test("buildInventory splits token cost into always-on / on-demand / metadata", () => {
  const files: FrameworkFile[] = [
    { path: "instructions.md", content: "x".repeat(400) },  // always-on ~100 tokens
    { path: "commands/plan.md", content: "y".repeat(40) },  // on-demand ~10 tokens
    skill("review", "Reviews code and diffs for bugs.", "z".repeat(40)),
  ];
  const inv = buildInventory(files);
  assert.equal(inv.totals.alwaysOnTokens, 100);
  assert.ok(inv.totals.onDemandTokens >= 10, "command + skill bodies counted on-demand");
  assert.ok(inv.totals.metadataTokens > 0, "skill name+description counted as metadata");
  // metadata comes only from skills
  const onlyCmd = buildInventory([{ path: "commands/x.md", content: "hello" }]);
  assert.equal(onlyCmd.totals.metadataTokens, 0);
});

test("buildInventory warns when the always-on bucket blows the budget", () => {
  const big = "a".repeat((ALWAYS_ON_TOKEN_BUDGET + 200) * 4);
  const inv = buildInventory([{ path: "instructions.md", content: big }]);
  assert.ok(inv.warnings.some((w) => w.path === "instructions.md" && w.level === "warn"));
});

test("buildInventory warns on an oversized skill body", () => {
  const body = Array.from({ length: 600 }, (_, i) => `line ${i}`).join("\n");
  const inv = buildInventory([skill("huge", "A big skill.", body)]);
  assert.ok(inv.warnings.some((w) => w.path === "skills/huge/SKILL.md"));
});
