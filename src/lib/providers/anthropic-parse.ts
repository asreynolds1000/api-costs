// Pure parsing for the Anthropic cost report. Type-only imports, so tests can load this file
// directly with node --test.
// Docs: https://platform.claude.com/docs/en/api/usage-cost-api
import type { CostEntry, SyncWindow } from "./types";

// Any response we don't recognise throws. A silent [] would be logged as a successful sync
// of zero records, which looks exactly like a month with no API use.
function shapeError(what: string, got: unknown): never {
  const shown = JSON.stringify(got);
  throw new Error(`Anthropic cost report: unexpected response, ${what} (got ${shown?.slice(0, 120) ?? String(got)})`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function parseCostPage(
  body: unknown,
  toDate: (d: Date) => string
): { entries: CostEntry[]; dates: string[]; nextPage: string | null } {
  if (!isObject(body) || !Array.isArray(body.data)) shapeError("expected a data array", body);
  if (typeof body.has_more !== "boolean") shapeError("expected has_more to be a boolean", body.has_more);
  let nextPage: string | null = null;
  if (body.has_more) {
    if (typeof body.next_page !== "string" || !body.next_page) {
      shapeError("has_more is true but next_page is missing", body.next_page);
    }
    nextPage = body.next_page;
  }

  const entries: CostEntry[] = [];
  const dates: string[] = [];
  for (const bucket of body.data) {
    if (!isObject(bucket) || typeof bucket.starting_at !== "string" || !Array.isArray(bucket.results)) {
      shapeError("expected buckets with starting_at and a results array", bucket);
    }
    const start = new Date(bucket.starting_at);
    if (Number.isNaN(start.getTime())) shapeError("starting_at is not a date", bucket.starting_at);
    const date = toDate(start);
    dates.push(date);

    for (const result of bucket.results) {
      if (!isObject(result)) shapeError("expected result objects", result);
      // amount is a decimal string in the lowest currency unit: "123.45" USD is $1.2345
      const amount = result.amount;
      const cents = typeof amount === "string" || typeof amount === "number" ? Number(amount) : NaN;
      if (amount === "" || !Number.isFinite(cents)) shapeError("amount is not a number", amount);
      if (result.currency !== undefined && result.currency !== "USD") {
        shapeError("expected USD amounts", result.currency);
      }
      if (cents === 0) continue;

      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      entries.push({
        provider: "anthropic",
        model: str(result.model) ?? str(result.description) ?? "anthropic",
        date,
        costUsd: cents / 100,
        unitType: result.cost_type === "web_search" ? "requests" : "tokens",
        rawLineItem: str(result.description) ?? str(result.cost_type),
      });
    }
  }
  return { entries, dates, nextPage };
}

// Follows next_page until has_more is false. The window spans every bucket the API returned,
// empty ones included, so the caller can replace exactly the dates this report covered.
export async function collectCostReport(
  fetchPage: (page: string | undefined) => Promise<unknown>,
  toDate: (d: Date) => string
): Promise<{ entries: CostEntry[]; window: SyncWindow | null }> {
  const entries: CostEntry[] = [];
  const dates: string[] = [];
  const seen = new Set<string>();
  let page: string | undefined;
  do {
    const parsed = parseCostPage(await fetchPage(page), toDate);
    entries.push(...parsed.entries);
    dates.push(...parsed.dates);
    page = parsed.nextPage ?? undefined;
    if (page && seen.has(page)) shapeError("next_page repeated", page);
    if (page) seen.add(page);
  } while (page);

  const sorted = [...dates].sort();
  const window = sorted.length ? { from: sorted[0], to: sorted[sorted.length - 1] } : null;
  return { entries, window };
}
