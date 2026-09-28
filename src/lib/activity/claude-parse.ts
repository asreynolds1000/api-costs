// Pure parsing for Claude Code transcript lines (~/.claude/projects, ~/.claude-ss/projects).
// No fs or path-alias imports, so tests/activity.test.ts can load it with plain `node --test`,
// same convention as src/lib/plans/parse.ts. Date conversion is injected via `.finish(toDate)`
// so this module never needs to know about timezones.

export type ClaudeUsageRow = {
  date: string;
  project: string;
  model: string;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

export type ClaudeToolRow = {
  date: string;
  kind: "builtin" | "mcp" | "skill" | "subagent";
  grp: string | null;
  name: string;
  count: number;
};

export type ClaudeSession = {
  sessionId: string;
  project: string;
  startedAt: string | null;
  endedAt: string | null;
  isSubagent: boolean;
};

export type ClaudeCostState = {
  totalCostUSD: number;
  modelUsage: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      costUSD?: number;
      [key: string]: unknown;
    }
  >;
};

export type ClaudeFinishResult = {
  session: ClaudeSession;
  usage: ClaudeUsageRow[];
  tools: ClaudeToolRow[];
  costState: ClaudeCostState | null;
};

export type ClaudeAccumulatorOpts = {
  isSubagent: boolean;
  subagentType?: string;
};

type ToolClass = { kind: ClaudeToolRow["kind"]; grp: string | null; name: string };

function numOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Basename without a path import: last "/"-separated segment, ignoring a trailing slash.
function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  if (trimmed === "") return "unknown";
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || "unknown";
}

// mcp__<server>__<tool>: split on the FIRST "__" after "mcp" and the NEXT "__" after that.
// Server/tool names may themselves contain single underscores or hyphens (e.g.
// "google-workspace", "claude_ai_Wispr_Flow"), so a naive global split on "_" would break
// them apart; splitting on the literal two-char delimiter "__" does not.
function classifyMcp(name: string): ToolClass {
  const rest = name.slice(5); // strip "mcp__"
  const idx = rest.indexOf("__");
  if (idx === -1) return { kind: "mcp", grp: rest || "unknown", name: "" };
  return { kind: "mcp", grp: rest.slice(0, idx), name: rest.slice(idx + 2) };
}

function classifyTool(name: unknown, input: unknown): ToolClass | null {
  if (typeof name !== "string" || name.length === 0) return null;
  if (name.startsWith("mcp__")) return classifyMcp(name);
  const inputObj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (name === "Skill") {
    const skill = inputObj.skill;
    return { kind: "skill", grp: null, name: typeof skill === "string" ? skill : "unknown" };
  }
  if (name === "Agent" || name === "Task") {
    const subagentType = inputObj.subagent_type;
    const model = inputObj.model;
    return {
      kind: "subagent",
      grp: typeof model === "string" ? model : "inherit",
      name: typeof subagentType === "string" ? subagentType : "general-purpose",
    };
  }
  return { kind: "builtin", grp: null, name };
}

type PendingUsage = {
  timestamp: string;
  cwd: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite5m: number;
    cacheWrite1h: number;
  };
};

type PendingTool = {
  timestamp: string;
  kind: ClaudeToolRow["kind"];
  grp: string | null;
  name: string;
};

