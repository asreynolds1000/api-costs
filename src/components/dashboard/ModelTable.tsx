"use client";

import { useState } from "react";
import type { ModelSpend } from "@/lib/db/queries";
import { formatCurrencyDetail, getProviderLabel, getProviderColor } from "@/lib/format";

type SortKey = "cost" | "model" | "provider";

export function ModelTable({ data }: { data: ModelSpend[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortAsc, setSortAsc] = useState(false);

  const total = data.reduce((sum, d) => sum + d.cost, 0);

  const sorted = [...data].sort((a, b) => {
    const mul = sortAsc ? 1 : -1;
    if (sortKey === "cost") return (a.cost - b.cost) * mul;
    if (sortKey === "model") return a.model.localeCompare(b.model) * mul;
    return a.provider.localeCompare(b.provider) * mul;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key !== "cost"); // cost defaults desc, others asc
    }
  }

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " \u2191" : " \u2193") : "";

  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    sortKey === key ? (sortAsc ? "ascending" : "descending") : "none";

  function handleKeyDown(key: SortKey, e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSort(key);
    }
  }

  if (data.length === 0) {
    return (
      <div className="text-muted text-sm text-center py-6">
        No model spend in this range.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted text-xs border-b border-card-border">
            <th
              className="sticky top-0 bg-card pb-2 pr-4 font-medium cursor-pointer hover:text-foreground"
              tabIndex={0}
              aria-sort={ariaSort("model")}
              onClick={() => toggleSort("model")}
              onKeyDown={(e) => handleKeyDown("model", e)}
            >
              Model{arrow("model")}
            </th>
            <th
              className="sticky top-0 bg-card pb-2 pr-4 font-medium cursor-pointer hover:text-foreground"
              tabIndex={0}
              aria-sort={ariaSort("provider")}
              onClick={() => toggleSort("provider")}
              onKeyDown={(e) => handleKeyDown("provider", e)}
            >
              Provider{arrow("provider")}
            </th>
            <th
              className="sticky top-0 bg-card pb-2 pr-4 font-medium text-right cursor-pointer hover:text-foreground"
              tabIndex={0}
              aria-sort={ariaSort("cost")}
              onClick={() => toggleSort("cost")}
              onKeyDown={(e) => handleKeyDown("cost", e)}
            >
              Cost{arrow("cost")}
            </th>
            <th className="sticky top-0 bg-card pb-2 font-medium text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const pct = total > 0 ? ((row.cost / total) * 100).toFixed(1) : "0.0";
            return (
              <tr
                key={`${row.provider}-${row.model}`}
                className="border-b border-card-border/40 last:border-0 hover:bg-card-border/30"
              >
                <td className="py-2 pr-4 font-mono text-xs break-words">{row.model}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5"
                    style={{ backgroundColor: getProviderColor(row.provider) }}
                  />
                  {getProviderLabel(row.provider)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {formatCurrencyDetail(row.cost)}
                </td>
                <td className="py-2 text-right text-muted tabular-nums">{pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
