// Daily encrypted copy of the dashboard database. Activity rows outlive the transcripts they
// came from (both machines prune after 30 days), so this file is the only place that history
// exists. Encrypted with `age` to a public key, so the copy is unreadable without the private one.
// Configured by DB_BACKUP_DIR and BACKUP_AGE_RECIPIENT_FILE in .env.local.
// No path aliases, so tests can load this file directly with node --test.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NAME = /^costs-(\d{4}-\d{2}-\d{2})\.sqlite\.age$/;

export type BackupDeps = {
  dir: string; // the backup folder; its parent must already exist (a missing Drive mount is an error)
  today: string; // YYYY-MM-DD, Eastern
  snapshot: (dest: string) => Promise<unknown>; // better-sqlite3 db.backup(): consistent online copy
  encrypt: (src: string, dest: string) => Promise<void>;
  keepDaily?: number;
};

export type BackupResult = { ok: boolean; skipped: boolean; file: string | null; pruned: number; error?: string };

export async function backupDaily(d: BackupDeps): Promise<BackupResult> {
  if (!existsSync(dirname(d.dir))) {
    return { ok: false, skipped: false, file: null, pruned: 0, error: `missing folder ${dirname(d.dir)}` };
  }
  mkdirSync(d.dir, { recursive: true });
  const dest = join(d.dir, `costs-${d.today}.sqlite.age`);
  if (existsSync(dest)) return { ok: true, skipped: true, file: dest, pruned: 0 };

  const tmp = join(tmpdir(), `api-costs-backup-${process.pid}-${Date.now()}.sqlite`);
  const partial = `${dest}.partial`;
  try {
    await d.snapshot(tmp);
    await d.encrypt(tmp, partial);
    renameSync(partial, dest);
  } catch (err) {
    rmSync(partial, { force: true });
    return { ok: false, skipped: false, file: null, pruned: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    rmSync(tmp, { force: true });
  }
  return { ok: true, skipped: false, file: dest, pruned: pruneBackups(d.dir, d.keepDaily ?? 14) };
}

// Keeps the newest `keepDaily` copies, plus the oldest copy of every earlier month.
export function pruneBackups(dir: string, keepDaily: number): number {
  const files = readdirSync(dir).filter((f) => NAME.test(f)).sort(); // oldest first: the date is in the name
  const recent = new Set(files.slice(-keepDaily));
  const monthsKept = new Set<string>();
  let removed = 0;
  for (const f of files) {
    if (recent.has(f)) continue;
    const month = NAME.exec(f)![1].slice(0, 7);
    if (!monthsKept.has(month)) {
      monthsKept.add(month);
      continue;
    }
    rmSync(join(dir, f));
    removed++;
  }
  return removed;
}

// Date (YYYY-MM-DD) of the newest backup in `dir`, or null.
export function newestBackupDate(dir: string): string | null {
  try {
    const dates = readdirSync(dir)
      .map((f) => NAME.exec(f)?.[1])
      .filter((x): x is string => !!x)
      .sort();
    return dates.at(-1) ?? null;
  } catch {
    return null;
  }
}

export function ageEncrypt(recipientFile: string): (src: string, dest: string) => Promise<void> {
  return (src, dest) =>
    new Promise((resolve, reject) => {
      execFile(process.env.AGE_BIN || "age", ["-R", recipientFile, "-o", dest, src], { timeout: 60_000 }, (err, _o, stderr) =>
        err ? reject(new Error(`age failed: ${stderr || err.message}`)) : resolve()
      );
    });
}
