import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationInbox, CONVERSATION_PAGE_SIZE } from "./conversationInbox.js";
import { selectConversationTask, type ConversationTask } from "./conversation.js";

const tasks: ConversationTask[] = Array.from({ length: 5000 }, (_, i) => ({
  id: `t${i}`, runnerId: "local", sessionId: `s${i}`, turnId: `turn${i}`, title: `Tarefa ${i}`,
  state: "succeeded", updatedAt: 5000 - i, origin: "Projeto", summary: "resultado", needsInput: false, canCancel: false,
}));
const prefs = { quiet: false, seen: {}, notified: {} };

test("inbox bounds legacy summaries and list size without changing source data or voice lookup", () => {
  const huge = "x".repeat(22_350_827), source = tasks.map((t, i) => i === 0 ? { ...t, summary: huge } : t);
  const view = buildConversationInbox(source, prefs, { offset: 0 }, []);
  assert.equal(view.tasks?.length, CONVERSATION_PAGE_SIZE);
  assert.equal(view.total, 5000);
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 150_000);
  assert.equal(view.tasks?.[0].summaryTruncated, true);
  assert.equal(source[0].summary, huge);
  assert.equal(selectConversationTask(source, "Tarefa 4999")?.id, "t4999");
});

test("all historical tasks remain reachable by bounded pages and focus survives off-page", () => {
  const preferences = { ...prefs, task: { runnerId: "local", sessionId: "s4999", turnId: "turn4999" } };
  const found = new Set<string>();
  for (let offset = 0; offset < tasks.length; offset += CONVERSATION_PAGE_SIZE) {
    const page = buildConversationInbox(tasks, preferences, { offset }, []);
    for (const task of page.tasks || []) found.add(task.id);
    assert.equal(page.selected?.id, "t4999");
  }
  assert.equal(found.size, 5000);
});

test("closed-panel polls keep total and notifications without shipping tasks or private preference maps", () => {
  const view = buildConversationInbox(tasks, { ...prefs, seen: { secret: 1 }, notified: { secret: 2 } }, { summaryOnly: true }, tasks.map(t => t.id));
  assert.equal(view.tasks, undefined);
  assert.equal(view.updateCount, 5000);
  assert.equal(view.updates.length, CONVERSATION_PAGE_SIZE);
  assert.equal(view.total, 5000);
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 10_000);
  assert.doesNotMatch(JSON.stringify(view), /secret/);
});

test("unchanged pages omit cards but still deliver fresh notifications; changes invalidate version", () => {
  const first = buildConversationInbox(tasks, prefs, {}, []);
  const same = buildConversationInbox(tasks, prefs, { version: first.version }, ["t4000"]);
  assert.equal(same.unchanged, true);
  assert.equal(same.tasks, undefined);
  assert.equal(same.updateCount, 1);
  const changed = buildConversationInbox([{ ...tasks[0], state: "failed" }, ...tasks.slice(1)], prefs, { version: first.version }, []);
  assert.equal(changed.unchanged, false);
  assert.equal(changed.tasks?.[0].state, "failed");
  assert.notEqual(buildConversationInbox(tasks, prefs, { offset: 50 }, []).version, first.version);
});

test("empty, invalid and out-of-range page requests are normalized", () => {
  assert.equal(buildConversationInbox([], prefs, { offset: 999 }, []).offset, 0);
  for (const offset of [-1, NaN, Infinity, "0", {}, 1.5]) assert.equal(buildConversationInbox(tasks, prefs, { offset }, []).offset, 0);
  const last = buildConversationInbox(tasks, prefs, { offset: 999999 }, []);
  assert.equal(last.offset, 4950);
  assert.equal(last.tasks?.at(-1)?.id, "t4999");
  assert.equal(buildConversationInbox([{ ...tasks[0], state: "handled" }], prefs, {}, []).total, 0);
});

test("deleted or unauthorized selection cannot escape the caller-filtered task list", () => {
  const view = buildConversationInbox([], { ...prefs, task: { runnerId: "private", sessionId: "secret" } }, {}, []);
  assert.equal(view.selected, undefined);
  assert.equal(view.preferences.task, undefined);
});

test("legacy records without an origin do not break the entire inbox", () => {
  const legacy = { ...tasks[0], origin: undefined } as unknown as ConversationTask;
  const view = buildConversationInbox([legacy], prefs, {}, []);
  assert.equal(view.tasks?.[0].origin, "");
  assert.equal(legacy.origin, undefined);
});
