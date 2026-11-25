// Re-key stored OpenAI rows after a parseLineItem change.
// model and direction are part of the cost_entries dedup key, so a parser change alone makes the
// next sync insert a second copy of every row whose parse changed. Run this with the server
// stopped (pm2 stop api-costs), after a backup, before the new code's first sync.
//
// Run with: npx tsx scripts/reparse-openai.ts <database path>            (dry run)
//           npx tsx scripts/reparse-openai.ts <database path> --apply

import Database from "better-sqlite3";
import { parseLineItem } from "../src/lib/providers/openai-parse";

const [dbPath, flag] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: npx tsx scripts/reparse-openai.ts <database path> [--apply]");
  process.exit(2);
}
const apply = flag === "--apply";
const db = new Database(dbPath);

type Row = { id: number; model: string; direction: string; unit_type: string; raw_line_item: string; cost_usd: number };
const rows = db
  .prepare(
    "SELECT id, model, direction, unit_type, raw_line_item, cost_usd FROM cost_entries WHERE provider = 'openai' AND source = 'api_sync'"
  )
  .all() as Row[];

const changes = rows.flatMap((r) => {
  const next = parseLineItem(r.raw_line_item);
  const same = next.model === r.model && next.direction === r.direction && next.unitType === r.unit_type;
  return same ? [] : [{ ...r, next }];
});

for (const c of changes) {
  console.log(
    `${c.id}\t${c.raw_line_item}\t${c.model}/${c.direction}/${c.unit_type} -> ${c.next.model}/${c.next.direction}/${c.next.unitType}\t$${c.cost_usd.toFixed(2)}`
  );
}
const total = changes.reduce((n, c) => n + c.cost_usd, 0);
console.log(`${changes.length} of ${rows.length} rows change, $${total.toFixed(2)}${apply ? "" : " (dry run)"}`);

if (apply && changes.length) {
  const update = db.prepare("UPDATE cost_entries SET model = ?, direction = ?, unit_type = ? WHERE id = ?");
  db.transaction(() => {
    for (const c of changes) update.run(c.next.model, c.next.direction, c.next.unitType, c.id);
  })();
  console.log("applied");
}
db.close();
