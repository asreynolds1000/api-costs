"use client";

import { useState, useEffect } from "react";
import { getProviderLabel, getProviderColor, formatCurrencyDetail } from "@/lib/format";
import type { SyncedEntry } from "@/lib/db/queries";

type SyncEntriesModalProps = {
  provider: string;
  syncedAt: string;
  recordCount: number;
  onClose: () => void;
};

type SortKey = "date" | "model" | "costUsd" | "direction";
type SortDir = "asc" | "desc";

export function SyncEntriesModal({
  provider,
  syncedAt,
  recordCount,
  onClose,
}: SyncEntriesModalProps) {
  const [entries, setEntries] = useState<SyncedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    fetch(
      `/api/sync-entries?provider=${encodeURIComponent(provider)}&syncedAt=${encodeURIComponent(syncedAt)}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, [provider, syncedAt]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "costUsd" ? "desc" : "asc");
    }
  }

  const sorted = entries
    ? [...entries].sort((a, b) => {
        const mul = sortDir === "asc" ? 1 : -1;
        if (sortKey === "costUsd") return (a.costUsd - b.costUsd) * mul;
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        return av < bv ? -1 * mul : av > bv ? 1 * mul : 0;
      })
    : null;

  const totalCost = entries?.reduce((sum, e) => sum + e.costUsd, 0) ?? 0;

  const syncDate = new Date(syncedAt);
  const syncLabel = syncDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-card-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-card-border">
          <div className="flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: getProviderColor(provider) }}
            />
            <div>
              <h2 className="text-sm font-semibold">
                {getProviderLabel(provider)} sync records
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {syncLabel} · {recordCount} records · {formatCurrencyDetail(totalCost)} total
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-lg px-2 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-auto flex-1 px-1">
          {error && (
            <div className="px-5 py-4 text-sm text-red-400">{error}</div>
          )}
          {!entries && !error && (
            <div className="px-5 py-4 text-sm text-muted">Loading...</div>
          )}
          {sorted && sorted.length === 0 && (
            <div className="px-5 py-4 text-sm text-muted">
              No entries found for this sync window. Records may have been
              overwritten by a newer sync.
            </div>
          )}
          {sorted && sorted.length > 0 && (
            <table className="w-full text-xs table-fixed">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[38%]" />
                <col className="w-[14%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead className="sticky top-0 bg-card">
                <tr className="text-muted border-b border-card-border">
                  <th
                    className="text-left px-4 py-2 font-medium cursor-pointer hover:text-foreground select-none"
                    onClick={() => handleSort("date")}
                  >
                    Date{sortArrow("date")}
                  </th>
                  <th
                    className="text-left px-4 py-2 font-medium cursor-pointer hover:text-foreground select-none"
                    onClick={() => handleSort("model")}
                  >
                    Model{sortArrow("model")}
                  </th>
                  <th
                    className="text-left px-4 py-2 font-medium cursor-pointer hover:text-foreground select-none"
                    onClick={() => handleSort("direction")}
                  >
                    Direction{sortArrow("direction")}
                  </th>
                  <th
                    className="text-right px-4 py-2 font-medium cursor-pointer hover:text-foreground select-none"
                    onClick={() => handleSort("costUsd")}
                  >
                    Cost{sortArrow("costUsd")}
                  </th>
                  <th className="text-right px-4 py-2 font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry, i) => (
                  <tr
                    key={i}
                    className="border-b border-card-border/30 last:border-0 hover:bg-card-border/10"
                  >
                    <td className="px-4 py-1.5 text-muted whitespace-nowrap">
                      {entry.date}
                    </td>
                    <td className="px-4 py-1.5 truncate" title={entry.model}>
                      {entry.model}
                    </td>
                    <td className="px-4 py-1.5 text-muted">
                      {entry.direction ?? "-"}
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono">
                      {formatCurrencyDetail(entry.costUsd)}
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-muted">
                      {entry.tokensIn || entry.tokensOut
                        ? `${(entry.tokensIn ?? 0).toLocaleString()} / ${(entry.tokensOut ?? 0).toLocaleString()}`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
