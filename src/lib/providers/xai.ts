import type { ProviderAdapter, CostEntry } from "./types";

type XaiTimeSeries = {
  group: string[];
  groupLabels: string[];
  dataPoints: Array<{
    timestamp: string;
    values: number[];
  }>;
  limitReached: boolean;
};

type XaiUsageResponse = {
  timeSeries: XaiTimeSeries[];
};

// Parse the description group label to extract model name and infer type
// Examples: "Chat grok-4-1-fast-non-reasoning", "grok-imagine-image", "grok-imagine-video"
function parseDescription(desc: string): { model: string; unitType: string } {
  // Strip "Chat " prefix
  const cleaned = desc.replace(/^Chat\s+/i, "");

  if (cleaned.includes("imagine-video")) {
    return { model: cleaned, unitType: "video_seconds" };
  }
  if (cleaned.includes("imagine-image")) {
    return { model: cleaned, unitType: "images" };
  }
  return { model: cleaned, unitType: "tokens" };
}

export class XaiAdapter implements ProviderAdapter {
  provider = "xai";

  isConfigured(): boolean {
    return !!process.env.XAI_MANAGEMENT_KEY && !!process.env.XAI_TEAM_ID;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "XAI_MANAGEMENT_KEY or XAI_TEAM_ID not set" };
    }
    try {
      const res = await fetch(
        `https://management-api.x.ai/v1/billing/teams/${process.env.XAI_TEAM_ID}/prepaid/balance`,
        {
          headers: { Authorization: `Bearer ${process.env.XAI_MANAGEMENT_KEY}` },
        }
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
    if (!this.isConfigured()) throw new Error("XAI_MANAGEMENT_KEY or XAI_TEAM_ID not set");

    const teamId = process.env.XAI_TEAM_ID!;
    const now = new Date();

    // Format dates as "YYYY-MM-DD HH:MM:SS"
    const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

    const body = {
      analyticsRequest: {
        timeRange: {
          startTime: fmt(since),
          endTime: fmt(now),
          timezone: "America/New_York",
        },
        timeUnit: "TIME_UNIT_DAY",
        values: [{ name: "usd", aggregation: "AGGREGATION_SUM" }],
        groupBy: ["description"],
        filters: [],
      },
    };

    const res = await fetch(
      `https://management-api.x.ai/v1/billing/teams/${teamId}/usage`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.XAI_MANAGEMENT_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`xAI API error ${res.status}: ${text.slice(0, 500)}`);
    }

    const data: XaiUsageResponse = await res.json();
    const entries: CostEntry[] = [];

    for (const series of data.timeSeries) {
      const desc = series.group[0] ?? series.groupLabels[0] ?? "unknown";
      const { model, unitType } = parseDescription(desc);

      for (const point of series.dataPoints) {
        const costUsd = point.values[0] ?? 0;
        if (costUsd === 0) continue;

        const date = point.timestamp.slice(0, 10);

        entries.push({
          provider: "xai",
          model,
          date,
          costUsd,
          unitType,
          direction: "total",
          rawLineItem: desc,
        });
      }
    }

    return entries;
  }
}
