import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  aiQuotaClaudeWindows,
  claudeWindows,
  mergeClaudeWindows,
  newestUpdate,
  type AiQuotaCodexState,
  type ClaudeState,
  type PlanUsage,
  type QuotaWindow,
} from "./parse";

// Written by scripts/claude-statusline.sh on each Claude Code status line refresh.
const STATE_PATH =
  process.env.CLAUDE_USAGE_STATE ??
  join(homedir(), ".local", "state", "ai-usage", "claude-rate-limits.json");

// Written by ai-quota's direct probe, on its own schedule. It stays current when the status line
// doesn't refresh (on 2026-11-25 the status line reading was 17 hours old while Claude Code was in use).
const PROBE_PATH = join(homedir(), ".local", "state", "ai-usage", "claude-probe.json");

// Max 20x was renamed Ultra on 2026-10-30 (Max 5x is now Max).
export const CLAUDE_PLAN = "Claude Ultra";

function probeWindows(nowSec: number): QuotaWindow[] {
  try {
    return aiQuotaClaudeWindows(JSON.parse(readFileSync(PROBE_PATH, "utf8")) as AiQuotaCodexState, nowSec);
  } catch {
    return []; // not installed, or mid-write: the status line alone
  }
}

export function getClaudeUsage(nowSec = Date.now() / 1000): PlanUsage {
  const base = {
    id: "claude" as const,
    name: CLAUDE_PLAN,
    windows: [],
    updatedAt: null,
    note: "The Fable weekly limit and credit balances aren't available on this Mac.",
  };

  const probe = probeWindows(nowSec);
  let state: ClaudeState = {};
  try {
    state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch (err) {
    if (probe.length === 0) {
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      return {
        ...base,
        status: missing ? "missing" : "error",
        message: missing
          ? "No Claude usage recorded yet. It shows up after your next Claude Code reply on this Mac."
          : `Couldn't read ${STATE_PATH}.`,
      };
    }
  }

  const windows = mergeClaudeWindows(claudeWindows(state, nowSec), probe);
  if (windows.length === 0) {
    return { ...base, status: "missing", message: "No Claude usage recorded yet." };
  }
  return { ...base, status: "ok", windows, updatedAt: newestUpdate(windows) };
}
