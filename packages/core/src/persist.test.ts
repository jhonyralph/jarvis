import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, readJson, jsonExists } from "./persist.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "jarvis-persist-"));
}

test("round-trips an object", () => {
  const dir = tmp();
  try {
    const f = join(dir, "a.json");
    writeJsonAtomic(f, { hello: "world", n: 1 });
    assert.deepEqual(readJson(f, null), { hello: "world", n: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("creates the parent directory if missing", () => {
  const dir = tmp();
  try {
    const f = join(dir, "nested", "deep", "b.json");
    writeJsonAtomic(f, [1, 2, 3]);
    assert.deepEqual(readJson(f, null), [1, 2, 3]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("leaves no .tmp file behind", () => {
  const dir = tmp();
  try {
    const f = join(dir, "c.json");
    writeJsonAtomic(f, { ok: true });
    assert.equal(existsSync(f + ".tmp"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a corrupt primary file falls back to the .bak snapshot", () => {
  const dir = tmp();
  try {
    const f = join(dir, "d.json");
    writeJsonAtomic(f, { v: 1 });          // first good write (no .bak yet)
    writeJsonAtomic(f, { v: 2 });          // second write snapshots v:1 into .bak, primary now v:2
    assert.deepEqual(readJson(f, null), { v: 2 });
    writeFileSync(f, "{ this is not valid json");  // simulate a torn/corrupt primary
    assert.deepEqual(readJson(f, null), { v: 1 }, "should recover the last backup");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a corrupt primary with no backup returns the caller default (never throws)", () => {
  const dir = tmp();
  try {
    const f = join(dir, "e.json");
    writeFileSync(f, "garbage");
    assert.deepEqual(readJson(f, { fallback: true }), { fallback: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("backup:false skips the .bak copy", () => {
  const dir = tmp();
  try {
    const f = join(dir, "f.json");
    writeJsonAtomic(f, { v: 1 }, { backup: false });
    writeJsonAtomic(f, { v: 2 }, { backup: false });
    assert.equal(existsSync(f + ".bak"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pretty option indents the output", () => {
  const dir = tmp();
  try {
    const f = join(dir, "g.json");
    writeJsonAtomic(f, { a: 1 }, { pretty: true });
    assert.ok(readFileSync(f, "utf8").includes("\n  "), "pretty output should contain indented newlines");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("jsonExists sees primary or backup", () => {
  const dir = tmp();
  try {
    const f = join(dir, "h.json");
    assert.equal(jsonExists(f), false);
    writeJsonAtomic(f, { v: 1 });
    assert.equal(jsonExists(f), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
