"use client";

import { getProviderLabel, getProviderColor } from "@/lib/format";

type Props = {
  providers: string[];
  active: string | null;
  onChange: (provider: string | null) => void;
};

export function ProviderFilter({ providers, active, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onChange(null)}
        className={`px-2.5 py-1 text-xs rounded transition-colors ${
          active === null
            ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/30"
            : "text-muted hover:text-foreground hover:bg-card-border/30"
        }`}
      >
        All Providers
      </button>
      {providers.map((p) => (
        <button
          key={p}
          onClick={() => onChange(active === p ? null : p)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
            active === p
              ? "bg-card-border border border-card-border text-foreground"
              : "text-muted hover:text-foreground hover:bg-card-border/30"
          }`}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: getProviderColor(p) }}
          />
          {getProviderLabel(p)}
        </button>
      ))}
    </div>
  );
}
