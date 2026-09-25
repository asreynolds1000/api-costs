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
};

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
