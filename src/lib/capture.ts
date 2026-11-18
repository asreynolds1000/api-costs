// Keeping the data: copy the Mac Mini's logs before each index, back up the database after.
// Neither changes the tick's ok flag (that drives the provider-sync indicator). The page reads
// their status from memory only, never from the backup folder: that folder is on a cloud-drive
// mount, and a page render must not wait on it.
import { sqlite } from "@/lib/db";
import { toEasternDate } from "@/lib/timezone";
import { lastMirrorAt, mirrorMini } from "@/lib/activity/mini-mirror";
import { ageEncrypt, backupDaily, newestBackupDate, type BackupResult } from "@/lib/db/backup";

export type CaptureStatus = {
  mini: { enabled: boolean; copiedAt: string | null; error: string | null };
  // date: newest backup; undefined until the first scheduler tick has looked (about 30 s after boot)
  backup: { configured: boolean; date?: string | null; error: string | null };
  note: string | null; // ACTIVITY_NOTE: install-specific caveats for the Activity header
};

// After a failed backup, wait this long before trying again rather than snapshotting every tick
const BACKUP_RETRY_MS = 2 * 60 * 60_000;
const BACKUP_DEADLINE_MS = 3 * 60_000;

// On globalThis: route handlers and instrumentation load separate module copies
type State = {
  miniError: string | null;
  backupError: string | null;
  backupFailedAt: number;
  backupRunning?: boolean;
  newestBackup?: string | null;
};
const g = globalThis as unknown as { __capture?: State };
const state = () => (g.__capture ??= { miniError: null, backupError: null, backupFailedAt: 0 });

export async function copyMiniLogs(): Promise<void> {
  try {
    const r = await mirrorMini();
    state().miniError = r.ok ? null : r.errors.join("; ");
    if (!r.ok) console.error(`[capture] Mac Mini copy: ${state().miniError}`);
  } catch (err) {
    state().miniError = err instanceof Error ? err.message : String(err);
    console.error("[capture] Mac Mini copy failed:", err);
  }
}

export async function backupDatabase(): Promise<void> {
  const dir = process.env.DB_BACKUP_DIR;
  const recipient = process.env.BACKUP_AGE_RECIPIENT_FILE;
  if (!dir || !recipient) return;
  const s = state();
  if (s.backupRunning) return; // a previous attempt is still stuck on the drive; let it finish
  try {
    if (s.backupError && Date.now() - s.backupFailedAt < BACKUP_RETRY_MS) return;
    s.backupRunning = true;
    const attempt = backupDaily({
      dir,
      today: toEasternDate(new Date()),
      snapshot: (dest) => sqlite.backup(dest),
      encrypt: ageEncrypt(recipient),
    }).finally(() => (s.backupRunning = false));
    // The tick waits at most BACKUP_DEADLINE_MS, so a hung drive cannot stop later indexing
    const r = await Promise.race([
      attempt,
      new Promise<BackupResult>((resolve) =>
        setTimeout(() => resolve({ ok: false, skipped: false, file: null, pruned: 0, error: "timed out" }), BACKUP_DEADLINE_MS).unref()
      ),
    ]);
    s.backupError = r.ok ? null : (r.error ?? "unknown error");
    if (!r.ok) {
      s.backupFailedAt = Date.now();
      console.error(`[capture] database backup: ${s.backupError}`);
    }
  } catch (err) {
    s.backupError = err instanceof Error ? err.message : String(err);
    s.backupFailedAt = Date.now();
    console.error("[capture] database backup failed:", err);
  } finally {
    if (!s.backupRunning) s.newestBackup = await newestBackupDate(dir);
  }
}

export function getCaptureStatus(): CaptureStatus {
  const s = state();
  return {
    mini: { enabled: process.env.MINI_MIRROR !== "0", copiedAt: lastMirrorAt(), error: s.miniError },
    backup: {
      configured: !!process.env.DB_BACKUP_DIR && !!process.env.BACKUP_AGE_RECIPIENT_FILE,
      date: s.newestBackup,
      error: s.backupError,
    },
    note: process.env.ACTIVITY_NOTE || null,
  };
}
