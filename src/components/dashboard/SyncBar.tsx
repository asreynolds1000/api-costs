"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import type { SyncStatus } from "@/lib/db/queries";
import type { SchedulerState } from "@/lib/scheduler";

type SyncBarProps = {
  statuses: SyncStatus[];
  scheduler: SchedulerState;
  serverNow: number;
};

const STALE_MS = 26 * 60 * 60 * 1000;

export function SyncBar({ statuses, scheduler, serverNow }: SyncBarProps) {
  const now = useClientClock(serverNow);
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState("");
  const [, startTransition] = useTransition();

  const times = statuses.filter((s) => s.lastSuccess).map((s) => new Date(s.lastSuccess!).getTime());
  const mostRecent = times.length > 0 ? Math.max(...times) : 0;
  const stale = now - mostRecent > STALE_MS;
  const failed = scheduler.lastTickOk === false;
  const busy = syncing || scheduler.running;

  const nextMs = scheduler.nextTickAt ? new Date(scheduler.nextTickAt).getTime() - now : null;
  const nextText = !scheduler.enabled
    ? "auto-sync off"
    : nextMs === null
      ? null
      : nextMs < 60_000
        ? "next sync in under a minute"
        : `next in ${formatDuration(nextMs / 1000)}`;

  const tone = busy ? "live" : failed || stale ? "warn" : "ok";

  async function handleSync() {
    setSyncing(true);
    setResult("");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { results } = (await res.json()) as { results: { ok: boolean; records: number }[] };
      const records = results.reduce((n, r) => n + r.records, 0);
      const bad = results.filter((r) => !r.ok).length;
      setResult(bad ? `Synced ${records} records, ${bad} failed` : `Synced ${records} records`);
    } catch {
      setResult("Sync failed");
    }
    setSyncing(false);
    startTransition(() => router.refresh());
    setTimeout(() => setResult(""), 8000);
  }

  const status = busy
    ? "Syncing providers…"
    : result ||
      [
        mostRecent ? `Synced ${formatRelativeTime(new Date(mostRecent).toISOString(), now)}` : "Never synced",
        nextText,
      ]
        .filter(Boolean)
        .join(", ");

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="flex items-center gap-2" aria-live="polite">
        <span aria-hidden className={`live-dot live-dot--${tone}`} />
        <span className={tone === "warn" ? "text-warning" : "text-muted"}>
          {status}
          {failed && !busy && !result ? ". The last run had errors; see Sync history." : ""}
        </span>
      </span>
      <button
        onClick={handleSync}
        disabled={busy}
        className="px-3 py-1.5 rounded-lg border border-card-border bg-card font-medium hover:bg-card-border transition-colors disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

// Ticks every 15 s. Starts at the server's clock so the first client render matches the HTML.
function useClientClock(serverNow: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
