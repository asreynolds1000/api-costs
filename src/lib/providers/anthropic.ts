import type { ProviderAdapter, CostEntry } from "./types";
import { toEasternDate } from "../timezone";

// Anthropic Usage & Cost Admin API.
// Requires an Admin API key (sk-ant-admin01-...), NOT a standard API key.
// Cost amounts are returned as decimal strings in the lowest unit (cents),
// so costUsd = Number(amount) / 100.
// Docs: https://platform.claude.com/docs/en/api/usage-cost-api
//
// NOTE: Anthropic org-level cost data only exists for metered pay-as-you-go
// API usage. Subscription/Max usage does not appear here, so sync() will return
// an empty array (cleanly) until the org has billable API spend.

const BASE = "https://api.anthropic.com/v1/organizations/cost_report";
const VERSION = "2023-06-01";

type AnthropicCostResult = {
  amount?: string | number;
  currency?: string;
  description?: string | null;
  model?: string | null;
  cost_type?: string | null;
  token_type?: string | null;
  workspace_id?: string | null;
};

type AnthropicCostBucket = {
  starting_at: string;
  ending_at: string;
  results: AnthropicCostResult[];
};

type AnthropicCostResponse = {
  data: AnthropicCostBucket[];
  has_more?: boolean;
  next_page?: string | null;
};

export class AnthropicAdapter implements ProviderAdapter {
  provider = "anthropic";

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_ADMIN_KEY;
  }

  private headers() {
    return {
      "x-api-key": process.env.ANTHROPIC_ADMIN_KEY as string,
      "anthropic-version": VERSION,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "ANTHROPIC_ADMIN_KEY not set" };
    }
    try {
      const start = new Date(Date.now() - 86400_000).toISOString();
      const res = await fetch(
        `${BASE}?starting_at=${encodeURIComponent(start)}`,
        { headers: this.headers() }
      );
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async sync(since: Date): Promise<CostEntry[]> {
    if (!this.isConfigured()) throw new Error("ANTHROPIC_ADMIN_KEY not set");

    const entries: CostEntry[] = [];
    const startingAt = since.toISOString();
    const endingAt = new Date().toISOString();
    let page: string | undefined;

    do {
      const params = new URLSearchParams({
        starting_at: startingAt,
        ending_at: endingAt,
      });
      // group by description so results carry parsed model / cost_type fields
      params.append("group_by[]", "description");
      if (page) params.set("page", page);

      const res = await fetch(`${BASE}?${params}`, { headers: this.headers() });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 500)}`);
      }

      const data: AnthropicCostResponse = await res.json();

      for (const bucket of data.data ?? []) {
        const date = toEasternDate(new Date(bucket.starting_at));
        for (const result of bucket.results ?? []) {
          const cents = Number(result.amount ?? 0);
          if (!cents) continue; // skip empty/zero line items
          entries.push({
            provider: "anthropic",
            model: result.model ?? result.description ?? "anthropic",
            date,
            costUsd: cents / 100, // amounts are in cents
            unitType: result.cost_type === "web_search" ? "requests" : "tokens",
            rawLineItem: result.description ?? result.cost_type ?? undefined,
          });
        }
      }

      page = data.next_page ?? undefined;
    } while (page);

    return entries;
  }
}
