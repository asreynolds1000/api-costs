// Run with: npm test   (node --test, no framework)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { parseCostPage, collectCostReport } from "../src/lib/providers/anthropic-parse.ts";
import { checkWindowReplace, clearSyncedWindow, countSyncedWindow } from "../src/lib/db/sync-window.ts";
import { dedupKey } from "../src/lib/providers/normalize.ts";
import { toEasternDate } from "../src/lib/timezone.ts";

// One day of the real cost report (group_by[]=description), 2026-08-22 UTC, trimmed to two results.
const realBucket = {
  starting_at: "2026-08-22T00:00:00Z",
  ending_at: "2026-08-23T00:00:00Z",
  results: [
    {
      currency: "USD", amount: "0.0105", workspace_id: null, description: "Claude Haiku 4.5 - Input Tokens",
      cost_type: "tokens", context_window: "0-200k", model: "claude-haiku-4-5-20251001", service_tier: "standard",
      token_type: "uncached_input_tokens", inference_geo: "not_available", speed: "standard",
    },
    {
      currency: "USD", amount: "3.652", workspace_id: null, description: "Claude Haiku 4.5 - Input Tokens, Cache Write",
      cost_type: "tokens", context_window: "0-200k", model: "claude-haiku-4-5-20251001", service_tier: "standard",
      token_type: "cache_creation.ephemeral_5m_input_tokens", inference_geo: "not_available", speed: "standard",
    },
  ],
};
const emptyBucket = (day: string) => ({ starting_at: `${day}T00:00:00Z`, ending_at: "", results: [] });
const page = (data: unknown[], nextPage: string | null = null) => ({ data, has_more: nextPage !== null, next_page: nextPage });

test("anthropic: a real cost report bucket parses to dollars on the Eastern date", () => {
  const { entries, dates, nextPage } = parseCostPage(page([realBucket]), toEasternDate);
  assert.equal(nextPage, null);
  assert.deepEqual(dates, ["2026-08-21"]);
  assert.deepEqual(
    entries.map((e) => [e.date, e.model, e.rawLineItem, e.costUsd]),
    [
      ["2026-08-21", "claude-haiku-4-5-20251001", "Claude Haiku 4.5 - Input Tokens", 0.0105 / 100],
      ["2026-08-21", "claude-haiku-4-5-20251001", "Claude Haiku 4.5 - Input Tokens, Cache Write", 3.652 / 100],
    ]
  );
});

// Before 2026-11-16 each of these synced zero records and was logged as a success.
test("anthropic: a response without a data array throws instead of syncing nothing", () => {
  assert.throws(() => parseCostPage({ buckets: [realBucket], has_more: false }, toEasternDate), /data array/);
  assert.throws(() => parseCostPage({ error: { type: "x" } }, toEasternDate), /data array/);
});

test("anthropic: a result without a numeric amount throws instead of being skipped as zero", () => {
  const renamed = { ...realBucket, results: [{ ...realBucket.results[0], amount: undefined, cost: "0.0105" }] };
  assert.throws(() => parseCostPage(page([renamed]), toEasternDate), /amount/);
  const bad = { ...realBucket, results: [{ ...realBucket.results[0], amount: "n/a" }] };
  assert.throws(() => parseCostPage(page([bad]), toEasternDate), /amount/);
});

test("anthropic: paging fields that don't add up throw instead of truncating", () => {
  assert.throws(() => parseCostPage({ data: [], has_more: true, next_page: null }, toEasternDate), /next_page/);
  assert.throws(() => parseCostPage({ data: [] }, toEasternDate), /has_more/);
});

test("anthropic: pages are followed to the end and the window spans empty days", async () => {
  const pages: Record<string, unknown> = {
    first: page([realBucket, emptyBucket("2026-08-23")], "p2"),
    p2: page([emptyBucket("2026-08-24")]),
  };
  const asked: (string | undefined)[] = [];
  const { entries, window } = await collectCostReport(async (p) => {
    asked.push(p);
    return pages[p ?? "first"];
  }, toEasternDate);
  assert.deepEqual(asked, [undefined, "p2"]);
  assert.equal(entries.length, 2);
  assert.deepEqual(window, { from: "2026-08-21", to: "2026-08-23" });
});

test("anthropic: a report with no buckets has no window, so nothing is replaced", async () => {
  const { entries, window } = await collectCostReport(async () => page([]), toEasternDate);
  assert.deepEqual([entries, window], [[], null]);
});

// --- replacing the synced window ------------------------------------------------------

