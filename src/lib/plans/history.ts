import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { windowTrend, type PlanUsage } from "./parse";

// Written by ai-quota, one line per observation. Optional: without it the chart has no history
// and draws only the current reading.
const HISTORY_PATH = join(homedir(), ".local", "state", "ai-usage", "history.jsonl");
const WEEK = 10080;

export function withWeeklyTrends(plans: PlanUsage[]): PlanUsage[] {
  let text = "";
  try {
    text = readFileSync(HISTORY_PATH, "utf8");
  } catch {
    // not installed
  }
  return plans.map((plan) => ({
    ...plan,
    windows: plan.windows.map((w) =>
      w.windowMinutes === WEEK ? { ...w, trend: windowTrend(text, plan.id, w) } : w
    ),
  }));
}
