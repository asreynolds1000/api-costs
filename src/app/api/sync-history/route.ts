import { NextResponse } from "next/server";
import { getAllSyncHistory, getProviderFreshness } from "@/lib/db/queries";

export async function GET() {
  const history = getAllSyncHistory(20);
  const freshness = getProviderFreshness();
  const latestActivity: Record<string, string | null> = {};
  for (const f of freshness) {
    latestActivity[f.provider] = f.latestDate;
  }
  return NextResponse.json({ history, latestActivity });
}
