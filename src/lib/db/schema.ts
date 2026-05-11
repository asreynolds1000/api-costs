import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const costEntries = sqliteTable(
  "cost_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(), // "openai", "xai", "gemini"
    model: text("model").notNull(),
    date: text("date").notNull(), // ISO date "2026-04-15"
    costUsd: real("cost_usd").notNull(),
    unitType: text("unit_type").notNull().default("tokens"), // "tokens", "images", "video_seconds", "flat", "unknown"
    units: real("units"),
    direction: text("direction"), // "input", "output", "total", null
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    requests: integer("requests"),
    rawLineItem: text("raw_line_item"),
    source: text("source").notNull(), // "api_sync", "manual", "csv_import"
    syncedAt: text("synced_at").notNull(),
  },
  (table) => [
    uniqueIndex("cost_entries_dedup").on(
      table.provider,
      table.model,
      table.date,
      table.direction,
      table.rawLineItem,
      table.source
    ),
    index("cost_entries_provider_synced").on(
      table.provider,
      table.syncedAt
    ),
  ]
);

export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  syncedAt: text("synced_at").notNull(),
  status: text("status").notNull(), // "success", "error"
  recordsSynced: integer("records_synced"),
  errorMessage: text("error_message"),
});
