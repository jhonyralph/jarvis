import { test } from "node:test";
import assert from "node:assert/strict";
import { runManagedTurn, isLimitError, type TurnCtx, type TurnStoredMessage } from "./turn.js";

/** Build a mock ctx with an in-memory store + recording spies. */
function mockCtx(over: Partial<TurnCtx> = {}) {
  const added: Array<{ sid: string; msg: TurnStoredMessage }> = [];
  const broadcasts: Array<{ sid: string; msg: any }> = [];
  const spoken: string[] = [];
  let clock = 1000;
  const order: string[] = [];
  const ctx: TurnCtx = {
    ensure: (sid) => { order.push("ensure:" + sid); return { agent: "mock", cwd: "/work" }; },
    resolveAgentName: (n) => n,
    add: (sid, msg) => { order.push("add:" + msg.role); added.push({ sid, msg }); },
    broadcast: (sid, msg) => broadcasts.push({ sid, msg }),
    pushSessions: () => order.push("pushSessions"),
    now: () => clock++,
    runAgentTurn: async () => { order.push("runAgentTurn"); return { text: "resposta", activity: [{ kind: "tool", name: "Edit" }] }; },
    speak: async (_sid, text) => { order.push("speak"); spoken.push(text); },
    ...over,
  };
  return { ctx, added, broadcasts, spoken, order };
}

test("persists the user then the assistant message, in order, around the agent run", async () => {
  const m = mockCtx();
  await runManagedTurn(m.ctx, "s1", { showText: "faça X", onError: () => assert.fail("should not error") });
  assert.deepEqual(m.added.map((a) => a.msg.role), ["user", "assistant"]);
  assert.equal(m.added[0].msg.text, "faça X");
  assert.equal(m.added[1].msg.text, "resposta");
  // the user message must be persisted BEFORE the agent runs, the assistant AFTER
  assert.deepEqual(m.order, ["ensure:s1", "add:user", "pushSessions", "runAgentTurn", "add:assistant", "pushSessions"]);
});

test("persists the assistant's activity trace (the sendTo regression this unification fixes)", async () => {
  const m = mockCtx();
  await runManagedTurn(m.ctx, "s1", { showText: "oi", onError: () => {} });
  const asst = m.added.find((a) => a.msg.role === "assistant")!;
  assert.deepEqual(asst.msg.activity, [{ kind: "tool", name: "Edit" }], "activity must be stored so a reload rebuilds tool blocks");
});

test("broadcasts the user message with attachments and speaker", async () => {
  const m = mockCtx();
  await runManagedTurn(m.ctx, "s1", { showText: "com foto", speaker: "jonathan", images: ["/pasted/a.png"], onError: () => {} });
  const first = m.broadcasts[0].msg;
  assert.equal(first.t, "message");
  assert.equal(first.message.speaker, "jonathan");
  assert.deepEqual(first.message.images, ["/pasted/a.png"]);
});

test("agentText overrides what the agent receives without changing what's stored", async () => {
  let receivedByAgent = "";
  const m = mockCtx({ runAgentTurn: async (_sid, _a, agentText) => { receivedByAgent = agentText; return { text: "ok" }; } });
  await runManagedTurn(m.ctx, "s1", { showText: "veja o anexo", agentText: "veja o anexo\n---arquivo: conteúdo", onError: () => {} });
  assert.equal(receivedByAgent, "veja o anexo\n---arquivo: conteúdo");
  assert.equal(m.added[0].msg.text, "veja o anexo", "the STORED user text stays clean");
});

test("only speaks when asked", async () => {
  const quiet = mockCtx();
  await runManagedTurn(quiet.ctx, "s1", { showText: "x", onError: () => {} });
  assert.equal(quiet.spoken.length, 0);
  const loud = mockCtx();
  await runManagedTurn(loud.ctx, "s1", { showText: "x", speak: true, onError: () => {} });
  assert.deepEqual(loud.spoken, ["resposta"]);
});

test("routes agent failures to onError with the limit flag set for quota errors", async () => {
  const got: Array<{ message: string; limit: boolean }> = [];
  const m = mockCtx({ runAgentTurn: async () => { throw new Error("plan usage limit exceeded"); } });
  await runManagedTurn(m.ctx, "s1", { showText: "x", onError: (message, limit) => { got.push({ message, limit }); } });
  assert.equal(got.length, 1);
  assert.equal(got[0].limit, true);
  // a limit error must NOT persist a (nonexistent) assistant reply
  assert.equal(m.added.filter((a) => a.msg.role === "assistant").length, 0);
});

test("isLimitError matches quota-ish messages only", () => {
  assert.equal(isLimitError("rate limit reached"), true);
  assert.equal(isLimitError("quota exceeded"), true);
  assert.equal(isLimitError("ENOENT: file not found"), false);
});

test("cost guard-rail refuses the turn before spending — no message stored, no agent run", async () => {
  let ran = false;
  const got: Array<{ message: string; limit: boolean }> = [];
  const m = mockCtx({
    checkBudget: () => ({ blocked: true, message: "sessão acima do limite de $5" }),
    runAgentTurn: async () => { ran = true; return { text: "x" }; },
  });
  await runManagedTurn(m.ctx, "s1", { showText: "gaste mais", onError: (message, limit) => got.push({ message, limit }) });
  assert.equal(ran, false, "the agent must not run when over budget");
  assert.equal(m.added.length, 0, "no user/assistant message is persisted");
  assert.deepEqual(got, [{ message: "sessão acima do limite de $5", limit: true }]);
});

test("cost guard-rail allows the turn when under budget", async () => {
  const m = mockCtx({ checkBudget: () => ({ blocked: false }) });
  await runManagedTurn(m.ctx, "s1", { showText: "ok", onError: () => assert.fail("should not error") });
  assert.equal(m.added.filter((a) => a.msg.role === "assistant").length, 1);
});

test("idempotency: a re-delivered turnId runs at most once (local turns)", async () => {
  const ids = new Set<string>();
  const m = mockCtx({ seen: (id: string) => { if (ids.has(id)) return false; ids.add(id); return true; } });
  await runManagedTurn(m.ctx, "s1", { showText: "x", turnId: "T1", onError: () => {} });
  await runManagedTurn(m.ctx, "s1", { showText: "x", turnId: "T1", onError: () => {} }); // re-delivered
  assert.equal(m.added.filter((a) => a.msg.role === "assistant").length, 1, "runs once despite re-delivery");
  // a distinct turnId still runs
  await runManagedTurn(m.ctx, "s1", { showText: "y", turnId: "T2", onError: () => {} });
  assert.equal(m.added.filter((a) => a.msg.role === "assistant").length, 2);
});
