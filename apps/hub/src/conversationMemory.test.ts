import test from "node:test";
import assert from "node:assert/strict";
import type { PersonalPreference } from "@jarvis/protocol";
import { conversationMemories } from "./conversationMemory.js";
test("decisions require source scope and respect correction, expiry and rejection", () => {
  const base: PersonalPreference = { id: "one", principalId: "owner", kind: "explicit", key: "conversation.decision", value: "use the approved API", polarity: "require", confidence: 1, purposes: ["automation"], createdAt: 1, updatedAt: 2,
    evidence: [{ id: "source", kind: "statement", at: 1, summary: "task", sourceId: "pc/project/task" }] };
  const scope = { runnerId: "pc", sessionId: "project" };
  assert.equal(conversationMemories([base], undefined).length, 0);
  assert.equal(conversationMemories([base], { ...scope, sessionId: "other" }).length, 0);
  assert.equal(conversationMemories([{ ...base, decision: "rejected" }, { ...base, expiresAt: 4 }], scope, 5).length, 0);
  assert.deepEqual(conversationMemories([{ ...base, value: "corrected API", decision: "corrected" }], scope), [{ kind: base.key, value: "corrected API", source: "pc/project/task" }]);
});
