import { syncAll, type SyncResult } from "@/lib/sync";
import { refreshQuotas } from "@/lib/plans/quotas";
import { indexActivity } from "@/lib/activity/indexer";

// One background loop in the pm2 process: sync every configured provider, refresh the
// vendor quotas, then index local Claude Code and Codex logs.
// Started from src/instrumentation.ts. AUTO_SYNC_MINUTES=0 turns it off.

export type SchedulerState = {
  enabled: boolean;
  intervalMs: number;
  running: boolean;
  lastTickAt: string | null;
  lastTickOk: boolean | null;
  nextTickAt: string | null;
};

type Internal = SchedulerState & { started: boolean; timer?: NodeJS.Timeout; current?: Promise<SyncResult[]> };

const BOOT_DELAY_MS = 30_000;

function intervalFromEnv() {
  const raw = process.env.AUTO_SYNC_MINUTES;
  const minutes = raw === undefined || raw === "" ? 30 : Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

// Route handlers and instrumentation load separate module copies, so state lives on globalThis
const g = globalThis as unknown as { __scheduler?: Internal };
function state(): Internal {
  if (!g.__scheduler) {
    const intervalMs = intervalFromEnv();
    g.__scheduler = {
      started: false,
      enabled: intervalMs > 0,
      intervalMs,
      running: false,
      lastTickAt: null,
      lastTickOk: null,
      nextTickAt: null,
    };
  }
  return g.__scheduler;
}

export function getSchedulerState(): SchedulerState {
  const { enabled, intervalMs, running, lastTickAt, lastTickOk, nextTickAt } = state();
  return { enabled, intervalMs, running, lastTickAt, lastTickOk, nextTickAt };
}

function scheduleNext(delayMs: number) {
  const s = state();
  clearTimeout(s.timer);
  s.nextTickAt = new Date(Date.now() + delayMs).toISOString();
  s.timer = setTimeout(() => void runTick(), delayMs);
}

export function startScheduler() {
  const s = state();
  if (s.started || !s.enabled) return;
  s.started = true;
  // Quotas are cheap and the page shows "waiting" until the first reading, so fetch them now
  void refreshQuotas().catch(() => {});
  scheduleNext(BOOT_DELAY_MS);
}

// Runs one full refresh. A caller that arrives mid-tick (Sync now, the timer) gets the
// running tick's result instead of starting a second one. Never throws.
export function runTick(): Promise<SyncResult[]> {
  const s = state();
  if (s.current) return s.current;

  s.running = true;
  s.current = (async () => {
    let ok = true;
    let results: SyncResult[] = [];
    try {
      results = await syncAll();
      ok = results.every((r) => r.ok);
      await refreshQuotas();
      const indexed = await indexActivity();
      if (indexed.errors.length) {
        ok = false;
        console.error(`[scheduler] activity index: ${indexed.errors.length} file errors, first: ${indexed.errors[0]}`);
      }
    } catch (err) {
      ok = false;
      console.error("[scheduler] tick failed:", err);
    } finally {
      s.running = false;
      s.current = undefined;
      s.lastTickAt = new Date().toISOString();
      s.lastTickOk = ok;
      // A manual tick also resets the clock, so the next automatic one is a full interval away
      if (s.started) scheduleNext(s.intervalMs);
    }
    return results;
  })();
  return s.current;
}
