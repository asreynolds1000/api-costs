"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/format";
import type { SyncStatus } from "@/lib/db/queries";

type SyncBarProps = {
  statuses: SyncStatus[];
  providerConfigured: Record<string, boolean>;
  now: number;
};

export function SyncBar({ statuses, providerConfigured, now }: SyncBarProps) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState("");

  const times = statuses.filter((s) => s.lastSuccess).map((s) => new Date(s.lastSuccess!).getTime());
  const mostRecent = times.length > 0 ? Math.max(...times) : 0;
  const lastSyncStr = mostRecent > 0 ? formatRelativeTime(new Date(mostRecent).toISOString(), now) : "never";
  const stale = now - mostRecent > 26 * 60 * 60 * 1000;

  async function handleSync() {
    setSyncing(true);
    setResult("");

    const configured = Object.entries(providerConfigured)
      .filter(([, v]) => v)
      .map(([k]) => k);

    let total = 0;
    let failed = 0;
    for (const p of configured) {
      try {
        const res = await fetch(`/api/sync/${p}`, { method: "POST" });
        if (res.ok) total += (await res.json()).recordsSynced ?? 0;
        else failed++;
      } catch {
        failed++;
      }
    }

    setSyncing(false);
    setResult(failed ? `Synced ${total} records, ${failed} failed` : `Synced ${total} records`);
    setTimeout(() => window.location.reload(), 800);
  }

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className={stale && !syncing && !result ? "text-warning" : "text-muted"} aria-live="polite">
        {syncing ? "Syncing providers…" : result || `Last synced ${lastSyncStr}`}
      </span>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="px-3 py-1.5 rounded-lg border border-card-border bg-card font-medium hover:bg-card-border transition-colors disabled:opacity-50"
      >
        {syncing ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
