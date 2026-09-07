import { test } from "node:test";
import assert from "node:assert/strict";
import { CODEX_PRICE_TABLE, codexModelPrice, codexPriceOverride, codexLongContextMode, estimateCodexCost } from "./codex-pricing.js";

const near = (actual: number | undefined, expected: number, what: string): void => {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${what}: esperado ${expected}, veio ${actual}`);
};

test("an unknown model is never priced — tokens_only beats a wrong estimate", () => {
  const unknown = estimateCodexCost({ inputTokens: 400_000, cachedInputTokens: 0, outputTokens: 60_000, model: "gpt-7-mirage", env: {} });
  assert.equal(unknown.costUsd, undefined);
  assert.match(unknown.source, /sem preço/);
  const noModel = estimateCodexCost({ inputTokens: 1000, cachedInputTokens: 0, outputTokens: 10, env: {} });
  assert.equal(noModel.costUsd, undefined);
  assert.match(noModel.source, /desconhecido/);
});

test("the env override wins over the table and stays flat (no cliff, no fast multiplier)", () => {
  const env = { JARVIS_CODEX_PRICE_IN: "2", JARVIS_CODEX_PRICE_OUT: "20", JARVIS_CODEX_PRICE_CACHED: "0" };
  // Astra's own row would surcharge this turn; an explicit operator rate must not be second-guessed.
  const r = estimateCodexCost({ inputTokens: 500_000, cachedInputTokens: 100_000, outputTokens: 50_000, model: "gpt-6-astra", fastMode: true, env });
  near(r.costUsd, (400_000 * 2 + 100_000 * 0 + 50_000 * 20) / 1e6, "override");
  assert.equal(r.longContext, false);
  assert.equal(r.fast, false);
  // A partial override still resolves the missing coefficients the way it always did (cached = in/10).
  const partial = codexPriceOverride({ JARVIS_CODEX_PRICE_IN: "3" });
  assert.deepEqual([partial!.in, partial!.cachedIn, partial!.out], [3, 0.3, 10]);
  assert.equal(codexPriceOverride({}), undefined, "no env ⇒ no override");
  assert.equal(codexPriceOverride({ JARVIS_CODEX_PRICE_IN: "abc" }), undefined, "junk is not an override");
  assert.equal(codexPriceOverride({ JARVIS_CODEX_PRICE_IN: "-5" }), undefined, "negative is not an override");
});

test("Astra: base, long-context and fast tiers compose the way the price sheet describes", () => {
  const astra = { model: "gpt-6-astra", env: {} };
  // Under the threshold: 200k*10 + 60k*50.
  near(estimateCodexCost({ inputTokens: 200_000, cachedInputTokens: 0, outputTokens: 60_000, ...astra }).costUsd, 5, "base");
  // Over it, "whole" (default): the entire prompt reprices at 2x in / 1.5x out.
  const long = estimateCodexCost({ inputTokens: 400_000, cachedInputTokens: 0, outputTokens: 60_000, ...astra });
  near(long.costUsd, 12.5, "whole-prompt surcharge");
  assert.equal(long.longContext, true);
  // Fast tier doubles whatever rate applied.
  near(estimateCodexCost({ inputTokens: 400_000, cachedInputTokens: 0, outputTokens: 60_000, fastMode: true, ...astra }).costUsd, 25, "fast + long");
  near(estimateCodexCost({ inputTokens: 200_000, cachedInputTokens: 0, outputTokens: 60_000, fastMode: true, ...astra }).costUsd, 10, "fast alone");
  // The cached prefix is surcharged too (the wording covers "input and cache rates").
  near(estimateCodexCost({ inputTokens: 400_000, cachedInputTokens: 400_000, outputTokens: 0, ...astra }).costUsd, 400_000 * 1 * 2 / 1e6, "cached at 2x");
});

test("the long-context reading is a switch, because the published wording is ambiguous", () => {
  const env = { JARVIS_CODEX_LONG_CONTEXT_MODE: "excess" };
  assert.equal(codexLongContextMode(env), "excess");
  assert.equal(codexLongContextMode({}), "whole", "default never under-reports");
  assert.equal(codexLongContextMode({ JARVIS_CODEX_LONG_CONTEXT_MODE: "nonsense" }), "whole");
  // excess: only the 128k above the threshold is surcharged, output stays at 1.5x.
  // (272k*10 + 128k*20 + 60k*75)/1e6 = 2.72 + 2.56 + 4.5 = 9.78
  near(estimateCodexCost({ inputTokens: 400_000, cachedInputTokens: 0, outputTokens: 60_000, model: "gpt-6-astra", env }).costUsd, 9.78, "excess reading");
});

test("the threshold follows the real prompt size, not the billed delta", () => {
  // A 10k delta on a 400k prompt is still a surcharged turn; a 10k delta on a 10k prompt is not.
  const surcharged = estimateCodexCost({ inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 1_000, promptTokens: 400_000, model: "gpt-6-astra", env: {} });
  near(surcharged.costUsd, (10_000 * 20 + 1_000 * 75) / 1e6, "delta billed at the surcharged rate");
  const plain = estimateCodexCost({ inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 1_000, model: "gpt-6-astra", env: {} });
  near(plain.costUsd, (10_000 * 10 + 1_000 * 50) / 1e6, "no surcharge without a long prompt");
});

test("every table row is internally coherent and provenance is never silently lost", () => {
  for (const [slug, price] of Object.entries(CODEX_PRICE_TABLE)) {
    assert.ok(price.in >= 0 && price.cachedIn >= 0 && price.out >= 0, `${slug}: rates must be non-negative`);
    assert.ok(price.cachedIn <= price.in, `${slug}: cached input must never cost more than fresh input`);
    assert.ok(["published", "ballpark"].includes(price.confidence), `${slug}: confidence must be declared`);
    if (price.longContextThresholdTokens !== undefined) {
      assert.ok(price.longContextThresholdTokens > 0, `${slug}: threshold must be positive`);
      assert.ok((price.longContextInMult ?? 1) >= 1 && (price.longContextOutMult ?? 1) >= 1, `${slug}: a surcharge cannot be a discount`);
    }
    // Every priced row must say which table produced the number, so a ledger entry stays traceable.
    const r = estimateCodexCost({ inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, model: slug, env: {} });
    assert.ok(r.costUsd !== undefined, `${slug}: a table row must yield a price`);
    assert.match(r.source, new RegExp(`preço de ${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `${slug}: source must name the model`);
    assert.match(r.source, /tabela (published|ballpark)/, `${slug}: source must expose the confidence`);
  }
  assert.equal(codexModelPrice(undefined), undefined);
  assert.equal(codexModelPrice("nope"), undefined);
  assert.equal(codexModelPrice("gpt-6-astra")!.in, 10);
});