export function createClaudeAccumulator(opts: ClaudeAccumulatorOpts) {
  let sessionId: string | null = null;
  let sessionCwd: string | null = null;
  let minTs: string | null = null;
  let maxTs: string | null = null;
  let costState: ClaudeCostState | null = null;

  const usageByKey = new Map<string, PendingUsage>();
  const toolsSeenIds = new Set<string>();
  const toolEvents: PendingTool[] = [];

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
    if (sessionId === null && typeof o.sessionId === "string") sessionId = o.sessionId;
    if (sessionCwd === null && typeof o.cwd === "string") sessionCwd = o.cwd;

    if (o.type === "cost-state") {
      const totalCostUSD = o.totalCostUSD;
      const modelUsage = o.modelUsage;
      if (typeof totalCostUSD === "number" && modelUsage && typeof modelUsage === "object") {
        costState = {
          totalCostUSD,
          modelUsage: modelUsage as ClaudeCostState["modelUsage"],
        };
      }
      return;
    }

    if (o.type !== "assistant") return;
    const message = o.message;
    if (!message || typeof message !== "object") return;
    const msg = message as Record<string, unknown>;
    const model = msg.model;
    if (typeof model !== "string" || model === "<synthetic>") return;
    if (typeof ts !== "string") return; // can't date-bucket usage/tools without a timestamp

    const lineCwd = typeof o.cwd === "string" ? o.cwd : (sessionCwd ?? "");

    // Tools: every content block on this line is independent (Claude Code persists one
    // finalized content block per JSONL line, not the growing message), so tool_use blocks
    // must be collected from every line, deduped globally by tool_use.id.
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type !== "tool_use") continue;
        const toolId = b.id;
        if (typeof toolId !== "string" || toolsSeenIds.has(toolId)) continue;
        toolsSeenIds.add(toolId);
        const cls = classifyTool(b.name, b.input);
        if (cls) toolEvents.push({ timestamp: ts, kind: cls.kind, grp: cls.grp, name: cls.name });
      }
    }

    // Usage: dedup by (message.id, requestId), LAST-WINS (overwrite every time this line's
    // key is seen again; the last line for a key carries the final/maximum usage).
    const mid = msg.id;
    const rid = o.requestId;
    const usage = msg.usage;
    if (typeof mid === "string" && typeof rid === "string" && usage && typeof usage === "object") {
      const u = usage as Record<string, unknown>;
      const cc = u.cache_creation;
      let cacheWrite5m = 0;
      let cacheWrite1h = 0;
      if (cc && typeof cc === "object") {
        const ccObj = cc as Record<string, unknown>;
        cacheWrite5m = numOr0(ccObj.ephemeral_5m_input_tokens);
        cacheWrite1h = numOr0(ccObj.ephemeral_1h_input_tokens);
      } else {
        cacheWrite5m = numOr0(u.cache_creation_input_tokens);
      }
      usageByKey.set(`${mid}::${rid}`, {
        timestamp: ts,
        cwd: lineCwd,
        model,
        usage: {
          input: numOr0(u.input_tokens),
          output: numOr0(u.output_tokens),
          cacheRead: numOr0(u.cache_read_input_tokens),
          cacheWrite5m,
          cacheWrite1h,
        },
      });
    }
  }

  function finish(toDate: (iso: string) => string): ClaudeFinishResult {
    const usageGroups = new Map<string, ClaudeUsageRow>();
    for (const v of usageByKey.values()) {
      const date = toDate(v.timestamp);
      const project = basename(v.cwd);
      const key = `${date}|${project}|${v.model}`;
      let g = usageGroups.get(key);
      if (!g) {
        g = {
          date,
          project,
          model: v.model,
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
      g.input += v.usage.input;
      g.output += v.usage.output;
      g.cacheRead += v.usage.cacheRead;
      g.cacheWrite5m += v.usage.cacheWrite5m;
      g.cacheWrite1h += v.usage.cacheWrite1h;
    }

    const toolGroups = new Map<string, ClaudeToolRow>();
    for (const ev of toolEvents) {
      const date = toDate(ev.timestamp);
      const key = `${date}|${ev.kind}|${ev.grp ?? ""}|${ev.name}`;
      let g = toolGroups.get(key);
      if (!g) {
        g = { date, kind: ev.kind, grp: ev.grp, name: ev.name, count: 0 };
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
        isSubagent: !!opts.isSubagent,
      },
      usage: [...usageGroups.values()],
      tools: [...toolGroups.values()],
      costState,
    };
  }

  return { line, finish };
}
