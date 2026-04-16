import { sql, eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "./index";
import { costEntries, syncLog } from "./schema";

// Period boundaries relative to now
function startOfDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function startOfWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function startOfYear(): string {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

// Sum cost for a date range
function sumCostSince(since: string) {
  return db
    .select({ total: sql<number>`COALESCE(SUM(${costEntries.costUsd}), 0)` })
    .from(costEntries)
    .where(gte(costEntries.date, since))
    .get()!.total;
}

function sumCostAll() {
  return db
    .select({ total: sql<number>`COALESCE(SUM(${costEntries.costUsd}), 0)` })
    .from(costEntries)
    .get()!.total;
}

export type PeriodSummary = {
  today: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
  allTime: number;
};

export function getPeriodSummary(): PeriodSummary {
  return {
    today: sumCostSince(startOfDay()),
    thisWeek: sumCostSince(startOfWeek()),
    thisMonth: sumCostSince(startOfMonth()),
    thisYear: sumCostSince(startOfYear()),
    allTime: sumCostAll(),
  };
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
  const providers = ["openai", "xai", "gemini", "openrouter"];
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
