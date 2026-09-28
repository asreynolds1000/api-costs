// Run with: npm test   (node --test, no framework)
// Fixtures are hand-written synthetic lines shaped like real Claude Code / Codex transcript
// lines (verified against real local logs during development), never copied transcript
// content -- this repo is public.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaudeAccumulator } from "../src/lib/activity/claude-parse.ts";
import { createCodexAccumulator } from "../src/lib/activity/codex-parse.ts";
import { estimateCost, normalizeModelId, PRICES } from "../src/lib/activity/pricing.ts";

const toDate = (iso: string) => iso.slice(0, 10); // fixed stand-in for toEasternDate in tests

// --- Claude Code fixtures --------------------------------------------------------------

function assistantLine(opts: {
  ts: string;
  cwd?: string;
  sessionId?: string;
  requestId?: string;
  msgId?: string;
  model?: string;
  content: unknown[];
  usage?: Record<string, unknown>;
}) {
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.ts,
    cwd: opts.cwd,
    sessionId: opts.sessionId ?? "sess-1",
    requestId: opts.requestId ?? "req-1",
    message: {
      id: opts.msgId ?? "msg-1",
      model: opts.model ?? "claude-opus-5-5",
      content: opts.content,
      usage: opts.usage,
    },
  });
}

function toolUse(id: string, name: string, input: Record<string, unknown> = {}) {
  return { type: "tool_use", id, name, input };
}

const usageBlock = (n: number, extra: Record<string, unknown> = {}) => ({
  input_tokens: 2,
  output_tokens: n,
  cache_read_input_tokens: 10,
  cache_creation_input_tokens: 20,
  ...extra,
});

test("claude: usage dedup is LAST-WINS per (message.id, requestId), growing across lines", () => {
  const acc = createClaudeAccumulator({ isSubagent: false });
  // Same key, three lines (one content block each, as real transcripts persist), usage grows.
  acc.line(assistantLine({ ts: "2026-09-01T10:00:00.000Z", cwd: "/home/dev/Code/demo-app", content: [{ type: "thinking", thinking: "" }], usage: usageBlock(100) }));
  acc.line(assistantLine({ ts: "2026-09-01T10:00:01.000Z", cwd: "/home/dev/Code/demo-app", content: [{ type: "text", text: "hi" }], usage: usageBlock(150) }));
  acc.line(assistantLine({ ts: "2026-09-01T10:00:02.000Z", cwd: "/home/dev/Code/demo-app", content: [toolUse("tu-1", "Read", { file_path: "/tmp/x" })], usage: usageBlock(300) }));

  const result = acc.finish(toDate);
  assert.equal(result.usage.length, 1);
  assert.equal(result.usage[0].output, 300, "last line's usage wins, not a sum across lines");
  assert.equal(result.usage[0].messages, 1, "one deduped key = one message, regardless of line count");
  assert.equal(result.usage[0].project, "demo-app");
});

test("claude: tool_use blocks are collected from every line sharing a key, deduped by tool_use.id", () => {
  const acc = createClaudeAccumulator({ isSubagent: false });
  acc.line(assistantLine({ ts: "2026-09-01T10:00:00.000Z", cwd: "/x/proj", content: [toolUse("tu-a", "Bash", { command: "ls" })], usage: usageBlock(10) }));
  acc.line(assistantLine({ ts: "2026-09-01T10:00:01.000Z", cwd: "/x/proj", content: [toolUse("tu-b", "Read", {})], usage: usageBlock(20) }));
  // A duplicate line for the SAME tool_use id (e.g. a resumed/replayed line) must not double count.
  acc.line(assistantLine({ ts: "2026-09-01T10:00:02.000Z", cwd: "/x/proj", content: [toolUse("tu-a", "Bash", { command: "ls" })], usage: usageBlock(30) }));

  const result = acc.finish(toDate);
  const byName = Object.fromEntries(result.tools.map((t) => [t.name, t.count]));
  assert.equal(byName.Bash, 1, "tu-a counted once despite appearing on two lines");
  assert.equal(byName.Read, 1);
});

