import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationLedger } from "./conversationLedger.js";

const input = { principalId: "owner", clientId: "wk012345", sessionId: "voice", runnerId: "local", text: "Execute os testes" };
function fixture(t: any) { const dir = mkdtempSync(join(tmpdir(), "jarvis-conversation-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test("deleting a history scrubs receipt content but retains deduplication across restart", async (t) => {
  const dir = fixture(t), ledger = new ConversationLedger(dir);
  ledger.accept(input); ledger.update(input.principalId, input.clientId, { reply: "private result", sessionId: "task" });
  await ledger.forgetSession("local", "voice");
  ledger.update(input.principalId, input.clientId, { reply: "late response" });
  const disk = readdirSync(dir).map((n) => readFileSync(join(dir,n),"utf8")).join("");
  assert.doesNotMatch(disk, /Execute os testes|private result|late response/);
  const restarted = new ConversationLedger(dir); await restarted.ready;
  assert.equal(restarted.list("owner").length, 0);
  assert.ok(restarted.accept(input).deletedAt);
});
test("lost ACK then restart recovers the same request, with no implicit re-execution", (t) => {
  const dir = fixture(t), first = new ConversationLedger(dir);
  const receipt = first.accept(input);
  first.update("owner", input.clientId, { status: "dispatched", sessionId: "task1" });
  const restarted = new ConversationLedger(dir);
  const repeated = restarted.accept(input);
  assert.equal(repeated.id, receipt.id);
  assert.equal(repeated.status, "interrupted");
  assert.equal(repeated.sessionId, "task1");
  assert.equal(restarted.list("owner").length, 1);
});
test("identical client ids from different principals never expose or suppress another request", (t) => {
  const ledger = new ConversationLedger(fixture(t));
  ledger.accept(input);
  ledger.accept({ ...input, principalId: "guest", text: "guest request" });
  assert.deepEqual(ledger.list("guest").map((r) => r.text), ["guest request"]);
  assert.notEqual(ledger.get("owner", input.clientId)?.id, ledger.get("guest", input.clientId)?.id);
});
test("disk failure neither accepts nor remembers the request", (t) => {
  const ledger = new ConversationLedger(fixture(t), Date.now, () => { throw new Error("disk full"); });
  assert.throws(() => ledger.accept(input), /disk full/);
  assert.equal(ledger.get("owner", input.clientId), undefined);
});
test("corrupt deduplication evidence fails closed", (t) => {
  const dir = fixture(t);
  new ConversationLedger(dir).accept(input);
  writeFileSync(join(dir, readdirSync(dir)[0]), "broken");
  const ledger = new ConversationLedger(dir);
  assert.throws(() => ledger.accept(input), /ilegível/);
  assert.doesNotThrow(() => ledger.accept({ ...input, clientId: "another1" }));
});
test("task focus and notification preferences survive a device/restart change", (t) => {
  const dir = fixture(t), ledger = new ConversationLedger(dir);
  ledger.configure("owner", { quiet: true, task: { runnerId: "remote", sessionId: "work" }, seen: { execution1: 123 } });
  assert.deepEqual(new ConversationLedger(dir).preferences("owner"), { quiet: true, task: { runnerId: "remote", sessionId: "work" }, seen: { execution1: 123 } });
  assert.deepEqual(ledger.preferences("guest"), { quiet: false, seen: {} });
});
