import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeWindows, newestUpdate, type ClaudeState, type PlanUsage } from "./parse";

// Written by scripts/claude-statusline.sh on each Claude Code status line refresh.
const STATE_PATH =
  process.env.CLAUDE_USAGE_STATE ??
  join(homedir(), ".local", "state", "ai-usage", "claude-rate-limits.json");

export function getClaudeUsage(nowSec = Date.now() / 1000): PlanUsage {
  const base = {
    id: "claude" as const,
    name: "Claude Max",
    windows: [],
    updatedAt: null,
    note: "The Fable weekly limit and credit balances aren't available on this Mac.",
  };

  let state: ClaudeState;
  try {
    state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    return {
      ...base,
      status: missing ? "missing" : "error",
      message: missing
        ? "No Claude usage recorded yet. It shows up after your next Claude Code reply on this Mac."
        : `Couldn't read ${STATE_PATH}.`,
    };
  }

  const windows = claudeWindows(state, nowSec);
  if (windows.length === 0) {
    return { ...base, status: "missing", message: "No Claude usage recorded yet." };
  }
  return { ...base, status: "ok", windows, updatedAt: newestUpdate(windows) };
}
