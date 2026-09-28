import { NextResponse } from "next/server";
import { runTick } from "@/lib/scheduler";

// Sync now: one full refresh (all configured providers, quotas, local activity). If the
// scheduler is mid-tick, this waits for that tick instead of starting another.
export async function POST() {
  const results = await runTick();
  return NextResponse.json({
    results: results.map((r) => ({ provider: r.provider, ok: r.ok, records: r.records })),
  });
}
