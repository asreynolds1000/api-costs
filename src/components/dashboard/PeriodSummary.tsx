import { formatCurrency } from "@/lib/format";
import type { PeriodSummary as PeriodSummaryType } from "@/lib/db/queries";

const periods: { key: keyof PeriodSummaryType; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "thisYear", label: "This Year" },
  { key: "allTime", label: "All Time" },
];

export function PeriodSummary({ data }: { data: PeriodSummaryType }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {periods.map(({ key, label }) => (
        <div
          key={key}
          className="bg-card border border-card-border rounded-lg px-4 py-3 text-center"
        >
          <div className="text-xs text-muted uppercase tracking-wide mb-1">
            {label}
          </div>
          <div className="text-xl font-mono font-semibold">
            {formatCurrency(data[key])}
          </div>
        </div>
      ))}
    </div>
  );
}
