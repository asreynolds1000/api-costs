"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  PeriodSummary as PeriodSummaryType,
  DailySpend,
  ProviderSpend,
  ModelSpend,
  SyncStatus,
} from "@/lib/db/queries";
import { PeriodSummary } from "./PeriodSummary";
import { SpendTimeline } from "./SpendTimeline";
import { ProviderBreakdown } from "./ProviderBreakdown";
import { ModelTable } from "./ModelTable";
import { SyncPanel } from "./SyncPanel";
import { ManualEntryForm } from "./ManualEntryForm";
import { DateRangePicker } from "./DateRangePicker";

type DashboardData = {
  summary: PeriodSummaryType;
  daily: DailySpend[];
  providers: ProviderSpend[];
  models: ModelSpend[];
  syncStatuses: SyncStatus[];
  providerConfigured: Record<string, boolean>;
};

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function DashboardClient({ data }: { data: DashboardData }) {
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [rangeDays, setRangeDays] = useState(30);
  const [filteredModels, setFilteredModels] = useState<ModelSpend[]>(data.models);
  const [syncing, setSyncing] = useState(false);

  const cutoffStr = daysAgoStr(rangeDays);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Sync all configured providers on page load (max once per hour)
  useEffect(() => {
    const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    const lastSync = localStorage.getItem("api-costs-last-sync");
    const now = Date.now();

    if (lastSync && now - Number(lastSync) < SYNC_INTERVAL_MS) return;

    const configured = Object.entries(data.providerConfigured)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (configured.length === 0) return;

    localStorage.setItem("api-costs-last-sync", String(now));
    setSyncing(true);

    Promise.all(
      configured.map((p) =>
        fetch(`/api/sync/${p}`, { method: "POST" }).catch(() => null)
      )
    ).then(() => {
      setSyncing(false);
      window.location.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch model data for the selected range
  const fetchModels = useCallback(async (start: string, end: string) => {
    try {
      const res = await fetch(`/api/models?start=${start}&end=${end}`);
      if (res.ok) {
        const models: ModelSpend[] = await res.json();
        setFilteredModels(models);
      }
    } catch {
      // Keep existing data on error
    }
  }, []);

  useEffect(() => {
    fetchModels(cutoffStr, todayStr);
  }, [cutoffStr, todayStr, fetchModels]);

  const filteredDaily = data.daily.filter((d) => d.date >= cutoffStr);
  const filteredProviders = aggregateProviders(filteredDaily);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">API Cost Dashboard</h1>
        {syncing && <span className="text-xs text-muted animate-pulse">Syncing...</span>}
      </div>

      {/* Period Summary Cards - always relative to today */}
      <PeriodSummary data={data.summary} />

      {/* Chart Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Spend Timeline - 3/4 width on desktop */}
        <div className="md:col-span-3 bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted">Daily Spend</h2>
            <DateRangePicker activeDays={rangeDays} onChange={setRangeDays} />
          </div>
          <div className="h-64">
            <SpendTimeline data={filteredDaily} />
          </div>
        </div>

        {/* Provider Breakdown - 1/4 width on desktop */}
        <div className="md:col-span-1 bg-card border border-card-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted mb-3">By Provider</h2>
          <div className="h-64">
            <ProviderBreakdown data={filteredProviders} />
          </div>
        </div>
      </div>

      {/* Model Table */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <h2 className="text-sm font-medium text-muted mb-3">Top Models by Spend</h2>
        <ModelTable data={filteredModels} />
      </div>

      {/* Sync Panel */}
      <SyncPanel
        statuses={data.syncStatuses}
        providerConfigured={data.providerConfigured}
        onManualEntry={() => setShowManualEntry(true)}
      />

      {/* Manual Entry Modal */}
      {showManualEntry && (
        <ManualEntryForm onClose={() => setShowManualEntry(false)} />
      )}
    </div>
  );
}

// Re-aggregate providers from filtered daily data
function aggregateProviders(daily: DailySpend[]): ProviderSpend[] {
  const map = new Map<string, number>();
  for (const d of daily) {
    map.set(d.provider, (map.get(d.provider) ?? 0) + d.cost);
  }
  return Array.from(map.entries())
    .map(([provider, cost]) => ({ provider, cost }))
    .sort((a, b) => b.cost - a.cost);
}
