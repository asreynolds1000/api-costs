"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailySpend } from "@/lib/db/queries";
import { getProviderLabel } from "@/lib/format";

// Transform daily spend rows into chart data: { date, openai, xai, gemini }
// Fills gaps between first and last date so the chart has continuous x-axis
function pivotData(rows: DailySpend[]) {
  const byDate = new Map<string, Record<string, number>>();
  const defaults = { openai: 0, xai: 0, gemini: 0, openrouter: 0 };
  for (const row of rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, { ...defaults });
    const entry = byDate.get(row.date)!;
    entry[row.provider] = (entry[row.provider] ?? 0) + row.cost;
  }

  if (byDate.size === 0) return [];

  // Fill in missing dates between min and max
  const dates = Array.from(byDate.keys()).sort();
  const start = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  const filled: Array<Record<string, unknown>> = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const entry = byDate.get(iso) ?? { ...defaults };
    filled.push({
      date: iso.slice(5),
      fullDate: iso,
      openai: entry.openai ?? 0,
      xai: entry.xai ?? 0,
      gemini: entry.gemini ?? 0,
      openrouter: entry.openrouter ?? 0,
    });
  }

  return filled;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: "#10b981",
  xai: "#8b5cf6",
  gemini: "#3b82f6",
  openrouter: "#f97316",
};

const providers = ["openai", "xai", "gemini", "openrouter"];

export function SpendTimeline({ data }: { data: DailySpend[] }) {
  const chartData = pivotData(data);

  if (chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        No spend data yet. Add entries or sync a provider.
      </div>
    );
  }

  const totalSpend = chartData.reduce((sum, d) => {
    return sum + providers.reduce((s, p) => s + (Number((d as Record<string, unknown>)[p]) || 0), 0);
  }, 0);

  return (
    <div role="img" aria-label={`Area chart showing daily spend over ${chartData.length} days, totaling $${totalSpend.toFixed(2)}`} className="w-full h-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2b35" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#71717a", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#2a2b35" }}
        />
        <YAxis
          tick={{ fill: "#71717a", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          width={60}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1a1b23",
            border: "1px solid #2a2b35",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#e4e4e7" }}
          formatter={(value, name) => [
            `$${Number(value).toFixed(4)}`,
            getProviderLabel(String(name)),
          ]}
          labelFormatter={(label, payload) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const item = (payload as any)?.[0]?.payload as Record<string, string> | undefined;
            return item?.fullDate ?? String(label);
          }}
        />
        {providers.map((provider) => (
          <Area
            key={provider}
            type="monotone"
            dataKey={provider}
            stackId="1"
            stroke={PROVIDER_COLORS[provider]}
            fill={PROVIDER_COLORS[provider]}
            fillOpacity={0.3}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}
