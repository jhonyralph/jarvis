/**
 * "@" file search, "!" bash injection, and "#" memory append. All operate on a throwaway temp dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMentionFiles } from "./mentions.js";
import { expandBang, appendMemory, applyMemoryAppend, MemoryProvenanceStore, previewMemoryAppend } from "./triggers.js";

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

test("memory preview is side-effect free and stale previews fail closed", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-memory-preview-"));
  try {
    const preview = previewMemoryAppend("# regra nova", d, "codex");
    assert.equal(existsSync(preview.file), false);
    assert.match(preview.appendText, /- regra nova/);
    const applied = applyMemoryAppend(preview);
    assert.match(readFileSync(applied.file, "utf8"), /- regra nova/);

    const stale = previewMemoryAppend("outra regra", d, "codex");
    writeFileSync(stale.file, readFileSync(stale.file, "utf8") + "mudança externa\n");
    assert.throws(() => applyMemoryAppend(stale), /mudou depois da prévia/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("memory provenance records hashes and actor metadata without note contents", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-memory-audit-"));
  try {
    const audit = new MemoryProvenanceStore(d);
    audit.append({ at: 1, runnerId: "local", userId: "u1", deviceId: "d1", cwd: d, target: "AGENTS.md", beforeHash: "a", afterHash: "b", noteHash: "c" });
    const raw = readFileSync(audit.path, "utf8");
    assert.match(raw, /"userId":"u1"/);
    assert.doesNotMatch(raw, /regra secreta/);
  } finally { rmSync(d, { recursive: true, force: true }); }
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