test("claude: mcp tool classification splits on the delimiter, not on single underscores/hyphens", () => {
  const acc = createClaudeAccumulator({ isSubagent: false });
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:00.000Z",
      cwd: "/x/proj",
      content: [toolUse("tu-1", "mcp__claude_ai_Wispr_Flow__search_meetings", { query: "demo" })],
      usage: usageBlock(5),
    })
  );
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:01.000Z",
      cwd: "/x/proj",
      requestId: "req-2",
      msgId: "msg-2",
      content: [toolUse("tu-2", "mcp__google-workspace__search_gmail_messages", { query: "demo" })],
      usage: usageBlock(5),
    })
  );

  const result = acc.finish(toDate);
  const mcpTools = result.tools.filter((t) => t.kind === "mcp");
  assert.deepEqual(
    mcpTools.map((t) => [t.grp, t.name]).sort(),
    [
      ["claude_ai_Wispr_Flow", "search_meetings"],
      ["google-workspace", "search_gmail_messages"],
    ]
  );
});

test("claude: Skill and Agent classification, including Agent defaults when fields are absent", () => {
  const acc = createClaudeAccumulator({ isSubagent: false });
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:00.000Z",
      cwd: "/x/proj",
      content: [toolUse("tu-1", "Skill", { skill: "session-wrapup" })],
      usage: usageBlock(5),
    })
  );
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:01.000Z",
      cwd: "/x/proj",
      requestId: "req-2",
      msgId: "msg-2",
      content: [toolUse("tu-2", "Agent", { description: "do a thing", subagent_type: "general-purpose", model: "sonnet" })],
      usage: usageBlock(5),
    })
  );
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:02.000Z",
      cwd: "/x/proj",
      requestId: "req-3",
      msgId: "msg-3",
      content: [toolUse("tu-3", "Agent", {})], // no subagent_type / model given
      usage: usageBlock(5),
    })
  );
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:03.000Z",
      cwd: "/x/proj",
      requestId: "req-4",
      msgId: "msg-4",
      content: [toolUse("tu-4", "Read", {})],
      usage: usageBlock(5),
    })
  );

  const result = acc.finish(toDate);
  const byId = Object.fromEntries(result.tools.map((t) => [`${t.kind}:${t.grp}:${t.name}`, t.count]));
  assert.equal(byId["skill:null:session-wrapup"], 1);
  assert.equal(byId["subagent:sonnet:general-purpose"], 1);
  assert.equal(byId["subagent:inherit:general-purpose"], 1, "missing subagent_type/model default to general-purpose/inherit");
  assert.equal(byId["builtin:null:Read"], 1);
});

test("claude: <synthetic> model lines are skipped entirely (no usage, no tools)", () => {
  const acc = createClaudeAccumulator({ isSubagent: false });
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:00.000Z",
      cwd: "/x/proj",
      model: "<synthetic>",
      content: [toolUse("tu-1", "Bash", { command: "ls" })],
      usage: usageBlock(999),
    })
  );
  const result = acc.finish(toDate);
  assert.equal(result.usage.length, 0);
  assert.equal(result.tools.length, 0);
});

test("claude: a malformed JSON line is skipped, not thrown", () => {
  const acc = createClaudeAccumulator({ isSubagent: false });
  assert.doesNotThrow(() => {
    acc.line("{not valid json");
    acc.line("");
    acc.line(assistantLine({ ts: "2026-09-01T10:00:00.000Z", cwd: "/x/proj", content: [], usage: usageBlock(7) }));
  });
  const result = acc.finish(toDate);
  assert.equal(result.usage.length, 1);
  assert.equal(result.usage[0].output, 7);
});

test("claude: cache_creation split is used when present; cache_creation_input_tokens alone is treated as 5m", () => {
  const acc = createClaudeAccumulator({ isSubagent: false });
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:00.000Z",
      cwd: "/x/proj",
      content: [],
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } },
    })
  );
  acc.line(
    assistantLine({
      ts: "2026-09-01T10:00:01.000Z",
      cwd: "/x/proj",
      requestId: "req-2",
      msgId: "msg-2",
      content: [],
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 50 },
    })
  );
  const result = acc.finish(toDate);
  // Both lines group into one row (same date/project/model).
  assert.equal(result.usage.length, 1);
  assert.equal(result.usage[0].cacheWrite5m, 100 + 50);
  assert.equal(result.usage[0].cacheWrite1h, 200);
});

