import { formatCurrency, getProviderLabel } from "@/lib/format";
import { toEasternDate } from "@/lib/timezone";
import type { PeriodSummary as PeriodSummaryType, ProviderFreshness } from "@/lib/db/queries";

const periods: { key: keyof PeriodSummaryType; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "thisYear", label: "This Year" },
  { key: "allTime", label: "All Time" },
];

function buildLagWarnings(freshness: ProviderFreshness[]): string[] {
  const todayET = toEasternDate(new Date());
  const warnings: string[] = [];
  for (const { provider, latestDate, totalSpend } of freshness) {
    if (!latestDate || totalSpend < 5) continue;
    const daysOld = Math.floor(
      (new Date(todayET).getTime() - new Date(latestDate).getTime()) / 86400000
    );
    if (daysOld >= 2) {
      const dateLabel = new Date(latestDate + "T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      warnings.push(`${getProviderLabel(provider)} through ${dateLabel}`);
    }
  }
  return warnings;
}

type PeriodSummaryProps = {
  data: PeriodSummaryType;
  freshness?: ProviderFreshness[];
};

export function PeriodSummary({ data, freshness }: PeriodSummaryProps) {
  const lagWarnings = freshness ? buildLagWarnings(freshness) : [];
  const showLagOnCard = (key: string) => key === "today" || key === "yesterday";

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
            {showLagOnCard(key) && lagWarnings.length > 0 && data[key] === 0 && (
              <div className="text-[10px] text-amber-500/80 mt-1 leading-tight">
                Incomplete
              </div>
            )}
          </div>
        ))}
      </div>
      {lagWarnings.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-500/70 flex items-center gap-1.5">
          <span>⚠</span>
          <span>
            API lag: {lagWarnings.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
