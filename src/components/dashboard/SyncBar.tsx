"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/format";
import type { SyncStatus } from "@/lib/db/queries";

type SyncBarProps = {
  statuses: SyncStatus[];
  providerConfigured: Record<string, boolean>;
};

export function SyncBar({ statuses, providerConfigured }: SyncBarProps) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState("");

  // Find the most recent sync across all providers
  const lastSyncTimes = statuses
    .filter((s) => s.lastSync)
    .map((s) => new Date(s.lastSync!).getTime());
  const mostRecentSync = lastSyncTimes.length > 0 ? Math.max(...lastSyncTimes) : 0;
  const minutesSinceSync = mostRecentSync > 0
    ? Math.floor((Date.now() - mostRecentSync) / 60000)
    : Infinity;

  const isFresh = minutesSinceSync < 60;
  const lastSyncStr = mostRecentSync > 0
    ? formatRelativeTime(new Date(mostRecentSync).toISOString())
    : "never";

  async function handleSync() {
    setSyncing(true);
    setResult("");

    const configured = Object.entries(providerConfigured)
      .filter(([, v]) => v)
      .map(([k]) => k);

    let totalSynced = 0;
    for (const p of configured) {
      try {
        const res = await fetch(`/api/sync/${p}`, { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          totalSynced += data.recordsSynced ?? 0;
        }
      } catch {
        // continue with other providers
      }
    }

    setSyncing(false);
    setResult(`Synced ${totalSynced} records`);
    localStorage.setItem("api-costs-last-sync", String(Date.now()));

    setTimeout(() => window.location.reload(), 800);
  }

  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${isFresh ? "bg-accent-green" : "bg-amber-500"}`}
        />
        <span className="text-muted">
          {syncing
            ? "Syncing..."
            : result
              ? result
              : `Last sync: ${lastSyncStr}`}
        </span>
      </div>
      <button
        onClick={handleSync}
        disabled={syncing}
        className={`px-2.5 py-1 rounded transition-colors ${
          isFresh
            ? "text-muted hover:text-foreground hover:bg-card-border/30"
            : "text-amber-500 bg-amber-500/10 hover:bg-amber-500/20"
        } disabled:opacity-50`}
      >
        {syncing ? "Syncing..." : isFresh ? "Sync" : "Sync Now"}
      </button>
    </div>
  );
}
