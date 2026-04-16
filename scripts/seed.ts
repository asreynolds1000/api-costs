// Seed test data for development
// Run with: npx tsx scripts/seed.ts

import Database from "better-sqlite3";
import { join } from "path";

const DB_PATH = join(process.cwd(), "data", "costs.sqlite");
const db = new Database(DB_PATH);

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const now = new Date().toISOString();

const insert = db.prepare(`
  INSERT OR REPLACE INTO cost_entries
    (provider, model, date, cost_usd, unit_type, units, direction, tokens_in, tokens_out, requests, raw_line_item, source, synced_at)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Generate 60 days of varied data
const models = [
  { provider: "openai", model: "gpt-5.4-mini", minCost: 0.05, maxCost: 2.5 },
  { provider: "openai", model: "gpt-5.4", minCost: 0.1, maxCost: 5.0 },
  { provider: "openai", model: "gpt-image-1.5", minCost: 0.02, maxCost: 1.0 },
  { provider: "openai", model: "o4-mini", minCost: 0.05, maxCost: 3.0 },
  { provider: "xai", model: "grok-4-1-fast-reasoning", minCost: 0.01, maxCost: 0.8 },
  { provider: "xai", model: "grok-4.20-0309-reasoning", minCost: 0.1, maxCost: 4.0 },
  { provider: "xai", model: "grok-imagine-image", minCost: 0.02, maxCost: 0.5 },
  { provider: "gemini", model: "gemini-2.5-flash", minCost: 0.01, maxCost: 0.5 },
  { provider: "gemini", model: "gemini-3-pro-image-preview", minCost: 0.05, maxCost: 1.5 },
  { provider: "gemini", model: "gemini-2.5-pro", minCost: 0.05, maxCost: 2.0 },
];

let count = 0;
for (let day = 0; day < 60; day++) {
  const date = dateStr(day);
  // Each day, randomly include 3-8 models
  const activeModels = models
    .filter(() => Math.random() > 0.3)
    .slice(0, Math.floor(randomBetween(3, 8)));

  for (const m of activeModels) {
    const cost = randomBetween(m.minCost, m.maxCost);
    const tokensIn = Math.floor(randomBetween(1000, 500000));
    const tokensOut = Math.floor(randomBetween(500, 200000));
    const reqs = Math.floor(randomBetween(1, 50));

    insert.run(
      m.provider,
      m.model,
      date,
      Math.round(cost * 10000) / 10000,
      m.model.includes("image") ? "images" : "tokens",
      tokensIn + tokensOut,
      "total",
      tokensIn,
      tokensOut,
      reqs,
      null,
      "manual",
      now
    );
    count++;
  }
}

console.log(`Seeded ${count} cost entries across 60 days`);
db.close();
