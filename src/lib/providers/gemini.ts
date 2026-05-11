import { BigQuery } from "@google-cloud/bigquery";
import type { ProviderAdapter, CostEntry } from "./types";
import { toEasternDate } from "../timezone";

// Gemini costs come from GCP BigQuery billing export.
// Setup required:
//   1. Enable BigQuery billing export in GCP Console > Billing > Billing Export
//   2. Create a service account with BigQuery Data Viewer + Job User roles
//   3. Download the JSON key file
//   4. Set env vars: GOOGLE_APPLICATION_CREDENTIALS, GCP_BILLING_PROJECT, GCP_BILLING_DATASET

// Pattern-based model extraction from SKU descriptions.
// Real SKU examples from BigQuery:
//   "Gemini 3.1 Flash Image Image Output - Predictions"
//   "Generate_content image output token count for Gemini 3 Pro Image"
//   "Generate_content text output token count for gemini 3 pro short"
//   "Generate content output token count Gemini 2.5 Pro short output text"
//   "Generate content output token count gemini 2.5 flash short input text"
//   "Veo Generation 720p with Audio"
//   "Veo Fast Generation 1080p with Audio"
//   "Veo Lite Generation 720p with Audio"
const MODEL_PATTERNS: Array<[RegExp, string]> = [
  [/gemini 3\.1 flash image/i, "gemini-3.1-flash-image"],
  [/gemini 3 pro image/i, "gemini-3-pro-image"],
  [/gemini 2\.5 flash native image/i, "gemini-2.5-flash-image"],
  [/gemini 3\.1 pro/i, "gemini-3.1-pro"],
  [/gemini 3 pro/i, "gemini-3-pro"],
  [/gemini 2\.5 pro/i, "gemini-2.5-pro"],
  [/gemini 2\.5 flash/i, "gemini-2.5-flash"],
  [/gemini 2\.0 flash/i, "gemini-2.0-flash"],
  [/veo.*lite/i, "veo-lite"],
  [/veo.*fast/i, "veo-fast"],
  [/veo/i, "veo-standard"],
];

function normalizeModel(skuDescription: string): string {
  for (const [pattern, model] of MODEL_PATTERNS) {
    if (pattern.test(skuDescription)) return model;
  }
  return skuDescription.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, "");
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
    const sinceStr = toEasternDate(since);

    const query = `
      SELECT
        DATE(usage_start_time, "America/New_York") as usage_date,
        sku.description as sku_description,
        SUM(cost) as total_cost,
        SUM(usage.amount) as total_usage,
        usage.unit as usage_unit
      FROM \`${table}\`
      WHERE
        service.description IN ('Generative Language API', 'Gemini API')
        AND DATE(usage_start_time, "America/New_York") >= @since_date
        AND cost > 0
        AND sku.description NOT LIKE '%Tax%'
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
