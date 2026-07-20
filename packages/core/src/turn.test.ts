import test from "node:test";
import assert from "node:assert/strict";
import { buildTurnAttachments, imageDataUrl, runManagedTurn, touchedFilesFromMessages, type TurnStoredMessage } from "./index.js";

test("managed lifecycle persists the same rich user and assistant history", async () => {
  const stored: TurnStoredMessage[] = [], broadcast: unknown[] = [];
  await runManagedTurn({
    ensure: () => ({ agent: "gemini", cwd: "/repo" }), resolveAgentName: (x) => x,
    add: (_sid, msg) => stored.push(msg), broadcast: (_sid, msg) => broadcast.push(msg),
    pushSessions: () => {}, now: (() => { let n = 10; return () => ++n; })(), speak: async () => {},
    runAgentTurn: async () => ({ text: "feito", activity: [{ kind: "tool", name: "Bash" }], usage: { inputTokens: 4, costKind: "tokens_only", source: "fixture" } }),
  }, "s1", { showText: "olá", agentText: "contexto\nolá", images: ["data:image/png;base64,eA=="], files: [{ name: "a.txt", content: "x" }], onError: assert.fail });
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0].images, ["data:image/png;base64,eA=="]);
  assert.equal(stored[1].activity?.length, 1);
  assert.equal(stored[1].usage?.costKind, "tokens_only");
  assert.equal(broadcast.length, 1);
});

test("budget block and duplicate turn do not persist a phantom user message", async () => {
  let adds = 0, runs = 0, errors = 0;
  const base = { ensure: () => ({ agent: "codex", cwd: "/repo" }), resolveAgentName: (x: string) => x, add: () => { adds++; }, broadcast: () => {}, pushSessions: () => {}, now: Date.now, speak: async () => {}, runAgentTurn: async () => { runs++; return { text: "x" }; } };
  await runManagedTurn({ ...base, checkBudget: () => ({ blocked: true, message: "limite" }) }, "s", { showText: "x", onError: () => { errors++; } });
  await runManagedTurn({ ...base, seen: () => false }, "s", { showText: "x", turnId: "dup", onError: assert.fail });
  assert.deepEqual({ adds, runs, errors }, { adds: 0, runs: 0, errors: 1 });
});

test("attachment builder preserves text files and turns images into readable paths/previews", () => {
  const built = buildTurnAttachments([{ name: "a.txt", content: "abc" }, { name: "pic.png", content: Buffer.from("x").toString("base64"), image: true }], "pergunta", {
    saveImage: () => "/tmp/pic.png", previewImage: (name, bytes) => imageDataUrl(name, bytes),
  });
  assert.match(built.agentText, /arquivo anexado: a\.txt/);
  assert.match(built.agentText, /\/tmp\/pic\.png/);
  assert.equal(built.showText, "pergunta");
  assert.match(built.images?.[0] || "", /^data:image\/png;base64,/);
  assert.equal(built.files?.[0].content, "abc");
});

test("Files menu is rebuilt provider-neutrally and does not double-count tool lifecycle events", () => {
  const files = touchedFilesFromMessages([{ activity: [
    { kind: "tool_started", eventId: "e1", tool: { callId: "p1", name: "Edit", path: "src/a.ts", adds: 0, dels: 0, status: "running" } },
    { kind: "tool_completed", eventId: "e2", tool: { callId: "p1", name: "Edit", path: "src/a.ts", adds: 3, dels: 1, status: "completed" } },
    { kind: "tool_completed", eventId: "e3", tool: { callId: "w1", name: "Write", path: "src/new.ts", adds: 2, dels: 0, status: "completed" } },
    { kind: "tool", toolId: "r1", name: "Read", path: "README.md", status: "completed" },
  ] }]);
  assert.deepEqual(files.find((f) => f.path === "src/a.ts"), { path: "src/a.ts", action: "edit", adds: 3, dels: 1 });
  assert.deepEqual(files.find((f) => f.path === "src/new.ts"), { path: "src/new.ts", action: "write", adds: 2, dels: 0 });
  assert.deepEqual(files.find((f) => f.path === "README.md"), { path: "README.md", action: "read", adds: 0, dels: 0 });
});
