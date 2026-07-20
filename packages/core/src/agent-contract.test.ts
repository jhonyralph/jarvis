import test from "node:test";
import assert from "node:assert/strict";
import { createEventSequencer, descriptorProblems, modelSupports, LIMITED_CAPABILITIES, type AgentDescriptor } from "./agent-contract.js";

const descriptor = (over: Partial<AgentDescriptor> = {}): AgentDescriptor => ({
  id: "sample",
  label: "Sample",
  support: "unverified",
  cli: { command: "sample", version: "1.0.0" },
  capabilities: { ...LIMITED_CAPABILITIES, stream: "block", modelCatalog: "runtime", modelControl: "per_turn" },
  models: [{ id: "m1", label: "M1", source: "cli", visibility: "public", efforts: ["low", "high"], defaultEffort: "low", modalities: ["text"], discoveredAt: 1 }],
  defaultModel: "m1",
  discoveredAt: 1,
  ...over,
});

test("canonical sequencer emits stable monotonic ids and exactly one terminal", () => {
  let at = 10;
  const s = createEventSequencer("turn-1", () => at++);
  assert.deepEqual(s.next("started"), { schemaVersion: 1, turnId: "turn-1", eventId: "turn-1:1", seq: 1, at: 10, kind: "started" });
  assert.equal(s.next("text_block", { text: "ok" }).seq, 2);
  assert.equal(s.next("completed", { text: "ok" }).seq, 3);
  assert.equal(s.terminal, true);
  assert.throws(() => s.next("completed"), /terminated/);
});

test("descriptor validation prevents incomplete adapters from claiming complete", () => {
  const d = descriptor({ support: "complete", cli: { command: "sample" }, capabilities: { ...LIMITED_CAPABILITIES } });
  assert.deepEqual(descriptorProblems(d), ["complete agent requires live stream", "complete agent requires verified CLI version"]);
});

test("descriptor validation catches duplicate models and impossible defaults", () => {
  const m = descriptor().models[0];
  const d = descriptor({ models: [m, { ...m }], defaultModel: "missing" });
  assert.deepEqual(descriptorProblems(d), ["duplicate model: m1", "unknown default model: missing"]);
});

test("model validation rejects unknown model and unsupported effort before spawn", () => {
  const d = descriptor();
  assert.deepEqual(modelSupports(d, "missing", "low"), { ok: false, code: "INVALID_MODEL", message: "modelo não disponível para Sample: missing" });
  assert.deepEqual(modelSupports(d, "m1", "ultra"), { ok: false, code: "INVALID_EFFORT", message: "esforço 'ultra' não suportado por m1" });
  assert.deepEqual(modelSupports(d, "m1", "high"), { ok: true });
});
