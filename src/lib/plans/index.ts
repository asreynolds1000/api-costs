import { getClaudeUsage } from "./claude";
import { getCodexUsage } from "./codex";
import type { PlanUsage } from "./parse";

export type { PlanUsage, QuotaWindow } from "./parse";

function safely(id: PlanUsage["id"], name: string, read: () => PlanUsage): PlanUsage {
  try {
    return read();
  } catch (err) {
    return {
      id,
      name,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      windows: [],
      updatedAt: null,
    };
  }
}

export function getPlanUsage(): PlanUsage[] {
  return [
    safely("claude", "Claude Max", getClaudeUsage),
    safely("codex", "ChatGPT Codex", getCodexUsage),
  ];
}
