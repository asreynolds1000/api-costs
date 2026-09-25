import { formatCurrency } from "@/lib/format";
import type { PeriodSummary as PeriodSummaryType } from "@/lib/db/queries";

type Tile = { label: string; value: number; detail?: string };

export function PeriodSummary({ data, today }: { data: PeriodSummaryType; today: string }) {
  const lastMonthName = new Date(`${today}T12:00:00Z`);
  lastMonthName.setUTCDate(1);
  lastMonthName.setUTCMonth(lastMonthName.getUTCMonth() - 1);
  const lastMonthLabel = lastMonthName.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  const tiles: Tile[] = [
    { label: "This week", value: data.thisWeek },
    { label: "This month", value: data.thisMonth, detail: `${lastMonthLabel}: ${formatCurrency(data.lastMonth)}` },
    { label: "Last 30 days", value: data.last30Days },
    {
      label: "This year",
      value: data.thisYear,
      detail:
        Math.abs(data.allTime - data.thisYear) >= 0.01 ? `All time: ${formatCurrency(data.allTime)}` : undefined,
    },
  ];

  return (
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="bg-card border border-card-border rounded-xl px-4 py-3.5">
          <dt className="text-sm text-muted">{t.label}</dt>
          <dd className="text-2xl font-semibold tracking-tight mt-1">{formatCurrency(t.value)}</dd>
          {t.detail && <dd className="text-xs text-muted mt-1">{t.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
