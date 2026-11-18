// Daily encrypted copy of the dashboard database. Activity rows outlive the transcripts they
// came from (both machines prune after 30 days), so this file is the only place that history
// exists. Encrypted with `age` to a public key, so the copy is unreadable without the private one.
// Configured by DB_BACKUP_DIR and BACKUP_AGE_RECIPIENT_FILE in .env.local.
// Every filesystem call is async: the backup folder sits on a cloud-drive mount, and a hung
// mount must not block the server's event loop.
// No path aliases, so tests can load this file directly with node --test.
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NAME = /^costs-(\d{4}-\d{2}-\d{2})\.sqlite\.age$/;
const WORK_PREFIX = "api-costs-backup-";
// An encrypted copy of even an empty database is well over this; anything smaller is a stub
const MIN_BACKUP_BYTES = 1024;

export type BackupDeps = {
  dir: string; // the backup folder; its parent must already exist (a missing Drive mount is an error)
  today: string; // YYYY-MM-DD, Eastern
  snapshot: (dest: string) => Promise<unknown>; // better-sqlite3 db.backup(): consistent online copy
  encrypt: (src: string, dest: string) => Promise<void>;
  keepDaily?: number;
  workRoot?: string; // where the plaintext snapshot is made; defaults to the OS temp folder
};

export type BackupResult = { ok: boolean; skipped: boolean; file: string | null; pruned: number; error?: string };

const exists = (p: string) => access(/*turbopackIgnore: true*/ p).then(() => true, () => false);

export async function backupDaily(d: BackupDeps): Promise<BackupResult> {
  const fail = (error: string): BackupResult => ({ ok: false, skipped: false, file: null, pruned: 0, error });
  if (!(await exists(dirname(/*turbopackIgnore: true*/ d.dir)))) return fail(`missing folder ${dirname(/*turbopackIgnore: true*/ d.dir)}`);
  await mkdir(/*turbopackIgnore: true*/ d.dir, { recursive: true });
  const dest = join(/*turbopackIgnore: true*/ d.dir, `costs-${d.today}.sqlite.age`);
  // Skip only when today's copy is a real file of plausible size; a stub left by a crash is redone
  const prior = await stat(/*turbopackIgnore: true*/ dest).catch(() => null);
  if (prior?.isFile() && prior.size >= MIN_BACKUP_BYTES) return { ok: true, skipped: true, file: dest, pruned: 0 };
  if (prior) await rm(/*turbopackIgnore: true*/ dest, { recursive: true, force: true });

  const workRoot = d.workRoot ?? tmpdir();
  await sweepLeftovers(d.dir, workRoot);
  // mkdtemp makes the folder 0700, so the plaintext snapshot is private to this user
  const work = await mkdtemp(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ workRoot, WORK_PREFIX));
  // Snapshot and encrypt in the private work folder; only a finished ciphertext enters the
  // backup folder, under a per-process name, and a same-folder rename publishes it.
  const partial = `${dest}.${process.pid}.partial`;
  try {
    await d.snapshot(join(/*turbopackIgnore: true*/ work, "costs.sqlite"));
    await d.encrypt(join(/*turbopackIgnore: true*/ work, "costs.sqlite"), join(/*turbopackIgnore: true*/ work, "costs.sqlite.age"));
    await copyFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ work, "costs.sqlite.age"), partial);
    await rename(/*turbopackIgnore: true*/ partial, dest);
  } catch (err) {
    await rm(/*turbopackIgnore: true*/ partial, { force: true });
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    await rm(/*turbopackIgnore: true*/ work, { recursive: true, force: true });
  }
  return { ok: true, skipped: false, file: dest, pruned: await pruneBackups(d.dir, d.keepDaily ?? 14) };
}

// A crash between steps can leave a plaintext snapshot in the temp folder or a .partial file in
// the backup folder. Neither is ever read; remove them before the next attempt.
async function sweepLeftovers(dir: string, workRoot: string): Promise<void> {
  for (const f of await readdir(/*turbopackIgnore: true*/ dir)) if (f.endsWith(".partial")) await rm(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, f), { force: true });
  for (const f of await readdir(/*turbopackIgnore: true*/ workRoot).catch(() => [] as string[])) {
    if (!f.startsWith(WORK_PREFIX)) continue;
    const p = join(/*turbopackIgnore: true*/ workRoot, f);
    const s = await stat(/*turbopackIgnore: true*/ p).catch(() => null);
    if (s && Date.now() - s.mtimeMs > 60 * 60_000) await rm(/*turbopackIgnore: true*/ p, { recursive: true, force: true });
  }
}

// Keeps the newest `keepDaily` copies, plus the oldest copy of every earlier month.
export async function pruneBackups(dir: string, keepDaily: number): Promise<number> {
  const files = (await readdir(/*turbopackIgnore: true*/ dir)).filter((f) => NAME.test(f)).sort(); // oldest first: the date is in the name
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
    await rm(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, f));
    removed++;
  }
  return removed;
}

// Date (YYYY-MM-DD) of the newest backup in `dir`, or null.
export async function newestBackupDate(dir: string): Promise<string | null> {
  try {
    const dates = (await readdir(/*turbopackIgnore: true*/ dir))
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
