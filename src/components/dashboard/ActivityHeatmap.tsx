"use client";

import { useState } from "react";
import type { ActivityDaily, SessionsByDay } from "@/lib/activity/queries";
import { formatCurrency, formatInt } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";

type Props = {
  daily: ActivityDaily[];
  sessions: SessionsByDay[];
  today: string; // YYYY-MM-DD, Eastern
  dataStart: { claude: string | null; codex: string | null }; // earliest day with indexed usage
};

type Day = { date: string; messages: number; sessions: number; estCost: number };

// One grid per tool, each in its own hue (the spend chart's Anthropic and OpenAI colours) and
// scaled on its own: Codex runs at a tenth of Claude Code's message count, so a shared scale
// would leave its grid nearly blank. Ramps are one hue, dark to bright (OKLCH L .36/.48/.62/.80);
// level 0 is "no activity".
const SOURCES = [
  {
    key: "claude-code",
    label: "Claude Code",
    levels: ["var(--meter-track)", "#652810", "#9b3b12", "#d85825", "#ffa07c"],
  },
  {
    key: "codex",
    label: "Codex",
    levels: ["var(--meter-track)", "#0d4832", "#036f4d", "#189e70", "#81d2ac"],
  },
] as const;

const CELL = 15;
const GAP = 4;
const PITCH = CELL + GAP;
const LEFT = 30; // day-name gutter
const TOP = 18; // month-name gutter
const HEADER = 26; // per-grid title row
const BETWEEN = 18; // space between the two grids
const GRID_H = HEADER + 7 * PITCH;

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const utc = (date: string) => new Date(`${date}T12:00:00Z`);

type Hover = { source: string; day: Day; x: number; y: number; beforeData: boolean };

