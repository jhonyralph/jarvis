import test from "node:test";
import assert from "node:assert/strict";
import { coordinateConversation, conversationIntent, conversationBriefing, selectConversationTask, mergeConversationTasks, type ConversationTask } from "./conversation.js";
const task: ConversationTask = { id: "t1", runnerId: "local", sessionId: "s1", title: "Backend DNAutto", state: "running", updatedAt: 10, origin: "DNAutto", needsInput: false, canCancel: true };
const other = { ...task, id: "t2", sessionId: "s2", title: "Jarvis", origin: "Jarvis" };
test("short status and corrections remain available while work is running", async () => {
  const corrections: string[] = [];
  const deps = { tasks: [task, other], focus: { runnerId: "local", sessionId: "s1" }, seen: {}, stop() {},
    cancel: async () => "cancelado", correct: async (t: ConversationTask, s: string) => { corrections.push(t.id + s); return "correção entregue"; },
    task: async () => { throw new Error("must not start a second executor"); }, chat: async () => "chat" };
  assert.match(await coordinateConversation("como está?", deps), /Backend DNAutto: em andamento/);
  assert.equal(await coordinateConversation("Correção: use o outro endpoint", deps), "correção entregue");
  assert.deepEqual(corrections, ["t1Correção: use o outro endpoint"]);
  assert.match(await coordinateConversation("status Jarvis", deps), /Jarvis: em andamento/);
});
test("ambiguous destination never sends correction to whichever execution was last", async () => {
  const deps = { tasks: [task, other], seen: {}, stop() {}, cancel: async () => "", correct: async () => { throw new Error("wrong task"); }, task: async () => "", chat: async () => "" };
  assert.match(await coordinateConversation("quis dizer o outro projeto", deps), /único destino/);
  assert.equal(selectConversationTask([task, { ...other, title: "Backend DNAutto" }], "DNAutto"), undefined);
});
test("selection remains on the exact turn when the same session has a newer queued correction", () => {
  const original = { ...task, turnId: "original" }, correction = { ...task, id: "correction", turnId: "correction", state: "queued" };
  assert.equal(selectConversationTask([correction, original], "", { runnerId: task.runnerId, sessionId: task.sessionId, turnId: "original" })?.id, original.id);
});
test("stop speech, end conversation and cancel task are different intents", () => {
  assert.equal(conversationIntent("pare de falar").kind, "stop");
  assert.equal(conversationIntent("encerre a conversa").kind, "end");
  assert.equal(conversationIntent("encerrar a conversa").kind, "end");
  assert.equal(conversationIntent("cancele esta tarefa").kind, "cancel");
  assert.equal(conversationIntent("Pode implementar tudo").kind, "task");
});
test("return briefing is deduplicated and never labels interrupted work completed", () => {
  const failed = { ...task, state: "orphaned", updatedAt: 30 };
  assert.match(conversationBriefing([failed], {}), /interrompido/);
  assert.match(conversationBriefing([failed], { t1: 30 }), /Nenhum/);
  assert.equal(mergeConversationTasks([task], []).length, 1);
});
