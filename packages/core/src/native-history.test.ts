/**
 * nativeHistory grouping: a native (claude) session's history must reconstruct the SAME grouped,
 * per-turn activity the live stream and a managed session show — one assistant message per turn
 * carrying its tools in an `activity` array — NOT a flat list of separate role:"tool" messages.
 *
 * native.ts reads ~/.claude by default; it honors JARVIS_CLAUDE_DIR / JARVIS_HOME (set here before
 * import) so we can point it at a throwaway fixture. node --test runs each file in its own process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "jarvis-nat-"));
const CLAUDE = join(HOME, "claude-projects");
mkdirSync(join(CLAUDE, "proj"), { recursive: true });
process.env.JARVIS_CLAUDE_DIR = CLAUDE;
process.env.JARVIS_HOME = HOME;

const UUID = "11111111-2222-3333-4444-555555555555";
// One logical turn = user prompt → assistant(text + tool_use) → injected tool_result → assistant(final
// text). The two assistant text blocks belong to the SAME turn (the tool_result user is mid-turn, not
// a boundary). Then a SECOND real user prompt opens a new turn.
const lines = [
  { type: "user", uuid: "u1", timestamp: "2026-07-19T12:00:00Z", cwd: "/repo", message: { role: "user", content: "edite o foo" } },
  { type: "assistant", uuid: "a1", parentUuid: "u1", isSidechain: false, timestamp: "2026-07-19T12:00:01Z", message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 10 }, content: [
    { type: "text", text: "Vou editar. " },
    { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/repo/foo.ts", old_string: "a", new_string: "b" } },
  ] } },
  { type: "user", uuid: "u2", parentUuid: "a1", timestamp: "2026-07-19T12:00:02Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
  { type: "assistant", uuid: "a2", parentUuid: "u2", isSidechain: false, timestamp: "2026-07-19T12:00:03Z", message: { role: "assistant", content: [{ type: "text", text: "Pronto, editei foo.ts." }] } },
  { type: "user", uuid: "u3", parentUuid: "a2", timestamp: "2026-07-19T12:00:04Z", message: { role: "user", content: "e agora rode os testes" } },
  { type: "assistant", uuid: "a3", parentUuid: "u3", isSidechain: false, timestamp: "2026-07-19T12:00:05Z", message: { role: "assistant", content: [
    { type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test" } },
  ] } },
];
writeFileSync(join(CLAUDE, "proj", `${UUID}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

const { nativeHistory } = await import("./native.js");

test("native history groups each turn's tools into the assistant message's activity", () => {
  const h = nativeHistory(`claude:${UUID}`);
  assert.ok(h, "history reconstructed");
  // No flat role:"tool" messages remain — tools live inside the assistant turn now.
  assert.equal(h.messages.some((m) => m.role === "tool"), false, "no flat tool messages");
  // Two turns: user, assistant(grouped), user, assistant(grouped).
  assert.deepEqual(h.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);

  const turn1 = h.messages[1];
  // Both assistant text blocks of turn 1 accumulate into one answer.
  assert.match(turn1.text, /Vou editar/);
  assert.match(turn1.text, /Pronto, editei foo\.ts/);
  assert.ok(turn1.activity && turn1.activity.length === 1, "turn 1 has one tool activity event");
  const edit = turn1.activity![0];
  assert.equal(edit.kind, "tool");
  assert.equal(edit.name, "Edit");
  assert.equal(edit.path, "/repo/foo.ts", "file path is reconstructed for the tool");
  assert.ok((edit.adds ?? 0) >= 0 && (edit.dels ?? 0) >= 0, "diff counts computed");

  const turn2 = h.messages[3];
  assert.ok(turn2.activity && turn2.activity.length === 1 && turn2.activity[0].name === "Bash", "turn 2 groups its Bash tool");
  // real model is surfaced (last non-synthetic assistant model)
  assert.equal(h.model, "claude-opus-4-8");
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));
