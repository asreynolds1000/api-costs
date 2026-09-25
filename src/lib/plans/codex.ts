import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  codexWindows,
  findLatestCodexSnapshot,
  newestUpdate,
  type CodexSnapshot,
  type PlanUsage,
} from "./parse";

// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, 1+ GB in total, so only the newest
// files are opened and they are read backwards from the end.
const DAY_DIRS = 14; // a resumed session keeps appending to the day it started
const FILES_TO_CHECK = 3; // concurrent sessions: take the newest snapshot across these
const CHUNK = 2 * 1024 * 1024;
const MAX_BYTES_PER_FILE = 64 * 1024 * 1024; // single lines can exceed 1 MB

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function newestSessionFiles(root: string): string[] {
  const numericDesc = (dir: string) =>
    listDir(dir).filter((n) => /^\d+$/.test(n)).sort().reverse();

  const days: string[] = [];
  outer: for (const y of numericDesc(root)) {
    for (const m of numericDesc(join(root, y))) {
      for (const d of numericDesc(join(root, y, m))) {
        days.push(join(root, y, m, d));
        if (days.length >= DAY_DIRS) break outer;
      }
    }
  }

  return days
    .flatMap((dir) => listDir(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f)))
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, FILES_TO_CHECK)
    .map((f) => f.path);
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

export function getCodexUsage(nowSec = Date.now() / 1000): PlanUsage {
  const base = { id: "codex" as const, name: "ChatGPT Codex", windows: [], updatedAt: null };
  const root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");

  let best: CodexSnapshot | null = null;
  for (const file of newestSessionFiles(root)) {
    const snap = lastSnapshotInFile(file);
    if (snap && (!best || snap.timestamp > best.timestamp)) best = snap;
  }

  if (!best) {
    return {
      ...base,
      status: "missing",
      message: "No Codex usage found yet. It shows up after your next Codex run on this Mac.",
    };
  }

  const windows = codexWindows(best, nowSec);
  return { ...base, status: "ok", windows, updatedAt: newestUpdate(windows) };
}
