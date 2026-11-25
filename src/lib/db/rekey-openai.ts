// No imports, so tests can load this file directly with node --test. The parser is passed in.

type Sqlite = {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
  transaction(fn: () => void): () => void;
};

type Parsed = { model: string; direction: string; unitType: string };

type Row = {
  id: number;
  model: string;
  direction: string;
  unit_type: string;
  date: string;
  raw_line_item: string;
  synced_at: string;
};

// model and direction come from parsing the raw line item, and both are in the cost_entries dedup
// key. When the parser changes, rows stored under the old parse would sit beside the new sync's
// rows and count twice. Runs when the database opens, before any sync: every OpenAI row is moved
// to the key the current parser gives it. Where two rows land on one key (a sync already ran with
// the new parser), the most recently synced one is kept. Idempotent; a no-op once keys match.
// Rows with an empty raw_line_item (legacy, from the 2026-09-28 NULL-key cleanup) are left alone.
export function rekeyOpenAIRows(sqlite: Sqlite, parse: (line: string) => Parsed): { rekeyed: number; removed: number } {
  const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cost_entries'").get();
  if (!hasTable) return { rekeyed: 0, removed: 0 };

  const rows = sqlite
    .prepare(
      `SELECT id, model, direction, unit_type, date, raw_line_item, synced_at FROM cost_entries
       WHERE provider = 'openai' AND source = 'api_sync' AND raw_line_item <> ''`
    )
    .all() as Row[];

  const plan = rows.map((r) => ({ r, next: parse(r.raw_line_item) }));
  const moves = (p: (typeof plan)[number]) =>
    p.next.model !== p.r.model || p.next.direction !== p.r.direction || p.next.unitType !== p.r.unit_type;
  if (!plan.some(moves)) return { rekeyed: 0, removed: 0 };

  // Group by destination key. Rows sharing a date and raw line item share a destination, so any
  // collision is the same charge stored twice.
  const groups = new Map<string, typeof plan>();
  for (const p of plan) {
    const key = JSON.stringify([p.next.model, p.next.direction, p.r.date, p.r.raw_line_item]);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  let rekeyed = 0;
  let removed = 0;
  const del = sqlite.prepare("DELETE FROM cost_entries WHERE id = ?");
  const update = sqlite.prepare("UPDATE cost_entries SET model = ?, direction = ?, unit_type = ? WHERE id = ?");
  sqlite.transaction(() => {
    for (const group of groups.values()) {
      group.sort((a, b) => b.r.synced_at.localeCompare(a.r.synced_at) || b.r.id - a.r.id);
      const [keep, ...drop] = group;
      for (const d of drop) {
        del.run(d.r.id);
        removed++;
      }
      if (moves(keep)) {
        update.run(keep.next.model, keep.next.direction, keep.next.unitType, keep.r.id);
        rekeyed++;
      }
    }
  })();
  return { rekeyed, removed };
}
