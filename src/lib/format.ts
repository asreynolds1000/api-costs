const summaryFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const detailFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// For summary cards and totals (2 decimal places)
export function formatCurrency(amount: number): string {
  return summaryFormatter.format(amount);
}

// For per-model detail where sub-cent costs are common (up to 4 decimal places)
export function formatCurrencyDetail(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return detailFormatter.format(amount);
  return summaryFormatter.format(amount);
}

// Provider display names and colors
export const PROVIDER_CONFIG: Record<string, { label: string; color: string }> = {
  openai: { label: "OpenAI", color: "var(--provider-openai)" },
  xai: { label: "xAI", color: "var(--provider-xai)" },
  gemini: { label: "Gemini", color: "var(--provider-gemini)" },
  openrouter: { label: "OpenRouter", color: "var(--provider-openrouter)" },
  bfl: { label: "BFL (Flux)", color: "var(--provider-bfl, #7c3aed)" },
  fal: { label: "FAL", color: "var(--provider-fal, #ec4899)" },
};

export const PROVIDER_NAMES = Object.keys(PROVIDER_CONFIG);

export function getProviderLabel(provider: string): string {
  return PROVIDER_CONFIG[provider]?.label ?? provider;
}

export function getProviderColor(provider: string): string {
  return PROVIDER_CONFIG[provider]?.color ?? "#888";
}

// Date helpers
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
