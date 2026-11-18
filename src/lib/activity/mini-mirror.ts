// Copies the Mac Mini's Claude Code and Codex logs into a local mirror that the activity
// indexer reads alongside this Mac's own logs. The Mini prunes transcripts after 30 days, so
// the copy NEVER deletes: the mirror doubles as the long-term copy of the Mini's transcripts.
// No path aliases, so tests can load this file directly with node --test.
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MINI_DIRS = [
  { remote: ".claude/projects", local: "claude" },
  { remote: ".claude-ss/projects", local: "claude-ss" },
  { remote: ".codex/sessions", local: "codex" },
] as const;

const LAST_OK_FILE = ".last-ok";
// Runs inside the scheduler tick, which "Sync now" waits on. After the first full copy each run
// only moves what changed, so two minutes per folder is generous.
const TIMEOUT_MS = 2 * 60_000;
// rsync exit 24: some source files vanished mid-transfer (the Mini pruning old transcripts).
// Everything still there was copied, so it counts as success.
const OK_CODES = new Set([0, 24]);

export function miniMirrorDir(): string {
  return process.env.MINI_MIRROR_DIR || join(/*turbopackIgnore: true*/ homedir(), ".local", "state", "ai-usage", "mini");
}

export type Runner = (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; stderr: string }>;

const execRunner: Runner = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (!err) return resolve({ code: 0, stderr });
      const e = err as Error & { code?: unknown; killed?: boolean };
      const code = typeof e.code === "number" ? e.code : -1; // -1: timed out or failed to start
      const why = e.killed ? `timed out after ${timeoutMs / 1000}s` : stderr || e.message;
      resolve({ code, stderr: why });
    });
  });

export type MirrorResult = { ok: boolean; skipped: boolean; errors: string[]; ms: number };

export async function mirrorMini(run: Runner = execRunner, dir = miniMirrorDir()): Promise<MirrorResult> {
  const startedAt = Date.now();
  if (process.env.MINI_MIRROR === "0") return { ok: true, skipped: true, errors: [], ms: 0 };
  const host = process.env.MINI_HOST || "mac-mini";
  const errors: string[] = [];
  for (const d of MINI_DIRS) {
    const local = join(/*turbopackIgnore: true*/ dir, d.local);
    mkdirSync(local, { recursive: true });
    const args = ["-a", "-e", "ssh -o BatchMode=yes -o ConnectTimeout=10", `${host}:${d.remote}/`, `${local}/`];
    const { code, stderr } = await run("rsync", args, TIMEOUT_MS);
    if (!OK_CODES.has(code)) errors.push(`${d.remote}: rsync exit ${code}: ${stderr.trim().split("\n").at(-1) ?? ""}`);
  }
  const ok = errors.length === 0;
  if (ok) writeFileSync(join(/*turbopackIgnore: true*/ dir, LAST_OK_FILE), new Date().toISOString());
  return { ok, skipped: false, errors, ms: Date.now() - startedAt };
}

// ISO time of the last copy where every folder succeeded, or null if there has never been one.
export function lastMirrorAt(dir = miniMirrorDir()): string | null {
  try {
    return readFileSync(join(/*turbopackIgnore: true*/ dir, LAST_OK_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}
