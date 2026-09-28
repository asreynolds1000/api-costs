"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  PeriodSummary as PeriodSummaryType,
  DailySpend,
  ProviderSpend,
  ModelSpend,
  SyncStatus,
} from "@/lib/db/queries";
import type { PlanUsage as PlanUsageType } from "@/lib/plans";
import type { SchedulerState } from "@/lib/scheduler";
import type { ActivityResult } from "@/lib/activity/queries";
import { ActivitySection } from "./ActivitySection";
import { DEFAULT_RANGE_DAYS, formatCurrency, formatRelativeTime, getProviderLabel } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";
import { PlanUsage } from "./PlanUsage";
import { SpendHero } from "./SpendHero";
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
  scheduler: SchedulerState;
  activityYear: ActivityResult;
  activity: ActivityResult;
  serverNow: number;
  today: string; // YYYY-MM-DD, Eastern
};

// A configured provider whose last successful sync trails the newest sync by more than
// this gets flagged. (The daily cron can miss a run while the laptop sleeps; that shows
// in the header instead, not as every provider at once.)
const SYNC_BEHIND_MS = 26 * 60 * 60 * 1000;

// Re-render from the server (router.refresh keeps client state such as the range and filter).
const PAGE_REFRESH_MS = 2 * 60 * 1000;

export function DashboardClient({ data }: { data: DashboardData }) {
  const [rangeDays, setRangeDays] = useState(DEFAULT_RANGE_DAYS);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  // Models for the default range come from the server; other ranges are fetched.
  const [modelsByRange, setModelsByRange] = useState<Record<number, ModelSpend[] | "error">>({
    [DEFAULT_RANGE_DAYS]: data.models,
  });
  // New server data (auto-refresh or a sync) makes the cached model lists stale. Reset them
  // during render when the data changes, rather than remounting, which would reset the range.
  const [dataStamp, setDataStamp] = useState(data.serverNow);
  if (dataStamp !== data.serverNow) {
    setDataStamp(data.serverNow);
    setModelsByRange({ [DEFAULT_RANGE_DAYS]: data.models });
  }

  useAutoRefresh(data.serverNow);

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
        <h1 className="font-display text-3xl font-semibold tracking-tight">AI usage</h1>
        <SyncBar statuses={data.syncStatuses} scheduler={data.scheduler} serverNow={data.serverNow} />
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

        <SpendHero summary={data.summary} daily={data.daily} today={data.today} />

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

      </section>

      <ActivitySection year={data.activityYear} initial={data.activity} today={data.today} serverNow={data.serverNow} />

      <SyncHistory />
    </main>
  );
}

// Refresh every PAGE_REFRESH_MS while visible, and right away when the tab comes back after
// being away longer than that. Hidden tabs don't poll.
function useAutoRefresh(renderedAt: number) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => startTransition(() => router.refresh());
    const due = () => Date.now() - renderedAt >= PAGE_REFRESH_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, PAGE_REFRESH_MS);
    const onReturn = () => {
      if (document.visibilityState === "visible" && due()) refresh();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [router, renderedAt]);
}

function aggregateProviders(daily: DailySpend[]): ProviderSpend[] {
  const map = new Map<string, number>();
  for (const d of daily) map.set(d.provider, (map.get(d.provider) ?? 0) + d.cost);
  return Array.from(map.entries())
    .map(([provider, cost]) => ({ provider, cost }))
    .sort((a, b) => b.cost - a.cost);
}
