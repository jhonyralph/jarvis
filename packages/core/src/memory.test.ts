import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyMemoryText, cosine, MemoryStore, type MemoryEntry } from "./memory.js";

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

test("classifies personal topics without leaking them into project scope", () => {
  const recipe = classifyMemoryText({ text: "Receita de bolo com farinha e forno", cwd: "C:/repo/jarvis" });
  assert.equal(recipe.scope, "personal");
  assert.equal(recipe.topic, "recipe");
  assert.ok(recipe.namespaces.includes("topic:recipe"));
  assert.equal(recipe.projectKey, undefined);

  const sports = classifyMemoryText({ text: "placar do jogo de futebol" });
  assert.equal(sports.scope, "personal");
  assert.equal(sports.topic, "sports");
});

test("classifies project memories with normalized project keys", () => {
  const c = classifyMemoryText({ text: "Fix typecheck in packages core module", cwd: "C:\\Repo\\Jarvis\\packages\\core\\" });
  assert.equal(c.scope, "project");
  assert.equal(c.topic, "project");
  assert.equal(c.projectKey, "c:/repo/jarvis/packages/core");
  assert.ok(c.namespaces.includes("project:c:/repo/jarvis/packages/core"));
});

test("search can isolate namespaces even when vectors are similar", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    const m = new MemoryStore(d);
    m.upsert(entry("recipe", [1, 0], { text: "Receita de massa no forno", cwd: "/repo" }));
    m.upsert(entry("sports", [1, 0], { text: "Jogo de futebol do time", cwd: "/repo" }));
    m.upsert(entry("project", [1, 0], { text: "Fix API test in repo", cwd: "/repo/apps/api" }));

    assert.deepEqual(m.search([1, 0], { namespaces: ["topic:recipe"] }).map((h) => h.id), ["recipe"]);
    assert.deepEqual(m.search([1, 0], { scope: "project" }).map((h) => h.id), ["project"]);
    assert.deepEqual(m.search([1, 0], { projectKey: "/repo/apps/api" }).map((h) => h.id), ["project"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
