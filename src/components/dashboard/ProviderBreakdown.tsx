"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { ProviderSpend } from "@/lib/db/queries";
import { getProviderLabel, formatCurrency } from "@/lib/format";

const PROVIDER_COLORS: Record<string, string> = {
  openai: "#10b981",
  xai: "#8b5cf6",
  gemini: "#3b82f6",
  openrouter: "#f97316",
};

export function ProviderBreakdown({ data }: { data: ProviderSpend[] }) {
  const total = data.reduce((sum, d) => sum + d.cost, 0);

  if (total === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        No data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: getProviderLabel(d.provider),
    provider: d.provider,
    value: d.cost,
    pct: ((d.cost / total) * 100).toFixed(1),
  }));

  const summary = chartData.map((d) => `${d.name} ${d.pct}%`).join(", ");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0" role="img" aria-label={`Provider breakdown: ${summary}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.provider}
                  fill={PROVIDER_COLORS[entry.provider] ?? "#888"}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1b23",
                border: "1px solid #2a2b35",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5 pt-2">
        {chartData.map((entry) => (
          <div key={entry.provider} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: PROVIDER_COLORS[entry.provider] ?? "#888" }}
              />
              <span>{entry.name}</span>
            </div>
            <span className="font-mono text-muted whitespace-nowrap">{entry.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
