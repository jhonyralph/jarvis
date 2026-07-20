/**
 * "@" file search, "!" bash injection, and "#" memory append. All operate on a throwaway temp dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMentionFiles } from "./mentions.js";
import { expandBang, appendMemory } from "./triggers.js";

const ROOT = mkdtempSync(join(tmpdir(), "jarvis-trig-"));
mkdirSync(join(ROOT, "src"), { recursive: true });
mkdirSync(join(ROOT, "node_modules", "pkg"), { recursive: true });
writeFileSync(join(ROOT, "README.md"), "readme");
writeFileSync(join(ROOT, "src", "index.ts"), "code");
writeFileSync(join(ROOT, "src", "helper.ts"), "code");
writeFileSync(join(ROOT, "node_modules", "pkg", "dep.js"), "dep");

test("listMentionFiles finds files under cwd, skips node_modules, matches a query", () => {
  const all = listMentionFiles(ROOT);
  assert.ok(all.includes("README.md"));
  assert.ok(all.includes("src/index.ts"));
  assert.ok(!all.some((f) => f.includes("node_modules")), "node_modules is skipped");
  const q = listMentionFiles(ROOT, "helper");
  assert.deepEqual(q, ["src/helper.ts"]);
});

test("appendMemory uses each provider's canonical project instruction file", () => {
  const r1 = appendMemory("# lembre disso", ROOT, "claude");
  assert.equal(r1.file, join(ROOT, "CLAUDE.md"));
  assert.match(readFileSync(r1.file, "utf8"), /- lembre disso/);
  const r2 = appendMemory("nota codex", ROOT, "codex");
  assert.equal(r2.file, join(ROOT, "AGENTS.md"));
  assert.ok(existsSync(r2.file));
  const r3 = appendMemory("nota gemini", ROOT, "gemini");
  assert.equal(r3.file, join(ROOT, "GEMINI.md"));
  const r4 = appendMemory("nota cursor", ROOT, "cursor");
  assert.equal(r4.file, join(ROOT, "AGENTS.md"));
});

test("expandBang runs the command and injects its output; null when not a bang", async () => {
  assert.equal(await expandBang("apenas uma mensagem", ROOT), null);
  const r = await expandBang("!echo hello", ROOT);
  assert.ok(r);
  assert.equal(r!.cmd, "echo hello");
  assert.match(r!.expanded, /hello/, "command output is injected");
  assert.match(r!.expanded, /Saída de `echo hello`/);
  const withAsk = await expandBang("!echo hi\no que é isso?", ROOT);
  assert.match(withAsk!.expanded, /o que é isso\?/, "trailing lines become the user's ask");
});

test.after(() => rmSync(ROOT, { recursive: true, force: true }));
