// Run with: npm test   (node --test, no framework)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findLatestCodexSnapshot,
  codexWindows,
  claudeWindows,
  windowElapsed,
  windowLabel,
} from "../src/lib/plans/parse.ts";

// Shapes seen in real ~/.codex/sessions logs (2026-09), trimmed to the fields that matter.
const tokenCount = (ts: string, rateLimits: unknown) =>
  JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: rateLimits } });

const codexWeekly = tokenCount("2026-09-25T15:19:11.818Z", {
  limit_id: "codex", limit_name: null,
  primary: { used_percent: 13.0, window_minutes: 10080, resets_at: 1790880759 },
  secondary: null,
  credits: { has_credits: false, unlimited: false, balance: null },
  plan_type: "self_serve_business_prolite",
});
const codexFiveHourAndWeekly = tokenCount("2026-09-15T12:00:00.000Z", {
  limit_id: "codex",
  primary: { used_percent: 41.0, window_minutes: 300, resets_at: 1789500000 },
  secondary: { used_percent: 22.0, window_minutes: 10080, resets_at: 1790000000 },
  credits: { has_credits: true, unlimited: false, balance: "0" },
});
const spark = tokenCount("2026-09-25T15:20:00.000Z", {
  limit_id: "codex_bengalfox", limit_name: "GPT-5.3-Codex-Spark",
  primary: { used_percent: 0.0, window_minutes: 10080, resets_at: 1790880759 },
  secondary: null,
});
const premium = tokenCount("2026-09-25T15:21:00.000Z", { limit_id: "premium", primary: null, secondary: null });
const nullSnapshot = tokenCount("2026-09-25T15:22:00.000Z", null);

test("codex: plan snapshot wins over later Spark, premium and null snapshots", () => {
  const text = [codexFiveHourAndWeekly, codexWeekly, spark, premium, nullSnapshot, "{not json"].join("\n");
  const snap = findLatestCodexSnapshot(text);
  assert.equal(snap?.timestamp, "2026-09-25T15:19:11.818Z");
  const [w] = codexWindows(snap!, 1790800000);
  assert.equal(w.label, "Weekly");
  assert.equal(w.usedPercent, 13);
  assert.equal(w.resetsAt, 1790880759);
});

test("codex: windows are labelled by length, not position", () => {
  const snap = findLatestCodexSnapshot(codexFiveHourAndWeekly)!;
  const ws = codexWindows(snap, 1789400000);
  assert.deepEqual(ws.map((w) => [w.label, w.usedPercent]), [["5-hour", 41], ["Weekly", 22]]);
});

test("codex: a window whose reset has passed reports unknown usage, not the stale percent", () => {
  const snap = findLatestCodexSnapshot(codexWeekly)!;
  const [w] = codexWindows(snap, 1790880760);
  assert.equal(w.reset, true);
  assert.equal(w.usedPercent, null);
});

test("codex: no plan snapshot returns null", () => {
  assert.equal(findLatestCodexSnapshot([spark, premium, nullSnapshot].join("\n")), null);
});

test("pace: elapsed fraction of the window", () => {
  const w = { key: "k", label: "Weekly", windowMinutes: 10080, usedPercent: 10, resetsAt: 1000 + 10080 * 30, updatedAt: null, reset: false };
  assert.equal(windowElapsed(w, 1000), 0.5);
  assert.equal(windowLabel(1440), "1-day");
});

test("claude: state file windows, with reset handling", () => {
  const state = {
    windows: {
      five_hour: { used_percentage: 30, resets_at: 2000, updated_at: 1500 },
      seven_day: { used_percentage: 6, resets_at: 9000, updated_at: 1500 },
    },
  };
  const ws = claudeWindows(state, 2500);
  assert.equal(ws[0].reset, true);
  assert.equal(ws[1].usedPercent, 6);
  assert.equal(ws[1].updatedAt, new Date(1500 * 1000).toISOString());
});

// --- status line script ---------------------------------------------------

const SCRIPT = join(import.meta.dirname, "..", "scripts", "claude-statusline.sh");

function runStatusline(input: object, stateDir: string) {
  const r = spawnSync("bash", [SCRIPT], {
    input: JSON.stringify(input),
    env: { ...process.env, AI_USAGE_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  return { out: r.stdout.trim(), err: r.stderr, code: r.status };
}

const session = (rateLimits?: object) => ({
  model: { display_name: "Opus 5.5" },
  context_window: { used_percentage: 34.4 },
  ...(rateLimits ? { rate_limits: rateLimits } : {}),
});

test("statusline: prints a status and records usage", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusline-"));
  const r = runStatusline(session({
    five_hour: { used_percentage: 30.2, resets_at: 1790900000 },
    seven_day: { used_percentage: 6, resets_at: 1791000000 },
  }), dir);
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.equal(r.out, "Opus 5.5  ctx 34%  5h 30%  week 6%");
  const state = JSON.parse(readFileSync(join(dir, "claude-rate-limits.json"), "utf8"));
  assert.equal(state.windows.five_hour.used_percentage, 30.2);
  assert.equal(typeof state.windows.seven_day.updated_at, "number");
});

test("statusline: without rate_limits it prints and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusline-"));
  const r = runStatusline(session(), dir);
  assert.equal(r.out, "Opus 5.5  ctx 34%");
  assert.equal(existsSync(join(dir, "claude-rate-limits.json")), false);
});

test("statusline: an idle session's stale numbers do not overwrite fresher ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusline-"));
  const file = join(dir, "claude-rate-limits.json");
  writeFileSync(file, JSON.stringify({
    windows: {
      five_hour: { used_percentage: 45, resets_at: 1790900000, updated_at: 111 },
      seven_day: { used_percentage: 9, resets_at: 1791000000, updated_at: 111 },
    },
  }));
  runStatusline(session({
    five_hour: { used_percentage: 30, resets_at: 1790900000 }, // same window, lower: stale
    seven_day: { used_percentage: 9, resets_at: 1791000000 }, // unchanged
  }), dir);
  let state = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(state.windows.five_hour.used_percentage, 45);
  assert.equal(state.windows.five_hour.updated_at, 111);
  assert.equal(state.windows.seven_day.updated_at, 111, "unchanged value keeps its timestamp");

  runStatusline(session({ five_hour: { used_percentage: 2, resets_at: 1790918000 } }), dir); // new window
  state = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(state.windows.five_hour.used_percentage, 2);
  assert.equal(state.windows.seven_day.used_percentage, 9, "a window missing from input is kept");
});

test("statusline: a corrupt state file is replaced, not fatal", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusline-"));
  writeFileSync(join(dir, "claude-rate-limits.json"), "{garbage");
  const r = runStatusline(session({ seven_day: { used_percentage: 7, resets_at: 1791000000 } }), dir);
  assert.equal(r.code, 0);
  const state = JSON.parse(readFileSync(join(dir, "claude-rate-limits.json"), "utf8"));
  assert.equal(state.windows.seven_day.used_percentage, 7);
});
