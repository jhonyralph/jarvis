/**
 * Per-MODEL price table for the Codex estimator.
 *
 * Codex reports TOKENS, never a price, so Jarvis estimates the "custo" column. Until now that
 * estimate used THREE GLOBAL coefficients for the whole agent (`JARVIS_CODEX_PRICE_IN/_CACHED/_OUT`),
 * which meant every model on the machine was billed at the same rate. That was survivable while the
 * whole catalog sat in the same price class; it stopped being survivable with `gpt-6-astra`, which is
 * ~8x the old input default, ~5x the output default, and adds TWO multipliers the old linear formula
 * could not express at all:
 *
 *   1. a long-context surcharge above a per-model input threshold, and
 *   2. a faster service tier that costs a multiple of the normal rate.
 *
 * See `docs/research/astra-6-teardown.md` (item A) for the full derivation.
 *
 * Rules, in order:
 *   - `JARVIS_CODEX_PRICE_*` set  → flat linear pricing at those rates, NO multipliers (the exact
 *     pre-existing behaviour, kept so an operator override stays predictable and backward compatible).
 *   - model present in the table  → table rates + long-context + fast multipliers.
 *   - model unknown or absent     → NO cost at all (`tokens_only`). Deliberate: a silent 8x
 *     under-report is worse than an honest blank. The env override above is the escape hatch.
 */

/** How the provider applies the long-context surcharge once a turn crosses `longContextThresholdTokens`. */
export type LongContextMode =
  /** The WHOLE prompt is repriced at the surcharged rate (literal reading of the OpenAI wording). */
  | "whole"
  /** Only the tokens ABOVE the threshold are surcharged. */
  | "excess";

/** Where a row's numbers come from — surfaced in the usage provenance string, never guessed silently. */
export type PriceConfidence =
  /** in/out taken from a cited provider/analyst publication. */
  | "published"
  /** Jarvis's historical ballpark; NOT a quoted price. Preserves the pre-table behaviour. */
  | "ballpark";

export interface CodexModelPrice {
  /** USD per 1M non-cached input tokens. */
  in: number;
  /** USD per 1M cached input tokens. */
  cachedIn: number;
  /** USD per 1M output tokens (reasoning tokens included). */
  out: number;
  confidence: PriceConfidence;
  /** Above this many input tokens in ONE turn the surcharge applies. Absent ⇒ no surcharge. */
  longContextThresholdTokens?: number;
  longContextInMult?: number;
  longContextOutMult?: number;
  /** Multiplier when the turn ran on the provider's faster service tier. Absent ⇒ no fast surcharge. */
  fastMult?: number;
}

/** Jarvis's historical GPT-5-class ballpark — the exact defaults the global env coefficients used.
 *  Frozen because several table rows share this one object. */
const BALLPARK: CodexModelPrice = Object.freeze({ in: 1.25, cachedIn: 0.125, out: 10, confidence: "ballpark" as const });

/**
 * Bump `JARVIS_CODEX_PRICING_VERSION` (or this constant) whenever a row changes, so a stored ledger
 * entry can always be traced back to the table that produced it.
 */
export const CODEX_PRICE_TABLE_VERSION = "jarvis-codex-prices-2026-09";

/**
 * Keyed by the exact `codex debug models` slug.
 *
 * IMPORTANT: rows marked `ballpark` are NOT quoted prices — they are the legacy Jarvis estimate kept
 * so that adding this table did not silently change the cost shown for models we never had a
 * published price for. Replace them with `published` rows as sources appear; do not invent numbers.
 */
export const CODEX_PRICE_TABLE: Readonly<Record<string, CodexModelPrice>> = Object.freeze({
  // Published: developers.openai.com/api/docs/models/gpt-6-astra (read 2026-09-05).
  // $10 in / $1 cached in / $50 out; >272K input ⇒ 2x input+cache and 1.5x output; Fast tier ⇒ 2x.
  "gpt-6-astra": {
    in: 10, cachedIn: 1, out: 50, confidence: "published",
    longContextThresholdTokens: 272_000, longContextInMult: 2, longContextOutMult: 1.5, fastMult: 2,
  },
  // Published in/out: Artificial Analysis "Benchmarking GPT-6 Astra" ($10/$50 vs $4/$20).
  // cachedIn has no published figure — kept at the in/10 ratio Jarvis has always assumed.
  "gpt-5.6-sol": { in: 4, cachedIn: 0.4, out: 20, confidence: "published" },
  // No published price found for the rows below — legacy ballpark, so behaviour is unchanged.
  "gpt-5.6-terra": BALLPARK,
  "gpt-5.6-luna": BALLPARK,
  "gpt-5.5": BALLPARK,
  "gpt-5.4-mini": BALLPARK,
  "gpt-5.3-codex-spark": BALLPARK,
  "gpt-reserve": BALLPARK,
});

