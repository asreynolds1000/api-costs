import { BigQuery } from "@google-cloud/bigquery";
import type { ProviderAdapter, CostEntry } from "./types";

// Gemini costs come from GCP BigQuery billing export.
// Setup required:
//   1. Enable BigQuery billing export in GCP Console > Billing > Billing Export
//   2. Create a service account with BigQuery Data Viewer + Job User roles
//   3. Download the JSON key file
//   4. Set env vars: GOOGLE_APPLICATION_CREDENTIALS, GCP_BILLING_PROJECT, GCP_BILLING_DATASET

// SKU descriptions from the billing export that map to Gemini models
const SKU_TO_MODEL: Record<string, string> = {
  "gemini 2.5 flash online input": "gemini-2.5-flash",
  "gemini 2.5 flash online output": "gemini-2.5-flash",
  "gemini 2.5 flash online thinking output": "gemini-2.5-flash",
  "gemini 2.0 flash online input": "gemini-2.0-flash",
  "gemini 2.0 flash online output": "gemini-2.0-flash",
  "gemini 2.5 pro online input": "gemini-2.5-pro",
  "gemini 2.5 pro online output": "gemini-2.5-pro",
  "gemini 2.5 pro online thinking output": "gemini-2.5-pro",
  "gemini 3.1 pro online input": "gemini-3.1-pro-preview",
  "gemini 3.1 pro online output": "gemini-3.1-pro-preview",
  "gemini 3 pro image generation output": "gemini-3-pro-image-preview",
  "gemini 3.1 flash image generation output": "gemini-3.1-flash-image-preview",
  "gemini 2.5 flash image generation output": "gemini-2.5-flash-image",
  "veo 3.1 standard video generation output": "veo-3.1-standard",
  "veo 3.1 fast video generation output": "veo-3.1-fast",
  "veo 3.1 lite video generation output": "veo-3.1-lite",
};

function normalizeModel(skuDescription: string): string {
  const lower = skuDescription.toLowerCase();
  for (const [pattern, model] of Object.entries(SKU_TO_MODEL)) {
    if (lower.includes(pattern)) return model;
  }
  return skuDescription.replace(/Online (Input|Output|Thinking Output)/gi, "").trim().toLowerCase();
}

function inferDirection(skuDescription: string): string {
  const lower = skuDescription.toLowerCase();
  if (lower.includes("input")) return "input";
  if (lower.includes("output")) return "output";
  return "total";
}

function inferUnitType(skuDescription: string): string {
  const lower = skuDescription.toLowerCase();
  if (lower.includes("image generation")) return "images";
  if (lower.includes("video generation")) return "video_seconds";
  return "tokens";
}

// Auto-discover the billing export table name from the dataset
async function findBillingTable(bq: BigQuery, project: string, dataset: string): Promise<string | null> {
  try {
    const [tables] = await bq.dataset(dataset, { projectId: project }).getTables();
    // Look for standard billing export tables (prefix: gcp_billing_export)
    const billingTable = tables.find((t) =>
      t.id?.startsWith("gcp_billing_export")
    );
    if (billingTable) {
      return `${project}.${dataset}.${billingTable.id}`;
    }
    return null;
  } catch {
    return null;
  }
}

export class GeminiAdapter implements ProviderAdapter {
  provider = "gemini";

  isConfigured(): boolean {
    return !!(
      process.env.GOOGLE_APPLICATION_CREDENTIALS &&
      (process.env.GCP_BILLING_TABLE ||
        (process.env.GCP_BILLING_PROJECT && process.env.GCP_BILLING_DATASET))
    );
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: "Gemini billing not configured (need GOOGLE_APPLICATION_CREDENTIALS + GCP_BILLING_PROJECT/DATASET)",
      };
    }
    try {
      const table = await this.getTable();
      if (!table) {
        return {
          ok: false,
          error: "Billing export table not found yet. Data takes a few hours to appear after enabling export.",
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private async getTable(): Promise<string | null> {
    // If explicit table is set, validate and use it
    if (process.env.GCP_BILLING_TABLE) {
      const table = process.env.GCP_BILLING_TABLE;
      if (!/^[\w.-]+$/.test(table)) {
        throw new Error(`Invalid BigQuery table name: ${table}`);
      }
      return table;
    }
    // Otherwise auto-discover from project + dataset
    const project = process.env.GCP_BILLING_PROJECT!;
    const dataset = process.env.GCP_BILLING_DATASET!;
    const bq = new BigQuery();
    return findBillingTable(bq, project, dataset);
  }

  async sync(since: Date): Promise<CostEntry[]> {
    if (!this.isConfigured()) {
      throw new Error("Gemini billing not configured");
    }

    const table = await this.getTable();
    if (!table) {
      throw new Error(
        "Billing export table not found. Data takes a few hours to appear after enabling BigQuery export. Try again later."
      );
    }

    const bq = new BigQuery();
    const sinceStr = since.toISOString().slice(0, 10);

    const query = `
      SELECT
        DATE(usage_start_time) as usage_date,
        sku.description as sku_description,
        SUM(cost) as total_cost,
        SUM(usage.amount) as total_usage,
        usage.unit as usage_unit
      FROM \`${table}\`
      WHERE
        service.description = 'Generative Language API'
        AND DATE(usage_start_time) >= @since_date
        AND cost > 0
      GROUP BY
        usage_date, sku_description, usage_unit
      ORDER BY
        usage_date DESC, total_cost DESC
    `;

    const [rows] = await bq.query({
      query,
      params: { since_date: sinceStr },
    });

    const entries: CostEntry[] = [];

    for (const row of rows) {
      const skuDesc = row.sku_description as string;
      const model = normalizeModel(skuDesc);
      const direction = inferDirection(skuDesc);
      const unitType = inferUnitType(skuDesc);

      entries.push({
        provider: "gemini",
        model,
        date: (row.usage_date as { value: string }).value ?? String(row.usage_date),
        costUsd: Number(row.total_cost),
        unitType,
        units: Number(row.total_usage),
        direction,
        rawLineItem: skuDesc,
      });
    }

    return entries;
  }
}
