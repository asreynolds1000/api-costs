import type { ProviderAdapter, CostEntry, ProviderState } from "./types";
import { toEasternDate } from "@/lib/timezone";

export class BflAdapter implements ProviderAdapter {
  provider = "bfl";


  isConfigured(): boolean {
    return !!process.env.BFL_API_KEY;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "BFL_API_KEY not set" };
    }
    try {
      const res = await fetch("https://api.bfl.ai/v1/credits", {
        headers: {
          accept: "application/json",
          "x-key": process.env.BFL_API_KEY!,
        },
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      const data = await res.json();
      return { ok: true, error: `Balance: $${(data.credits / 100).toFixed(2)}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  // BFL has no usage history, only a credit balance, so spend is the drop between two
  // readings. The last reading lives in provider_state so it survives restarts (it used to
  // be an instance field, and the first sync after every restart recorded nothing).
  async sync(since: Date): Promise<CostEntry[]> {
    return (await this.syncWithState(since, {})).entries;
  }

  async syncWithState(_since: Date, state: ProviderState): Promise<{ entries: CostEntry[]; state: ProviderState }> {
    if (!this.isConfigured()) throw new Error("BFL_API_KEY not set");

    const res = await fetch("https://api.bfl.ai/v1/credits", {
      headers: {
        accept: "application/json",
        "x-key": process.env.BFL_API_KEY!,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BFL API error ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    const current = Number(data.credits);
    if (!Number.isFinite(current)) throw new Error("BFL API returned no credit balance");

    const previous = state.lastBalance !== undefined ? Number(state.lastBalance) : null;
    const entries: CostEntry[] = [];
    // Credits are 1:1 with cents. A top-up raises the balance; spend inside that same
    // window can't be separated from it, so a rise records nothing.
    if (previous !== null && Number.isFinite(previous) && current < previous) {
      entries.push({
        provider: "bfl",
        model: "flux (aggregate)",
        date: toEasternDate(new Date()),
        costUsd: (previous - current) / 100,
        unitType: "credits",
        units: previous - current,
        direction: "total",
        rawLineItem: `Balance: ${previous} → ${current} credits`,
      });
    }

    return { entries, state: { lastBalance: String(current) } };
  }
}
