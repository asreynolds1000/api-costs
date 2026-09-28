// Walks ~/.claude/projects, ~/.claude-ss/projects and ~/.codex/sessions, streams any file
// whose (size, mtime) changed since the last run, and replaces that file's rows in the
// activity_* tables in one transaction. Never deletes rows for files that have since
// disappeared from disk (Claude Code prunes old transcripts; history must survive that).
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toEasternDate } from "@/lib/timezone";
import { createClaudeAccumulator, type ClaudeFinishResult } from "./claude-parse";
import { createCodexAccumulator, type CodexFinishResult } from "./codex-parse";
import { estimateCost } from "./pricing";

export type IndexResult = {
  filesSeen: number;
  filesParsed: number;
  rowsWritten: number;
  ms: number;
  errors: string[];
};

export type IndexOptions = {
  claudeProjectsDirs?: string[];
  codexHome?: string;
};

type Source = "claude-code" | "codex";
// `path` is where the file is read from. `key` identifies it in the activity tables: the path
// relative to its log root, so the same transcript found under another configured root (or
// after a move) replaces its rows instead of being counted twice.
type FileEntry = { path: string; key: string; source: Source; isSubagent: boolean };

const toDate = (iso: string): string => toEasternDate(new Date(iso));

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function claudeRoots(opts?: IndexOptions): string[] {
  if (opts?.claudeProjectsDirs) return opts.claudeProjectsDirs;
  const env = process.env.CLAUDE_PROJECTS_DIRS;
  if (env) return env.split(":").filter((s) => s.length > 0);
  return [join(homedir(), ".claude", "projects"), join(homedir(), ".claude-ss", "projects")];
}

function codexSessionsRoot(opts?: IndexOptions): string {
  const home = opts?.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(home, "sessions");
}

// <root>/<proj>/<session>.jsonl (a session file) and
// <root>/<proj>/<session>/subagents/agent-*.jsonl (that session's subagent transcripts).
function listClaudeFiles(root: string): FileEntry[] {
  const out: FileEntry[] = [];
  for (const proj of listDir(root)) {
    const projDir = join(root, proj);
    if (!isDirectory(projDir)) continue;
    for (const entry of listDir(projDir)) {
      const entryPath = join(projDir, entry);
      if (entry.endsWith(".jsonl")) {
        out.push({ path: entryPath, key: `claude-code:${proj}/${entry}`, source: "claude-code", isSubagent: false });
        continue;
      }
      const subagentsDir = join(entryPath, "subagents");
      for (const sub of listDir(subagentsDir)) {
        if (sub.endsWith(".jsonl")) {
          out.push({
            path: join(subagentsDir, sub),
            key: `claude-code:${proj}/${entry}/subagents/${sub}`,
            source: "claude-code",
            isSubagent: true,
          });
        }
      }
    }
  }
  return out;
}

// <sessions>/YYYY/MM/DD/rollout-*.jsonl
function listCodexFiles(sessionsRoot: string): FileEntry[] {
  const out: FileEntry[] = [];
  for (const y of listDir(sessionsRoot).filter((n) => /^\d+$/.test(n))) {
    const yDir = join(sessionsRoot, y);
    for (const m of listDir(yDir).filter((n) => /^\d+$/.test(n))) {
      const mDir = join(yDir, m);
      for (const d of listDir(mDir).filter((n) => /^\d+$/.test(n))) {
        const dDir = join(mDir, d);
        for (const f of listDir(dDir)) {
          if (f.startsWith("rollout-") && f.endsWith(".jsonl")) {
            out.push({ path: join(dDir, f), key: `codex:${y}/${m}/${d}/${f}`, source: "codex", isSubagent: false });
          }
        }
      }
    }
  }
  return out;
}

function readSubagentType(agentJsonlPath: string): string | undefined {
  const metaPath = agentJsonlPath.replace(/\.jsonl$/, ".meta.json");
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { agentType?: unknown };
    return typeof meta.agentType === "string" ? meta.agentType : undefined;
  } catch {
    return undefined;
  }
}

async function streamLines(path: string, onLine: (line: string) => void): Promise<void> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) onLine(line);
}

async function parseFile(entry: FileEntry): Promise<ClaudeFinishResult | CodexFinishResult> {
  if (entry.source === "claude-code") {
    const subagentType = entry.isSubagent ? readSubagentType(entry.path) : undefined;
    const acc = createClaudeAccumulator({ isSubagent: entry.isSubagent, subagentType });
    await streamLines(entry.path, acc.line);
    return acc.finish(toDate);
  }
  const acc = createCodexAccumulator();
  await streamLines(entry.path, acc.line);
  return acc.finish(toDate);
}

