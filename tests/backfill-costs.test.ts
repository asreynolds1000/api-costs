// Rows indexed before a model had a price keep est_cost_usd NULL, because the indexer skips
// files whose size and mtime have not changed. backfillMissingCosts reprices them from the
// token counts already stored on each row.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { backfillMissingCosts } from "../src/lib/db/backfill-costs.ts";
import { estimateCost } from "../src/lib/activity/pricing.ts";

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE activity_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, input INTEGER NOT NULL,
    output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write_5m INTEGER NOT NULL,
    cache_write_1h INTEGER NOT NULL, est_cost_usd REAL)`);
  const ins = sqlite.prepare(
    "INSERT INTO activity_usage (model, input, output, cache_read, cache_write_5m, cache_write_1h, est_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  ins.run("gpt-6.1-sol", 1_000_000, 1_000_000, 0, 0, 0, null); // indexed under the old table: NULL
  ins.run("gpt-6-astra", 1_000_000, 0, 0, 0, 0, 10); // already priced: must not change
  ins.run("some-made-up-model-id", 1, 1, 0, 0, 0, null); // still unpriced: stays NULL
  return sqlite;
}

const costs = (sqlite: Database.Database) =>
  (sqlite.prepare("SELECT model, est_cost_usd AS c FROM activity_usage ORDER BY id").all() as { model: string; c: number | null }[]).map((r) => r.c);

test("backfill: reprices NULL rows whose model now has a price, and leaves the rest alone", () => {
  const sqlite = freshDb();
  assert.equal(backfillMissingCosts(sqlite, estimateCost), 1);
  assert.deepEqual(costs(sqlite), [12, 10, null]);
});

test("backfill: a second run changes nothing", () => {
  const sqlite = freshDb();
  backfillMissingCosts(sqlite, estimateCost);
  assert.equal(backfillMissingCosts(sqlite, estimateCost), 0);
  assert.deepEqual(costs(sqlite), [12, 10, null]);
});
