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

export interface ProviderAdapter {
  provider: string;
  sync(since: Date): Promise<CostEntry[]>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  isConfigured(): boolean;
}
