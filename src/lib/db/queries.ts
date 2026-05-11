import { sql, eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "./index";
import { costEntries, syncLog } from "./schema";
import { toEasternDate } from "../timezone";
import { PROVIDER_NAMES } from "../format";

function todayET(): string {
  return toEasternDate(new Date());
}

function offsetET(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toEasternDate(d);
}

function startOfDay(): string {
  return todayET();
}

function startOfYesterday(): string {
  return offsetET(-1);
}

function startOfWeek(): string {
  const long = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(new Date());
  const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(long);
  return offsetET(-dayOfWeek);
}

function startOfMonth(): string {
  const today = todayET();
  return today.slice(0, 8) + "01";
}

function startOfYear(): string {
  const today = todayET();
  return today.slice(0, 5) + "01-01";
}

export type PeriodSummary = {
  today: number;
  yesterday: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
  allTime: number;
};

export function getPeriodSummary(): PeriodSummary {
  const today = startOfDay();
  const yesterday = startOfYesterday();
  const week = startOfWeek();
  const month = startOfMonth();
  const year = startOfYear();

  const row = db
    .select({
      today: sql<number>`COALESCE(SUM(CASE WHEN ${costEntries.date} >= ${today} THEN ${costEntries.costUsd} END), 0)`,
      yesterday: sql<number>`COALESCE(SUM(CASE WHEN ${costEntries.date} = ${yesterday} THEN ${costEntries.costUsd} END), 0)`,
      thisWeek: sql<number>`COALESCE(SUM(CASE WHEN ${costEntries.date} >= ${week} THEN ${costEntries.costUsd} END), 0)`,
      thisMonth: sql<number>`COALESCE(SUM(CASE WHEN ${costEntries.date} >= ${month} THEN ${costEntries.costUsd} END), 0)`,
      thisYear: sql<number>`COALESCE(SUM(CASE WHEN ${costEntries.date} >= ${year} THEN ${costEntries.costUsd} END), 0)`,
      allTime: sql<number>`COALESCE(SUM(${costEntries.costUsd}), 0)`,
    })
    .from(costEntries)
    .get()!;

  return row;
}

// Daily spend by provider for chart
export type DailySpend = {
  date: string;
  provider: string;
  cost: number;
};

export function getDailySpend(startDate: string, endDate: string): DailySpend[] {
  return db
    .select({
      date: costEntries.date,
      provider: costEntries.provider,
      cost: sql<number>`SUM(${costEntries.costUsd})`,
    })
    .from(costEntries)
    .where(and(gte(costEntries.date, startDate), lte(costEntries.date, endDate)))
    .groupBy(costEntries.date, costEntries.provider)
    .orderBy(costEntries.date)
    .all();
}

// Spend by provider
export type ProviderSpend = {
  provider: string;
  cost: number;
};

export function getProviderSpend(startDate?: string, endDate?: string): ProviderSpend[] {
  const conditions = [];
  if (startDate) conditions.push(gte(costEntries.date, startDate));
  if (endDate) conditions.push(lte(costEntries.date, endDate));

  return db
    .select({
      provider: costEntries.provider,
      cost: sql<number>`SUM(${costEntries.costUsd})`,
    })
    .from(costEntries)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(costEntries.provider)
    .orderBy(sql`SUM(${costEntries.costUsd}) DESC`)
    .all();
}

// Spend by model
export type ModelSpend = {
  model: string;
  provider: string;
  cost: number;
  requests: number;
};

export function getModelSpend(startDate?: string, endDate?: string): ModelSpend[] {
  const conditions = [];
  if (startDate) conditions.push(gte(costEntries.date, startDate));
  if (endDate) conditions.push(lte(costEntries.date, endDate));

  return db
    .select({
      model: costEntries.model,
      provider: costEntries.provider,
      cost: sql<number>`SUM(${costEntries.costUsd})`,
      requests: sql<number>`COALESCE(SUM(${costEntries.requests}), 0)`,
    })
    .from(costEntries)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(costEntries.model, costEntries.provider)
    .orderBy(sql`SUM(${costEntries.costUsd}) DESC`)
    .all();
}

// Last sync time per provider
export type SyncStatus = {
  provider: string;
  lastSync: string | null;
  status: string | null;
  recordsSynced: number | null;
};

export function getSyncStatuses(): SyncStatus[] {
  const providers = PROVIDER_NAMES;
  return providers.map((provider) => {
    const latest = db
      .select()
      .from(syncLog)
      .where(eq(syncLog.provider, provider))
      .orderBy(desc(syncLog.syncedAt))
      .limit(1)
      .get();

    return {
      provider,
      lastSync: latest?.syncedAt ?? null,
      status: latest?.status ?? null,
      recordsSynced: latest?.recordsSynced ?? null,
    };
  });
}

// Insert a manual cost entry
export type ManualEntry = {
  provider: string;
  model: string;
  date: string;
  costUsd: number;
  unitType?: string;
  units?: number;
  direction?: string;
  tokensIn?: number;
  tokensOut?: number;
  requests?: number;
};

export function insertManualEntry(entry: ManualEntry) {
  db.insert(costEntries)
    .values({
      provider: entry.provider,
      model: entry.model,
      date: entry.date,
      costUsd: entry.costUsd,
      unitType: entry.unitType || "unknown",
      units: entry.units ?? null,
      direction: entry.direction ?? "total",
      tokensIn: entry.tokensIn ?? null,
      tokensOut: entry.tokensOut ?? null,
      requests: entry.requests ?? null,
      rawLineItem: null,
      source: "manual",
      syncedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [
        costEntries.provider,
        costEntries.model,
        costEntries.date,
        costEntries.direction,
        costEntries.rawLineItem,
        costEntries.source,
      ],
      set: {
        costUsd: entry.costUsd,
        unitType: entry.unitType || "unknown",
        units: entry.units ?? null,
        tokensIn: entry.tokensIn ?? null,
        tokensOut: entry.tokensOut ?? null,
        requests: entry.requests ?? null,
        syncedAt: new Date().toISOString(),
      },
    })
    .run();
}

// Log a sync operation
export function logSync(provider: string, status: string, recordsSynced?: number, errorMessage?: string) {
  db.insert(syncLog).values({
    provider,
    syncedAt: new Date().toISOString(),
    status,
    recordsSynced: recordsSynced ?? null,
    errorMessage: errorMessage ?? null,
  }).run();
}

// Full sync history for a provider (most recent first)
export type SyncLogEntry = {
  id: number;
  provider: string;
  syncedAt: string;
  status: string;
  recordsSynced: number | null;
  errorMessage: string | null;
};

export function getSyncHistory(provider: string, limit = 20): SyncLogEntry[] {
  return db
    .select()
    .from(syncLog)
    .where(eq(syncLog.provider, provider))
    .orderBy(desc(syncLog.syncedAt))
    .limit(limit)
    .all();
}

export function getAllSyncHistory(limit = 20): Record<string, SyncLogEntry[]> {
  const providers = PROVIDER_NAMES;
  const result: Record<string, SyncLogEntry[]> = {};
  for (const p of providers) {
    result[p] = getSyncHistory(p, limit);
  }
  return result;
}

// Latest data date per provider (for freshness indicators)
export type ProviderFreshness = {
  provider: string;
  latestDate: string | null;
  totalSpend: number;
};

// Entries that were touched by a specific sync run
export type SyncedEntry = {
  model: string;
  date: string;
  costUsd: number;
  direction: string | null;
  unitType: string;
  tokensIn: number | null;
  tokensOut: number | null;
  requests: number | null;
  rawLineItem: string | null;
};

export function getEntriesForSync(provider: string, syncedAt: string): SyncedEntry[] {
  const syncTime = new Date(syncedAt).getTime();
  const windowStart = new Date(syncTime - 2000).toISOString();
  const windowEnd = new Date(syncTime + 500).toISOString();

  return db
    .select({
      model: costEntries.model,
      date: costEntries.date,
      costUsd: costEntries.costUsd,
      direction: costEntries.direction,
      unitType: costEntries.unitType,
      tokensIn: costEntries.tokensIn,
      tokensOut: costEntries.tokensOut,
      requests: costEntries.requests,
      rawLineItem: costEntries.rawLineItem,
    })
    .from(costEntries)
    .where(
      and(
        eq(costEntries.provider, provider),
        gte(costEntries.syncedAt, windowStart),
        lte(costEntries.syncedAt, windowEnd)
      )
    )
    .orderBy(desc(costEntries.date), costEntries.model)
    .all();
}

export function getProviderFreshness(): ProviderFreshness[] {
  const rows = db
    .select({
      provider: costEntries.provider,
      latestDate: sql<string>`MAX(${costEntries.date})`,
      totalSpend: sql<number>`COALESCE(SUM(${costEntries.costUsd}), 0)`,
    })
    .from(costEntries)
    .groupBy(costEntries.provider)
    .all();

  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDER_NAMES.map((provider) => ({
    provider,
    latestDate: byProvider.get(provider)?.latestDate ?? null,
    totalSpend: byProvider.get(provider)?.totalSpend ?? 0,
  }));
}
