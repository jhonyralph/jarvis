import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectFile } from "./files.js";

test("readProjectFile displays text files that contain NUL escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-files-"));
  try {
    const p = join(dir, "app.js");
    writeFileSync(p, Buffer.from("const sep = '\0';\nconsole.log(sep);\n", "utf8"));
    const out = readProjectFile(p);
    assert.equal(out.error, undefined);
    assert.equal(out.name, "app.js");
    assert.equal(typeof out.mtimeMs, "number");
    assert.match(out.content || "", /'\\0'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readProjectFile still refuses binary files with many NUL bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-files-"));
  try {
    const p = join(dir, "blob.bin");
    writeFileSync(p, Buffer.from([0, 1, 2, 0, 3, 4, 0, 5, 6, 0]));
    const out = readProjectFile(p);
    assert.match(out.error || "", /arquivo binário/);
    assert.equal(out.content, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
