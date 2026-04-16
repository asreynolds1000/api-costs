import type { ProviderAdapter, CostEntry } from "./types";

// Parse OpenAI line_item strings like "gpt-4o, input" or "Image models"
function parseLineItem(lineItem: string): { model: string; direction: string; unitType: string } {
  // Common format: "model-name, input" or "model-name, output" or "model-name, cached input"
  const commaMatch = lineItem.match(/^(.+),\s*(cached input|input|output|input audio|output audio)$/i);
  if (commaMatch) {
    return {
      model: commaMatch[1].trim(),
      direction: commaMatch[2].toLowerCase().includes("input") ? "input" : "output",
      unitType: "tokens",
    };
  }

  // Category-level items like "Image models", "Audio models"
  if (/image/i.test(lineItem)) {
    return { model: lineItem, direction: "total", unitType: "images" };
  }
  if (/audio/i.test(lineItem)) {
    return { model: lineItem, direction: "total", unitType: "flat" };
  }

  // Fallback: store the raw string as the model name
  console.warn(`[openai] Unrecognized line_item format: "${lineItem}"`);
  return { model: lineItem, direction: "total", unitType: "unknown" };
}

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
        const date = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);

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
