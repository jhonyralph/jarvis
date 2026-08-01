import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionOwnershipStore } from "./executionOwnership.js";

test("execution root ownership persists across restart and fails closed for other principals", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-execution-owners-"));
  const file = join(root, "execution-ownership.json");
  const first = new ExecutionOwnershipStore(file, () => 100);
  first.claim("runner-a", "exec-a", "alice");

  const restarted = new ExecutionOwnershipStore(file);
  assert.equal(restarted.allows("runner-a", "exec-a", "alice"), true);
  assert.equal(restarted.allows("runner-a", "exec-a", "bob"), false);
  assert.equal(restarted.allows("runner-a", "unowned", "alice"), false);
  assert.equal(restarted.hasOnRunner("runner-a", "alice"), true);
  assert.equal(restarted.hasOnRunner("runner-a", "bob"), false);
});

test("the same execution id on different runners has independent ownership", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-execution-owners-"));
  const owners = new ExecutionOwnershipStore(join(root, "execution-ownership.json"));
  owners.claim("runner-a", "exec-a", "alice");
  owners.claim("runner-b", "exec-a", "bob");

  assert.equal(owners.allows("runner-a", "exec-a", "alice"), true);
  assert.equal(owners.allows("runner-b", "exec-a", "alice"), false);
  assert.throws(() => owners.claim("runner-a", "exec-a", "bob"), /another principal/);
});
