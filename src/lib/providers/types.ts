export type CostEntry = {
  provider: string;
  model: string;
  date: string;
  costUsd: number;
  unitType: string;
  units?: number;
  direction?: string;
  tokensIn?: number;
  tokensOut?: number;
  requests?: number;
  rawLineItem?: string;
};

// Key/value state an adapter needs across syncs and restarts (stored in provider_state).
export type ProviderState = Record<string, string>;

// Inclusive range of stored dates (YYYY-MM-DD) that an adapter's response covered in full.
export type SyncWindow = { from: string; to: string };

export interface ProviderAdapter {
  provider: string;
  sync(since: Date): Promise<CostEntry[]>;
  // Adapters that diff against a previous reading implement this instead of relying on
  // sync(); the returned state is committed in the same transaction as the entries.
  syncWithState?(since: Date, state: ProviderState): Promise<{ entries: CostEntry[]; state: ProviderState }>;
  // Adapters whose API returns every line item for each day it reports implement this. The
  // synced rows for the window's dates are replaced, not upserted, so a line item the provider
  // renamed or withdrew can't linger beside its replacement.
  syncWindow?(since: Date): Promise<{ entries: CostEntry[]; window: SyncWindow | null }>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  isConfigured(): boolean;
}
