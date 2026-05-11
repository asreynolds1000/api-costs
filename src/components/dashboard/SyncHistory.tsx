"use client";

import { useState, useEffect } from "react";
import { getProviderLabel, getProviderColor } from "@/lib/format";
import { SyncEntriesModal } from "./SyncEntriesModal";
import type { SyncLogEntry } from "@/lib/db/queries";

function formatSyncTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${timeStr}`;
  return `${dateStr} ${timeStr}`;
}

type ModalTarget = {
  provider: string;
  syncedAt: string;
  recordCount: number;
};

type ProviderSectionProps = {
  provider: string;
  entries: SyncLogEntry[];
  latestActivity: string | null;
  onRecordClick: (target: ModalTarget) => void;
};

function formatActivityDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function ProviderSection({ provider, entries, latestActivity, onRecordClick }: ProviderSectionProps) {
  const [open, setOpen] = useState(false);
  const lastEntry = entries[0];
  const lastFailed = lastEntry?.status === "error";

  return (
    <div className="border border-card-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full grid grid-cols-[40%_40%_20%] items-center px-4 py-2.5 hover:bg-card-border/20 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: getProviderColor(provider) }}
          />
          <span className="text-sm font-medium">
            {getProviderLabel(provider)}
          </span>
          {lastFailed && (
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
          )}
        </div>
        <div className="text-xs text-muted">
          {entries.length === 0 && "No syncs recorded"}
          {lastEntry && (
            <>
              Last: {formatSyncTime(lastEntry.syncedAt)}
              {lastEntry.status === "error" && (
                <span className="text-red-400 ml-1">failed</span>
              )}
              {lastEntry.status === "success" && lastEntry.recordsSynced != null && (
                <span className="ml-1">({lastEntry.recordsSynced} records)</span>
              )}
            </>
          )}
        </div>
        <div className="text-xs text-muted text-right">
          {latestActivity
            ? <>thru {formatActivityDate(latestActivity)}</>
            : null
          }
          <span className="ml-2">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-card-border">
          {entries.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted">
              No sync history available.
            </div>
          ) : (
            <table className="w-full text-xs table-fixed">
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[40%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="text-muted border-b border-card-border">
                  <th className="text-left px-4 py-1.5 font-medium">Time</th>
                  <th className="text-left px-4 py-1.5 font-medium">Status</th>
                  <th className="text-right px-4 py-1.5 font-medium">Records</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const canClick =
                    entry.status === "success" &&
                    entry.recordsSynced != null &&
                    entry.recordsSynced > 0;

                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-card-border/50 last:border-0"
                    >
                      <td className="px-4 py-1.5 text-muted whitespace-nowrap">
                        {formatSyncTime(entry.syncedAt)}
                      </td>
                      <td className="px-4 py-1.5">
                        <span
                          className={
                            entry.status === "success"
                              ? "text-green-400"
                              : "text-red-400"
                          }
                        >
                          {entry.status}
                        </span>
                        {entry.errorMessage && (
                          <div className="text-red-400/70 mt-0.5 truncate">
                            {entry.errorMessage}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono">
                        {canClick ? (
                          <button
                            className="text-accent-blue hover:text-accent-blue/80 underline underline-offset-2 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRecordClick({
                                provider,
                                syncedAt: entry.syncedAt,
                                recordCount: entry.recordsSynced!,
                              });
                            }}
                          >
                            {entry.recordsSynced}
                          </button>
                        ) : (
                          (entry.recordsSynced ?? "-")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

type SyncHistoryResponse = {
  history: Record<string, SyncLogEntry[]>;
  latestActivity: Record<string, string | null>;
};

export function SyncHistory() {
  const [data, setData] = useState<SyncHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

  useEffect(() => {
    if (expanded && !data && !historyError) {
      fetch("/api/sync-history")
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(setData)
        .catch(() => setHistoryError(true));
    }
  }, [expanded, data, historyError]);

  return (
    <>
      <div className="bg-card border border-card-border rounded-lg">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-border/10 transition-colors"
          aria-expanded={expanded}
        >
          <span className="text-sm font-medium">Sync History</span>
          <span className="text-muted text-xs">{expanded ? "▲" : "▼"}</span>
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-2 border-t border-card-border pt-3">
            {historyError ? (
              <div className="text-xs text-red-400 py-2">Failed to load sync history.</div>
            ) : !data ? (
              <div className="text-xs text-muted py-2">Loading...</div>
            ) : (
              Object.entries(data.history)
                .filter(([, entries]) => entries.length > 0)
                .sort(([, a], [, b]) => {
                  const aTime = a[0]?.syncedAt ?? "";
                  const bTime = b[0]?.syncedAt ?? "";
                  return bTime.localeCompare(aTime);
                })
                .map(([provider, entries]) => (
                  <ProviderSection
                    key={provider}
                    provider={provider}
                    entries={entries}
                    latestActivity={data.latestActivity[provider] ?? null}
                    onRecordClick={setModalTarget}
                  />
                ))
            )}
          </div>
        )}
      </div>

      {modalTarget && (
        <SyncEntriesModal
          provider={modalTarget.provider}
          syncedAt={modalTarget.syncedAt}
          recordCount={modalTarget.recordCount}
          onClose={() => setModalTarget(null)}
        />
      )}
    </>
  );
}
