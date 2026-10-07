// Pure parsing for subscription plan usage (Claude Max, ChatGPT Codex).
// No fs or path-alias imports, so tests/plans.test.ts can load it with plain `node --test`.

export type QuotaWindow = {
  key: string;
  label: string;
  windowMinutes: number;
  // null once the window has reset since the reading: usage since then is unknown, not zero
  usedPercent: number | null;
  resetsAt: number | null; // epoch seconds
  updatedAt: string | null; // ISO time the reading was taken (Codex) or last changed (Claude)
  reset: boolean;
  trend?: TrendPoint[]; // readings since the window started, oldest first (weekly windows only)
};

export type TrendPoint = { at: number; used: number }; // epoch seconds, percent used

export type PlanUsage = {
  id: "claude" | "codex";
  name: string;
  status: "ok" | "missing" | "error";
  message?: string;
  note?: string;
  windows: QuotaWindow[];
  updatedAt: string | null; // newest reading across windows
};

export function windowLabel(minutes: number): string {
  if (minutes === 300) return "5-hour";
  if (minutes === 10080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}

export function applyReset(w: QuotaWindow, nowSec: number): QuotaWindow {
  if (w.resetsAt !== null && w.resetsAt <= nowSec) {
    return { ...w, usedPercent: null, reset: true };
  }
  return w;
}

// Fraction of the window already elapsed (0..1), for the pace marker. null when unknown.
export function windowElapsed(w: QuotaWindow, nowSec: number): number | null {
  if (w.resetsAt === null || w.reset) return null;
  const remaining = w.resetsAt - nowSec;
  return Math.min(1, Math.max(0, 1 - remaining / (w.windowMinutes * 60)));
}

export function newestUpdate(windows: QuotaWindow[]): string | null {
  const times = windows.map((w) => w.updatedAt).filter((t): t is string => !!t);
  return times.length ? times.sort().at(-1)! : null;
}

// --- Codex ---------------------------------------------------------------
// Codex session logs carry `event_msg` lines whose payload is
// {type: "token_count", rate_limits: {limit_id, primary, secondary, ...}}.
// Only limit_id "codex" is the plan quota; "codex_bengalfox" (Spark) and
// "premium" (primary null) also appear and must not win.

type CodexWindowRaw = {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
} | null;

export type CodexSnapshot = {
  timestamp: string;
  primary: CodexWindowRaw;
  secondary: CodexWindowRaw;
};

const CODEX_MARKER = '"limit_id":"codex"';

// Newest plan-quota snapshot in a block of complete JSONL lines, scanning from the end.
export function findLatestCodexSnapshot(text: string): CodexSnapshot | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes(CODEX_MARKER)) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = obj?.payload;
    if (payload?.type !== "token_count") continue;
    const rl = payload.rate_limits;
    if (!rl || rl.limit_id !== "codex" || !rl.primary) continue;
    if (typeof obj.timestamp !== "string") continue;
    return { timestamp: obj.timestamp, primary: rl.primary, secondary: rl.secondary ?? null };
  }
  return null;
}

export function codexWindows(s: CodexSnapshot, nowSec: number): QuotaWindow[] {
  const raw = [s.primary, s.secondary].filter(
    (w): w is NonNullable<CodexWindowRaw> => !!w && typeof w.window_minutes === "number"
  );
  return raw
    .map((w) =>
      applyReset(
        {
          key: `codex:${w.window_minutes}`,
          label: windowLabel(w.window_minutes!),
          windowMinutes: w.window_minutes!,
          usedPercent: typeof w.used_percent === "number" ? w.used_percent : null,
          resetsAt: typeof w.resets_at === "number" ? w.resets_at : null,
          updatedAt: s.timestamp,
          reset: false,
        },
        nowSec
      )
    )
    .sort((a, b) => a.windowMinutes - b.windowMinutes);
}

// A separate quota probe (ai-quota) calls `codex app-server` directly and records the plan windows
// to codex-rate-limits.json, keyed by window length in minutes. Unlike the session logs, it
// stays current when Codex runs elsewhere on the same account. Times are epoch seconds.

type AiQuotaWindowRaw = {
  used_percentage?: number;
  resets_at?: number;
  observed_at?: number;
  rejected?: boolean;
};

