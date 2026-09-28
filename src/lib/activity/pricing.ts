// Token-to-USD pricing for local Claude Code / Codex activity (per Reference/API/
// MODEL-CATALOG-REFERENCE.md, re-verify there before trusting a number long-term).
// No imports, same convention as claude-parse.ts / codex-parse.ts.
//
// Default cache rules (used whenever a model has no documented override):
//   cache write, 5-minute TTL: 1.25x input
//   cache write, 1-hour TTL:   2x input
//   cache read:                0.1x input
//
// Evidence per row is in the comment beside it. "cost-state fit" means: computed with this
// table against real per-message usage from ~/.claude/projects and compared to Claude Code's
// own `cost-state` totalCostUSD/modelUsage[model].costUSD for the same session (see the
// verification script referenced in the final report -- this file just carries the numbers).

export type UsageForCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

export type ModelPrice = {
  // USD per 1,000,000 tokens.
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

function priced(input: number, output: number, opts?: { cacheRead?: number; cacheWrite5m?: number; cacheWrite1h?: number }): ModelPrice {
  return {
    input,
    output,
    cacheRead: opts?.cacheRead ?? input * 0.1,
    cacheWrite5m: opts?.cacheWrite5m ?? input * 1.25,
    // Non-Anthropic models have no 5m/1h TTL distinction, and codex-parse.ts always reports
    // 0 cacheWrite1h tokens for them, so this rate is inert there; the default (2x input)
    // still applies uniformly rather than being conditioned on provider.
    cacheWrite1h: opts?.cacheWrite1h ?? input * 2,
  };
}

export const PRICES: Record<string, ModelPrice> = {
  // --- Anthropic (Claude Code) -------------------------------------------------------------
  // Model ids are normalized first (see normalizeModelId): date suffixes and a trailing
  // "[1m]" context-window tag are stripped, since MODEL-CATALOG-REFERENCE lists 1M context
  // as already included at standard pricing for every model below (no long-context premium).

  // $4/$20, cache read $0.20 (MODEL-CATALOG-REFERENCE line 123). Confirmed by cost-state fit:
  // one real session (cache writes ~100% 1h-TTL) reproduced costUSD to within rounding using
  // cacheWrite1h = 2x input ($8), before the full multi-session fit below.
  "claude-opus-5-5": priced(4, 20, { cacheRead: 0.2, cacheWrite1h: 8, cacheWrite5m: 5 }),

  // $5/$25 (line 124), no documented cache-read override -> default 0.1x = $0.50.
  "claude-opus-5": priced(5, 25),

  // $5/$25, same tier as Opus 5 (line 126).
  "claude-opus-4-8": priced(5, 25),

  // $10/$50, cache read $0.25 -- "75% below the usual 0.1x-of-input rate ($1.00)" (line 119).
  "claude-fable-5-1": priced(10, 50, { cacheRead: 0.25 }),

  // $10/$50 (line 122). No special cache-read rate is documented for the older Fable 5 (only
  // 5.1 gets the $0.25 cut), so this uses the default 0.1x = $1.00.
  "claude-fable-5": priced(10, 50),

  // $1/$5 (line 131), default cache rules.
  "claude-haiku-4-5": priced(1, 5),

  // $2/$10. MODEL-CATALOG-REFERENCE flags this as OPEN (line 129: intro $2/$10 "expired"
  // 2026-08-31 but not re-verified since; OpenRouter still listed $2/$10 live on 2026-09-27).
  // Settled here by the cost-state fit (this file's companion verification run): every
  // Sonnet-5 session with a cost-state line matched $2/$10 to within a few percent and did
  // NOT match $3/$15 (see the price-table evidence in the final report). Re-check the
  // reference before trusting this past 2026-Q4 -- the promo has no stated end date.
  "claude-sonnet-5": priced(2, 10),

  // --- OpenAI (Codex) ------------------------------------------------------------------------
  // gpt-6-astra: $10/$50, cached $1.00, cache writes $12.50 (line 155).
  "gpt-6-astra": priced(10, 50, { cacheRead: 1.0, cacheWrite5m: 12.5 }),

  // gpt-6-sol: $2/$10, cached $0.20, cache writes $2.50 (line 156).
  "gpt-6-sol": priced(2, 10, { cacheRead: 0.2, cacheWrite5m: 2.5 }),

  // gpt-5.6-sol: promotional $4/$20, cached $0.40, "at least through 2026-11-21" (line 159).
  // Cache-write rate not documented -> default 1.25x input.
  "gpt-5.6-sol": priced(4, 20, { cacheRead: 0.4 }),

  // gpt-5.6-terra: $2/$12, cached rate "NOT re-confirmed" -> default 0.1x (line 160).
  "gpt-5.6-terra": priced(2, 12),

  // gpt-5.6-luna: $0.20/$1.20, cached rate "NOT re-confirmed" -> default 0.1x (line 161).
  "gpt-5.6-luna": priced(0.2, 1.2),

  // gpt-5.4: $2.50/$15 (line 164), default cache rules.
  "gpt-5.4": priced(2.5, 15),

  // gpt-5.2: $1.75/$14 (line 169), default cache rules.
  "gpt-5.2": priced(1.75, 14),

  // gpt-5: $1.25/$10 (line 172), default cache rules.
  "gpt-5": priced(1.25, 10),

  // gpt-5-mini: $0.25/$2 (line 173), default cache rules.
  "gpt-5-mini": priced(0.25, 2),

  // Deliberately NOT priced (return null, per spec): gpt-5.2-codex, gpt-5.1-codex*,
  // gpt-5-codex -- MODEL-CATALOG-REFERENCE's "Codex Family" table (line 204-213) lists these
  // model ids with no price column at all. "codex-auto-review" is not a documented OpenAI
  // model id (an internal Codex label, not a billable model) and is also left unpriced.
};

const SYNTHETIC_MODELS = new Set(["<synthetic>"]);

// Strips a trailing date suffix ("-20251001") and a trailing bracket tag ("[1m]").
export function normalizeModelId(model: string): string {
  let m = model.replace(/\[[^\]]*\]$/, "");
  m = m.replace(/-\d{8}$/, "");
  return m;
}

export function estimateCost(model: string, usage: UsageForCost): number | null {
  if (SYNTHETIC_MODELS.has(model)) return null;
  const price = PRICES[normalizeModelId(model)];
  if (!price) return null;
  const cost =
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheWrite5m * price.cacheWrite5m +
      usage.cacheWrite1h * price.cacheWrite1h) /
    1_000_000;
  return Number.isFinite(cost) ? cost : null;
}
