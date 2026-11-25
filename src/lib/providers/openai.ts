import type { ProviderAdapter, CostEntry } from "./types";
import { toEasternDate } from "../timezone";
import { parseLineItem } from "./openai-parse";

type OpenAICostBucket = {
  start_time: number;
  end_time: number;
  start_time_iso?: string;
  results: Array<{
    amount: { value: number | string; currency: string };
    line_item: string | null;
    project_id: string | null;
  }>;
};

type OpenAICostResponse = {
  object: string;
  data: OpenAICostBucket[];
  has_more?: boolean;
  next_page?: string;
};

export class OpenAIAdapter implements ProviderAdapter {
  provider = "openai";

  isConfigured(): boolean {
    return !!process.env.OPENAI_ADMIN_KEY;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "OPENAI_ADMIN_KEY not set" };
    }
    try {
      const res = await fetch(
        `https://api.openai.com/v1/organization/costs?start_time=${Math.floor(Date.now() / 1000) - 86400}&limit=1`,
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY}` },
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
    if (!this.isConfigured()) throw new Error("OPENAI_ADMIN_KEY not set");

    const entries: CostEntry[] = [];
    let page: string | undefined;
    const startTime = Math.floor(since.getTime() / 1000);
    const endTime = Math.floor(Date.now() / 1000);

    do {
      const params = new URLSearchParams({
        start_time: String(startTime),
        end_time: String(endTime),
        "group_by[]": "line_item",
        limit: "100",
      });
      if (page) params.set("page", page);

      const res = await fetch(
        `https://api.openai.com/v1/organization/costs?${params}`,
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY}` },
        }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${text.slice(0, 500)}`);
      }

      const data: OpenAICostResponse = await res.json();

      for (const bucket of data.data) {
        const date = toEasternDate(new Date(bucket.start_time * 1000));

        for (const result of bucket.results) {
          const costVal = Number(result.amount?.value ?? 0);
          if (!costVal || costVal === 0) continue;

          const lineItem = result.line_item ?? "unknown";
          const { model, direction, unitType } = parseLineItem(lineItem);

          entries.push({
            provider: "openai",
            model,
            date,
            costUsd: costVal,
            unitType,
            direction,
            rawLineItem: lineItem,
          });
        }
      }

      page = data.next_page;
    } while (page);

    return entries;
  }
}
