import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cosine, MemoryStore, type MemoryEntry } from "./memory.js";

test("cosine: identical vectors = 1, orthogonal = 0, opposite = -1", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([0, 0], [1, 1]), 0, "zero vector → 0, no NaN");
});

function entry(id: string, vec: number[], over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { id, sessionId: id, text: "s " + id, ts: 1, vec, ...over };
}

test("search ranks by cosine and respects topK", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    const m = new MemoryStore(d);
    m.upsert(entry("a", [1, 0, 0]));
    m.upsert(entry("b", [0.9, 0.1, 0]));
    m.upsert(entry("c", [0, 1, 0]));
    const hits = m.search([1, 0, 0], { topK: 2 });
    assert.deepEqual(hits.map((h) => h.id), ["a", "b"], "closest first");
    assert.ok(hits[0].score >= hits[1].score);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("upsert replaces by id; removeSession drops entries", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    const m = new MemoryStore(d);
    m.upsert(entry("a", [1, 0]));
    m.upsert(entry("a", [0, 1]));           // replace
    assert.equal(m.size(), 1);
    assert.deepEqual(m.search([0, 1], { topK: 1 })[0].vec, [0, 1]);
    m.removeSession("a");
    assert.equal(m.size(), 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("filters by cwd and agent", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    const m = new MemoryStore(d);
    m.upsert(entry("a", [1, 0], { cwd: "/x", agent: "claude-code" }));
    m.upsert(entry("b", [1, 0], { cwd: "/y", agent: "codex" }));
    assert.deepEqual(m.search([1, 0], { cwd: "/x" }).map((h) => h.id), ["a"]);
    assert.deepEqual(m.search([1, 0], { agent: "codex" }).map((h) => h.id), ["b"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("minScore filters weak matches", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    const m = new MemoryStore(d);
    m.upsert(entry("a", [1, 0]));
    m.upsert(entry("c", [0, 1]));
    assert.deepEqual(m.search([1, 0], { minScore: 0.5 }).map((h) => h.id), ["a"], "orthogonal excluded");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("persists across reload", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    new MemoryStore(d).upsertMany([entry("a", [1, 0]), entry("b", [0, 1])]);
    assert.equal(new MemoryStore(d).size(), 2);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
