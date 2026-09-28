// No imports, so tests can load this file directly with node --test.

type Sqlite = {
  prepare(sql: string): { get(): unknown; run(): unknown };
  transaction(fn: () => void): () => void;
};

// Before 2026-09-28 some adapters wrote NULL into direction / raw_line_item. SQLite treats
// NULLs as distinct in the dedup index, so each sync inserted another copy, and a normalized
// row written now would sit beside the old NULL row. Collapse every group that shares a
// normalized key to its newest row, then normalize what survives. Idempotent; a no-op once clean.
export function collapseNullDedupKeys(sqlite: Sqlite): number {
  const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cost_entries'").get();
  if (!hasTable) return 0;
  const dirty = sqlite
    .prepare("SELECT 1 FROM cost_entries WHERE direction IS NULL OR raw_line_item IS NULL LIMIT 1")
    .get();
  if (!dirty) return 0;

  let removed = 0;
  sqlite.transaction(() => {
    const res = sqlite
      .prepare(
        `DELETE FROM cost_entries WHERE id NOT IN (
           SELECT max(id) FROM cost_entries
           GROUP BY provider, model, date, coalesce(direction, 'total'), coalesce(raw_line_item, ''), source)`
      )
      .run() as { changes: number };
    removed = res.changes;
    sqlite.prepare("UPDATE cost_entries SET direction = 'total' WHERE direction IS NULL").run();
    sqlite.prepare("UPDATE cost_entries SET raw_line_item = '' WHERE raw_line_item IS NULL").run();
  })();
  return removed;
}
