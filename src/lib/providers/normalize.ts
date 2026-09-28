// No imports, so tests can load this file directly with node --test.

// The cost_entries dedup index includes direction and raw_line_item. SQLite treats NULLs
// as distinct in a unique index, so a NULL in either column made every sync insert a fresh
// copy of the same row (Anthropic had 6 copies of each row by 2026-09-28). Never write NULL.
export function dedupKey(entry: { direction?: string | null; rawLineItem?: string | null }) {
  return { direction: entry.direction ?? "total", rawLineItem: entry.rawLineItem ?? "" };
}
