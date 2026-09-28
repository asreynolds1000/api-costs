// Pure parsing for Codex rollout transcript lines (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl).
// No fs or path-alias imports, same convention as claude-parse.ts / plans/parse.ts, so
// tests/activity.test.ts can load it directly with `node --test`.

export type CodexUsageRow = {
  date: string;
  project: string;
  model: string;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  // Codex has no 5-minute/1-hour cache-TTL distinction (that's an Anthropic concept). This
  // is always 0; it exists so a CodexUsageRow has the same shape as a ClaudeUsageRow and both
  // can be written into the same activity_usage columns / passed to estimateCost uniformly.
  cacheWrite1h: number;
};

export type CodexToolRow = {
  date: string;
  kind: "codex";
  grp: "codex";
  name: string;
  count: number;
};

export type CodexSession = {
  sessionId: string;
  project: string;
  startedAt: string | null;
  endedAt: string | null;
  isSubagent: boolean;
};

export type CodexFinishResult = {
  session: CodexSession;
  usage: CodexUsageRow[];
  tools: CodexToolRow[];
  costState: null; // Codex rollouts carry no equivalent of Claude Code's cost-state line
};

function numOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  if (trimmed === "") return "unknown";
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || "unknown";
}

type TurnContext = { model: string; cwd: string | null };

type PendingUsage = {
  timestamp: string;
  turnId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
};

type PendingTool = { timestamp: string; name: string };

const TOOL_RESPONSE_TYPES = new Set(["function_call", "custom_tool_call", "web_search_call"]);

export function createCodexAccumulator() {
  let sessionId: string | null = null;
  let sessionCwd: string | null = null;
  let isSubagent = false;
  let minTs: string | null = null;
  let maxTs: string | null = null;

  // turn_id -> {model, cwd}. Codex rollouts are append-only and a turn_context line always
  // precedes the token_usage_record / response_item lines for that turn, so a plain map
  // built up in line-order is sufficient (no need to resolve out of order).
  const turnContexts = new Map<string, TurnContext>();
  const pendingUsage: PendingUsage[] = [];
  const pendingTools: PendingTool[] = [];

  function line(raw: string): void {
    if (typeof raw !== "string" || raw.trim() === "") return;
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      return;
    }
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;

    const ts = o.timestamp;
    if (typeof ts === "string") {
      if (minTs === null || ts < minTs) minTs = ts;
      if (maxTs === null || ts > maxTs) maxTs = ts;
    }

    const type = o.type;
    const payload = o.payload;
    if (!payload || typeof payload !== "object") return;
    const p = payload as Record<string, unknown>;

    if (type === "session_meta") {
      if (typeof p.id === "string") sessionId = p.id;
      if (typeof p.cwd === "string") sessionCwd = p.cwd;
      const source = p.source;
      if (source && typeof source === "object" && "subagent" in (source as Record<string, unknown>)) {
        isSubagent = true;
      }
      if (p.thread_source === "subagent") isSubagent = true;
      return;
    }

    if (type === "turn_context") {
      const turnId = p.turn_id;
      const model = p.model;
      if (typeof turnId === "string" && typeof model === "string") {
        turnContexts.set(turnId, { model, cwd: typeof p.cwd === "string" ? p.cwd : null });
      }
      return;
    }

    if (type === "token_usage_record") {
      const turnId = p.turn_id;
      const usage = p.usage;
      if (typeof turnId === "string" && usage && typeof usage === "object" && typeof ts === "string") {
        const u = usage as Record<string, unknown>;
        const input = numOr0(u.input_tokens);
        const cached = numOr0(u.cached_input_tokens);
        pendingUsage.push({
          timestamp: ts,
          turnId,
          // input_tokens INCLUDES cached_input_tokens; uncached = input - cached.
          input: Math.max(0, input - cached),
          output: numOr0(u.output_tokens),
          cacheRead: cached,
          cacheWrite5m: numOr0(u.cache_write_input_tokens),
        });
      }
      return;
    }

    if (type === "response_item") {
      const itemType = p.type;
      if (typeof itemType === "string" && TOOL_RESPONSE_TYPES.has(itemType) && typeof ts === "string") {
        const name = typeof p.name === "string" ? p.name : "web_search";
        pendingTools.push({ timestamp: ts, name });
      }
    }
  }

  function finish(toDate: (iso: string) => string): CodexFinishResult {
    const usageGroups = new Map<string, CodexUsageRow>();
    for (const v of pendingUsage) {
      const ctx = turnContexts.get(v.turnId);
      if (!ctx) continue; // no model to attribute this usage to: drop it
      const date = toDate(v.timestamp);
      const project = basename(ctx.cwd ?? sessionCwd ?? "");
      const key = `${date}|${project}|${ctx.model}`;
      let g = usageGroups.get(key);
      if (!g) {
        g = {
          date,
          project,
          model: ctx.model,
          messages: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        };
        usageGroups.set(key, g);
      }
      g.messages += 1;
      g.input += v.input;
      g.output += v.output;
      g.cacheRead += v.cacheRead;
      g.cacheWrite5m += v.cacheWrite5m;
    }

    const toolGroups = new Map<string, CodexToolRow>();
    for (const ev of pendingTools) {
      const date = toDate(ev.timestamp);
      const key = `${date}|${ev.name}`;
      let g = toolGroups.get(key);
      if (!g) {
        g = { date, kind: "codex", grp: "codex", name: ev.name, count: 0 };
        toolGroups.set(key, g);
      }
      g.count += 1;
    }

    return {
      session: {
        sessionId: sessionId ?? "",
        project: basename(sessionCwd ?? ""),
        startedAt: minTs,
        endedAt: maxTs,
        isSubagent,
      },
      usage: [...usageGroups.values()],
      tools: [...toolGroups.values()],
      costState: null,
    };
  }

  return { line, finish };
}
