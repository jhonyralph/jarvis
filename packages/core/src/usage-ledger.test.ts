import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageLedger } from "./usage-ledger.js";

test("usage ledger keeps billed and estimated costs semantically separate", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-ledger-")), "usage.json");
  const ledger = new UsageLedger(file);
  ledger.record("s", "claude-code", { costUsd: 2, costKind: "estimated_api_equivalent", source: "fixture", inputTokens: 10 });
  ledger.record("s", "opencode", { costUsd: 1, costKind: "billed", source: "fixture", outputTokens: 3, model: "m2", effort: "high" });
  assert.deepEqual({ total: ledger.session("s").costUsd, billed: ledger.session("s").billableUsd, estimated: ledger.session("s").estimatedUsd }, { total: 3, billed: 1, estimated: 2 });
  assert.equal(ledger.total().inputTokens, 10); assert.equal(ledger.byAgent().opencode.billableUsd, 1);
  assert.equal(ledger.session("s").model, "m2"); assert.equal(ledger.session("s").effort, "high");
});

test("usage ledger migrates old untyped cost as unavailable, never billed", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-ledger-old-")); const file = join(dir, "usage.json");
  writeFileSync(file, JSON.stringify({ old: { cost: 4, ts: Date.now() } }));
  const ledger = new UsageLedger(file);
  assert.equal(ledger.session("old").costUsd, 4); assert.equal(ledger.session("old").billableUsd, 0); assert.equal(ledger.session("old").byKind.unavailable, 4);
});

test("usage ledger converts repeated legacy Codex cumulative snapshots to deltas", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-ledger-codex-")); const file = join(dir, "usage.json"), at = Date.now();
  writeFileSync(file, JSON.stringify([
    { sessionId: "c", agent: "codex", at, costKind: "estimated_api_equivalent", source: "codex exec --json tokens × JARVIS_CODEX_PRICE_* (v1)", costUsd: 10, inputTokens: 1000, outputTokens: 100, contextTokens: 1000 },
    { sessionId: "c", agent: "codex", at: at + 1, costKind: "estimated_api_equivalent", source: "codex exec --json tokens × JARVIS_CODEX_PRICE_* (v1)", costUsd: 12, inputTokens: 1200, outputTokens: 130, contextTokens: 1200 },
  ]));
  const usage = new UsageLedger(file).session("c");
  assert.equal(usage.costUsd, 12); assert.equal(usage.inputTokens, 1200); assert.equal(usage.outputTokens, 130); assert.equal(usage.contextTokens, undefined);
});

test("usage views can attribute legacy unknown entries from their session without rewriting history", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-usage-attribution-")), file = join(dir, "usage.json");
  writeFileSync(file, JSON.stringify({ knownSession: { cost: 2, ts: Date.now() }, deletedSession: { cost: 1, ts: Date.now() } }));
  const ledger = new UsageLedger(file);
  const resolve = (sid: string, agent: string) => agent === "unknown" ? (sid === "knownSession" ? "codex" : "legacy-unattributed") : agent;
  assert.equal(ledger.byAgent(resolve).codex.costUsd, 2);
  assert.equal(ledger.byAgent(resolve)["legacy-unattributed"].costUsd, 1);
  assert.equal(ledger.topSessions(2, resolve)[0].agent, "codex");
});

test("usage views isolate equal session ids by runner", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-ledger-runners-")), "usage.json");
  const ledger = new UsageLedger(file);
  ledger.record("same", "mock", { inputTokens: 2, costKind: "tokens_only" }, "runner-a");
  ledger.record("same", "mock", { inputTokens: 3, costKind: "tokens_only" }, "runner-b");
  ledger.record("same", "mock", { inputTokens: 5, costKind: "tokens_only" }, "local");
  assert.equal(ledger.session("same", "runner-a").inputTokens, 2);
  assert.equal(ledger.session("same", "runner-b").inputTokens, 3);
  assert.equal(ledger.session("same", "local").inputTokens, 5);
  assert.deepEqual(ledger.topSessions(10).map((entry) => entry.runnerId).sort(), ["local", "runner-a", "runner-b"]);
});

test("scoped usage views quarantine entries without runner provenance", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-ledger-legacy-runner-")), "usage.json");
  writeFileSync(file, JSON.stringify([
    { sessionId: "same", agent: "mock", at: Date.now(), costKind: "tokens_only", source: "legacy", inputTokens: 7 },
    { sessionId: "same", runnerId: "local", agent: "mock", at: Date.now(), costKind: "tokens_only", source: "scoped", inputTokens: 3 },
  ]));
  const ledger = new UsageLedger(file);
  assert.equal(ledger.session("same").inputTokens, 10);
  assert.equal(ledger.session("same", "local").inputTokens, 3);
  assert.equal(ledger.session("same", "runner-a").inputTokens, 0);
  assert.deepEqual(ledger.topSessions(10).map((entry) => entry.runnerId).sort(), ["legacy", "local"]);
});

test("Codex cumulative migration is isolated by runner", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-ledger-codex-runners-")), "usage.json"), at = Date.now();
  const entry = (runnerId: string, inputTokens: number, outputTokens: number) => ({ sessionId: "same", runnerId, agent: "codex", at, costKind: "estimated_api_equivalent", source: "codex exec --json tokens × fixture", inputTokens, outputTokens });
  writeFileSync(file, JSON.stringify([entry("runner-a", 100, 10), entry("runner-b", 40, 4)]));
  const ledger = new UsageLedger(file);
  assert.equal(ledger.session("same", "runner-a").inputTokens, 100);
  assert.equal(ledger.session("same", "runner-b").inputTokens, 40);
});
