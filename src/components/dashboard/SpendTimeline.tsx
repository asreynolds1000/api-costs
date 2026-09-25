"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { DailySpend } from "@/lib/db/queries";
import { PROVIDER_NAMES, formatCurrency, getProviderColor, getProviderLabel } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";

type Bucket = {
  key: string;
  tick: string;
  tipLabel: string;
  total: number;
  top: string | null; // provider drawn last (gets the rounded end)
  bottom: string | null; // provider on the baseline (no gap under it)
  [provider: string]: number | string | null;
};

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);

function weekStart(iso: string): string {
  return shiftDate(iso, -asDate(iso).getUTCDay()); // Sunday, matching "This week"
}

// Every day (or week) in [start, end] gets a bucket, zero-filled, so gaps show as gaps.
function buildBuckets(rows: DailySpend[], start: string, end: string, weekly: boolean) {
  const byKey = new Map<string, Map<string, number>>();
  const keyOf = (d: string) => (weekly ? weekStart(d) : d);
  for (const r of rows) {
    const k = keyOf(r.date);
    const m = byKey.get(k) ?? new Map<string, number>();
    m.set(r.provider, (m.get(r.provider) ?? 0) + r.cost);
    byKey.set(k, m);
  }

  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.provider, (totals.get(r.provider) ?? 0) + r.cost);
  const known = PROVIDER_NAMES.filter((p) => (totals.get(p) ?? 0) > 0);
  const unknown = [...totals.keys()].filter((p) => !PROVIDER_NAMES.includes(p) && totals.get(p)! > 0);
  const providers = [...known, ...unknown.sort()];

  const buckets: Bucket[] = [];
  const seen = new Set<string>();
  for (let d = start; d <= end; d = shiftDate(d, 1)) {
    const k = keyOf(d);
    if (seen.has(k)) continue;
    seen.add(k);
    const m = byKey.get(k);
    const b: Bucket = {
      key: k,
      tick: dayFmt.format(asDate(k)),
      tipLabel: weekly ? `Week of ${dayFmt.format(asDate(k))}` : weekdayFmt.format(asDate(k)),
      total: 0,
      top: null,
      bottom: null,
    };
    for (const p of providers) {
      const v = m?.get(p) ?? 0;
      b[p] = v;
      b.total += v;
      if (v > 0) {
        b.top = p;
        b.bottom ??= p;
      }
    }
    buckets.push(b);
  }
  return { buckets, providers };
}

type SegmentProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: Bucket;
};

// Stacked segment: 4px rounded end on the topmost segment only, and a 2px gap of
// card colour between segments (taken from the segment's own bottom edge).
function segment(provider: string) {
  function Segment({ x = 0, y = 0, width = 0, height = 0, fill, payload }: SegmentProps) {
    if (height <= 0 || width <= 0) return null;
    const gap = payload?.bottom !== provider && height > 3 ? 2 : 0;
    const h = height - gap;
    const r = payload?.top === provider ? Math.min(4, width / 2, h) : 0;
    const path = r
      ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + h}Z`
      : `M${x},${y}H${x + width}V${y + h}H${x}Z`;
    return <path d={path} fill={fill} />;
  }
  return Segment;
}

function axisMoney(v: number): string {
  if (v === 0) return "$0";
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  if (v >= 10) return `$${Math.round(v)}`;
  return `$${Number(v.toFixed(2))}`;
}

function TooltipCard({
  active,
  payload,
  providers,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Bucket }>;
  providers: string[];
}) {
  const b = payload?.[0]?.payload;
  if (!active || !b) return null;
  const rows = providers
    .map((p) => ({ p, v: Number(b[p]) || 0 }))
    .filter((r) => r.v > 0)
    .sort((a, c) => c.v - a.v);
  return (
    <div className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs shadow-lg min-w-40">
      <div className="flex justify-between gap-4 font-medium mb-1">
        <span>{b.tipLabel}</span>
        <span className="tabular-nums">{formatCurrency(b.total)}</span>
      </div>
      {rows.length === 0 && <div className="text-muted">No spend</div>}
      {rows.map(({ p, v }) => (
        <div key={p} className="flex items-center justify-between gap-4 text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getProviderColor(p) }} />
            {getProviderLabel(p)}
          </span>
          <span className="tabular-nums text-foreground">{formatCurrency(v)}</span>
        </div>
      ))}
    </div>
  );
}

type Props = { data: DailySpend[]; start: string; end: string; weekly: boolean };

export function SpendTimeline({ data, start, end, weekly }: Props) {
  const { buckets, providers } = buildBuckets(data, start, end, weekly);
  const total = buckets.reduce((s, b) => s + b.total, 0);

  if (total === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        No spend in this range.
      </div>
    );
  }

  const peak = buckets.reduce((a, b) => (b.total > a.total ? b : a));

  return (
    <div className="h-full flex flex-col">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mb-3" aria-label="Legend">
        {providers.map((p) => (
          <li key={p} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: getProviderColor(p) }} />
            {getProviderLabel(p)}
          </li>
        ))}
      </ul>
      <div
        role="img"
        aria-label={`Stacked bar chart of ${weekly ? "weekly" : "daily"} spend by provider, ${formatCurrency(total)} in total. Highest: ${peak.tipLabel}, ${formatCurrency(peak.total)}.`}
        className="flex-1 min-h-0 w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--card-border)" />
            <XAxis
              dataKey="tick"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--card-border)" }}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={axisMoney}
              width={48}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={(props) => (
                <TooltipCard
                  active={props.active}
                  payload={props.payload as ReadonlyArray<{ payload?: Bucket }> | undefined}
                  providers={providers}
                />
              )}
            />
            {providers.map((p) => (
              <Bar
                key={p}
                dataKey={p}
                stackId="spend"
                fill={getProviderColor(p)}
                maxBarSize={24}
                isAnimationActive={false}
                shape={segment(p)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
