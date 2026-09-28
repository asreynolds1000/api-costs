import { eq } from "drizzle-orm";
import { getAdapter, getAllAdapters } from "@/lib/providers/registry";
import type { CostEntry, ProviderState } from "@/lib/providers/types";
import { logSync } from "@/lib/db/queries";
import { db, schema } from "@/lib/db";
import { dedupKey } from "@/lib/providers/normalize";

export type SyncResult = { provider: string; ok: boolean; records: number; error?: string };

const SYNC_DAYS = 90;
// An adapter call that hangs must not stall the scheduler or a waiting Sync now click.
// A timed-out call keeps running in the background, but its result is discarded.
const PROVIDER_TIMEOUT_MS = 120_000;

// Route handlers and instrumentation load separate module copies in this build, so the
// in-flight map lives on globalThis (one pm2 process, one map).
const g = globalThis as unknown as { __syncInFlight?: Map<string, Promise<SyncResult>> };
const inFlight = (g.__syncInFlight ??= new Map());

// A second caller for the same provider waits on the running sync instead of starting another.
export function syncProvider(provider: string): Promise<SyncResult> {
  const running = inFlight.get(provider);
  if (running) return running;
  const job = runSync(provider).finally(() => inFlight.delete(provider));
  inFlight.set(provider, job);
  return job;
}

export async function syncAll(): Promise<SyncResult[]> {
  const providers = getAllAdapters()
    .filter((a) => a.isConfigured())
    .map((a) => a.provider);
  const settled = await Promise.allSettled(providers.map(syncProvider));
  return settled.map((s, i) =>
    s.status === "fulfilled" ? s.value : { provider: providers[i], ok: false, records: 0, error: String(s.reason) }
  );
}

async function runSync(provider: string): Promise<SyncResult> {
  const adapter = getAdapter(provider);
  if (!adapter) return { provider, ok: false, records: 0, error: `Unknown provider: ${provider}` };
  if (!adapter.isConfigured()) {
    return { provider, ok: false, records: 0, error: `${provider} is not configured. Check .env.local` };
  }

  try {
    const since = new Date();
    since.setDate(since.getDate() - SYNC_DAYS);

    let entries: CostEntry[];
    let nextState: ProviderState | undefined;
    if (adapter.syncWithState) {
      const out = await withTimeout(adapter.syncWithState(since, readState(provider)), provider);
      entries = out.entries;
      nextState = out.state;
    } else {
      entries = await withTimeout(adapter.sync(since), provider);
    }

    const records = writeEntries(provider, entries, nextState);
    logSync(provider, "success", records);
    return { provider, ok: true, records };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logSync(provider, "error", 0, message);
    return { provider, ok: false, records: 0, error: message };
  }
}

function withTimeout<T>(work: Promise<T>, provider: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${provider} sync timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`)),
      PROVIDER_TIMEOUT_MS
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function readState(provider: string): ProviderState {
  const rows = db
    .select({ key: schema.providerState.key, value: schema.providerState.value })
    .from(schema.providerState)
    .where(eq(schema.providerState.provider, provider))
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// Entries and any adapter state commit together, so a crash can't record the new BFL
// balance without the spend row that came from it (or the reverse).
function writeEntries(provider: string, entries: CostEntry[], nextState?: ProviderState): number {
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const entry of entries) {
      const { direction, rawLineItem } = dedupKey(entry);
      tx.insert(schema.costEntries)
        .values({
          provider: entry.provider,
          model: entry.model,
          date: entry.date,
          costUsd: entry.costUsd,
          unitType: entry.unitType,
          units: entry.units ?? null,
          direction,
          tokensIn: entry.tokensIn ?? null,
          tokensOut: entry.tokensOut ?? null,
          requests: entry.requests ?? null,
          rawLineItem,
          source: "api_sync",
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.costEntries.provider,
            schema.costEntries.model,
            schema.costEntries.date,
            schema.costEntries.direction,
            schema.costEntries.rawLineItem,
            schema.costEntries.source,
          ],
          set: {
            costUsd: entry.costUsd,
            unitType: entry.unitType,
            units: entry.units ?? null,
            tokensIn: entry.tokensIn ?? null,
            tokensOut: entry.tokensOut ?? null,
            requests: entry.requests ?? null,
            syncedAt: now,
          },
        })
        .run();
    }

    for (const [key, value] of Object.entries(nextState ?? {})) {
      tx.insert(schema.providerState)
        .values({ provider, key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: [schema.providerState.provider, schema.providerState.key],
          set: { value, updatedAt: now },
        })
        .run();
    }
  });
  return entries.length;
}

