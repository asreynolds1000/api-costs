"use client";

import { useState } from "react";
import type { SyncStatus } from "@/lib/db/queries";
import { getProviderLabel, formatRelativeTime } from "@/lib/format";

type SyncPanelProps = {
  statuses: SyncStatus[];
  providerConfigured: Record<string, boolean>;
  onManualEntry: () => void;
};

async function syncProvider(provider: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`/api/sync/${provider}`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      return { ok: true, message: `Synced ${data.recordsSynced ?? 0} records` };
    }
    return { ok: false, message: data.error ?? "Sync failed" };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

export function SyncPanel({ statuses, providerConfigured, onManualEntry }: SyncPanelProps) {
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);

  async function handleSync(provider: string) {
    setSyncing((s) => ({ ...s, [provider]: true }));
    setResults((r) => ({ ...r, [provider]: "" }));
    const result = await syncProvider(provider);
    setResults((r) => ({ ...r, [provider]: result.message }));
    setSyncing((s) => ({ ...s, [provider]: false }));
    if (result.ok) window.location.reload();
  }

  async function handleSyncAll() {
    const providers = statuses
      .filter((s) => providerConfigured[s.provider])
      .map((s) => s.provider);

    for (const p of providers) {
      setSyncing((s) => ({ ...s, [p]: true }));
    }

    const allResults: Record<string, string> = {};
    for (const p of providers) {
      const result = await syncProvider(p);
      allResults[p] = result.message;
      setResults((r) => ({ ...r, [p]: result.message }));
      setSyncing((s) => ({ ...s, [p]: false }));
    }

    setResults(allResults);
    window.location.reload();
  }

  return (
    <div className="bg-card border border-card-border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors"
          aria-expanded={expanded}
        >
          <span>Sync Status</span>
          <span className="text-muted">{expanded ? "\u25B2" : "\u25BC"}</span>
        </button>
        <button
          onClick={handleSyncAll}
          className="text-xs px-2.5 py-1 bg-accent-blue/20 text-accent-blue rounded hover:bg-accent-blue/30 transition-colors"
        >
          Sync All
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-card-border pt-3">
          {statuses.map((status) => {
            const configured = providerConfigured[status.provider];
            const isGemini = status.provider === "gemini";

            return (
              <div
                key={status.provider}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      configured ? "bg-accent-green" : "bg-muted"
                    }`}
                  />
                  <span className="font-medium w-16">
                    {getProviderLabel(status.provider)}
                  </span>
                  <span className="text-muted text-xs">
                    {status.lastSync
                      ? `Last: ${formatRelativeTime(status.lastSync)}`
                      : isGemini && !configured
                        ? "Manual entry / BigQuery not configured"
                        : configured
                          ? "Never synced"
                          : "Not configured"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {results[status.provider] && (
                    <span className="text-xs text-muted">
                      {results[status.provider]}
                    </span>
                  )}
                  {isGemini && (
                    <button
                      onClick={onManualEntry}
                      className="text-xs px-2.5 py-1 bg-card-border rounded hover:bg-card-border/70 transition-colors"
                    >
                      Add Entry
                    </button>
                  )}
                  {(!isGemini || configured) && (
                    <button
                      onClick={() => handleSync(status.provider)}
                      disabled={!configured || syncing[status.provider]}
                      className="text-xs px-2.5 py-1 bg-card-border rounded hover:bg-card-border/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {syncing[status.provider] ? "Syncing..." : "Sync"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {!providerConfigured.openai && (
            <p className="text-xs text-muted mt-2">
              OpenAI: Set OPENAI_ADMIN_KEY in .env.local (sk-admin-* from platform.openai.com)
            </p>
          )}
          {!providerConfigured.xai && (
            <p className="text-xs text-muted">
              xAI: Set XAI_MANAGEMENT_KEY and XAI_TEAM_ID in .env.local (from console.x.ai)
            </p>
          )}
          {!providerConfigured.gemini && (
            <p className="text-xs text-muted">
              Gemini: Set GOOGLE_APPLICATION_CREDENTIALS and GCP_BILLING_TABLE for auto-sync (see SETUP.md)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
