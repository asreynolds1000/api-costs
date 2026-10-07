"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { PlanUsage, TrendPoint } from "@/lib/plans";
import { applyReset } from "@/lib/plans/parse";
import { formatClockTime } from "@/lib/format";

// Burn-up of each plan's weekly limit. The plans' weeks start at different times, so the
// x axis is days into each plan's own window, which also makes one even-pace line serve both.

const SERIES: Record<string, { label: string; color: string }> = {
  claude: { label: "Claude Max", color: "var(--provider-anthropic)" },
  codex: { label: "ChatGPT Codex", color: "var(--provider-openai)" },
};

const DAY = 86400;
const WEEK_DAYS = 7;
const HEIGHT = 244;
const M = { top: 12, right: 44, bottom: 32, left: 40 };

type Series = {
  id: string;
  label: string;
  color: string;
  start: number; // window start, epoch seconds
  resetsAt: number;
  points: { day: number; used: number }[];
  now: { day: number; used: number };
  projected: number | null; // straight-line % at reset; null too early in the window
};

function buildSeries(plans: PlanUsage[], nowSec: number): Series[] {
  return plans.flatMap((plan) => {
    const meta = SERIES[plan.id];
    const raw = plan.windows.find((w) => w.windowMinutes === WEEK_DAYS * 1440);
    if (!meta || !raw?.trend?.length) return [];
    const w = applyReset(raw, nowSec);
    if (w.reset || w.resetsAt === null || w.usedPercent === null) return [];
    const start = w.resetsAt - WEEK_DAYS * DAY;
    const toPoint = (p: TrendPoint) => ({ day: (p.at - start) / DAY, used: p.used });
    const points = raw.trend.map(toPoint);
    const nowDay = Math.min(WEEK_DAYS, (nowSec - start) / DAY);
    // Usage holds between readings, so the line runs flat from the last reading to now
    const now = { day: Math.max(points.at(-1)!.day, nowDay), used: points.at(-1)!.used };
    const elapsed = now.day / WEEK_DAYS;
    const projected = elapsed >= 0.1 && now.used > 0 ? now.used / elapsed : null;
    return [{ id: plan.id, ...meta, start, resetsAt: w.resetsAt, points, now, projected }];
  });
}

