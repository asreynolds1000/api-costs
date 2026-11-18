// Files whose rows need per-request repricing: unpriced rows for a tiered model always, and every
// file with a tiered model's rows once when the stored pricing version is behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { pathsNeedingReprice, recordPricingVersion } from "../src/lib/db/reprice-paths.ts";

const tiered = (m: string) => m === "claude-haiku-5-5";

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE activity_usage (path TEXT NOT NULL, model TEXT NOT NULL, est_cost_usd REAL);
    CREATE TABLE provider_state (provider TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX provider_state_pk ON provider_state (provider, key);`);
  const ins = sqlite.prepare("INSERT INTO activity_usage (path, model, est_cost_usd) VALUES (?, ?, ?)");
  ins.run("a.jsonl", "claude-haiku-5-5", 0.5);   // priced the old way (from the daily total)
  ins.run("b.jsonl", "claude-haiku-5-5", null);  // never priced
  ins.run("c.jsonl", "claude-sonnet-5-5", 1.0);  // no tier: never re-parsed for this
  ins.run("d.jsonl", "claude-sonnet-5-5", null); // no tier: the aggregate backfill handles it
  return sqlite;
}

test("reprice: before the upgrade, every file with a tiered model's rows is re-parsed", () => {
  const sqlite = freshDb();
  assert.deepEqual([...pathsNeedingReprice(sqlite, tiered, "2")].sort(), ["a.jsonl", "b.jsonl"]);
});

test("reprice: after recording the version, only unpriced tiered rows are re-parsed", () => {
  const sqlite = freshDb();
  recordPricingVersion(sqlite, "2");
  assert.deepEqual([...pathsNeedingReprice(sqlite, tiered, "2")], ["b.jsonl"]);
  // A later version bump re-parses the tiered files again.
  assert.deepEqual([...pathsNeedingReprice(sqlite, tiered, "3")].sort(), ["a.jsonl", "b.jsonl"]);
});
