import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  aiQuotaCodexWindows,
  codexWindows,
  findLatestCodexSnapshot,
  newestUpdate,
  type AiQuotaCodexState,
  type CodexSnapshot,
  type PlanUsage,
  type QuotaWindow,
} from "./parse";

const AI_QUOTA_PATH = join(homedir(), ".local", "state", "ai-usage", "codex-rate-limits.json");

// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, 1+ GB in total. Every file is stat'ed
// (cheap), but files are opened newest-mtime first and read backwards from the end, and
// the scan stops at the first file last written before the best snapshot found so far:
// that file cannot contain a newer one. A resumed session keeps appending to the day
// directory it started in, which is why mtime, not directory date, drives the order.
const MAX_FILES_OPENED = 40;
const CHUNK = 2 * 1024 * 1024;
const MAX_BYTES_PER_FILE = 64 * 1024 * 1024; // single lines can exceed 1 MB

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function sessionFilesByMtime(root: string): { path: string; mtime: number }[] {
  const numeric = (dir: string) => listDir(dir).filter((n) => /^\d+$/.test(n));
  const files: { path: string; mtime: number }[] = [];
  for (const y of numeric(root)) {
    for (const m of numeric(join(root, y))) {
      for (const d of numeric(join(root, y, m))) {
        const dir = join(root, y, m, d);
        for (const f of listDir(dir)) {
          if (!f.endsWith(".jsonl")) continue;
          try {
            files.push({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs });
          } catch {
            // file vanished between readdir and stat
          }
        }
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

// Reads complete lines backwards in chunks until a plan snapshot turns up.
// Splits on the newline byte, which never occurs inside a multi-byte UTF-8 character.
function lastSnapshotInFile(path: string): CodexSnapshot | null {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    let end = size;
    let carry = Buffer.alloc(0); // start of this chunk's first line, continued in the previous chunk
    while (end > 0 && size - end < MAX_BYTES_PER_FILE) {
      const start = Math.max(0, end - CHUNK);
      const chunk = Buffer.alloc(end - start);
      readSync(fd, chunk, 0, chunk.length, start);
      const buf = Buffer.concat([chunk, carry]);
      end = start;

      if (start === 0) return findLatestCodexSnapshot(buf.toString("utf8"));

      const firstNewline = buf.indexOf(10);
      if (firstNewline === -1) {
        carry = buf;
        continue;
      }
      const hit = findLatestCodexSnapshot(buf.subarray(firstNewline + 1).toString("utf8"));
      if (hit) return hit;
      carry = buf.subarray(0, firstNewline);
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function aiQuotaWindows(nowSec: number): QuotaWindow[] {
  try {
    return aiQuotaCodexWindows(JSON.parse(readFileSync(AI_QUOTA_PATH, "utf8")) as AiQuotaCodexState, nowSec);
  } catch {
    return []; // not installed, or mid-write: fall back to the session logs
  }
}

function sessionLogWindows(nowSec: number): QuotaWindow[] {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");

  let best: CodexSnapshot | null = null;
  let opened = 0;
  for (const file of sessionFilesByMtime(root)) {
    if (best && file.mtime < Date.parse(best.timestamp)) break;
    if (++opened > MAX_FILES_OPENED) break;
    const snap = lastSnapshotInFile(file.path);
    if (snap && (!best || snap.timestamp > best.timestamp)) best = snap;
  }

  return best ? codexWindows(best, nowSec) : [];
}

// Two sources, newest reading wins: ai-quota's direct probe, and the snapshots Codex writes
// to its session logs (current only when Codex last ran on this Mac).
export function getCodexUsage(nowSec = Date.now() / 1000): PlanUsage {
  const base = { id: "codex" as const, name: "ChatGPT Codex", windows: [], updatedAt: null };
  const [windows] = [aiQuotaWindows(nowSec), sessionLogWindows(nowSec)]
    .filter((ws) => ws.length > 0)
    .sort((a, b) => (newestUpdate(b) ?? "").localeCompare(newestUpdate(a) ?? ""));

  if (!windows) {
    return {
      ...base,
      status: "missing",
      message: "No Codex usage found yet. It shows up after your next Codex run on this Mac.",
    };
  }
  return { ...base, status: "ok", windows, updatedAt: newestUpdate(windows) };
}
