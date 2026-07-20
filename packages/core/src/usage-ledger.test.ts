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
  ledger.record("s", "opencode", { costUsd: 1, costKind: "billed", source: "fixture", outputTokens: 3 });
  assert.deepEqual({ total: ledger.session("s").costUsd, billed: ledger.session("s").billableUsd, estimated: ledger.session("s").estimatedUsd }, { total: 3, billed: 1, estimated: 2 });
  assert.equal(ledger.total().inputTokens, 10); assert.equal(ledger.byAgent().opencode.billableUsd, 1);
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