test("claude: cost-state -- the LAST cost-state line wins", () => {
  const acc = createClaudeAccumulator({ isSubagent: false });
  acc.line(JSON.stringify({ type: "cost-state", totalCostUSD: 1.5, modelUsage: { "claude-opus-5-5": { costUSD: 1.5 } } }));
  acc.line(JSON.stringify({ type: "cost-state", totalCostUSD: 3.25, modelUsage: { "claude-opus-5-5": { costUSD: 3.25 } } }));
  const result = acc.finish(toDate);
  assert.equal(result.costState?.totalCostUSD, 3.25);
});

test("claude: session start/end span all timestamps, project is the cwd basename, isSubagent passes through", () => {
  const acc = createClaudeAccumulator({ isSubagent: true, subagentType: "general-purpose" });
  acc.line(assistantLine({ ts: "2026-09-01T10:05:00.000Z", cwd: "/home/dev/Code/demo-app", sessionId: "sess-x", content: [], usage: usageBlock(1) }));
  acc.line(assistantLine({ ts: "2026-09-01T10:00:00.000Z", cwd: "/home/dev/Code/demo-app", sessionId: "sess-x", requestId: "req-2", msgId: "msg-2", content: [], usage: usageBlock(1) }));
  acc.line(assistantLine({ ts: "2026-09-01T10:10:00.000Z", cwd: "/home/dev/Code/demo-app", sessionId: "sess-x", requestId: "req-3", msgId: "msg-3", content: [], usage: usageBlock(1) }));
  const result = acc.finish(toDate);
  assert.equal(result.session.sessionId, "sess-x");
  assert.equal(result.session.project, "demo-app");
  assert.equal(result.session.startedAt, "2026-09-01T10:00:00.000Z");
  assert.equal(result.session.endedAt, "2026-09-01T10:10:00.000Z");
  assert.equal(result.session.isSubagent, true);
});

// --- Codex fixtures ---------------------------------------------------------------------

function sessionMeta(id: string, cwd: string, ts: string) {
  return JSON.stringify({ type: "session_meta", timestamp: ts, payload: { id, cwd, timestamp: ts } });
}
function turnContext(turnId: string, model: string, cwd: string, ts: string) {
  return JSON.stringify({ type: "turn_context", timestamp: ts, payload: { turn_id: turnId, model, cwd } });
}
function tokenUsage(turnId: string, usage: Record<string, unknown>, ts: string) {
  return JSON.stringify({ type: "token_usage_record", timestamp: ts, payload: { turn_id: turnId, response_id: `resp-${turnId}`, usage } });
}
function responseItem(itemType: string, name: string | undefined, ts: string) {
  return JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: itemType, id: `id-${ts}`, name } });
}

test("codex: two turns in one file join usage to the correct model via turn_id", () => {
  const acc = createCodexAccumulator();
  acc.line(sessionMeta("sess-codex-1", "/home/dev/Code/proj-a", "2026-09-01T10:00:00.000Z"));
  acc.line(turnContext("turn-1", "gpt-6-sol", "/home/dev/Code/proj-a", "2026-09-01T10:00:01.000Z"));
  acc.line(tokenUsage("turn-1", { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 50, reasoning_output_tokens: 5 }, "2026-09-01T10:00:02.000Z"));
  acc.line(turnContext("turn-2", "gpt-6-astra", "/home/dev/Code/proj-a", "2026-09-01T10:05:00.000Z"));
  acc.line(tokenUsage("turn-2", { input_tokens: 500, cached_input_tokens: 0, output_tokens: 300 }, "2026-09-01T10:05:01.000Z"));

  const result = acc.finish(toDate);
  const byModel = Object.fromEntries(result.usage.map((u) => [u.model, u]));
  assert.equal(byModel["gpt-6-sol"].output, 50);
  assert.equal(byModel["gpt-6-astra"].output, 300);
  assert.equal(result.session.sessionId, "sess-codex-1");
  assert.equal(result.session.project, "proj-a");
});