// Same unique index as cost_entries_dedup in src/lib/db/schema.ts
function tempTable() {
  const db = new Database(join(mkdtempSync(join(tmpdir(), "api-costs-")), "t.sqlite"));
  db.exec(`CREATE TABLE cost_entries (id INTEGER PRIMARY KEY, provider TEXT, model TEXT, date TEXT,
    direction TEXT, raw_line_item TEXT, source TEXT, cost_usd REAL);
    CREATE UNIQUE INDEX cost_entries_dedup ON cost_entries (provider, model, date, direction, raw_line_item, source);`);
  const upsert = db.prepare(`INSERT INTO cost_entries (provider, model, date, direction, raw_line_item, source, cost_usd)
    VALUES (@provider, @model, @date, @direction, @rawLineItem, @source, @cost)
    ON CONFLICT (provider, model, date, direction, raw_line_item, source) DO UPDATE SET cost_usd = excluded.cost_usd`);
  const write = (rows: { date: string; line: string; cost: number; provider?: string; source?: string }[]) => {
    for (const r of rows) {
      upsert.run({
        provider: r.provider ?? "anthropic", model: "claude-opus-4-6", date: r.date, source: r.source ?? "api_sync",
        cost: r.cost, ...dedupKey({ rawLineItem: r.line }),
      });
    }
  };
  type Row = { provider: string; date: string; line: string; source: string; cost: number };
  const rows = () =>
    db.prepare("SELECT provider, date, raw_line_item AS line, source, cost_usd AS cost FROM cost_entries ORDER BY id").all() as Row[];
  return { db, write, rows };
}

// What happened to 2026-08-08: synced on 08-13, then Anthropic reworded the description
const before = { date: "2026-08-08", line: "Claude Opus 4.6 Usage - Input Tokens", cost: 0.14428 };
const after = { date: "2026-08-08", line: "Claude Opus 4.6 - Input Tokens", cost: 0.14428 };

test("anthropic: an upsert alone keeps a reworded line item twice (the bug)", () => {
  const { write, rows } = tempTable();
  write([before]);
  write([after]);
  assert.equal(rows().length, 2);
});

test("anthropic: replacing the synced window leaves one row per line item", () => {
  const { db, write, rows } = tempTable();
  write([before]);
  const outside = { date: "2026-08-07", line: "Claude Opus 4.6 Usage - Input Tokens", cost: 1 };
  const manual = { date: "2026-08-08", line: "invoice", cost: 5, source: "manual" };
  const otherProvider = { date: "2026-08-08", line: "gpt", cost: 2, provider: "openai" };
  write([outside, manual, otherProvider]);

  const removed = clearSyncedWindow(db, "anthropic", { from: "2026-08-08", to: "2026-08-21" });
  write([after]);

  assert.equal(removed, 1);
  assert.deepEqual(
    rows().map((r) => [r.provider, r.date, r.line, r.source]),
    [
      ["anthropic", "2026-08-07", outside.line, "api_sync"],
      ["anthropic", "2026-08-08", "invoice", "manual"],
      ["openai", "2026-08-08", "gpt", "api_sync"],
      ["anthropic", "2026-08-08", after.line, "api_sync"],
    ]
  );
});

test("anthropic: a line item the provider stops reporting is removed on the next sync", () => {
  const { db, write, rows } = tempTable();
  write([after]);
  clearSyncedWindow(db, "anthropic", { from: "2026-08-08", to: "2026-08-08" }); // day now reports nothing
  assert.equal(rows().length, 0);
});

test("anthropic: an empty response over stored rows fails instead of clearing them", () => {
  const { db, write, rows } = tempTable();
  write([after, { date: "2026-08-07", line: "invoice", cost: 5, source: "manual" }]);
  const window = { from: "2026-08-01", to: "2026-08-21" };
  const stored = countSyncedWindow(db, "anthropic", window);
  assert.equal(stored, 1); // manual rows are not counted
  assert.throws(() => checkWindowReplace(0, stored, window), /Refusing to clear 1 synced rows/);
  assert.equal(rows().length, 2);
});

test("anthropic: an empty response over an empty window is fine", () => {
  const { db } = tempTable();
  const window = { from: "2026-10-01", to: "2026-11-15" };
  assert.doesNotThrow(() => checkWindowReplace(0, countSyncedWindow(db, "anthropic", window), window));
});

test("anthropic: a response with lines may replace stored rows", () => {
  assert.doesNotThrow(() => checkWindowReplace(3, 7, { from: "2026-08-01", to: "2026-08-21" }));
});