export function ActivityHeatmap({ daily, sessions, today, dataStart }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);

  // 53 week columns ending with the current week; columns start on Sunday
  const first = shiftDate(today, -364);
  const gridStart = shiftDate(first, -utc(first).getUTCDay());
  const days: { date: string; col: number; row: number }[] = [];
  for (let date = gridStart, i = 0; date <= today; date = shiftDate(date, 1), i++) {
    days.push({ date, col: Math.floor(i / 7), row: i % 7 });
  }
  const cols = days.at(-1)!.col + 1;

  const months: { col: number; label: string }[] = [];
  for (const d of days) {
    if (d.date.endsWith("-01") || d === days[0]) {
      if (!months.length || d.col - months.at(-1)!.col >= 3) months.push({ col: d.col, label: monthFmt.format(utc(d.date)) });
    }
  }

  const grids = SOURCES.map((source) => {
    const byDate = new Map<string, Day>();
    const get = (date: string) => {
      let d = byDate.get(date);
      if (!d) byDate.set(date, (d = { date, messages: 0, sessions: 0, estCost: 0 }));
      return d;
    };
    for (const r of daily) {
      if (r.source !== source.key) continue;
      const d = get(r.date);
      d.messages += r.messages;
      d.estCost += r.estCost;
    }
    let firstSession: string | null = null;
    for (const s of sessions) {
      if (s.source !== source.key) continue;
      get(s.date).sessions += s.count;
      if (!firstSession || s.date < firstSession) firstSession = s.date;
    }

    // Quartile bins over active days, so one huge day doesn't flatten the rest
    const active = [...byDate.values()]
      .filter((d) => d.date >= first)
      .map((d) => d.messages)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const q = (p: number) => active[Math.min(active.length - 1, Math.floor(p * active.length))] ?? 0;
    const cuts = [q(0.25), q(0.5), q(0.75)];
    const level = (n: number) => (n <= 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4);
    // Codex logs before Sep 2026 carry sessions but no per-message usage; show those days as active
    const dayLevel = (day?: Day) => (!day ? 0 : day.messages > 0 ? level(day.messages) : day.sessions > 0 ? 1 : 0);

    const usageStart = source.key === "codex" ? dataStart.codex : dataStart.claude;
    const start = [usageStart, firstSession].filter((d): d is string => !!d).sort()[0] ?? null;
    const total = active.reduce((a, b) => a + b, 0);
    const busiest = [...byDate.values()].sort((a, b) => b.messages - a.messages)[0];
    return { source, byDate, dayLevel, start, total, busiest };
  });

  const width = LEFT + cols * PITCH;
  const height = TOP + grids.length * GRID_H + (grids.length - 1) * BETWEEN;
  const label = grids
    .map(({ source, total, busiest }) =>
      busiest?.messages
        ? `${source.label}: ${formatInt(total)} messages over the last year, busiest day ${dayFmt.format(utc(busiest.date))} with ${formatInt(busiest.messages)}.`
        : `${source.label}: no messages recorded.`
    )
    .join(" ");

  return (
    <div className="relative">
      <svg width={width} height={height} role="img" aria-label={`Messages per day over the last year. ${label}`} className="block max-w-full">
        {months.map((m) => (
          <text key={m.col} x={LEFT + m.col * PITCH} y={11} className="fill-muted text-[11px]">
            {m.label}
          </text>
        ))}

        {grids.map(({ source, byDate, dayLevel, start, total }, g) => {
          const top = TOP + g * (GRID_H + BETWEEN);
          const cellsTop = top + HEADER;
          return (
            <g key={source.key}>
              <rect x={LEFT} y={top + 5} width={10} height={10} rx={2} fill={source.levels[3]} />
              <text x={LEFT + 16} y={top + 14} className="fill-foreground text-[12px] font-medium">
                {source.label}
              </text>
              <text x={width} y={top + 14} textAnchor="end" className="fill-muted text-[11px]">
                {formatInt(total)} messages
              </text>
              {[1, 3, 5].map((row) => (
                <text key={row} x={0} y={cellsTop + row * PITCH + CELL - 3} className="fill-muted text-[11px]">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][row]}
                </text>
              ))}
              {days.map((d) => {
                const day = byDate.get(d.date);
                const beforeData = !start || d.date < start;
                const outOfRange = d.date < first;
                const x = LEFT + d.col * PITCH;
                const y = cellsTop + d.row * PITCH;
                return (
                  <rect
                    key={d.date}
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    rx={3}
                    fill={source.levels[dayLevel(day)]}
                    opacity={outOfRange ? 0 : beforeData && !day ? 0.35 : 1}
                    stroke={hover?.source === source.key && hover.day.date === d.date ? "var(--foreground)" : undefined}
                    strokeWidth={1.5}
                    onMouseEnter={() =>
                      !outOfRange &&
                      setHover({
                        source: source.key,
                        day: day ?? { date: d.date, messages: 0, sessions: 0, estCost: 0 },
                        x,
                        y,
                        beforeData,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 rounded-lg border border-card-border bg-background px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(hover.x + CELL + 8, width - 220), top: Math.max(0, hover.y - 8) }}
        >
          <p className="font-medium text-foreground">
            {dayFmt.format(utc(hover.day.date))} · {SOURCES.find((s) => s.key === hover.source)?.label}
          </p>
          {hover.day.messages || hover.day.sessions ? (
            <>
              <p className="text-muted mt-0.5">
                {formatInt(hover.day.messages)} messages, {formatInt(hover.day.sessions)} sessions
              </p>
              {hover.day.estCost > 0 && <p className="text-muted">≈ {formatCurrency(hover.day.estCost)} at API prices</p>}
            </>
          ) : (
            <p className="text-muted mt-0.5">{hover.beforeData ? "Before the logs this Mac still has" : "No activity"}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-4 mt-2 text-xs text-muted" aria-hidden>
        <span>Less</span>
        {SOURCES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            {s.levels.map((c) => (
              <span key={c} className="inline-block rounded-[3px]" style={{ width: 11, height: 11, background: c }} />
            ))}
          </span>
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