test("codex: uncached input = input_tokens - cached_input_tokens", () => {
  const acc = createCodexAccumulator();
  acc.line(sessionMeta("sess-1", "/x/proj", "2026-09-01T10:00:00.000Z"));
  acc.line(turnContext("turn-1", "gpt-6-sol", "/x/proj", "2026-09-01T10:00:01.000Z"));
  acc.line(tokenUsage("turn-1", { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 10 }, "2026-09-01T10:00:02.000Z"));
  const result = acc.finish(toDate);
  assert.equal(result.usage[0].input, 600);
  assert.equal(result.usage[0].cacheRead, 400);
});

test("codex: token_usage_record with no matching turn_context is dropped", () => {
  const acc = createCodexAccumulator();
  acc.line(sessionMeta("sess-1", "/x/proj", "2026-09-01T10:00:00.000Z"));
  acc.line(tokenUsage("unknown-turn", { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10 }, "2026-09-01T10:00:02.000Z"));
  const result = acc.finish(toDate);
  assert.equal(result.usage.length, 0);
});

test("codex: tool classification covers function_call, custom_tool_call and web_search_call", () => {
  const acc = createCodexAccumulator();
  acc.line(sessionMeta("sess-1", "/x/proj", "2026-09-01T10:00:00.000Z"));
  acc.line(responseItem("function_call", "spawn_agent", "2026-09-01T10:00:01.000Z"));
  acc.line(responseItem("custom_tool_call", "exec", "2026-09-01T10:00:02.000Z"));
  acc.line(responseItem("web_search_call", undefined, "2026-09-01T10:00:03.000Z"));
  const result = acc.finish(toDate);
  const names = result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["exec", "spawn_agent", "web_search"]);
  for (const t of result.tools) {
    assert.equal(t.kind, "codex");
    assert.equal(t.grp, "codex");
  }
});

test("codex: a malformed line and a line with no payload are skipped, not thrown", () => {
  const acc = createCodexAccumulator();
  assert.doesNotThrow(() => {
    acc.line("{not valid json");
    acc.line(JSON.stringify({ type: "turn_context" })); // no payload
    acc.line(sessionMeta("sess-1", "/x/proj", "2026-09-01T10:00:00.000Z"));
  });
});

// --- pricing.ts --------------------------------------------------------------------------

test("pricing: normalizeModelId strips a date suffix and a trailing [1m] tag", () => {
  assert.equal(normalizeModelId("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
  assert.equal(normalizeModelId("claude-opus-5-5[1m]"), "claude-opus-5-5");
  assert.equal(normalizeModelId("claude-opus-5[1m]"), "claude-opus-5");
  assert.equal(normalizeModelId("claude-sonnet-5"), "claude-sonnet-5", "no suffix to strip");
});

test("pricing: estimateCost applies the default cache rules (5m = 1.25x, 1h = 2x input) when a model has no override", () => {
  // claude-sonnet-5 has no explicit cache overrides in PRICES -- this guards the default path.
  const price = PRICES["claude-sonnet-5"];
  assert.equal(price.input, 2);
  assert.equal(price.cacheWrite5m, 2 * 1.25);
  assert.equal(price.cacheWrite1h, 2 * 2, "1h default must be 2x input, not equal to the 5m rate");

  const cost = estimateCost("claude-sonnet-5", { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 1_000_000 });
  assert.equal(cost, 4, "1,000,000 cacheWrite1h tokens at $4/MTok (2x $2 input) = $4");
});

test("pricing: estimateCost with an explicit override (5m and 1h both set) matches the documented rate", () => {
  // claude-opus-5-5: $4/$20, cache read $0.20, cache write 5m $5, cache write 1h $8.
  const usage = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000 };
  const cost = estimateCost("claude-opus-5-5[1m]", usage); // exercise normalization too
  assert.equal(cost, 4 + 20 + 0.2 + 5 + 8);
});

test("pricing: an unpriced model returns null", () => {
  assert.equal(estimateCost("gpt-5.2-codex", { input: 100, output: 100, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }), null);
  assert.equal(estimateCost("some-made-up-model-id", { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }), null);
});

test("pricing: <synthetic> is never priced", () => {
  assert.equal(estimateCost("<synthetic>", { input: 1000, output: 1000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }), null);
});
