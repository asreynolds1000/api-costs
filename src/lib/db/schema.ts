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

// Small per-provider key/value state that must survive restarts (e.g. BFL's last credit balance).
export const providerState = sqliteTable(
  "provider_state",
  {
    provider: text("provider").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("provider_state_pk").on(table.provider, table.key)]
);

// --- Activity indexing (Claude Code / Codex local transcripts) -----------------------------
// Rows are keyed by source FILE PATH: re-parsing a file replaces its rows in one transaction.
// Rows are NEVER deleted just because a file disappeared from disk (Claude Code prunes old
// transcripts), so history survives even after the source file is gone.

export const activityFiles = sqliteTable("activity_files", {
  path: text("path").primaryKey(),
  source: text("source").notNull(), // "claude-code" | "codex"
  size: integer("size").notNull(),
  mtimeMs: integer("mtime_ms").notNull(),
  parsedAt: text("parsed_at").notNull(),
});

export const activityUsage = sqliteTable(
  "activity_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    path: text("path").notNull(),
    date: text("date").notNull(), // ISO date, Eastern
    source: text("source").notNull(), // "claude-code" | "codex"
    project: text("project").notNull(),
    model: text("model").notNull(),
    messages: integer("messages").notNull(),
    input: integer("input").notNull(),
    output: integer("output").notNull(),
    cacheRead: integer("cache_read").notNull(),
    cacheWrite5m: integer("cache_write_5m").notNull(),
    cacheWrite1h: integer("cache_write_1h").notNull(),
    estCostUsd: real("est_cost_usd"), // NULL when the model isn't in the price table
  },
  (table) => [
    index("activity_usage_date").on(table.date),
    index("activity_usage_path").on(table.path),
  ]
);

export const activityTools = sqliteTable(
  "activity_tools",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    path: text("path").notNull(),
    date: text("date").notNull(), // ISO date, Eastern
    source: text("source").notNull(), // "claude-code" | "codex"
    kind: text("kind").notNull(), // "builtin" | "mcp" | "skill" | "subagent" | "codex"
    grp: text("grp"), // MCP server name / subagent model / null
    name: text("name").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    index("activity_tools_date").on(table.date),
    index("activity_tools_path").on(table.path),
  ]
);

export const activitySessions = sqliteTable("activity_sessions", {
  path: text("path").primaryKey(),
  source: text("source").notNull(), // "claude-code" | "codex"
  sessionId: text("session_id").notNull(),
  project: text("project").notNull(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at").notNull(),
  isSubagent: integer("is_subagent").notNull(), // 0 | 1
});
