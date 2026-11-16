// No imports, so tests can load this file directly with node --test.

type Sqlite = { prepare(sql: string): { run(...params: unknown[]): unknown } };

// Delete a provider's synced rows for the dates a fresh response covered in full, so the
// rows written next are exactly what the provider reports now. An upsert alone leaves a row
// behind whenever its key changes: Anthropic reworded its line-item descriptions between
// 2026-08-13 and 2026-11-07 ("Claude Opus 4.6 Usage - Input Tokens" became
// "Claude Opus 4.6 - Input Tokens"), and 2026-08-08 was counted twice. Manual entries and
// dates outside the window are never touched. Run it inside the write transaction.
export function clearSyncedWindow(
  sqlite: Sqlite,
  provider: string,
  window: { from: string; to: string }
): number {
  const res = sqlite
    .prepare(
      `DELETE FROM cost_entries
       WHERE provider = ? AND source = 'api_sync' AND date >= ? AND date <= ?`
    )
    .run(provider, window.from, window.to) as { changes: number };
  return res.changes;
}
