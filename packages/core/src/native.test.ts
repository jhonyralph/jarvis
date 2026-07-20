/**
 * Golden tests for the native-transcript parsers — the highest-risk code in the project, because
 * it reverse-engineers the on-disk JSONL formats of the Claude/Codex CLIs. These lock the format
 * contract in place: if an upstream change (or an accidental refactor) breaks parsing, THESE fail
 * loudly instead of the app silently showing empty titles / missing diffs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterUnboundNativeSessions, parseNativeEvents, lineDiff, editCounts, toolFileStat } from "./native.js";

const TS = "2024-06-01T10:00:00.000Z";
const claudeLine = (o: object) => JSON.stringify({ timestamp: TS, ...o });

test("parseNativeEvents: claude assistant text → one message event", () => {
  const ev = parseNativeEvents(claudeLine({ type: "assistant", message: { content: [{ type: "text", text: "Olá, mundo" }] } }), true);
  assert.equal(ev.length, 1);
  assert.deepEqual({ kind: ev[0].kind, role: (ev[0] as any).role, text: (ev[0] as any).text }, { kind: "message", role: "assistant", text: "Olá, mundo" });
});

test("parseNativeEvents: claude user text → one user message event", () => {
  const ev = parseNativeEvents(claudeLine({ type: "user", message: { content: "faça o deploy" } }), true);
  assert.equal(ev.length, 1);
  assert.equal((ev[0] as any).role, "user");
  assert.equal((ev[0] as any).text, "faça o deploy");
});

test("parseNativeEvents: injected user content (system reminder) is dropped", () => {
  const ev = parseNativeEvents(claudeLine({ type: "user", message: { content: "<task-notification>ping</task-notification>" } }), true);
  assert.deepEqual(ev, []);
});

test("parseNativeEvents: claude tool_use Edit → tool event with path + line counts", () => {
  const ev = parseNativeEvents(claudeLine({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/repo/src/a.ts", old_string: "const a = 1", new_string: "const a = 2" } }] },
  }), true);
  assert.equal(ev.length, 1);
  const t = ev[0] as any;
  assert.equal(t.kind, "tool");
  assert.equal(t.name, "Edit");
  assert.equal(t.path, "/repo/src/a.ts");
  assert.equal(t.summary, "Editando a.ts");
  assert.equal(t.adds, 1);
  assert.equal(t.dels, 1);
});

test("parseNativeEvents: codex response_item message → message event", () => {
  const ev = parseNativeEvents(JSON.stringify({ type: "response_item", timestamp: TS, payload: { type: "message", role: "assistant", content: "resposta do codex" } }), false);
  assert.equal(ev.length, 1);
  assert.equal((ev[0] as any).role, "assistant");
  assert.equal((ev[0] as any).text, "resposta do codex");
});

test("parseNativeEvents: codex command + web search survive native tail", () => {
  const cmd = parseNativeEvents(JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "c", input: "npm test" } }), false)[0] as any;
  assert.equal(cmd.name, "Bash"); assert.match(cmd.summary, /npm test/);
  const web = parseNativeEvents(JSON.stringify({ type: "event_msg", payload: { type: "web_search_end", query: "official docs" } }), false)[0] as any;
  assert.equal(web.name, "WebSearch");
});

test("parseNativeEvents: codex patch preserves path, counts and inline rows", () => {
  const [event] = parseNativeEvents(JSON.stringify({ type: "event_msg", payload: { type: "patch_apply_end", changes: { "C:\\repo\\a.ts": { type: "update", unified_diff: "@@ -1 +1 @@\n-old\n+new" } } } }), false) as any[];
  assert.equal(event.name, "Edit"); assert.equal(event.path, "C:\\repo\\a.ts");
  assert.equal(event.adds, 1); assert.equal(event.dels, 1); assert.equal(event.rows.length, 3);
});

test("parseNativeEvents: malformed JSON line → [] (never throws)", () => {
  assert.deepEqual(parseNativeEvents("{ this is not json", true), []);
  assert.deepEqual(parseNativeEvents("", false), []);
});

test("parseNativeEvents: a non-message codex line (turn_context) yields nothing", () => {
  assert.deepEqual(parseNativeEvents(JSON.stringify({ type: "turn_context", payload: { model: "gpt-5", effort: "high" } }), false), []);
});

test("lineDiff: marks context, deletions and additions", () => {
  const rows = lineDiff("a\nb\nc", "a\nB\nc");
  assert.deepEqual(rows, [
    { t: " ", s: "a" },
    { t: "-", s: "b" },
    { t: "+", s: "B" },
    { t: " ", s: "c" },
  ]);
});

test("editCounts: counts added and removed lines", () => {
  assert.deepEqual(editCounts("um\ndois", "um\ndois\ntres"), { adds: 1, dels: 0 });
  assert.deepEqual(editCounts("a\nb", "b"), { adds: 0, dels: 1 });
});

test("toolFileStat: Edit returns path, counts and diff rows", () => {
  const st = toolFileStat("Edit", { file_path: "/x/y.ts", old_string: "foo", new_string: "bar" });
  assert.equal(st.path, "/x/y.ts");
  assert.equal(st.adds, 1);
  assert.equal(st.dels, 1);
  assert.ok(Array.isArray(st.rows));
});

test("toolFileStat: Write counts every line as an addition", () => {
  const st = toolFileStat("Write", { file_path: "/x/new.ts", content: "l1\nl2\nl3" });
  assert.equal(st.path, "/x/new.ts");
  assert.equal(st.adds, 3);
  assert.equal(st.dels, 0);
});

test("toolFileStat: MultiEdit aggregates counts across edits", () => {
  const st = toolFileStat("MultiEdit", {
    file_path: "/x/z.ts",
    edits: [
      { old_string: "a", new_string: "a\nb" },  // +1
      { old_string: "c\nd", new_string: "c" },   // -1
    ],
  });
  assert.equal(st.path, "/x/z.ts");
  assert.equal(st.adds, 1);
  assert.equal(st.dels, 1);
});

test("filterUnboundNativeSessions hides provider transcripts already bound to managed sessions", () => {
  const native = [
    { id: "claude:native-1", title: "backing transcript" },
    { id: "codex:native-2", title: "standalone codex" },
    { id: "managed-3", title: "accidental exact duplicate" },
  ];
  const managed = [
    { id: "managed-1", native: "claude:native-1" },
    { id: "managed-3", native: null },
  ];

  assert.deepEqual(
    filterUnboundNativeSessions(native, managed, (s) => s.native).map((s) => s.id),
    ["codex:native-2"],
  );
});
