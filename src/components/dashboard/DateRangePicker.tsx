"use client";

type Preset = { label: string; days: number };

const presets: Preset[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

type Props = {
  activeDays: number;
  onChange: (days: number) => void;
};

export function DateRangePicker({ activeDays, onChange }: Props) {
  return (
    <div className="flex gap-1">
      {presets.map((p) => (
        <button
          key={p.days}
          onClick={() => onChange(p.days)}
          className={`px-2.5 py-1 text-xs rounded transition-colors ${
            activeDays === p.days
              ? "bg-accent-blue/20 text-accent-blue"
              : "text-muted hover:text-foreground hover:bg-card-border/30"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
