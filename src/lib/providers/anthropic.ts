import type { ProviderAdapter, CostEntry, SyncWindow } from "./types";
import { toEasternDate } from "../timezone";
import { collectCostReport } from "./anthropic-parse";

// Anthropic Usage & Cost Admin API.
// Requires an Admin API key (sk-ant-admin01-...), NOT a standard API key.
// Cost amounts are returned as decimal strings in the lowest unit (cents),
// so costUsd = Number(amount) / 100. Parsing and paging: ./anthropic-parse.ts.
// Docs: https://platform.claude.com/docs/en/api/usage-cost-api
//
// NOTE: Anthropic org-level cost data only exists for metered pay-as-you-go
// API usage. Subscription/Max usage does not appear here, so a sync covering
// days with no API use correctly returns no entries.

const BASE = "https://api.anthropic.com/v1/organizations/cost_report";
const VERSION = "2023-06-01";

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
    return (await this.syncWindow(since)).entries;
  }

  async syncWindow(since: Date): Promise<{ entries: CostEntry[]; window: SyncWindow | null }> {
    if (!this.isConfigured()) throw new Error("ANTHROPIC_ADMIN_KEY not set");

    // Whole UTC days only: a window starting mid-day could return a partial first bucket, and
    // the window replace would swap that day's full rows for partial totals.
    const start = new Date(since);
    start.setUTCHours(0, 0, 0, 0);
    const startingAt = start.toISOString();
    const endingAt = new Date().toISOString();

    return collectCostReport(async (page) => {
      const params = new URLSearchParams({
        starting_at: startingAt,
        ending_at: endingAt,
        // 31 daily buckets per page (the default is 7), so 90 days is 3 requests, not 13
        limit: "31",
      });
      // group by description so results carry parsed model / cost_type fields
      params.append("group_by[]", "description");
      if (page) params.set("page", page);

      const res = await fetch(`${BASE}?${params}`, { headers: this.headers() });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 500)}`);
      }
      return res.json();
    }, toEasternDate);
  }
}
