import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "jarvis-codex-activity-"));
process.env.JARVIS_CODEX_DIR = join(root, "sessions");
process.env.JARVIS_CLAUDE_DIR = join(root, "claude");
process.env.JARVIS_HOME = root;
mkdirSync(process.env.JARVIS_CODEX_DIR, { recursive: true });
test.after(() => rmSync(root, { recursive: true, force: true }));
const { codexItemToEvents, codexPatchEventsFromLines, codexActivityEventsFromLines } = await import("./agents.js");
const { parseNativeEvents, nativeHistory, sessionFiles, sessionFileDiff } = await import("./native.js");
const { parseCodexChildRollout } = await import("./codex-executions.js");

// Shapes captured from Codex 0.154.0 rollouts (2026-11-04); paths/content anonymized.
const command = {
  type: "CommandExecution", id: "exec-read", command: ["pwsh.exe", "-Command", "Get-Content -Raw -LiteralPath 'src/a.ts'"],
  cwd: "file:///C:/repo", parsed_cmd: [{ type: "read", cmd: "Get-Content -Raw -LiteralPath 'src/a.ts'", name: "a.ts", path: "C:/repo/src/a.ts" }],
  status: "completed", exit_code: 0, stdout: "source contents", aggregated_output: "source contents",
};
const patch = { type: "FileChange", id: "exec-patch", status: "completed", changes: {
  "C:/repo/src/a.ts": { type: "update", unified_diff: "@@ -1 +1,2 @@\n-old\n+new\n+extra", move_path: null },
  "C:/repo/src/new.ts": { type: "add", content: "one\ntwo\n" },
} };
const row = (item: unknown) => ({ timestamp: "2026-11-04T12:00:00Z", type: "event_msg", payload: { type: "item_completed", item } });
const line = (item: unknown) => JSON.stringify(row(item));

test("current Codex items preserve read path and per-file diffs across stdout and native tail", () => {
  const read = codexItemToEvents(command, true).events[0];
  assert.equal(read?.name, "Read");
  assert.equal(read.path, "C:/repo/src/a.ts");
  assert.equal(read.status, "completed");
  assert.doesNotMatch(read.detail || "", /source contents/);
  const edits = codexItemToEvents(patch, true).events;
  assert.deepEqual(edits.map(e => [e.name, e.path, e.adds, e.dels]), [
    ["Edit", "C:/repo/src/a.ts", 2, 1], ["Write", "C:/repo/src/new.ts", 2, 0],
  ]);
  assert.deepEqual(edits[0].rows, [{ t: "@", s: "@@ -1 +1,2 @@" }, { t: "-", s: "old" }, { t: "+", s: "new" }, { t: "+", s: "extra" }]);
  assert.deepEqual(parseNativeEvents(line(command), false).map(e => [e.kind, (e as any).name, (e as any).path]), [["tool", "Read", "C:/repo/src/a.ts"]]);
  assert.deepEqual(parseNativeEvents(line(patch), false).map(e => [(e as any).path, (e as any).adds]), [["C:/repo/src/a.ts", 2], ["C:/repo/src/new.ts", 2]]);
  assert.equal(codexPatchEventsFromLines([line(patch)]).length, 2);
});

test("native reload and file panel recover current Codex activity, with repeated items counted once", () => {
  const id = "current-format";
  writeFileSync(join(process.env.JARVIS_CODEX_DIR!, `rollout-${id}.jsonl`), [
    { type: "session_meta", payload: { id, cwd: "C:/repo" } },
    { type: "response_item", payload: { type: "message", role: "user", content: "check files" } },
    row(command), row(patch), row(patch),
  ].map(r => JSON.stringify(r)).join("\n"));
  const hist = nativeHistory(`codex:${id}`)!;
  assert.deepEqual(hist.messages[1]?.activity?.map(e => e.name), ["Read", "Edit", "Write"]);
  assert.deepEqual(sessionFiles(`codex:${id}`), [
    { path: "C:/repo/src/a.ts", action: "edit", adds: 2, dels: 1 },
    { path: "C:/repo/src/new.ts", action: "write", adds: 2, dels: 0 },
  ]);
  assert.equal(sessionFileDiff(`codex:${id}`, "C:/repo/src/a.ts").rows?.length, 4);
});

test("child rollouts expose the same file activity only after the child's task starts", () => {
  const child = parseCodexChildRollout([
    JSON.stringify({ type: "session_meta", payload: { id: "child", parent_thread_id: "parent", thread_source: "subagent" } }),
    line({ ...patch, id: "forked-history" }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 1 } }),
    line(command), line(patch), line(patch),
  ])!;
  assert.deepEqual(child.activities.map(e => e.name), ["Read", "Edit", "Write"]);
  assert.equal(child.activities[1].adds, 2);
});

