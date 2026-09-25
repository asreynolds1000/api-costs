"use client";

import { useEffect, useState } from "react";
import type { PlanUsage as PlanUsageType, QuotaWindow } from "@/lib/plans";
import { windowElapsed } from "@/lib/plans/parse";
import { formatClockTime, formatDuration, formatRelativeTime } from "@/lib/format";

const REFRESH_MS = 60_000;
const STALE_MS = 6 * 60 * 60 * 1000;

type Props = { initial: PlanUsageType[]; serverNow: number };

export function PlanUsage({ initial, serverNow }: Props) {
  const [plans, setPlans] = useState(initial);
  // Starts at the server's clock so the first client render matches the server HTML.
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      setNow(Date.now());
      try {
        const res = await fetch("/api/plans", { cache: "no-store" });
        if (res.ok && !cancelled) setPlans(await res.json());
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
        <p className="text-xs text-muted hidden sm:block">
          The notch marks how much of each window has passed.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} now={now} />
        ))}
      </div>
    </section>
  );
}

function PlanCard({ plan, now }: { plan: PlanUsageType; now: number }) {
  const updatedMs = plan.updatedAt ? new Date(plan.updatedAt).getTime() : null;
  const stale = updatedMs !== null && now - updatedMs > STALE_MS;

  return (
    <article className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
      <header className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="font-medium">{plan.name}</h3>
        {plan.updatedAt && (
          <span className={`text-xs ${stale ? "text-warning" : "text-muted"}`}>
            {stale ? "Last reading " : "Updated "}
            {formatRelativeTime(plan.updatedAt, now)}
          </span>
        )}
      </header>

      {plan.status === "ok" ? (
        <div className={`space-y-4 ${stale ? "opacity-70" : ""}`}>
          {plan.windows.map((w) => (
            <WindowMeter key={w.key} window={w} now={now} />
          ))}
        </div>
      ) : (
        <p className={`text-sm ${plan.status === "error" ? "text-critical" : "text-muted"}`}>
          {plan.message}
        </p>
      )}

      {plan.note && plan.status === "ok" && (
        <p className="text-xs text-muted mt-4">{plan.note}</p>
      )}
    </article>
  );
}

function WindowMeter({ window: w, now }: { window: QuotaWindow; now: number }) {
  const nowSec = now / 1000;
  const used = w.usedPercent;
  const elapsed = windowElapsed(w, nowSec);
  const level = used === null ? "none" : used >= 90 ? "critical" : used >= 75 ? "warning" : "normal";
  const fill = { none: "", normal: "bg-meter", warning: "bg-warning", critical: "bg-critical" }[level];

  const resetText = w.reset
    ? `Reset at ${formatClockTime(w.resetsAt!, nowSec)}. New usage shows after your next reply.`
    : w.resetsAt !== null
      ? `Resets ${formatClockTime(w.resetsAt, nowSec)}, in ${formatDuration(w.resetsAt - nowSec)}`
      : null;

  const label = `${w.label} limit`;
  const valueText =
    used === null
      ? "unknown since reset"
      : `${Math.round(used)}% used${elapsed !== null ? `, ${Math.round(elapsed * 100)}% of the window passed` : ""}`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm">{w.label}</span>
        <span className="text-sm tabular-nums">
          {used === null ? (
            <span className="text-muted">Reset</span>
          ) : (
            <>
              <span className="font-semibold">{Math.round(used)}%</span>
              <span className="text-muted"> used</span>
              {level !== "normal" && (
                <span className={`ml-2 ${level === "critical" ? "text-critical" : "text-warning"}`}>
                  {level === "critical" ? "Near limit" : "Getting close"}
                </span>
              )}
            </>
          )}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used ?? undefined}
        aria-valuetext={valueText}
        className="relative h-2 rounded-full bg-meter-track"
      >
        {used !== null && (
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${fill}`}
            style={{ width: `${Math.min(100, Math.max(used, used > 0 ? 1.5 : 0))}%` }}
          />
        )}
        {elapsed !== null && (
          <div
            aria-hidden
            title={`${Math.round(elapsed * 100)}% of the window has passed`}
            className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground shadow-[0_0_0_2px_var(--card)]"
            style={{ left: `calc(${elapsed * 100}% - 1px)` }}
          />
        )}
      </div>
      {resetText && <p className="text-xs text-muted mt-1.5">{resetText}</p>}
    </div>
  );
}