// Replaces this file's rows across all four activity tables in one transaction and returns
// the number of rows written (usage + tools + 1 session row).
function writeFileRows(
  entry: FileEntry,
  result: ClaudeFinishResult | CodexFinishResult,
  size: number,
  mtimeMs: number
): number {
  let rows = 0;
  const parsedAt = new Date().toISOString();
  const mtime = Math.trunc(mtimeMs);

  db.transaction((tx) => {
    tx.delete(schema.activityUsage).where(eq(schema.activityUsage.path, entry.key)).run();
    tx.delete(schema.activityTools).where(eq(schema.activityTools.path, entry.key)).run();
    tx.delete(schema.activitySessions).where(eq(schema.activitySessions.path, entry.key)).run();

    for (const u of result.usage) {
      const estCostUsd = estimateCost(u.model, u);
      tx.insert(schema.activityUsage)
        .values({
          path: entry.key,
          date: u.date,
          source: entry.source,
          project: u.project,
          model: u.model,
          messages: u.messages,
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead,
          cacheWrite5m: u.cacheWrite5m,
          cacheWrite1h: u.cacheWrite1h,
          estCostUsd,
        })
        .run();
      rows++;
    }

    for (const t of result.tools) {
      tx.insert(schema.activityTools)
        .values({
          path: entry.key,
          date: t.date,
          source: entry.source,
          kind: t.kind,
          grp: t.grp,
          name: t.name,
          count: t.count,
        })
        .run();
      rows++;
    }

    tx.insert(schema.activitySessions)
      .values({
        path: entry.key,
        source: entry.source,
        sessionId: result.session.sessionId,
        project: result.session.project,
        startedAt: result.session.startedAt ?? "",
        endedAt: result.session.endedAt ?? "",
        isSubagent: result.session.isSubagent ? 1 : 0,
      })
      .run();
    rows++;

    tx.insert(schema.activityFiles)
      .values({ path: entry.key, source: entry.source, size, mtimeMs: mtime, parsedAt })
      .onConflictDoUpdate({
        target: schema.activityFiles.path,
        set: { size, mtimeMs: mtime, parsedAt },
      })
      .run();
  });

  return rows;
}

async function runIndexActivity(opts?: IndexOptions): Promise<IndexResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  const files: FileEntry[] = [];
  for (const root of claudeRoots(opts)) files.push(...listClaudeFiles(root));
  files.push(...listCodexFiles(codexSessionsRoot(opts)));

  const existing = new Map<string, { size: number; mtimeMs: number }>();
  for (const row of db
    .select({
      path: schema.activityFiles.path,
      size: schema.activityFiles.size,
      mtimeMs: schema.activityFiles.mtimeMs,
    })
    .from(schema.activityFiles)
    .all()) {
    existing.set(row.path, { size: row.size, mtimeMs: row.mtimeMs });
  }

  let filesParsed = 0;
  let rowsWritten = 0;

  for (const entry of files) {
    let stat;
    try {
      stat = statSync(entry.path);
    } catch (err) {
      errors.push(`${entry.path}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const prev = existing.get(entry.key);
    const mtime = Math.trunc(stat.mtimeMs);
    if (prev && prev.size === stat.size && prev.mtimeMs === mtime) {
      continue; // unchanged since the last run
    }

    try {
      const result = await parseFile(entry);
      rowsWritten += writeFileRows(entry, result, stat.size, stat.mtimeMs);
      filesParsed++;
    } catch (err) {
      errors.push(`${entry.path}: ${err instanceof Error ? err.message : String(err)}`);
    }

    await yieldToEventLoop();
  }

  return { filesSeen: files.length, filesParsed, rowsWritten, ms: Date.now() - startedAt, errors };
}

// route.ts and instrumentation.ts are separate Next.js bundles with separate module caches,
// so a plain module-level variable here would not actually serialize a concurrent call from
// both. globalThis is shared across bundles in the same process (same pattern as db/index.ts's
// singleton), so it's the only place this guard can live.
const globalForIndexer = globalThis as unknown as {
  __activityIndexInFlight?: Promise<IndexResult>;
};

export function indexActivity(opts?: IndexOptions): Promise<IndexResult> {
  if (globalForIndexer.__activityIndexInFlight) return globalForIndexer.__activityIndexInFlight;
  const promise = runIndexActivity(opts).finally(() => {
    globalForIndexer.__activityIndexInFlight = undefined;
  });
  globalForIndexer.__activityIndexInFlight = promise;
  return promise;
}