const dayTime = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export function WeekTrend({ plans, now }: { plans: PlanUsage[]; now: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nowSec = now / 1000;
  const series = buildSeries(plans, nowSec);
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (day: number) => M.left + (day / WEEK_DAYS) * plotW;
  const y = (pct: number) => M.top + (1 - Math.min(100, pct) / 100) * plotH;

  const valueAt = (s: Series, day: number): { used: number; projected: boolean } | null => {
    if (day <= s.now.day) {
      const pts = [...s.points, s.now];
      const i = pts.findIndex((p) => p.day >= day);
      if (i <= 0) return { used: pts[0].used, projected: false };
      const a = pts[i - 1];
      const b = pts[i];
      const t = b.day === a.day ? 1 : (day - a.day) / (b.day - a.day);
      return { used: a.used + t * (b.used - a.used), projected: false };
    }
    if (s.projected === null) return null;
    const t = (day - s.now.day) / (WEEK_DAYS - s.now.day);
    return { used: Math.min(100, s.now.used + t * (s.projected - s.now.used)), projected: true };
  };

  const summary = series.length
    ? series
        .map(
          (s) =>
            `${s.label} at ${Math.round(s.now.used)}% on day ${Math.ceil(s.now.day)} of 7` +
            (s.projected !== null ? `, on pace for about ${Math.round(Math.min(100, s.projected))}% by reset` : "")
        )
        .join(". ")
    : "No weekly readings yet.";

  return (
    <article className="plan-group plan-group--trend">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <h3 className="font-medium leading-tight">This week</h3>
          <p className="text-xs mt-0.5 text-muted">Weekly limits since each one reset</p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <svg width="16" height="8" aria-hidden>
                <line x1="1" y1="4" x2="15" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
              </svg>
              {s.label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden>
              <line x1="1" y1="4" x2="15" y2="4" stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" />
            </svg>
            Projected
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden>
              <line x1="1" y1="4" x2="15" y2="4" stroke="var(--spark)" strokeWidth="1.5" />
            </svg>
            Even pace
          </li>
        </ul>
      </header>

      <div ref={box} className="relative" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Weekly limit used over each plan's current week. ${summary}.`}
            className="block overflow-visible"
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const day = ((e.clientX - rect.left - M.left) / plotW) * WEEK_DAYS;
              setHoverDay(day >= 0 && day <= WEEK_DAYS ? day : null);
            }}
            onPointerLeave={() => setHoverDay(null)}
          >
            {[0, 25, 50, 75, 100].map((pct) => (
              <g key={pct}>
                <line x1={M.left} x2={M.left + plotW} y1={y(pct)} y2={y(pct)} stroke="var(--card-border)" strokeWidth={1} />
                <text x={M.left - 8} y={y(pct) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {pct}%
                </text>
              </g>
            ))}
            {/* Days are bands, labelled at their middles */}
            {Array.from({ length: WEEK_DAYS }, (_, d) => (
              <text key={d} x={x(d + 0.5)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted text-[11px]">
                Day {d + 1}
              </text>
            ))}

            {/* Even pace: the straight line from 0% at reset to 100% at the next one */}
            <line x1={x(0)} y1={y(0)} x2={x(WEEK_DAYS)} y2={y(100)} stroke="var(--spark)" strokeWidth={1.5} />

            {series.map((s, i) => {
              // Label above the end dot unless another plan's line runs just above it there
              const crowded = series.some((o, j) => {
                if (j === i) return false;
                const v = valueAt(o, s.now.day);
                return v !== null && y(v.used) < y(s.now.used) && y(s.now.used) - y(v.used) < 22;
              });
              const pts = [...s.points, s.now].map((p) => `${x(p.day)},${y(p.used)}`).join(" ");
              const endDay =
                s.projected === null
                  ? null
                  : s.projected <= 100
                    ? WEEK_DAYS
                    : s.now.day + ((100 - s.now.used) / (s.projected - s.now.used)) * (WEEK_DAYS - s.now.day);
              const endUsed = s.projected === null ? null : Math.min(100, s.projected);
              return (
                <g key={s.id}>
                  {endDay !== null && endUsed !== null && (
                    <>
                      <line
                        x1={x(s.now.day)}
                        y1={y(s.now.used)}
                        x2={x(endDay)}
                        y2={y(endUsed)}
                        stroke={s.color}
                        strokeOpacity={0.6}
                        strokeWidth={1.5}
                        strokeDasharray="2 4"
                        strokeLinecap="round"
                      />
                      <text x={x(endDay) + 6} y={y(endUsed) + 4} className="fill-muted text-[11px] tabular-nums">
                        {Math.round(endUsed)}%
                      </text>
                    </>
                  )}
                  <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  <circle cx={x(s.now.day)} cy={y(s.now.used)} r={5} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                  <text
                    x={x(s.now.day)}
                    y={crowded ? y(s.now.used) + 17 : y(s.now.used) - 10}
                    textAnchor="middle"
                    className="fill-foreground text-[12px] font-semibold tabular-nums"
                  >
                    {Math.round(s.now.used)}%
                  </text>
                </g>
              );
            })}

            {hoverDay !== null && (
              <line x1={x(hoverDay)} x2={x(hoverDay)} y1={M.top} y2={M.top + plotH} stroke="var(--muted)" strokeWidth={1} />
            )}
          </svg>
        )}

        {hoverDay !== null && series.length > 0 && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-card-border bg-background px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(x(hoverDay) + 10, width - 260), top: M.top }}
          >
            <p className="font-medium text-foreground">Day {Math.min(WEEK_DAYS, Math.floor(hoverDay) + 1)} of 7</p>
            {series.map((s) => {
              const v = valueAt(s, hoverDay);
              return (
                <p key={s.id} className="mt-1 flex items-center gap-2 text-muted">
                  <svg width="12" height="6" aria-hidden>
                    <line x1="1" y1="3" x2="11" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="font-semibold text-foreground tabular-nums">{v ? `${Math.round(v.used)}%` : "—"}</span>
                  <span>
                    {s.label}, {v?.projected ? "projected" : dayTime.format(new Date((s.start + hoverDay * DAY) * 1000))}
                  </span>
                </p>
              );
            })}
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>Weekly limit used, current week</caption>
        <thead>
          <tr>
            <th scope="col">Plan</th>
            <th scope="col">Used now</th>
            <th scope="col">Projected at reset</th>
            <th scope="col">Resets</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td>{Math.round(s.now.used)}%</td>
              <td>{s.projected === null ? "Too early to tell" : `${Math.round(Math.min(100, s.projected))}%`}</td>
              <td>{formatClockTime(s.resetsAt, nowSec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
