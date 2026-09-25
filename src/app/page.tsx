import {
  getPeriodSummary,
  getDailySpend,
  getModelSpend,
  getSyncStatuses,
} from "@/lib/db/queries";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { getPlanUsage } from "@/lib/plans";
import { shiftDate, toEasternDate } from "@/lib/timezone";
import { DEFAULT_RANGE_DAYS } from "@/lib/format";

// Don't cache -- always read fresh from SQLite and the local usage files
export const dynamic = "force-dynamic";

export default function Home() {
  // One clock read per request; everything downstream derives dates from it, so the
  // server HTML and the first client render agree.
  // eslint-disable-next-line react-hooks/purity -- server component, runs once per request
  const serverNow = Date.now();
  const today = toEasternDate(new Date(serverNow));

  // A year of daily rows; the client slices it to the selected range. The upper bound is
  // tomorrow because fal, xAI and BFL date rows in UTC, which is tomorrow in the ET evening.
  const queryEnd = shiftDate(today, 1);
  const daily = getDailySpend(shiftDate(today, -365), queryEnd);
  const models = getModelSpend(shiftDate(today, -(DEFAULT_RANGE_DAYS - 1)), queryEnd);

  const geminiSyncConfigured = !!(
    process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    (process.env.GCP_BILLING_TABLE ||
      (process.env.GCP_BILLING_PROJECT && process.env.GCP_BILLING_DATASET))
  );

  const providerConfigured: Record<string, boolean> = {
    openai: !!process.env.OPENAI_ADMIN_KEY,
    anthropic: !!process.env.ANTHROPIC_ADMIN_KEY,
    xai: !!process.env.XAI_MANAGEMENT_KEY && !!process.env.XAI_TEAM_ID,
    gemini: geminiSyncConfigured,
    openrouter: !!process.env.OPENROUTER_MGMT_KEY,
    fal: !!process.env.FAL_API_KEY,
  };

  return (
    <DashboardClient
      data={{
        summary: getPeriodSummary(),
        daily,
        models,
        syncStatuses: getSyncStatuses(),
        providerConfigured,
        plans: getPlanUsage(),
        serverNow,
        today,
      }}
    />
  );
}
