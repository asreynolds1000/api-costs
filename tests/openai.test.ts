// Run with: npm test   (node --test, no framework)
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLineItem } from "../src/lib/providers/openai-parse.ts";
import { rekeyOpenAIRows } from "../src/lib/db/rekey-openai.ts";

const parse = (line: string) => {
  const { model, direction, unitType } = parseLineItem(line);
  return [model, direction, unitType];
};

test("openai: token lines keep parsing as before", () => {
  assert.deepEqual(parse("gpt-4o, input"), ["gpt-4o", "input", "tokens"]);
  assert.deepEqual(parse("gpt-4o, cached input"), ["gpt-4o", "input", "tokens"]);
  assert.deepEqual(parse("gpt-4o, output"), ["gpt-4o", "output", "tokens"]);
  assert.deepEqual(parse("gpt-4o-audio, input audio"), ["gpt-4o-audio", "input", "tokens"]);
  assert.deepEqual(parse("gpt-4o-audio, output audio"), ["gpt-4o-audio", "output", "tokens"]);
  assert.deepEqual(parse("Image models"), ["Image models", "total", "images"]);
  assert.deepEqual(parse("Audio models"), ["Audio models", "total", "flat"]);
});

// Line items seen in the cost report that used to fall through to "unknown" (2026-11)
test("openai: cache writes, long context, whisper and web search are recognized", () => {
  assert.deepEqual(parse("gpt-6.1-sol, cache writes"), ["gpt-6.1-sol", "input", "tokens"]);
  assert.deepEqual(parse("gpt-5.4-2026-03-05, input, long context"), ["gpt-5.4-2026-03-05", "input", "tokens"]);
  assert.deepEqual(parse("gpt-5.4-2026-03-05, cached input, long context"), ["gpt-5.4-2026-03-05", "input", "tokens"]);
  assert.deepEqual(parse("gpt-5.4-2026-03-05, output, long context"), ["gpt-5.4-2026-03-05", "output", "tokens"]);
  assert.deepEqual(parse("whisper"), ["whisper", "total", "flat"]);
  assert.deepEqual(parse("web search tool calls"), ["web search tool calls", "total", "requests"]);
  // A token suffix wins over the image/audio category match (these were "images"/"flat" before)
  assert.deepEqual(parse("gpt-image-1, input, long context"), ["gpt-image-1", "input", "tokens"]);
  assert.deepEqual(parse("gpt-4o-audio-preview, cache writes"), ["gpt-4o-audio-preview", "input", "tokens"]);
});

test("openai: an unknown line still falls back to the raw string", () => {
  const warn = console.warn;
  const seen: string[] = [];
  console.warn = (msg: string) => seen.push(msg);
  try {
    assert.deepEqual(parse("brand new thing"), ["brand new thing", "total", "unknown"]);
  } finally {
    console.warn = warn;
  }
  assert.equal(seen.length, 1);
});

// --- re-keying stored rows when the parser changes -------------------------------

function costDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE cost_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, model TEXT NOT NULL, date TEXT NOT NULL,
    cost_usd REAL NOT NULL, unit_type TEXT, direction TEXT, raw_line_item TEXT, source TEXT NOT NULL, synced_at TEXT NOT NULL);
    CREATE UNIQUE INDEX cost_entries_dedup ON cost_entries (provider, model, date, direction, raw_line_item, source);`);
  const add = db.prepare(
    "INSERT INTO cost_entries (provider, model, date, cost_usd, unit_type, direction, raw_line_item, source, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'api_sync', ?)"
  );
  return { db, add: (...a: unknown[]) => add.run(...a) };
}
const dump = (db: Database.Database) =>
  db.prepare("SELECT provider, model, date, cost_usd, unit_type, direction, raw_line_item FROM cost_entries ORDER BY id").raw().all();

test("rekey: rows stored under the old parse move to the new key; others are untouched", () => {
  const { db, add } = costDb();
  add("openai", "gpt-6.1-sol, cache writes", "2026-11-15", 0.02, "unknown", "total", "gpt-6.1-sol, cache writes", "t1");
  add("openai", "whisper", "2026-11-17", 0.5, "unknown", "total", "whisper", "t1");
  add("openai", "gpt-4o", "2026-11-15", 1, "tokens", "input", "gpt-4o, input", "t1");
  add("openai", "gpt-4o", "2026-11-01", 2, "tokens", "input", "", "t1"); // legacy empty raw line item
  add("xai", "grok-4.3", "2026-11-15", 3, "unknown", "total", "grok-4.3", "t1");

  assert.deepEqual(rekeyOpenAIRows(db, parseLineItem), { rekeyed: 2, removed: 0 });
  assert.deepEqual(dump(db), [
    ["openai", "gpt-6.1-sol", "2026-11-15", 0.02, "tokens", "input", "gpt-6.1-sol, cache writes"],
    ["openai", "whisper", "2026-11-17", 0.5, "flat", "total", "whisper"],
    ["openai", "gpt-4o", "2026-11-15", 1, "tokens", "input", "gpt-4o, input"],
    ["openai", "gpt-4o", "2026-11-01", 2, "tokens", "input", ""],
    ["xai", "grok-4.3", "2026-11-15", 3, "unknown", "total", "grok-4.3"],
  ]);
  assert.deepEqual(rekeyOpenAIRows(db, parseLineItem), { rekeyed: 0, removed: 0 }); // idempotent
});

test("rekey: when a sync already stored the new key, the newest copy is kept, not summed", () => {
  const { db, add } = costDb();
  add("openai", "gpt-6.1-sol, cache writes", "2026-11-15", 0.02, "unknown", "total", "gpt-6.1-sol, cache writes", "2026-11-25T13:00:00Z");
  add("openai", "gpt-6.1-sol", "2026-11-15", 0.03, "tokens", "input", "gpt-6.1-sol, cache writes", "2026-11-25T14:00:00Z");
  assert.deepEqual(rekeyOpenAIRows(db, parseLineItem), { rekeyed: 0, removed: 1 });
  assert.deepEqual(dump(db), [["openai", "gpt-6.1-sol", "2026-11-15", 0.03, "tokens", "input", "gpt-6.1-sol, cache writes"]]);

  // And the other way round: the old-key copy is newer (the old server synced after the re-key)
  const second = costDb();
  second.add("openai", "gpt-6.1-sol", "2026-11-15", 0.03, "tokens", "input", "gpt-6.1-sol, cache writes", "2026-11-25T13:00:00Z");
  second.add("openai", "gpt-6.1-sol, cache writes", "2026-11-15", 0.04, "unknown", "total", "gpt-6.1-sol, cache writes", "2026-11-25T14:00:00Z");
  assert.deepEqual(rekeyOpenAIRows(second.db, parseLineItem), { rekeyed: 1, removed: 1 });
  assert.deepEqual(dump(second.db), [["openai", "gpt-6.1-sol", "2026-11-15", 0.04, "tokens", "input", "gpt-6.1-sol, cache writes"]]);
});

test("rekey: no cost_entries table is a no-op", () => {
  assert.deepEqual(rekeyOpenAIRows(new Database(":memory:"), parseLineItem), { rekeyed: 0, removed: 0 });
});

// Codex review 2026-11-25 reproduced this with two workers: one planned from a snapshot taken
// before the other's write, each deleted the copy the other kept, and the charge was gone.
test("rekey: a second connection writing mid-plan cannot make both copies disappear", () => {
  const path = join(mkdtempSync(join(tmpdir(), "rekey-")), "costs.sqlite");
  const setup = new Database(path);
  setup.pragma("journal_mode = WAL");
  setup.exec(`CREATE TABLE cost_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, model TEXT NOT NULL, date TEXT NOT NULL,
    cost_usd REAL NOT NULL, unit_type TEXT, direction TEXT, raw_line_item TEXT, source TEXT NOT NULL, synced_at TEXT NOT NULL);
    CREATE UNIQUE INDEX cost_entries_dedup ON cost_entries (provider, model, date, direction, raw_line_item, source);`);
  const raw = "gpt-6.1-sol, cache writes";
  const add = setup.prepare("INSERT INTO cost_entries VALUES (?, 'openai', ?, '2026-11-15', ?, ?, ?, ?, 'api_sync', ?)");
  add.run(1, raw, 0.02, "unknown", "total", raw, "2026-11-25T13:00:00Z"); // old key, older sync
  add.run(2, "gpt-6.1-sol", 0.03, "tokens", "input", raw, "2026-11-25T14:00:00Z"); // new key, newer sync
  setup.close();

  const a = new Database(path);
  const b = new Database(path);
  b.pragma("busy_timeout = 0");
  let blocked = 0;
  let stamp = 15;
  // On every parse step of A, B makes the old-key copy the newest and runs its own re-key
  const interleaved = (line: string) => {
    try {
      b.prepare("UPDATE cost_entries SET synced_at = ? WHERE id = 1").run(`2026-11-25T${stamp++}:00:00Z`);
      rekeyOpenAIRows(b, parseLineItem);
    } catch (err) {
      if ((err as { code?: string }).code !== "SQLITE_BUSY") throw err;
      blocked++;
    }
    return parseLineItem(line);
  };
  rekeyOpenAIRows(a, interleaved);
  const n = (a.prepare("SELECT count(*) AS n FROM cost_entries").get() as { n: number }).n;
  a.close();
  b.close();
  assert.equal(n, 1);
  assert.ok(blocked > 0, "B was never blocked: A did not hold the write lock while planning");
});
