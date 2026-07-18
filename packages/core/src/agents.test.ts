import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry, AiderAdapter, MockAgentAdapter } from "./agents.js";

test("AiderAdapter: name + empty (uninvented) model catalog", async () => {
  const a = new AiderAdapter();
  assert.equal(a.name, "aider");
  const caps = await a.capabilities();
  assert.deepEqual(caps.models, [], "no hardcoded model ids — aider spans many providers");
});

test("AgentRegistry registers aider alongside the built-ins and routes by name", () => {
  const reg = new AgentRegistry("mock").register(new MockAgentAdapter()).register(new AiderAdapter());
  assert.ok(reg.names().includes("aider"));
  assert.equal(reg.get("aider").name, "aider");
  assert.equal(reg.get("nope").name, "mock", "unknown name falls back to the default");
});