export type AiQuotaCodexState = {
  windows?: Record<string, AiQuotaWindowRaw | undefined>;
};

export function aiQuotaCodexWindows(state: AiQuotaCodexState, nowSec: number): QuotaWindow[] {
  return Object.entries(state.windows ?? {})
    .flatMap(([key, w]) => {
      const minutes = Number(key);
      if (!w || !Number.isInteger(minutes) || minutes <= 0) return [];
      // ai-quota counts a rejected probe as the limit being hit
      const used = w.rejected ? 100 : typeof w.used_percentage === "number" ? w.used_percentage : null;
      return [
        applyReset(
          {
            key: `codex:${minutes}`,
            label: windowLabel(minutes),
            windowMinutes: minutes,
            usedPercent: used,
            resetsAt: typeof w.resets_at === "number" ? w.resets_at : null,
            updatedAt:
              typeof w.observed_at === "number" ? new Date(w.observed_at * 1000).toISOString() : null,
            reset: false,
          },
          nowSec
        ),
      ];
    })
    .sort((a, b) => a.windowMinutes - b.windowMinutes);
}

// --- Trend -------------------------------------------------------------
// ai-quota appends one line per observation to history.jsonl:
// {at, provider: "claude" | "codex", minutes, resets_at, used}. Times are epoch seconds.

type HistoryRow = { at?: unknown; provider?: unknown; minutes?: unknown; resets_at?: unknown; used?: unknown };

// The readings that belong to window `w`: same provider and length, taken inside the window,
// reporting (within an hour) the same reset. Starts at 0% when the window opened and ends at
// the window's own current reading. Usage only rises inside a window, so a lower reading
// after a higher one is a stale re-send and is dropped.
export function windowTrend(jsonl: string, provider: string, w: QuotaWindow): TrendPoint[] {
  if (w.resetsAt === null || w.reset) return [];
  const start = w.resetsAt - w.windowMinutes * 60;
  const points: TrendPoint[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.includes(provider)) continue;
    let r: HistoryRow;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.provider !== provider || r.minutes !== w.windowMinutes) continue;
    if (typeof r.at !== "number" || typeof r.used !== "number" || typeof r.resets_at !== "number") continue;
    if (r.at < start || r.at > w.resetsAt || Math.abs(r.resets_at - w.resetsAt) > 3600) continue;
    points.push({ at: r.at, used: r.used });
  }
  const current = w.updatedAt ? Date.parse(w.updatedAt) / 1000 : null;
  if (current !== null && w.usedPercent !== null && current >= start) points.push({ at: current, used: w.usedPercent });
  points.sort((a, b) => a.at - b.at);

  const trend: TrendPoint[] = [{ at: start, used: 0 }];
  for (const p of points) {
    const last = trend.at(-1)!;
    if (p.at === last.at || p.used < last.used) continue;
    trend.push(p);
  }
  return trend;
}

// --- Claude --------------------------------------------------------------
// State file written by scripts/claude-statusline.sh from the status line's
// `rate_limits` field. Times are epoch seconds.

type ClaudeWindowRaw = {
  used_percentage?: number;
  resets_at?: number;
  updated_at?: number;
};

export type ClaudeState = {
  windows?: Record<string, ClaudeWindowRaw | undefined>;
  written_at?: number;
};

const CLAUDE_WINDOWS = [
  { key: "five_hour", minutes: 300 },
  { key: "seven_day", minutes: 10080 },
];

export function claudeWindows(state: ClaudeState, nowSec: number): QuotaWindow[] {
  return CLAUDE_WINDOWS.flatMap(({ key, minutes }) => {
    const w = state.windows?.[key];
    if (!w) return [];
    return [
      applyReset(
        {
          key,
          label: windowLabel(minutes),
          windowMinutes: minutes,
          usedPercent: typeof w.used_percentage === "number" ? w.used_percentage : null,
          resetsAt: typeof w.resets_at === "number" ? w.resets_at : null,
          updatedAt:
            typeof w.updated_at === "number" ? new Date(w.updated_at * 1000).toISOString() : null,
          reset: false,
        },
        nowSec
      ),
    ];
  });
}
