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

// Provider display names and colours. Key order is the chart stack order and the
// order the colours were validated in (see globals.css), so keep them in step.
export const PROVIDER_CONFIG: Record<string, { label: string; color: string }> = {
  gemini: { label: "Gemini", color: "var(--provider-gemini)" },
  anthropic: { label: "Anthropic", color: "var(--provider-anthropic)" },
  openai: { label: "OpenAI", color: "var(--provider-openai)" },
  openrouter: { label: "OpenRouter", color: "var(--provider-openrouter)" },
  fal: { label: "fal.ai", color: "var(--provider-fal)" },
  bfl: { label: "BFL (Flux)", color: "var(--provider-bfl)" },
  xai: { label: "xAI", color: "var(--provider-xai)" },
};

export const PROVIDER_NAMES = Object.keys(PROVIDER_CONFIG);

export function getProviderLabel(provider: string): string {
  return PROVIDER_CONFIG[provider]?.label ?? provider;
}

export function getProviderColor(provider: string): string {
  return PROVIDER_CONFIG[provider]?.color ?? "var(--muted)";
}

export function formatRelativeTime(isoString: string, now = Date.now()): string {
  const diffMins = Math.floor((now - new Date(isoString).getTime()) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

const ET = "America/New_York";
const clockFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
const dayClockFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ET,
});

// "1:00 PM" within the next 20 hours, otherwise "Thu 11:00 PM"
export function formatClockTime(epochSec: number, nowSec: number): string {
  const d = new Date(epochSec * 1000);
  return Math.abs(epochSec - nowSec) < 20 * 3600 ? clockFmt.format(d) : dayClockFmt.format(d);
}

// "12m", "2h 10m", "6d 5h"
export function formatDuration(seconds: number): string {
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// Default date range for the spend views, in days (server and client must agree)
export const DEFAULT_RANGE_DAYS = 30;
