"use client";

import { useState } from "react";
import type { ActivityDaily, SessionsByDay } from "@/lib/activity/queries";
import { formatCurrency, formatInt } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";

type Props = {
  daily: ActivityDaily[];
  sessions: SessionsByDay[];
  today: string; // YYYY-MM-DD, Eastern
  dataStart: string | null; // earliest day with indexed usage
};

type Day = { date: string; messages: number; sessions: number; estCost: number };

const CELL = 15;
const GAP = 4;
const PITCH = CELL + GAP;
const LEFT = 30; // day-name gutter
const TOP = 18; // month-name gutter
// Sequential, one hue (the gauges' silver), dark to bright. Level 0 is "no activity".
const LEVELS = ["var(--meter-track)", "#3d3f53", "#63667e", "#a0a3b9", "#e6e7ef"];

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const utc = (date: string) => new Date(`${date}T12:00:00Z`);

export function ActivityHeatmap({ daily, sessions, today, dataStart }: Props) {
  const [hover, setHover] = useState<{ day: Day; x: number; y: number } | null>(null);

  const byDate = new Map<string, Day>();
  const get = (date: string) => {
    let d = byDate.get(date);
    if (!d) byDate.set(date, (d = { date, messages: 0, sessions: 0, estCost: 0 }));
    return d;
  };
  for (const r of daily) {
    const d = get(r.date);
    d.messages += r.messages;
    d.estCost += r.estCost;
  }
  for (const s of sessions) get(s.date).sessions += s.count;

  // 53 week columns ending with the current week; columns start on Sunday
  const first = shiftDate(today, -364);
  const gridStart = shiftDate(first, -utc(first).getUTCDay());
  const days: { date: string; col: number; row: number }[] = [];
  for (let date = gridStart, i = 0; date <= today; date = shiftDate(date, 1), i++) {
    days.push({ date, col: Math.floor(i / 7), row: i % 7 });
  }
  const cols = days.at(-1)!.col + 1;

  // Quartile bins over active days, so one huge day doesn't flatten the rest
  const active = days
    .map((d) => byDate.get(d.date)?.messages ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const q = (p: number) => active[Math.min(active.length - 1, Math.floor(p * active.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (n: number) => (n <= 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4);
  // Codex logs before Sep 2026 carry sessions but no per-message usage; show those days as active
  const dayLevel = (day?: Day) => (!day ? 0 : day.messages > 0 ? level(day.messages) : day.sessions > 0 ? 1 : 0);

  const months: { col: number; label: string }[] = [];
  for (const d of days) {
    if (d.date.endsWith("-01") || d === days[0]) {
      if (!months.length || d.col - months.at(-1)!.col >= 3) months.push({ col: d.col, label: monthFmt.format(utc(d.date)) });
    }
  }

  const busiest = [...byDate.values()].sort((a, b) => b.messages - a.messages)[0];
  const width = LEFT + cols * PITCH;
  const height = TOP + 7 * PITCH;
  const label = busiest
    ? `Messages per day over the last year. Busiest day: ${dayFmt.format(utc(busiest.date))}, ${formatInt(busiest.messages)} messages.`
    : "Messages per day over the last year. No activity recorded.";

  return (
    <div className="relative">
      <svg width={width} height={height} role="img" aria-label={label} className="block max-w-full">
        {months.map((m) => (
          <text key={m.col} x={LEFT + m.col * PITCH} y={11} className="fill-muted text-[11px]">
            {m.label}
          </text>
        ))}
        {[1, 3, 5].map((row) => (
          <text key={row} x={0} y={TOP + row * PITCH + CELL - 3} className="fill-muted text-[11px]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][row]}
          </text>
        ))}
        {days.map((d) => {
          const day = byDate.get(d.date);
          const beforeData = !!dataStart && d.date < dataStart;
          const outOfRange = d.date < first;
          const x = LEFT + d.col * PITCH;
          const y = TOP + d.row * PITCH;
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx={3}
              fill={LEVELS[dayLevel(day)]}
              opacity={outOfRange ? 0 : beforeData && !day ? 0.35 : 1}
              onMouseEnter={() =>
                !outOfRange && setHover({ day: day ?? { date: d.date, messages: 0, sessions: 0, estCost: 0 }, x, y })
              }
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 rounded-lg border border-card-border bg-background px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(hover.x + CELL + 8, width - 200), top: Math.max(0, hover.y - 8) }}
        >
          <p className="font-medium text-foreground">{dayFmt.format(utc(hover.day.date))}</p>
          {hover.day.messages || hover.day.sessions ? (
            <>
              <p className="text-muted mt-0.5">
                {formatInt(hover.day.messages)} messages, {formatInt(hover.day.sessions)} sessions
              </p>
              {hover.day.estCost > 0 && (
                <p className="text-muted">≈ {formatCurrency(hover.day.estCost)} at API prices</p>
              )}
            </>
          ) : (
            <p className="text-muted mt-0.5">
              {dataStart && hover.day.date < dataStart ? "Before the logs this Mac still has" : "No activity"}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-1.5 mt-2 text-xs text-muted" aria-hidden>
        <span className="mr-1">Less</span>
        {LEVELS.map((c) => (
          <span key={c} className="inline-block rounded-[3px]" style={{ width: 11, height: 11, background: c }} />
        ))}
        <span className="ml-1">More</span>
      </div>
    </div>
  );
}
