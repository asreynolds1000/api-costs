import type { ProviderAdapter, CostEntry } from "./types";

type OpenRouterActivity = {
  date: string;
  model_permaslug: string;
  model: string;
  provider_name: string;
  usage: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
};

type OpenRouterActivityResponse = {
  data: OpenRouterActivity[];
};

// Strip the provider prefix from model names (e.g., "google/gemini-3-pro" -> "gemini-3-pro")
function cleanModelName(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function inferUnitType(model: string): string {
  if (model.includes("image")) return "images";
  if (model.includes("video")) return "video_seconds";
  return "tokens";
}

export class OpenRouterAdapter implements ProviderAdapter {
  provider = "openrouter";

  isConfigured(): boolean {
    return !!process.env.OPENROUTER_MGMT_KEY;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "OPENROUTER_MGMT_KEY not set" };
    }
    try {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_MGMT_KEY}` },
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async sync(_since: Date): Promise<CostEntry[]> {
    if (!this.isConfigured()) throw new Error("OPENROUTER_MGMT_KEY not set");

    // The activity endpoint returns all activity (no date filter param found)
    const res = await fetch("https://openrouter.ai/api/v1/activity", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_MGMT_KEY}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${text.slice(0, 500)}`);
    }

    const data: OpenRouterActivityResponse = await res.json();
    const entries: CostEntry[] = [];

    for (const row of data.data) {
      if (row.usage === 0) continue;

      const date = row.date.slice(0, 10);
      const model = cleanModelName(row.model);

      entries.push({
        provider: "openrouter",
        model,
        date,
        costUsd: row.usage,
        unitType: inferUnitType(model),
        direction: "total",
        tokensIn: row.prompt_tokens || undefined,
        tokensOut: row.completion_tokens || undefined,
        requests: row.requests || undefined,
        rawLineItem: row.model,
      });
    }

    return entries;
  }
}
