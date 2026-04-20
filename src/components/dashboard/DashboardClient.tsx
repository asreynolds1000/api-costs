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
import { ManualEntryForm } from "./ManualEntryForm";
import { DateRangePicker } from "./DateRangePicker";
import { ProviderFilter } from "./ProviderFilter";
import { SyncBar } from "./SyncBar";

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
  const [activeProvider, setActiveProvider] = useState<string | null>(null);

  const cutoffStr = daysAgoStr(rangeDays);
  const todayStr = new Date().toISOString().slice(0, 10);

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

  // Apply date + provider filters
  let filteredDaily = data.daily.filter((d) => d.date >= cutoffStr);
  if (activeProvider) {
    filteredDaily = filteredDaily.filter((d) => d.provider === activeProvider);
  }
  const filteredProviders = aggregateProviders(filteredDaily);

  const displayModels = activeProvider
    ? filteredModels.filter((m) => m.provider === activeProvider)
    : filteredModels;

  // Get unique providers from the data for the filter
  const availableProviders = Array.from(
    new Set(data.daily.map((d) => d.provider))
  ).sort();

  return (
    <div className="max-w-7xl w-full mx-auto px-4 py-6 space-y-4">
      {/* Header + Sync */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">API Cost Dashboard</h1>
          <button
            onClick={() => setShowManualEntry(true)}
            className="text-xs px-2.5 py-1 text-muted hover:text-foreground hover:bg-card-border/30 rounded transition-colors"
          >
            + Add Entry
          </button>
        </div>
        <SyncBar
          statuses={data.syncStatuses}
          providerConfigured={data.providerConfigured}
        />
      </div>

      {/* Period Summary Cards - always relative to today */}
      <PeriodSummary data={data.summary} />

      {/* Filters Row */}
      <div className="flex items-center justify-between">
        <ProviderFilter
          providers={availableProviders}
          active={activeProvider}
          onChange={setActiveProvider}
        />
        <DateRangePicker activeDays={rangeDays} onChange={setRangeDays} />
      </div>

      {/* Chart Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-3 min-w-0 bg-card border border-card-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted mb-3">Daily Spend</h2>
          <div className="h-64">
            <SpendTimeline data={filteredDaily} />
          </div>
        </div>

        <div className="md:col-span-1 min-w-0 bg-card border border-card-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted mb-3">By Provider</h2>
          <div className="h-64">
            <ProviderBreakdown data={filteredProviders} />
          </div>
        </div>
      </div>

      {/* Model Table */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <h2 className="text-sm font-medium text-muted mb-3">Top Models by Spend</h2>
        <div className="h-72 overflow-y-auto">
          <ModelTable data={displayModels} />
        </div>
      </div>

      {/* Manual Entry Modal */}
      {showManualEntry && (
        <ManualEntryForm onClose={() => setShowManualEntry(false)} />
      )}
    </div>
  );
}

function aggregateProviders(daily: DailySpend[]): ProviderSpend[] {
  const map = new Map<string, number>();
  for (const d of daily) {
    map.set(d.provider, (map.get(d.provider) ?? 0) + d.cost);
  }
  return Array.from(map.entries())
    .map(([provider, cost]) => ({ provider, cost }))
    .sort((a, b) => b.cost - a.cost);
}
