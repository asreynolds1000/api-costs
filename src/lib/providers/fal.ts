import type { ProviderAdapter, CostEntry } from "./types";

interface FalRequest {
  request_id: string;
  endpoint: string;
  status_code: number;
  billable_units: number;
  billing_status: string;
  duration: number;
  started_at: string;
  ended_at: string;
}

export class FalAdapter implements ProviderAdapter {
  provider = "fal";

  isConfigured(): boolean {
    return !!process.env.FAL_API_KEY;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "FAL_API_KEY not set" };
    }
    try {
      const res = await fetch("https://rest.alpha.fal.ai/users/current", {
        headers: { Authorization: `Key ${process.env.FAL_API_KEY}` },
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      const data = await res.json();
      return { ok: true, error: `Account: ${data.email}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async sync(since: Date): Promise<CostEntry[]> {
    if (!this.isConfigured()) throw new Error("FAL_API_KEY not set");

    const startTime = since.toISOString();
    const endTime = new Date().toISOString();
    const allRequests: FalRequest[] = [];

    let url: string | null =
      `https://rest.alpha.fal.ai/requests/?start_time=${startTime}&end_time=${endTime}&limit=100`;

    while (url) {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Key ${process.env.FAL_API_KEY}` },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`fal.ai API error ${res.status}: ${text.slice(0, 500)}`);
      }

      const data: { items?: FalRequest[]; next?: string } = await res.json();
      const items: FalRequest[] = data.items ?? [];

      for (const item of items) {
        if (
          item.billing_status === "PROCESSED" &&
          item.billable_units > 0 &&
          item.status_code >= 200 &&
          item.status_code < 300
        ) {
          allRequests.push(item);
        }
      }

      url = data.next ? data.next : null;
    }

    const dailyByModel = new Map<string, {
      costUsd: number;
      units: number;
      requests: number;
    }>();

    for (const req of allRequests) {
      const model = simplifyEndpoint(req.endpoint);
      const date = (req.started_at ?? req.ended_at).slice(0, 10);
      const key = `${model}|${date}`;

      const existing = dailyByModel.get(key) ?? { costUsd: 0, units: 0, requests: 0 };
      existing.units += req.billable_units;
      existing.requests += 1;
      dailyByModel.set(key, existing);
    }

    const entries: CostEntry[] = [];
    for (const [key, data] of dailyByModel) {
      const [model, date] = key.split("|");
      entries.push({
        provider: "fal",
        model,
        date,
        costUsd: 0,
        unitType: "units",
        units: data.units,
        direction: "total",
        requests: data.requests,
        rawLineItem: `${data.requests} requests, ${data.units} billable units`,
      });
    }

    return entries;
  }
}

function simplifyEndpoint(endpoint: string): string {
  return endpoint
    .replace(/^fal-ai\//, "")
    .replace(/^bytedance\//, "");
}
