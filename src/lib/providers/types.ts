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

export interface ProviderAdapter {
  provider: string;
  sync(since: Date): Promise<CostEntry[]>;
  // Adapters that diff against a previous reading implement this instead of relying on
  // sync(); the returned state is committed in the same transaction as the entries.
  syncWithState?(since: Date, state: ProviderState): Promise<{ entries: CostEntry[]; state: ProviderState }>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  isConfigured(): boolean;
}
