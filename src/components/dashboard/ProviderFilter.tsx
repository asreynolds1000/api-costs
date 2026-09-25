"use client";

import { getProviderLabel, getProviderColor } from "@/lib/format";

type Props = {
  providers: string[];
  active: string | null;
  onChange: (provider: string | null) => void;
};

export function ProviderFilter({ providers, active, onChange }: Props) {
  const chip = (selected: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${
      selected
        ? "border-foreground/40 bg-card-border text-foreground"
        : "border-transparent text-muted hover:text-foreground hover:bg-card"
    }`;

  return (
    <div role="group" aria-label="Filter by provider" className="flex flex-wrap items-center gap-1">
      <button onClick={() => onChange(null)} aria-pressed={active === null} className={chip(active === null)}>
        All providers
      </button>
      {providers.map((p) => (
        <button
          key={p}
          onClick={() => onChange(active === p ? null : p)}
          aria-pressed={active === p}
          className={chip(active === p)}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getProviderColor(p) }} />
          {getProviderLabel(p)}
        </button>
      ))}
    </div>
  );
}
