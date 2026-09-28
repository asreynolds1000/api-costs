"use client";

import { useState } from "react";
import type { ActivityModel } from "@/lib/activity/queries";
import {
  formatCompact,
  formatCurrencyDetail,
  getProviderColor,
  getSourceLabel,
  isSubscriptionSource,
} from "@/lib/format";

const SHOWN = 12;
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Every model touched in the range, wherever it ran: Claude Code, Codex, or a metered API.
export function ModelsUsed({ models }: { models: ActivityModel[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? models : models.slice(0, SHOWN);

  if (models.length === 0) return <p className="text-sm text-muted py-6 text-center">No model usage in this range.</p>;

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted text-xs border-b border-card-border">
            <th scope="col" className="py-2 pr-4 font-medium">Model</th>
            <th scope="col" className="py-2 pr-4 font-medium">Where</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">Days used</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">Last used</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">Tokens</th>
            <th scope="col" className="py-2 font-medium text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => {
            const estimate = isSubscriptionSource(m.source);
            return (
              <tr key={`${m.source}-${m.model}`} className="border-b border-card-border/60 last:border-0">
                <td className="py-2 pr-4 font-mono text-xs break-words">{m.model}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {!estimate && (
                    <span
                      aria-hidden
                      className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                      style={{ background: getProviderColor(m.source) }}
                    />
                  )}
                  {getSourceLabel(m.source)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{m.days}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-muted">
                  {shortDate.format(new Date(`${m.lastUsed}T12:00:00Z`))}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-muted">
                  {m.tokens === null || (!estimate && m.tokens === 0) ? "–" : formatCompact(m.tokens)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {estimate && m.estCost === 0 ? (
                    <span className="text-muted" title="No API list price on file for this model">
                      –
                    </span>
                  ) : (
                    <span title={estimate ? "Estimated at API list prices; covered by your subscription" : "Billed"}>
                      {estimate ? "≈ " : ""}
                      {formatCurrencyDetail(m.estCost)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-4 mt-3">
        <p className="text-xs text-muted">
          ≈ marks Claude Code and Codex usage priced at API list rates. Your subscriptions cover it.
        </p>
        {models.length > SHOWN && (
          <button onClick={() => setAll(!all)} className="text-xs text-muted hover:text-foreground underline underline-offset-2">
            {all ? "Show fewer" : `Show all ${models.length}`}
          </button>
        )}
      </div>
    </>
  );
}
