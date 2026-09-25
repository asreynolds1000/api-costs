import type { ProviderSpend } from "@/lib/db/queries";
import { getProviderLabel, getProviderColor, formatCurrency } from "@/lib/format";

// Ranked bars: dollars and share for each provider in the selected range.
export function ProviderBreakdown({ data }: { data: ProviderSpend[] }) {
  const rows = data.filter((d) => d.cost > 0);
  const total = rows.reduce((sum, d) => sum + d.cost, 0);

  if (total === 0) {
    return <p className="text-muted text-sm py-6 text-center">No spend in this range.</p>;
  }

  const max = rows[0].cost;

  return (
    <ul className="space-y-3.5">
      {rows.map((d) => {
        const pct = (d.cost / total) * 100;
        return (
          <li key={d.provider}>
            <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
              <span>{getProviderLabel(d.provider)}</span>
              <span className="tabular-nums">
                {formatCurrency(d.cost)}
                <span className="text-muted ml-2 inline-block w-10 text-right">
                  {pct < 1 ? "<1" : Math.round(pct)}%
                </span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-card-border/60" aria-hidden>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max((d.cost / max) * 100, 1.5)}%`,
                  backgroundColor: getProviderColor(d.provider),
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
