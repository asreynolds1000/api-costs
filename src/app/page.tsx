import {
  getPeriodSummary,
  getDailySpend,
  getProviderSpend,
  getModelSpend,
  getSyncStatuses,
} from "@/lib/db/queries";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

// Don't cache -- always read fresh from SQLite
export const dynamic = "force-dynamic";

export default function Home() {
  // Query all data server-side from SQLite
  // Get 1 year of daily data (client filters to selected range)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const startDate = oneYearAgo.toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  const summary = getPeriodSummary();
  const daily = getDailySpend(startDate, endDate);
  const providers = getProviderSpend();
  const models = getModelSpend();
  const syncStatuses = getSyncStatuses();

  const geminiSyncConfigured = !!(
    process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    (process.env.GCP_BILLING_TABLE ||
      (process.env.GCP_BILLING_PROJECT && process.env.GCP_BILLING_DATASET))
  );

  const providerConfigured: Record<string, boolean> = {
    openai: !!process.env.OPENAI_ADMIN_KEY,
    xai: !!process.env.XAI_MANAGEMENT_KEY && !!process.env.XAI_TEAM_ID,
    gemini: geminiSyncConfigured,
    openrouter: !!process.env.OPENROUTER_MGMT_KEY,
  };

  return (
    <DashboardClient
      data={{
        summary,
        daily,
        providers,
        models,
        syncStatuses,
        providerConfigured,
      }}
    />
  );
}
