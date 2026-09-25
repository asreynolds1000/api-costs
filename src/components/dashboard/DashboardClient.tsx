"use client";

import { useEffect, useState } from "react";
import type {
  PeriodSummary as PeriodSummaryType,
  DailySpend,
  ProviderSpend,
  ModelSpend,
  SyncStatus,
} from "@/lib/db/queries";
import type { PlanUsage as PlanUsageType } from "@/lib/plans";
import { DEFAULT_RANGE_DAYS, formatCurrency, formatRelativeTime, getProviderLabel } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";
import { PlanUsage } from "./PlanUsage";
import { PeriodSummary } from "./PeriodSummary";
import { SpendTimeline } from "./SpendTimeline";
import { ProviderBreakdown } from "./ProviderBreakdown";
import { ModelTable } from "./ModelTable";
import { DateRangePicker } from "./DateRangePicker";
import { ProviderFilter } from "./ProviderFilter";
import { SyncBar } from "./SyncBar";
import { SyncHistory } from "./SyncHistory";

type DashboardData = {
  summary: PeriodSummaryType;
  daily: DailySpend[];
  models: ModelSpend[];
  syncStatuses: SyncStatus[];
  providerConfigured: Record<string, boolean>;
  plans: PlanUsageType[];
  serverNow: number;
  today: string; // YYYY-MM-DD, Eastern
};

// A configured provider whose last successful sync trails the newest sync by more than
// this gets flagged. (The daily cron can miss a run while the laptop sleeps; that shows
// in the header instead, not as every provider at once.)
const SYNC_BEHIND_MS = 26 * 60 * 60 * 1000;

export function DashboardClient({ data }: { data: DashboardData }) {
  const [rangeDays, setRangeDays] = useState(DEFAULT_RANGE_DAYS);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  // Models for the default range come from the server; other ranges are fetched.
  const [modelsByRange, setModelsByRange] = useState<Record<number, ModelSpend[] | "error">>({
    [DEFAULT_RANGE_DAYS]: data.models,
  });

  const rangeStart = shiftDate(data.today, -(rangeDays - 1));
  const queryEnd = shiftDate(data.today, 1); // see page.tsx: some providers date rows in UTC
  const haveModels = rangeDays in modelsByRange;

  useEffect(() => {
    if (haveModels) return;
    let cancelled = false;
    fetch(`/api/models?start=${rangeStart}&end=${queryEnd}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ModelSpend[]>;
      })
      .then((rows) => {
        if (!cancelled) setModelsByRange((m) => ({ ...m, [rangeDays]: rows }));
      })
      .catch(() => {
        if (!cancelled) setModelsByRange((m) => ({ ...m, [rangeDays]: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [haveModels, rangeDays, rangeStart, queryEnd]);

  let rangeDaily = data.daily.filter((d) => d.date >= rangeStart);
  if (activeProvider) rangeDaily = rangeDaily.filter((d) => d.provider === activeProvider);
  const rangeProviders = aggregateProviders(rangeDaily);

  const modelState = modelsByRange[rangeDays];
  const models = Array.isArray(modelState) ? modelState : [];
  const displayModels = activeProvider ? models.filter((m) => m.provider === activeProvider) : models;
  const chartEnd = rangeDaily.reduce((end, d) => (d.date > end ? d.date : end), data.today);

  const availableProviders = Array.from(new Set(data.daily.map((d) => d.provider))).sort();

  const successTimes = data.syncStatuses
    .filter((s) => s.lastSuccess)
    .map((s) => new Date(s.lastSuccess!).getTime());
  const newestSync = successTimes.length ? Math.max(...successTimes) : 0;
  const staleSyncs = data.syncStatuses.filter(
    (s) =>
      data.providerConfigured[s.provider] &&
      (!s.lastSuccess || newestSync - new Date(s.lastSuccess).getTime() > SYNC_BEHIND_MS)
  );

  return (
    <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
        <SyncBar statuses={data.syncStatuses} providerConfigured={data.providerConfigured} now={data.serverNow} />
      </header>

      <PlanUsage initial={data.plans} serverNow={data.serverNow} />

      <section aria-labelledby="spend-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="spend-heading" className="text-base font-semibold">
            API spend
          </h2>
          {staleSyncs.length > 0 && (
            <p className="text-xs text-warning">
              Behind the other providers:{" "}
              {staleSyncs
                .map((s) =>
                  s.lastSuccess
                    ? `${getProviderLabel(s.provider)}, last synced ${formatRelativeTime(s.lastSuccess, data.serverNow)}`
                    : `${getProviderLabel(s.provider)}, never synced`
                )
                .join("; ")}
            </p>
          )}
        </div>

        <PeriodSummary data={data.summary} today={data.today} />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <ProviderFilter providers={availableProviders} active={activeProvider} onChange={setActiveProvider} />
          <DateRangePicker activeDays={rangeDays} onChange={setRangeDays} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 min-w-0 bg-card border border-card-border rounded-xl p-4 sm:p-5">
            <h3 className="text-sm font-medium mb-3">{rangeDays > 90 ? "Weekly spend" : "Daily spend"}</h3>
            <div className="h-72">
              <SpendTimeline data={rangeDaily} start={rangeStart} end={chartEnd} weekly={rangeDays > 90} />
            </div>
            {rangeDaily.some((d) => d.provider === "gemini") && (
              <p className="text-xs text-muted mt-3">
                Gemini costs arrive a day or two late, so the most recent days can still rise.
              </p>
            )}
          </div>

          <div className="min-w-0 bg-card border border-card-border rounded-xl p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h3 className="text-sm font-medium">By provider</h3>
              <span className="text-sm tabular-nums text-muted">
                {formatCurrency(rangeProviders.reduce((s, p) => s + p.cost, 0))}
              </span>
            </div>
            <ProviderBreakdown data={rangeProviders} />
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
          <h3 className="text-sm font-medium mb-3">Models by spend</h3>
          <div className="max-h-96 overflow-y-auto">
            {modelState === "error" ? (
              <p className="text-critical text-sm py-6 text-center">
                Couldn&apos;t load models for this range. Reload the page to try again.
              </p>
            ) : haveModels ? (
              <ModelTable data={displayModels} />
            ) : (
              <p className="text-muted text-sm py-6 text-center">Loading…</p>
            )}
          </div>
        </div>

        <SyncHistory />
      </section>
    </main>
  );
}

function aggregateProviders(daily: DailySpend[]): ProviderSpend[] {
  const map = new Map<string, number>();
  for (const d of daily) map.set(d.provider, (map.get(d.provider) ?? 0) + d.cost);
  return Array.from(map.entries())
    .map(([provider, cost]) => ({ provider, cost }))
    .sort((a, b) => b.cost - a.cost);
}
