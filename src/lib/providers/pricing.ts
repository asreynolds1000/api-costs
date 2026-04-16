// Token-to-USD pricing tables with effective dates.
// Used for providers that return token counts instead of costs (xAI, Gemini manual calc).
// Prices are per 1M tokens unless noted otherwise.

type PricingEntry = {
  model: string;
  effectiveFrom: string; // ISO date
  inputPerMillion: number;
  outputPerMillion: number;
  unit?: "tokens" | "images" | "video_seconds";
  flatRate?: number; // for per-image or per-second pricing
};

// xAI/Grok pricing (per 1M tokens unless flatRate specified)
export const xaiPricing: PricingEntry[] = [
  { model: "grok-4.20-0309-reasoning", effectiveFrom: "2025-01-01", inputPerMillion: 2.0, outputPerMillion: 6.0 },
  { model: "grok-4.20-0309-non-reasoning", effectiveFrom: "2025-01-01", inputPerMillion: 2.0, outputPerMillion: 6.0 },
  { model: "grok-4.20-multi-agent-0309", effectiveFrom: "2025-01-01", inputPerMillion: 2.0, outputPerMillion: 6.0 },
  { model: "grok-4-1-fast-reasoning", effectiveFrom: "2025-01-01", inputPerMillion: 0.2, outputPerMillion: 0.5 },
  { model: "grok-4-1-fast-non-reasoning", effectiveFrom: "2025-01-01", inputPerMillion: 0.2, outputPerMillion: 0.5 },
  { model: "grok-4-0709", effectiveFrom: "2025-01-01", inputPerMillion: 3.0, outputPerMillion: 15.0 },
  { model: "grok-code-fast-1", effectiveFrom: "2025-01-01", inputPerMillion: 0.2, outputPerMillion: 1.5 },
  { model: "grok-imagine-image", effectiveFrom: "2025-01-01", inputPerMillion: 0, outputPerMillion: 0, unit: "images", flatRate: 0.02 },
  { model: "grok-imagine-image-pro", effectiveFrom: "2025-01-01", inputPerMillion: 0, outputPerMillion: 0, unit: "images", flatRate: 0.07 },
  { model: "grok-imagine-video", effectiveFrom: "2025-01-01", inputPerMillion: 0, outputPerMillion: 0, unit: "video_seconds", flatRate: 0.05 },
];

// Gemini pricing (per 1M tokens)
export const geminiPricing: PricingEntry[] = [
  { model: "gemini-2.5-flash", effectiveFrom: "2025-01-01", inputPerMillion: 0.3, outputPerMillion: 2.5 },
  { model: "gemini-2.5-pro", effectiveFrom: "2025-01-01", inputPerMillion: 1.25, outputPerMillion: 10.0 },
  { model: "gemini-3.1-pro-preview", effectiveFrom: "2025-01-01", inputPerMillion: 2.0, outputPerMillion: 12.0 },
  { model: "gemini-3-pro-image-preview", effectiveFrom: "2025-01-01", inputPerMillion: 0, outputPerMillion: 60.0, unit: "images" },
  { model: "gemini-3.1-flash-image-preview", effectiveFrom: "2025-01-01", inputPerMillion: 0, outputPerMillion: 60.0, unit: "images" },
  { model: "gemini-2.5-flash-image", effectiveFrom: "2025-01-01", inputPerMillion: 0, outputPerMillion: 60.0, unit: "images" },
];

// Look up pricing for a model on a given date
export function getModelPricing(
  pricingTable: PricingEntry[],
  model: string,
  date: string
): PricingEntry | undefined {
  // Find the most recent pricing entry for this model that's effective on or before the date
  const candidates = pricingTable
    .filter((p) => p.model === model && p.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates[0];
}

// Calculate cost from token counts
export function calculateTokenCost(
  pricing: PricingEntry,
  tokensIn: number,
  tokensOut: number
): number {
  if (pricing.unit === "images" || pricing.unit === "video_seconds") {
    return 0; // These use flat rates, not token pricing
  }
  return (tokensIn * pricing.inputPerMillion + tokensOut * pricing.outputPerMillion) / 1_000_000;
}
