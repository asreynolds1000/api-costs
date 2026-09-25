"use client";

type Preset = { label: string; days: number };

const presets: Preset[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

type Props = {
  activeDays: number;
  onChange: (days: number) => void;
};

export function DateRangePicker({ activeDays, onChange }: Props) {
  return (
    <div role="group" aria-label="Date range" className="flex rounded-lg bg-card border border-card-border p-0.5">
      {presets.map((p) => (
        <button
          key={p.days}
          onClick={() => onChange(p.days)}
          aria-pressed={activeDays === p.days}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
            activeDays === p.days
              ? "bg-card-border text-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