export function codexModelPrice(model?: string): CodexModelPrice | undefined {
  return model ? CODEX_PRICE_TABLE[model] : undefined;
}

const envNum = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Operator override: three global coefficients, exactly as before this table existed. */
export function codexPriceOverride(env: NodeJS.ProcessEnv = process.env): CodexModelPrice | undefined {
  const inRate = envNum(env.JARVIS_CODEX_PRICE_IN);
  const cached = envNum(env.JARVIS_CODEX_PRICE_CACHED);
  const out = envNum(env.JARVIS_CODEX_PRICE_OUT);
  if (inRate === undefined && cached === undefined && out === undefined) return undefined;
  const base = inRate ?? BALLPARK.in;
  return { in: base, cachedIn: cached ?? base / 10, out: out ?? BALLPARK.out, confidence: "ballpark" };
}

/**
 * The OpenAI wording — "Prompts with more than 272K input tokens are priced at 2x input and cache
 * rates and 1.5x output" — admits two readings, and they differ by ~50% on the same turn. `whole`
 * (the literal one, and the one that never UNDER-reports) is the default; set
 * `JARVIS_CODEX_LONG_CONTEXT_MODE=excess` once measured against a real invoice.
 */
export function codexLongContextMode(env: NodeJS.ProcessEnv = process.env): LongContextMode {
  return env.JARVIS_CODEX_LONG_CONTEXT_MODE === "excess" ? "excess" : "whole";
}

export interface CodexCostInput {
  /** Billable input tokens for this turn (INCLUDES the cached prefix, as Codex reports it). */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** The turn's real prompt size, used ONLY to test the long-context threshold. Defaults to inputTokens. */
  promptTokens?: number;
  model?: string;
  fastMode?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface CodexCostEstimate {
  /** undefined ⇒ the turn is NOT priceable; the caller must report `tokens_only`, never a guess. */
  costUsd?: number;
  /** Provenance for the usage record — always says which table/branch produced the number. */
  source: string;
  /** True when the long-context surcharge was applied. */
  longContext: boolean;
  /** True when the fast-tier multiplier was applied. */
  fast: boolean;
}

/**
 * Pure. Returns the estimated USD for one Codex turn, or `costUsd: undefined` when the model has no
 * price we can defend. Never throws, never invents a rate for an unknown model.
 */
export function estimateCodexCost(input: CodexCostInput): CodexCostEstimate {
  const env = input.env ?? process.env;
  const version = env.JARVIS_CODEX_PRICING_VERSION || CODEX_PRICE_TABLE_VERSION;
  const uncached = Math.max(0, input.inputTokens - input.cachedInputTokens);
  const cached = Math.max(0, input.cachedInputTokens);
  const output = Math.max(0, input.outputTokens);

  const override = codexPriceOverride(env);
  if (override) {
    // Flat and multiplier-free on purpose: an explicit operator rate must stay predictable.
    const costUsd = (uncached * override.in + cached * override.cachedIn + output * override.out) / 1e6;
    return { costUsd, source: `codex tokens × JARVIS_CODEX_PRICE_* (${version})`, longContext: false, fast: false };
  }

  const price = codexModelPrice(input.model);
  if (!price) {
    const which = input.model ? `modelo '${input.model}' fora da tabela` : "modelo do turno desconhecido";
    return { costUsd: undefined, source: `codex tokens sem preço — ${which} (${version})`, longContext: false, fast: false };
  }

  const promptTokens = input.promptTokens && input.promptTokens > 0 ? input.promptTokens : input.inputTokens;
  const threshold = price.longContextThresholdTokens;
  const longContext = threshold !== undefined && promptTokens > threshold;
  const inMult = longContext ? price.longContextInMult ?? 1 : 1;
  const outMult = longContext ? price.longContextOutMult ?? 1 : 1;
  const fast = input.fastMode === true && (price.fastMult ?? 1) !== 1;
  const fastMult = fast ? price.fastMult! : 1;

  let inputCost: number;
  if (longContext && codexLongContextMode(env) === "excess" && threshold !== undefined) {
    // Only the tokens above the threshold are surcharged. Charge the cached prefix first at the base
    // rate, so the excess is attributed to the more expensive uncached tokens (never under-reports).
    const excess = Math.min(uncached, promptTokens - threshold);
    inputCost = (uncached - excess) * price.in + excess * price.in * inMult + cached * price.cachedIn;
  } else {
    inputCost = uncached * price.in * inMult + cached * price.cachedIn * inMult;
  }
  const costUsd = ((inputCost + output * price.out * outMult) * fastMult) / 1e6;

  const notes = [
    `tabela ${price.confidence}`,
    longContext ? `contexto longo >${threshold} (${codexLongContextMode(env)})` : undefined,
    fast ? `fast ×${fastMult}` : undefined,
  ].filter(Boolean).join(", ");
  return { costUsd, source: `codex tokens × preço de ${input.model} — ${notes} (${version})`, longContext, fast };
}
