import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";

const DEF = { agent: "mock", cwd: "/work" };
function dir(): string { return mkdtempSync(join(tmpdir(), "jarvis-store-")); }

test("ensure creates a session with the default agent/cwd and persists it", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.ensure("a");
    assert.equal(s.get("a")?.agent, "mock");
    assert.equal(s.get("a")?.cwd, "/work");
    // a fresh Store on the same dir reloads it from disk
    const s2 = new Store(DEF, d);
    assert.ok(s2.get("a"), "session should survive a reload");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("add auto-titles from the first user message and bumps count", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    const title = "Consertar o login quebrado no mobile com um titulo longo o suficiente para nao ser cortado no cabecalho\nmantendo o restante legivel";
    s.add("x", { role: "user", text: title, ts: 1 });
    assert.equal(s.get("x")?.title, title.replace(/\s+/g, " ").trim());
    s.add("x", { role: "assistant", text: "feito", ts: 2 });
    assert.equal(s.list()[0].count, 2);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("reconfigure is allowed only while the session has no messages (locked rule)", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.ensure("y", { agent: "mock", cwd: "/a" });
    assert.equal(s.reconfigure("y", { agent: "claude-code", cwd: "/b" }), true);
    assert.equal(s.get("y")?.agent, "claude-code");
    s.add("y", { role: "user", text: "oi", ts: 1 });
    assert.equal(s.reconfigure("y", { agent: "codex" }), false, "must refuse after a message exists");
    assert.equal(s.get("y")?.agent, "claude-code");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("dropLastUser removes a trailing user turn, but never an assistant reply", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.add("z", { role: "user", text: "primeira", ts: 1 });
    assert.equal(s.dropLastUser("z"), true);
    assert.equal(s.history("z").length, 0);
    s.add("z", { role: "user", text: "q", ts: 2 });
    s.add("z", { role: "assistant", text: "a", ts: 3 });
    assert.equal(s.dropLastUser("z"), false, "last is an assistant reply — no-op");
    assert.equal(s.history("z").length, 2);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("delete removes the session permanently", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.ensure("k");
    assert.equal(s.delete("k"), true);
    assert.equal(s.get("k"), undefined);
    assert.equal(s.delete("k"), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("list and digest are ordered newest-first by updatedAt", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.add("old", { role: "user", text: "velho", ts: 100 });
    s.add("new", { role: "user", text: "novo", ts: 200 });
    assert.deepEqual(s.list().map((x) => x.id), ["new", "old"]);
    assert.equal(s.digest(1)[0].id, "new");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("hidden managed sessions persist but stay out of ordinary list and digest", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.ensure("hidden-1", { hidden: true, rootExecutionId: "root-1", executionId: "child-1" });
    s.add("hidden-1", { role: "user", text: "interno", ts: 1 });
    assert.equal(s.isHidden("hidden-1"), true); assert.equal(s.history("hidden-1").length, 1);
    assert.equal(s.list().some((item) => item.id === "hidden-1"), false);
    assert.equal(s.digest().some((item) => item.id === "hidden-1"), false);
    const reopened = new Store(DEF, d);
    assert.equal(reopened.isHidden("hidden-1"), true); assert.equal(reopened.list().length, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a corrupt sessions.json recovers from the .bak snapshot instead of wiping history", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.add("keep", { role: "user", text: "não me perca", ts: 1 }); // first write (creates the file)
    s.add("keep", { role: "assistant", text: "ok", ts: 2 });      // second write snapshots the first into .bak
    // simulate a torn primary file (the exact crash-during-write scenario)
    writeFileSync(join(d, "sessions.json"), '{ "keep": { "id": "keep", ');
    const recovered = new Store(DEF, d);
    assert.ok(recovered.get("keep"), "must recover the session from .bak, not fall to empty");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("messages persist to a per-session JSONL, NOT inlined into sessions.json", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.add("s1", { role: "user", text: "oi", ts: 1 });
    s.add("s1", { role: "assistant", text: "olá", ts: 2 });
    // sessions.json holds metadata only — no message bodies
    const meta = JSON.parse(readFileSync(join(d, "sessions.json"), "utf8"));
    assert.equal(meta.s1.messages, undefined, "sessions.json must not carry inline messages anymore");
    assert.ok(existsSync(join(d, "sessions", "s1.jsonl")), "history goes to sessions/<id>.jsonl");
    // and a reload rebuilds the full history from the JSONL
    const reopened = new Store(DEF, d);
    assert.equal(reopened.history("s1").length, 2);
    assert.equal(reopened.history("s1")[1].text, "olá");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("migrates a legacy sessions.json (inline messages) into per-session JSONL on load", () => {
  const d = dir();
  try {
    // hand-write the OLD format: messages inlined in sessions.json
    const legacy = {
      old: { id: "old", title: "Antiga", agent: "mock", cwd: "/w", createdAt: 1, updatedAt: 3,
        messages: [ { role: "user", text: "pergunta", ts: 1 }, { role: "assistant", text: "resposta", ts: 3 } ] },
    };
    writeFileSync(join(d, "sessions.json"), JSON.stringify(legacy));
    const s = new Store(DEF, d);
    assert.equal(s.history("old").length, 2, "legacy history must load");
    assert.equal(s.list()[0].count, 2);
    // migration stripped the inline messages and wrote the JSONL
    const meta = JSON.parse(readFileSync(join(d, "sessions.json"), "utf8"));
    assert.equal(meta.old.messages, undefined, "inline messages must be stripped after migration");
    assert.ok(existsSync(join(d, "sessions", "old.jsonl")), "migrated history file must exist");
    // idempotent: a second load (now new format) keeps exactly the same history, no duplication
    const again = new Store(DEF, d);
    assert.equal(again.history("old").length, 2, "re-load must not duplicate migrated messages");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("deleting a session removes its history file too", () => {
  const d = dir();
  try {
    const s = new Store(DEF, d);
    s.add("gone", { role: "user", text: "x", ts: 1 });
    assert.ok(existsSync(join(d, "sessions", "gone.jsonl")));
    s.delete("gone");
    assert.equal(existsSync(join(d, "sessions", "gone.jsonl")), false, "history file must be removed on delete");
  } finally { rmSync(d, { recursive: true, force: true }); }
});