test("literal multi-file reads resolve cwd; scripts, variables and cwd changes never invent paths", () => {
  const events = (text: string) => codexItemToEvents({ ...command, parsed_cmd: [{ type: "unknown", cmd: text }], command: ["pwsh.exe", "-Command", text] }, true).events;
  assert.deepEqual(events("Get-Content 'src/a.ts'; Get-Content -LiteralPath 'src/b file.ts' -Raw | Select-Object -First 10").map(e => e.path), ["C:/repo/src/a.ts", "C:/repo/src/b file.ts"]);
  assert.equal(events('Write-Output "Get-Content secret.txt"')[0].name, "Bash");
  assert.equal(events("$code = @'\nGet-Content secret.txt\n'@; Write-Output $code")[0].name, "Bash");
  for (const text of ["Get-Content $path", "Get-Content *.ts", "Get-Content -Encoding utf8 src/a.ts", "cd elsewhere; Get-Content src/a.ts"]) {
    assert.ok(events(text).every(e => !e.path), text);
  }
  assert.equal(events("Get-Content -LiteralPath 'C:/repo/src/a.ts'")[0].path, "C:/repo/src/a.ts");
});

test("failed operations remain failures and never enter the touched-files panel", () => {
  const failed = { ...patch, id: "failed", status: "failed", stderr: "permission denied" };
  const ev = codexItemToEvents(failed, true).events[0];
  assert.equal(ev.status, "failed");
  assert.equal(ev.error, "permission denied");
  assert.equal(ev.name, "Tool", "legacy native UI must not inflect a failed attempt as Editado");
  assert.match(ev.summary || "", /falh/i);
  const negativeExit = codexItemToEvents({ ...command, exit_code: -1 }, true).events[0];
  assert.equal(negativeExit.status, "failed");
  writeFileSync(join(process.env.JARVIS_CODEX_DIR!, "rollout-failed-format.jsonl"), line(failed));
  assert.deepEqual(sessionFiles("codex:failed-format"), []);
});

test("large changes retain counts and full file-panel diff without inflating inline activity", () => {
  const big = { ...patch, id: "big", changes: { "C:/repo/large.ts": { type: "add", content: "line\n".repeat(400) } } };
  const ev = codexItemToEvents(big, true).events[0];
  assert.equal(ev.rows, undefined);
  assert.equal(ev.adds, 400);
  writeFileSync(join(process.env.JARVIS_CODEX_DIR!, "rollout-big-format.jsonl"), line(big));
  assert.equal(sessionFileDiff("codex:big-format", "C:/repo/large.ts").rows?.length, 400);
});

test("code-mode exec is not a shell command; recorded image and web tools are visible", () => {
  const [wrapper] = parseNativeEvents(JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "wrapper", input: 'text(await tools.exec_command({cmd:"Get-Content hidden.ts"}));' } }), false) as any[];
  assert.equal(wrapper.name, "exec"); assert.equal(wrapper.path, undefined);
  const [plainWrapper] = parseNativeEvents(JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: 'text("hello")' } }), false) as any[];
  assert.equal(plainWrapper.name, "exec");
  const [image] = parseNativeEvents(line({ type: "ImageView", id: "image", path: "file:///C:/repo/my%20image.png" }), false) as any[];
  assert.equal(image.name, "Read"); assert.equal(image.path, "C:/repo/my image.png");
  assert.equal(parseNativeEvents(line({ type: "Extension", kind: "web.search", id: "web", query: "docs" }), false)[0]?.kind, "tool");
});

test("malformed/future items, old turns and message/reasoning mirrors produce no invented tool", () => {
  for (const item of [null, {}, { type: "FileChange", changes: [null, 3] }, { type: "CommandExecution", command: null }, { type: "NewFutureType" }, { type: "AgentMessage", text: "already in response_item" }, { type: "Reasoning", text: "private" }]) {
    assert.deepEqual(codexActivityEventsFromLines([line(item)]), [], JSON.stringify(item));
  }
  assert.deepEqual(codexActivityEventsFromLines(["{invalid", line(patch)], Date.parse("2026-11-05T00:00:00Z")), []);
  const events = codexItemToEvents({ ...patch, changes: [{ path: "a.ts", kind: "modify", unified_diff: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n--- old\n+++ new" }] }, true).events;
  assert.equal(events[0].adds, 1); assert.equal(events[0].dels, 1);
});

test("file panel merges Windows separators and retains distinct edits of the same file", () => {
  const windows = { ...patch, changes: { "C:\\repo\\src\\a.ts": patch.changes["C:/repo/src/a.ts"] } };
  writeFileSync(join(process.env.JARVIS_CODEX_DIR!, "rollout-separators.jsonl"), [line(command), line(windows), line({ ...windows, id: "second-edit" }), line(command)].join("\n"));
  assert.deepEqual(sessionFiles("codex:separators"), [{ path: "C:/repo/src/a.ts", action: "edit", adds: 4, dels: 2 }]);
  assert.equal(sessionFileDiff("codex:separators", "C:\\repo\\src\\a.ts").adds, 4);
  const created = codexItemToEvents({ type: "file_change", changes: [{ path: "empty.ts", kind: "add", content: "" }] }, true).events[0];
  assert.equal(created.name, "Write"); assert.equal(created.adds, 0);
});

test("legacy child function call results retain their path and command metadata", () => {
  const child = parseCodexChildRollout([
    JSON.stringify({ type: "session_meta", payload: { id: "child", parent_thread_id: "parent", thread_source: "subagent" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "Read", call_id: "old-read", arguments: JSON.stringify({ file_path: "/repo/a.ts" }) } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "old-read", output: "contents" } }),
  ])!;
  assert.deepEqual(child.activities.map(e => [e.path, e.status]), [["/repo/a.ts", "started"], ["/repo/a.ts", "completed"]]);
});
