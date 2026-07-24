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
  normalizeFrameworkPreference, FRAMEWORK_PREFERENCES,
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
