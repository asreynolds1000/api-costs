// No imports, so tests can load this file directly with node --test.

type Sqlite = {
  prepare(sql: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };
};

const STATE_PROVIDER = "activity-index";
const STATE_KEY = "pricing_version";

// Transcript files the indexer must re-parse even when unchanged, so a model with a long-context
// tier gets per-request prices:
// - always, a file with an unpriced row for such a model (the aggregate backfill skips them);
// - once per pricing version, every file with such a model's rows, because rows priced by older
//   code (from a daily total, or from an average prompt size) are not NULL and would otherwise
//   keep their old cost.
export function pathsNeedingReprice(
  sqlite: Sqlite,
  hasLongContextTier: (model: string) => boolean,
  pricingVersion: string
): Set<string> {
  const stored = sqlite
    .prepare("SELECT value FROM provider_state WHERE provider = ? AND key = ?")
    .get(STATE_PROVIDER, STATE_KEY) as { value: string } | undefined;
  const upgrading = stored?.value !== pricingVersion;
  const rows = sqlite
    .prepare(
      upgrading
        ? "SELECT DISTINCT path, model FROM activity_usage"
        : "SELECT DISTINCT path, model FROM activity_usage WHERE est_cost_usd IS NULL"
    )
    .all() as { path: string; model: string }[];
  return new Set(rows.filter((r) => hasLongContextTier(r.model)).map((r) => r.path));
}

// Call after a scan that re-parsed the files above. A file pruned from disk cannot be re-parsed,
// so its rows keep their older cost; recording the version stops retrying it on every run.
export function recordPricingVersion(sqlite: Sqlite, pricingVersion: string): void {
  sqlite
    .prepare(
      `INSERT INTO provider_state (provider, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (provider, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(STATE_PROVIDER, STATE_KEY, pricingVersion, new Date().toISOString());
}
