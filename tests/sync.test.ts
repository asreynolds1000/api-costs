// Run with: npm test   (node --test, no framework)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { dedupKey } from "../src/lib/providers/normalize.ts";
import { collapseNullDedupKeys } from "../src/lib/db/migrate-dedup.ts";

// Same unique index as cost_entries_dedup in src/lib/db/schema.ts
function tempTable() {
  const db = new Database(join(mkdtempSync(join(tmpdir(), "api-costs-")), "t.sqlite"));
  db.exec(`CREATE TABLE cost_entries (id INTEGER PRIMARY KEY, provider TEXT, model TEXT, date TEXT,
    direction TEXT, raw_line_item TEXT, source TEXT, cost_usd REAL);
    CREATE UNIQUE INDEX cost_entries_dedup ON cost_entries (provider, model, date, direction, raw_line_item, source);`);
  const upsert = db.prepare(`INSERT INTO cost_entries (provider, model, date, direction, raw_line_item, source, cost_usd)
    VALUES (@provider, @model, @date, @direction, @rawLineItem, 'api_sync', @cost)
    ON CONFLICT (provider, model, date, direction, raw_line_item, source) DO UPDATE SET cost_usd = excluded.cost_usd`);
  const count = () => (db.prepare("SELECT count(*) AS n FROM cost_entries").get() as { n: number }).n;
  const total = () => (db.prepare("SELECT sum(cost_usd) AS t FROM cost_entries").get() as { t: number }).t;
  return { db, upsert, count, total };
}

const entry = { provider: "anthropic", model: "claude-x", date: "2026-08-08", cost: 1.5 };

test("NULL key columns defeat the dedup index (the bug)", () => {
  const { upsert, count } = tempTable();
  upsert.run({ ...entry, direction: null, rawLineItem: null });
  upsert.run({ ...entry, direction: null, rawLineItem: null });
  assert.equal(count(), 2);
});

test("syncing the same entries twice leaves one row once keys are normalized", () => {
  const { upsert, count } = tempTable();
  for (let i = 0; i < 2; i++) {
    upsert.run({ ...entry, ...dedupKey({ direction: undefined, rawLineItem: undefined }) });
    upsert.run({ ...entry, ...dedupKey({ direction: "input", rawLineItem: "input tokens" }) });
  }
  assert.equal(count(), 2);
});

test("dedupKey keeps real values and never returns null", () => {
  assert.deepEqual(dedupKey({ direction: "output", rawLineItem: "x" }), { direction: "output", rawLineItem: "x" });
  assert.deepEqual(dedupKey({ direction: null, rawLineItem: null }), { direction: "total", rawLineItem: "" });
});

test("upgrading a database with legacy NULL-key duplicates collapses them to the newest row", () => {
  const { db, upsert, count, total } = tempTable();
  upsert.run({ ...entry, cost: 1.0, direction: null, rawLineItem: null });
  upsert.run({ ...entry, cost: 1.0, direction: null, rawLineItem: null });
  upsert.run({ ...entry, cost: 1.5, direction: null, rawLineItem: null }); // newest
  assert.equal(collapseNullDedupKeys(db), 2);
  assert.equal(count(), 1);
  assert.equal(total(), 1.5);
  // A normalized sync now updates that row instead of adding one
  upsert.run({ ...entry, cost: 2, ...dedupKey({}) });
  assert.equal(count(), 1);
  assert.equal(total(), 2);
  assert.equal(collapseNullDedupKeys(db), 0); // idempotent
});
