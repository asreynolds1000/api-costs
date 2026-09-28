"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanUsage as PlanUsageType, QuotaWindow } from "@/lib/plans";
import { applyReset, windowElapsed } from "@/lib/plans/parse";
import { formatClockTime, formatDuration, formatRelativeTime } from "@/lib/format";

const REFRESH_MS = 60_000;
const STALE_MS = 6 * 60 * 60 * 1000;

type Props = { initial: PlanUsageType[]; serverNow: number };

export function PlanUsage({ initial, serverNow }: Props) {
  const [plans, setPlans] = useState(initial);
  // Starts at the server's clock so the first client render matches the server HTML.
  const [now, setNow] = useState(serverNow);
  const latestRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      setNow(Date.now());
      const id = ++latestRequest.current;
      try {
        const res = await fetch("/api/plans", { cache: "no-store" });
        const body = res.ok ? await res.json() : null;
        // A slower, older request must not overwrite a newer one
        if (body && !cancelled && id === latestRequest.current) setPlans(body);
      } catch {
        // keep the last good reading
      }
    }
    const timer = setInterval(refresh, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(clock);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <section aria-labelledby="plans-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="plans-heading" className="text-base font-semibold">
          Plan limits
        </h2>
        <p className="text-xs text-muted">The notch on each gauge marks how much of the window has passed.</p>
      </div>
      <div className="plan-cluster">
        {plans.map((plan) => (
          <PlanGroup key={plan.id} plan={plan} now={now} />
        ))}
      </div>
    </section>
  );
}

function PlanGroup({ plan, now }: { plan: PlanUsageType; now: number }) {
  const updatedMs = plan.updatedAt ? new Date(plan.updatedAt).getTime() : null;
  const stale = updatedMs !== null && now - updatedMs > STALE_MS;

  return (
    <article className="plan-group">
      <header className="mb-3">
        <h3 className="font-medium leading-tight">{plan.name}</h3>
        {plan.updatedAt && (
          <p className={`text-xs mt-0.5 ${stale ? "text-warning" : "text-muted"}`}>
            {stale ? "Last reading " : "Updated "}
            {formatRelativeTime(plan.updatedAt, now)}
          </p>
        )}
      </header>

      {plan.status !== "ok" ? (
        <p className={`text-sm max-w-52 ${plan.status === "error" ? "text-critical" : "text-muted"}`}>{plan.message}</p>
      ) : (
        <div className={`flex gap-6 ${stale ? "opacity-70" : ""}`}>
          {plan.windows.map((w) => (
            <Gauge key={w.key} window={w} now={now} />
          ))}
          {plan.balance && (
            <div className="gauge-slot justify-center">
              <p className="font-display text-5xl font-semibold leading-none">{plan.balance.value}</p>
              <p className="text-sm text-muted mt-2">{plan.balance.label}</p>
            </div>
          )}
        </div>
      )}

      {plan.note && plan.status === "ok" && <p className="text-xs text-muted mt-3 max-w-64">{plan.note}</p>}
    </article>
  );
}

// 270° arc, open at the bottom like an instrument dial.
const SIZE = 132;
const STROKE = 9;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const SWEEP = 0.75;
const START_DEG = 135;

function polar(deg: number, radius: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: SIZE / 2 + radius * Math.cos(rad), y: SIZE / 2 + radius * Math.sin(rad) };
}

function Gauge({ window: reading, now }: { window: QuotaWindow; now: number }) {
  const nowSec = now / 1000;
  // The window may have reset since this reading was fetched
  const w = applyReset(reading, nowSec);
  const used = w.usedPercent;
  const elapsed = windowElapsed(w, nowSec);
  const level = used === null ? "none" : used >= 90 ? "critical" : used >= 75 ? "warning" : "normal";
  const fill = { none: "transparent", normal: "var(--meter)", warning: "var(--warning)", critical: "var(--critical)" }[
    level
  ];

  const fraction = used === null ? 0 : Math.min(1, Math.max(0, used / 100));
  const arc = C * SWEEP;
  const notch = elapsed === null ? null : START_DEG + 360 * SWEEP * elapsed;

  const resetText = w.reset
    ? "Reset. New usage shows after your next reply."
    : w.resetsAt !== null
      ? `Resets ${formatClockTime(w.resetsAt, nowSec)}, in ${formatDuration(w.resetsAt - nowSec)}`
      : null;
  const pace = paceText(w, used, elapsed, nowSec);

  const valueText =
    used === null
      ? "unknown since reset"
      : `${Math.round(used)}% used${elapsed !== null ? `, ${Math.round(elapsed * 100)}% of the window passed` : ""}`;

  return (
    <div className="gauge-slot">
      <div
        role="meter"
        aria-label={`${w.label} limit`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used ?? undefined}
        aria-valuetext={valueText}
        className="relative"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--meter-track)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${C}`}
            transform={`rotate(${START_DEG} ${SIZE / 2} ${SIZE / 2})`}
          />
          {fraction > 0 && (
            <circle
              className="gauge-fill"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={fill}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(arc * fraction, 0.5)} ${C}`}
              transform={`rotate(${START_DEG} ${SIZE / 2} ${SIZE / 2})`}
              style={{ color: fill }}
            />
          )}
          {notch !== null && <Notch deg={notch} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pb-1">
          {used === null ? (
            <span className="text-sm text-muted">Reset</span>
          ) : (
            <>
              <span className="font-display text-[2rem] font-semibold leading-none">
                {Math.round(used)}
                <span className="text-lg text-muted">%</span>
              </span>
              <span className="text-xs text-muted mt-1">used</span>
            </>
          )}
        </div>
        <span className="absolute inset-x-0 bottom-1 text-center text-sm font-medium">{w.label}</span>
      </div>
      {level === "warning" || level === "critical" ? (
        <p className={`text-xs font-medium mt-2 ${level === "critical" ? "text-critical" : "text-warning"}`}>
          {level === "critical" ? "Near the limit" : "Getting close"}
        </p>
      ) : null}
      {w.detail && <p className="text-xs text-muted mt-2">{w.detail}</p>}
      {resetText && <p className="text-xs text-muted mt-1.5 max-w-44">{resetText}</p>}
      {pace && <p className={`text-xs mt-1 max-w-44 ${pace.warn ? "text-warning" : "text-muted"}`}>{pace.text}</p>}
    </div>
  );
}

function Notch({ deg }: { deg: number }) {
  const inner = polar(deg, R - STROKE);
  const outer = polar(deg, R + STROKE * 0.9);
  return (
    <g>
      <title>{`${Math.round(((deg - START_DEG) / (360 * SWEEP)) * 100)}% of the window has passed`}</title>
      <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--card)" strokeWidth={5} strokeLinecap="round" />
      <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--foreground)" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

// Straight-line projection of the current window. Too early in a window it is noise, so it
// waits until a tenth has passed.
function paceText(
  w: QuotaWindow,
  used: number | null,
  elapsed: number | null,
  nowSec: number
): { text: string; warn: boolean } | null {
  if (used === null || used <= 0 || elapsed === null || elapsed < 0.1 || w.resetsAt === null) return null;
  const projected = used / elapsed;
  if (projected <= 100) return { text: `At this pace, about ${Math.round(projected)}% by reset`, warn: false };
  const start = w.resetsAt - w.windowMinutes * 60;
  const runsOutAt = start + (nowSec - start) * (100 / used);
  return { text: `At this pace, runs out ${formatClockTime(runsOutAt, nowSec)}`, warn: true };
}
