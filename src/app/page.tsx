import {
  getPeriodSummary,
  getDailySpend,
  getModelSpend,
  getSyncStatuses,
} from "@/lib/db/queries";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { getPlanUsage } from "@/lib/plans";
import { shiftDate, toEasternDate } from "@/lib/timezone";
import { ACTIVITY_DEFAULT_DAYS, DEFAULT_RANGE_DAYS } from "@/lib/format";
import { getAllAdapters } from "@/lib/providers/registry";
import { getSchedulerState } from "@/lib/scheduler";
import { getActivity } from "@/lib/activity/queries";

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

  const activityYear = getActivity(shiftDate(today, -364), queryEnd);
  const activity = getActivity(shiftDate(today, -(ACTIVITY_DEFAULT_DAYS - 1)), queryEnd);

  const providerConfigured = Object.fromEntries(
    getAllAdapters().map((a) => [a.provider, a.isConfigured()])
  );

  return (
    <DashboardClient
      data={{
        summary: getPeriodSummary(),
        daily,
        models,
        syncStatuses: getSyncStatuses(),
        providerConfigured,
        plans: getPlanUsage(),
        scheduler: getSchedulerState(),
        activityYear,
        activity,
        serverNow,
        today,
      }}
    />
  );
}
