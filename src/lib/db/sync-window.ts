// No imports, so tests can load this file directly with node --test.

type Sqlite = {
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown };
};

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

export function countSyncedWindow(
  sqlite: Sqlite,
  provider: string,
  window: { from: string; to: string }
): number {
  const row = sqlite
    .prepare(
      `SELECT count(*) AS n FROM cost_entries
       WHERE provider = ? AND source = 'api_sync' AND date >= ? AND date <= ?`
    )
    .get(provider, window.from, window.to) as { n: number };
  return row.n;
}

// A well-formed response with no cost lines at all, over dates where rows are stored, is far
// more likely a key moved to another organization or a lost permission than spend that
// vanished. Fail the sync (it is logged as an error) rather than delete those rows.
export function checkWindowReplace(
  newCount: number,
  storedCount: number,
  window: { from: string; to: string }
): void {
  if (newCount === 0 && storedCount > 0) {
    throw new Error(
      `Refusing to clear ${storedCount} synced rows for ${window.from} to ${window.to}: ` +
        "the provider returned no cost lines for that range. Check the key's organization and permissions."
    );
  }
}
