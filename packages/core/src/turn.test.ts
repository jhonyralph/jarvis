import test from "node:test";
import assert from "node:assert/strict";
import { buildTurnAttachments, fileDiffFromMessages, imageDataUrl, runManagedTurn, touchedFilesFromMessages, type TurnStoredMessage } from "./index.js";

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

test("managed lifecycle uses one stable turn id for the manifest and provider invocation", async () => {
  const stored: TurnStoredMessage[] = []; let providerTurnId = "", recordedTurnId = "", committedTurnId = "";
  await runManagedTurn({
    ensure: () => ({ agent: "mock", cwd: "/repo" }), resolveAgentName: (name) => name,
    add: (_sid, message) => stored.push(message), broadcast: () => {}, pushSessions: () => {}, now: () => 10, speak: async () => {},
    buildContextManifest: (input) => ({
      schemaVersion: 1, turnId: input.turnId, sessionId: input.sid, runnerId: "local", agent: input.agentName, cwd: input.cwd, createdAt: 10,
      continuity: { kind: "jarvis_history", historyMessages: 0, historyChars: 0 },
      prompt: { userChars: input.showText.length, agentChars: input.agentText.length, agentSha256: "hash", transformed: true, attachments: [] },
      semanticMemory: { injected: false, entryIds: [] }, instructionFiles: [],
    }),
    recordContextManifest: (manifest) => { recordedTurnId = manifest.turnId; },
    runAgentTurn: async (_sid, _agent, _text, _cwd, opts) => { providerTurnId = opts.turnId || ""; return { text: "ok" }; },
    afterStored: (_sid, turnId) => { committedTurnId = turnId; assert.equal(stored.at(-1)?.role, "assistant"); },
  }, "s1", { showText: "raw", agentText: "expanded", onError: assert.fail });
  assert.ok(providerTurnId);
  assert.equal(recordedTurnId, providerTurnId);
  assert.equal(stored[0].contextManifest?.turnId, providerTurnId);
  assert.equal(committedTurnId, providerTurnId);
});

test("managed lifecycle can keep short-lived context out of the durable manifest", async () => {
  let manifestText = "", providerText = "";
  await runManagedTurn({
    ensure: () => ({ agent: "mock", cwd: "/repo" }), resolveAgentName: (name) => name,
    add: () => {}, broadcast: () => {}, pushSessions: () => {}, now: () => 10, speak: async () => {},
    buildContextManifest: (input) => {
      manifestText = input.agentText;
      return {
        schemaVersion: 1, turnId: input.turnId, sessionId: input.sid, runnerId: "local", agent: input.agentName, cwd: input.cwd, createdAt: 10,
        continuity: { kind: "jarvis_history", historyMessages: 0, historyChars: 0 },
        prompt: { userChars: input.showText.length, agentChars: input.agentText.length, agentSha256: "hash", transformed: true, attachments: [] },
        semanticMemory: { injected: false, entryIds: [] }, instructionFiles: [],
      };
    },
    runAgentTurn: async (_sid, _agent, text) => { providerText = text; return { text: "ok" }; },
  }, "s1", { showText: "raw", agentText: "PRIVATE-CONTEXT\nraw", manifestAgentText: "raw", onError: assert.fail });
  assert.equal(manifestText, "raw");
  assert.equal(providerText, "PRIVATE-CONTEXT\nraw");
});

test("runManagedTurn preempts to the secondary AI when the primary is exhausted", async () => {
  const stored: TurnStoredMessage[] = [], ran: string[] = [], notices: string[] = [];
  await runManagedTurn({
    ensure: () => ({ agent: "claude-code", cwd: "/repo" }), resolveAgentName: (x) => x,
    add: (_sid, m) => stored.push(m), broadcast: () => {}, pushSessions: () => {}, now: () => 1, speak: async () => {},
    runAgentTurn: async (_sid, agent) => { ran.push(agent); return { text: "ok from " + agent }; },
    resolveAgent: () => ({ agent: "codex", switched: true, note: "primária sem crédito — usando codex" }),
    notice: (_sid, msg) => notices.push(msg),
  }, "s1", { showText: "oi", onError: assert.fail });
  assert.deepEqual(ran, ["codex"], "ran the secondary, not the exhausted primary");
  assert.equal(stored.at(-1)?.agent, "codex");
  assert.ok(notices.some((n) => /codex/.test(n)), "user is told about the switch");
});

