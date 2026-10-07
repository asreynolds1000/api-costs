"use client";

import { useEffect, useState } from "react";
import type { ActivityResult } from "@/lib/activity/queries";
import { ACTIVITY_DEFAULT_DAYS as DEFAULT_DAYS, formatCompact, formatCurrency, formatInt } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";
import { DateRangePicker } from "./DateRangePicker";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { ToolsPanel } from "./ToolsPanel";
import { ModelsUsed } from "./ModelsUsed";


type Props = {
  year: ActivityResult; // last 365 days: drives the heatmap and the 1-year range
  initial: ActivityResult; // last DEFAULT_DAYS
  today: string;
  serverNow: number;
};

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function ActivitySection({ year, initial, today, serverNow }: Props) {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const seed = () => ({ [DEFAULT_DAYS]: initial, 365: year }) as Record<number, ActivityResult | "error">;
  const [byRange, setByRange] = useState(seed);
  // New server data (auto-refresh or a sync): drop fetched ranges rather than show stale ones
  const [stamp, setStamp] = useState(serverNow);
  if (stamp !== serverNow) {
    setStamp(serverNow);
    setByRange(seed());
  }

  const have = days in byRange;
  useEffect(() => {
    if (have) return;
    let cancelled = false;
    fetch(`/api/activity?start=${shiftDate(today, -(days - 1))}&end=${shiftDate(today, 1)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ActivityResult>;
      })
      .then((data) => !cancelled && setByRange((m) => ({ ...m, [days]: data })))
      .catch(() => !cancelled && setByRange((m) => ({ ...m, [days]: "error" })));
    return () => {
      cancelled = true;
    };
  }, [have, days, today]);

  const state = byRange[days];
  const data = state && state !== "error" ? state : null;

  const bySource = { "claude-code": 0, codex: 0 } as Record<string, number>;
  for (const d of data?.daily ?? []) bySource[d.source] = (bySource[d.source] ?? 0) + d.estCost;

  const start = year.dataStart.claude;
  const stats = data
    ? [
        { label: "Sessions", value: formatInt(data.totals.sessions) },
        { label: "Messages", value: formatInt(data.totals.messages) },
        { label: "Output tokens", value: formatCompact(data.totals.output) },
        { label: "Claude Code at API prices", value: `≈ ${formatCurrency(bySource["claude-code"])}` },
        { label: "Codex at API prices", value: `≈ ${formatCurrency(bySource.codex)}` },
      ]
    : [];

  return (
    <section aria-labelledby="activity-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h2 id="activity-heading" className="text-base font-semibold">
            Activity
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Claude Code and Codex on this Mac, plus every API model.
            {start ? ` Claude Code history starts ${monthDay.format(new Date(`${start}T12:00:00Z`))}.` : ""}
          </p>
        </div>
        <DateRangePicker activeDays={days} onChange={setDays} />
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-4 min-h-14">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="font-display text-2xl font-semibold mt-0.5">{s.value}</dd>
          </div>
        ))}
        {state === "error" && <p className="text-sm text-critical">Couldn&apos;t load this range. Reload to try again.</p>}
        {!state && <p className="text-sm text-muted">Loading…</p>}
      </dl>

      <div className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
        <h3 className="text-sm font-medium mb-3">Messages per day, last 12 months</h3>
        <ActivityHeatmap daily={year.daily} sessions={year.sessions} today={today} dataStart={year.dataStart} />
      </div>

      {data && (
        <>
          <div>
            <h3 className="text-sm font-medium mb-2">Tools used</h3>
            <ToolsPanel tools={data.tools} />
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
            <h3 className="text-sm font-medium mb-3">Models used</h3>
            <ModelsUsed models={data.models} />
          </div>
        </>
      )}
    </section>
  );
}
