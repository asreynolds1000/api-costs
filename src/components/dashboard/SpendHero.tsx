import { formatCurrency } from "@/lib/format";
import type { DailySpend, PeriodSummary } from "@/lib/db/queries";

type Props = { summary: PeriodSummary; daily: DailySpend[]; today: string };

// The page's one headline number (this month's spend) with its month-to-date bars, then the
// supporting periods as a quiet row. Server-rendered; no client state.
export function SpendHero({ summary, daily, today }: Props) {
  const [y, m, d] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthPrefix = today.slice(0, 8);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const prevPrefix = prev.toISOString().slice(0, 8);
  const monthName = (date: Date) => date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  const byDay = new Array<number>(daysInMonth).fill(0);
  let prevToDate = 0;
  for (const row of daily) {
    if (row.date.startsWith(monthPrefix)) byDay[Number(row.date.slice(8)) - 1] += row.cost;
    else if (row.date.startsWith(prevPrefix) && Number(row.date.slice(8)) <= d) prevToDate += row.cost;
  }

  const delta = summary.thisMonth - prevToDate;
  const deltaText =
    Math.abs(delta) < 0.01
      ? `Same as ${monthName(prev)} at this point`
      : `${formatCurrency(Math.abs(delta))} ${delta > 0 ? "more" : "less"} than ${monthName(prev)} by the ${ordinal(d)}`;

  // A straight-line projection is noise in the first days of a month
  const projected = d >= 3 ? (summary.thisMonth / d) * daysInMonth : null;

  const stats: { label: string; value: string; detail?: string; title?: string }[] = [
    ...(projected !== null
      ? [
          {
            label: `Projected for ${monthName(new Date(Date.UTC(y, m - 1, 1)))}`,
            value: formatCurrency(projected),
            title: "Month to date divided by days elapsed, times days in the month. Gemini costs arrive a day or two late, so this runs low near the end of the month.",
          },
        ]
      : []),
    { label: "Last 30 days", value: formatCurrency(summary.last30Days) },
    { label: "This week", value: formatCurrency(summary.thisWeek) },
    {
      label: "This year",
      value: formatCurrency(summary.thisYear),
      detail:
        Math.abs(summary.allTime - summary.thisYear) >= 0.01 ? `${formatCurrency(summary.allTime)} all time` : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
      <div>
        <p className="text-sm text-muted">This month</p>
        <div className="flex items-end gap-5 mt-1">
          <p className="font-display text-6xl font-semibold leading-none tracking-tight">
            {formatCurrency(summary.thisMonth)}
          </p>
          <MonthBars
            byDay={byDay}
            today={d}
            monthShort={new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
          />
        </div>
        <p className="text-sm text-muted mt-2">{deltaText}</p>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-4 pb-1">
        {stats.map((s) => (
          <div key={s.label} title={s.title}>
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="font-display text-2xl font-semibold mt-0.5">{s.value}</dd>
            {s.detail && <dd className="text-xs text-muted mt-0.5">{s.detail}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

// One bar per day of the month. Days to come show as faint slots, so the width also reads
// as how far through the month we are. Today is the only bar in the accent.
function MonthBars({ byDay, today, monthShort }: { byDay: number[]; today: number; monthShort: string }) {
  const max = Math.max(...byDay, 0.01);
  const H = 44;
  const BAR = 5;
  const GAP = 2;
  const width = byDay.length * (BAR + GAP) - GAP;
  const peak = byDay.indexOf(Math.max(...byDay));
  const label = `Daily spend this month, highest ${formatCurrency(byDay[peak])} on day ${peak + 1}`;

  return (
    <svg width={width} height={H} role="img" aria-label={label} className="mb-1.5 overflow-visible">
      {byDay.map((v, i) => {
        const day = i + 1;
        const future = day > today;
        const h = future ? 2 : Math.max(2, (v / max) * H);
        const fill = future ? "var(--meter-track)" : day === today ? "var(--meter)" : "var(--spark)";
        return (
          <rect key={day} x={i * (BAR + GAP)} y={H - h} width={BAR} height={h} rx={1.5} fill={fill}>
            {!future && <title>{`${monthShort} ${day}: ${formatCurrency(v)}`}</title>}
          </rect>
        );
      })}
    </svg>
  );
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}
