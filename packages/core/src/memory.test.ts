import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("legacy remote ids recover their runner partition before any reindex", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    writeFileSync(join(d, "memory.json"), JSON.stringify([{ id: "runner:machine-2:session-9", sessionId: "session-9", cwd: "/repo", text: "legacy", ts: 1, vec: [1, 0] }]));
    const m = new MemoryStore(d);
    assert.deepEqual(m.search([1, 0], { runnerIds: ["local"] }), []);
    assert.deepEqual(m.search([1, 0], { runnerIds: ["machine-2"] }).map((hit) => [hit.sessionId, hit.runnerId]), [["session-9", "machine-2"]]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("classifies personal topics without changing their scope while retaining the project partition", () => {
  const recipe = classifyMemoryText({ text: "Receita de bolo com farinha e forno", cwd: "C:/repo/jarvis" });
  assert.equal(recipe.scope, "personal");
  assert.equal(recipe.topic, "recipe");
  assert.ok(recipe.namespaces.includes("topic:recipe"));
  assert.equal(recipe.projectKey, "c:/repo/jarvis");
  assert.ok(recipe.namespaces.includes("project:c:/repo/jarvis"));

  const sports = classifyMemoryText({ text: "placar do jogo de futebol" });
  assert.equal(sports.scope, "personal");
  assert.equal(sports.topic, "sports");
});

test("search isolates identical vectors by runner, project and private owner", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    const m = new MemoryStore(d);
    m.upsert(entry("local-a", [1, 0], { runnerId: "local", cwd: "/repo/a", text: "Receita privada do projeto A", ownerId: "alice" }));
    m.upsert(entry("local-b", [1, 0], { runnerId: "local", cwd: "/repo/b", text: "Fix API no projeto B" }));
    m.upsert(entry("remote-a", [1, 0], { runnerId: "runner-2", cwd: "/repo/a", text: "Fix API no projeto A" }));

    assert.deepEqual(m.search([1, 0], { runnerIds: ["local"], projectKey: "/repo/a", principalId: "alice" }).map((h) => h.id), ["local-a"]);
    assert.deepEqual(m.search([1, 0], { runnerIds: ["local"], projectKey: "/repo/a", principalId: "bob" }), [], "another principal cannot read a private note");
    assert.deepEqual(m.search([1, 0], { runnerIds: ["runner-2"], projectKey: "/repo/a", principalId: "alice" }).map((h) => h.id), ["remote-a"]);
    assert.deepEqual(m.search([1, 0], { runnerIds: [] }), [], "an empty authorization set must fail closed");
    assert.equal(m.stats({ runnerIds: ["local"], principalId: "bob" }).total, 1, "stats use the same authorization boundary as search");
    assert.equal(m.stats({ runnerIds: ["local"], principalId: "alice", projectKey: "/repo/a" }).total, 1, "project stats do not reveal neighboring projects");
    assert.equal(m.stats({ runnerIds: [], principalId: "alice" }).total, 0, "stats also fail closed with no authorized runner");
  } finally { rmSync(d, { recursive: true, force: true }); }
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

test("memory stats and project prefixes support monorepo partitions", () => {
  const d = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  try {
    const m = new MemoryStore(d);
    m.upsert(entry("core", [1, 0], { text: "Fix test in TypeScript package", cwd: "/repo/packages/core", ts: 10 }));
    m.upsert(entry("web", [1, 0], { text: "Fix frontend component test", cwd: "/repo/apps/web", ts: 20 }));
    m.upsert(entry("recipe", [1, 0], { text: "Receita de bolo", cwd: "/repo/apps/web", ts: 30 }));

    assert.deepEqual(m.search([1, 0], { projectPrefix: "/repo/packages" }).map((h) => h.id), ["core"]);
    const stats = m.stats();
    assert.equal(stats.total, 3);
    assert.equal(stats.byScope.project, 2);
    assert.equal(stats.byTopic.recipe, 1);
    assert.deepEqual(stats.projects.map((p) => p.projectKey).sort(), ["/repo/apps/web", "/repo/packages/core"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