test("runManagedTurn retries the same turn on a limit error via the secondary", async () => {
  const stored: TurnStoredMessage[] = [], ran: string[] = [], notices: string[] = [];
  const cap: { limitAgent?: string } = {};
  await runManagedTurn({
    ensure: () => ({ agent: "claude-code", cwd: "/repo" }), resolveAgentName: (x) => x,
    add: (_sid, m) => stored.push(m), broadcast: () => {}, pushSessions: () => {}, now: () => 1, speak: async () => {},
    runAgentTurn: async (_sid, agent) => { ran.push(agent); if (agent === "claude-code") throw new Error("rate limit exceeded"); return { text: "ok from " + agent }; },
    onLimit: (agent) => { cap.limitAgent = agent; return { agent: "codex", note: "refazendo com codex" }; },
    notice: (_sid, msg) => notices.push(msg),
  }, "s1", { showText: "oi", onError: assert.fail });
  assert.deepEqual(ran, ["claude-code", "codex"], "primary failed, secondary retried the same turn");
  assert.equal(stored.filter((m) => m.role === "assistant").length, 1, "exactly one assistant reply persisted");
  assert.equal(stored.at(-1)?.agent, "codex");
  assert.equal(cap.limitAgent, "claude-code");
  assert.ok(notices.some((n) => /codex/.test(n)));
});

test("runManagedTurn reports a limit error when no secondary is available", async () => {
  const cap: { err?: { m: string; limit: boolean } } = {};
  await runManagedTurn({
    ensure: () => ({ agent: "claude-code", cwd: "/repo" }), resolveAgentName: (x) => x,
    add: () => {}, broadcast: () => {}, pushSessions: () => {}, now: () => 1, speak: async () => {},
    runAgentTurn: async () => { throw new Error("usage limit reached"); },
    onLimit: () => null,
  }, "s1", { showText: "oi", onError: (m, limit) => { cap.err = { m, limit }; } });
  assert.equal(cap.err?.limit, true);
  assert.match(cap.err?.m || "", /usage limit/);
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

test("attachment builder persists binary files instead of inlining base64", () => {
  const raw = Buffer.from("PK\x03\x04docx-ish-binary");
  const built = buildTurnAttachments([{ name: "brief.docx", content: raw.toString("base64"), binary: true, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }], "analise", {
    saveImage: assert.fail,
    saveFile: () => "/tmp/brief.docx",
  });
  assert.match(built.agentText, /Salvo em: \/tmp\/brief\.docx/);
  assert.doesNotMatch(built.agentText, new RegExp(raw.toString("base64")));
  assert.equal(built.files?.[0].path, "/tmp/brief.docx");
  assert.equal(built.files?.[0].binary, true);
});

test("attachment builder persists large text instead of inlining it", () => {
  const big = "x".repeat(80 * 1024);
  const built = buildTurnAttachments([{ name: "large.md", content: big }], "resuma", {
    inlineMax: 1024,
    persistMax: 2048,
    saveImage: assert.fail,
    saveFile: () => "/tmp/large.md",
  });
  assert.match(built.agentText, /Texto grande/);
  assert.doesNotMatch(built.agentText, /xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/);
  assert.equal(built.files?.[0].path, "/tmp/large.md");
  assert.equal(built.files?.[0].content, undefined);
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

test("File diffs are rebuilt provider-neutrally from persisted activity", () => {
  const messages = [{ activity: [
    { kind: "tool_started", eventId: "e1", tool: { callId: "p1", name: "Edit", path: "src/a.ts", adds: 0, dels: 0, status: "running" } },
    { kind: "tool_completed", eventId: "e2", tool: { callId: "p1", name: "Edit", path: "src/a.ts", adds: 1, dels: 1, status: "completed", rows: [{ t: "-", s: "old" }, { t: "+", s: "new" }] } },
  ] }];
  const diff = fileDiffFromMessages(messages, "src/a.ts");
  assert.equal(diff.adds, 1);
  assert.equal(diff.dels, 1);
  assert.deepEqual(diff.rows?.map((r) => r.t + r.s), ["-old", "+new"]);
  assert.match(fileDiffFromMessages(messages, "missing.ts").error || "", /sem diff/);
});
