// No imports, so tests can load this file directly with node --test.

type Sqlite = {
  prepare(sql: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
};

type Usage = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };

// The indexer prices a row once, when it writes the file's rows, and skips files whose size
// and mtime have not changed. So a model added to the price table after its sessions were
// indexed keeps est_cost_usd NULL forever (gpt-6.1-sol, the Codex default from 2026-09-29,
// had no price until 2026-11-17). This reprices those rows from the token counts already on
// each row. Rows that already have a cost are never touched, so running it again is a no-op.
export function backfillMissingCosts(
  sqlite: Sqlite,
  estimateCost: (model: string, usage: Usage) => number | null
): number {
  const rows = sqlite
    .prepare(
      `SELECT id, model, input, output, cache_read AS cacheRead, cache_write_5m AS cacheWrite5m,
              cache_write_1h AS cacheWrite1h
       FROM activity_usage WHERE est_cost_usd IS NULL`
    )
    .all() as ({ id: number; model: string } & Usage)[];
  const update = sqlite.prepare("UPDATE activity_usage SET est_cost_usd = ? WHERE id = ?");
  let repriced = 0;
  for (const row of rows) {
    const cost = estimateCost(row.model, row);
    if (cost === null) continue;
    update.run(cost, row.id);
    repriced++;
  }
  return repriced;
}
