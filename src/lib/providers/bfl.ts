import type { ProviderAdapter, CostEntry } from "./types";

export class BflAdapter implements ProviderAdapter {
  provider = "bfl";

  private lastKnownBalance: number | null = null;

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

  async sync(_since: Date): Promise<CostEntry[]> {
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
    const currentBalance = data.credits as number;
    const today = new Date().toISOString().slice(0, 10);

    // BFL only exposes a credit balance, not per-request usage history.
    // We record the balance as a negative cost entry so the dashboard
    // can compute spend by diffing balances across syncs.
    // Credits are 1:1 with cents ($0.01 each), so divide by 100 for USD.
    const entries: CostEntry[] = [];

    if (this.lastKnownBalance !== null && currentBalance < this.lastKnownBalance) {
      const spent = (this.lastKnownBalance - currentBalance) / 100;
      entries.push({
        provider: "bfl",
        model: "flux (aggregate)",
        date: today,
        costUsd: spent,
        unitType: "credits",
        units: this.lastKnownBalance - currentBalance,
        direction: "total",
        rawLineItem: `Balance: ${this.lastKnownBalance} → ${currentBalance} credits`,
      });
    }

    this.lastKnownBalance = currentBalance;
    return entries;
  }
}
