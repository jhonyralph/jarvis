/** Validator: frontmatter contract + limits; our starter pack validates clean. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateFramework } from "./framework-validate.js";
import type { FrameworkFile } from "./framework.js";
import { readCanonicalFramework, installFrameworkStarterPack } from "./framework.js";

const file = (path: string, content: string): FrameworkFile => ({ path, content });

test("a well-formed skill validates with no errors", () => {
  const r = validateFramework([file("skills/review/SKILL.md", "---\nname: review\ndescription: Reviews code.\n---\nBody.")]);
  assert.equal(r.ok, true);
  assert.equal(r.errors, 0);
});

test("missing name/description are errors", () => {
  const r = validateFramework([file("skills/x/SKILL.md", "---\ndescription:\n---\nBody.")]);
  assert.ok(r.errors >= 2);
  assert.ok(r.issues.some((i) => i.field === "name"));
  assert.ok(r.issues.some((i) => i.field === "description"));
});

test("name limits: length, charset and reserved words", () => {
  const long = validateFramework([file("skills/x/SKILL.md", `---\nname: ${"a".repeat(65)}\ndescription: ok\n---\n`)]);
  assert.ok(long.issues.some((i) => i.field === "name" && /máx 64/.test(i.message)));
  const bad = validateFramework([file("skills/x/SKILL.md", "---\nname: Bad Name\ndescription: ok\n---\n")]);
  assert.ok(bad.issues.some((i) => i.field === "name" && /minúsculas/.test(i.message)));
  const reserved = validateFramework([file("skills/x/SKILL.md", "---\nname: claude-helper\ndescription: ok\n---\n")]);
  assert.ok(reserved.issues.some((i) => i.field === "name" && /reservad/.test(i.message)));
});

test("duplicate skill names are an error", () => {
  const r = validateFramework([
    file("skills/a/SKILL.md", "---\nname: dup\ndescription: A.\n---\n"),
    file("skills/b/SKILL.md", "---\nname: dup\ndescription: B.\n---\n"),
  ]);
  assert.ok(r.issues.some((i) => /duplicado/.test(i.message)));
  assert.equal(r.ok, false);
});

test("command without description warns but does not block", () => {
  const r = validateFramework([file("commands/x.md", "Just do $ARGUMENTS.")]);
  assert.equal(r.ok, true);
  assert.ok(r.issues.some((i) => i.level === "warn" && i.field === "description"));
});

test("broken one-level reference warns", () => {
  const r = validateFramework([file("skills/x/SKILL.md", "---\nname: x\ndescription: ok\n---\nSee [more](REFERENCE.md).")]);
  assert.ok(r.issues.some((i) => i.field === "reference"));
  // present reference does not warn
  const ok = validateFramework([
    file("skills/x/SKILL.md", "---\nname: x\ndescription: ok\n---\nSee [more](reference.md)."),
    file("skills/x/reference.md", "content"),
  ]);
  assert.ok(!ok.issues.some((i) => i.field === "reference"));
});

test("out-of-scope path is an error", () => {
  const r = validateFramework([file("secrets/keys.md", "x")]);
  assert.ok(r.issues.some((i) => /fora do escopo/.test(i.message)));
  assert.equal(r.ok, false);
});

test("the shipped starter pack validates clean (0 errors)", () => {
  const root = mkdtempSync(join(tmpdir(), "jf-val-"));
  try {
    installFrameworkStarterPack(root);
    const files = readCanonicalFramework(root).files;
    const r = validateFramework(files);
    assert.equal(r.errors, 0, `starter pack must validate: ${JSON.stringify(r.issues.filter((i) => i.level === "error"))}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
