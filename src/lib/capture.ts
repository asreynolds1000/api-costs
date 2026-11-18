// Keeping the data: copy the Mac Mini's logs before each index, back up the database after.
// Neither changes the tick's ok flag (that drives the provider-sync indicator); their status is
// read from disk (mirror marker, newest backup file) so it survives restarts.
import { sqlite } from "@/lib/db";
import { toEasternDate } from "@/lib/timezone";
import { lastMirrorAt, mirrorMini } from "@/lib/activity/mini-mirror";
import { ageEncrypt, backupDaily, newestBackupDate } from "@/lib/db/backup";

export type CaptureStatus = {
  mini: { enabled: boolean; copiedAt: string | null; error: string | null };
  backup: { configured: boolean; date: string | null; error: string | null };
};

// Last errors, on globalThis: route handlers and instrumentation load separate module copies
const g = globalThis as unknown as { __captureErrors?: { mini: string | null; backup: string | null } };
const errors = () => (g.__captureErrors ??= { mini: null, backup: null });

export async function copyMiniLogs(): Promise<void> {
  try {
    const r = await mirrorMini();
    errors().mini = r.ok ? null : r.errors.join("; ");
    if (!r.ok) console.error(`[capture] Mac Mini copy: ${errors().mini}`);
  } catch (err) {
    errors().mini = err instanceof Error ? err.message : String(err);
    console.error("[capture] Mac Mini copy failed:", err);
  }
}

export async function backupDatabase(): Promise<void> {
  const dir = process.env.DB_BACKUP_DIR;
  const recipient = process.env.BACKUP_AGE_RECIPIENT_FILE;
  if (!dir || !recipient) return;
  try {
    const r = await backupDaily({
      dir,
      today: toEasternDate(new Date()),
      snapshot: (dest) => sqlite.backup(dest),
      encrypt: ageEncrypt(recipient),
    });
    errors().backup = r.ok ? null : (r.error ?? "unknown error");
    if (!r.ok) console.error(`[capture] database backup: ${errors().backup}`);
  } catch (err) {
    errors().backup = err instanceof Error ? err.message : String(err);
    console.error("[capture] database backup failed:", err);
  }
}

export function getCaptureStatus(): CaptureStatus {
  const dir = process.env.DB_BACKUP_DIR;
  return {
    mini: { enabled: process.env.MINI_MIRROR !== "0", copiedAt: lastMirrorAt(), error: errors().mini },
    backup: {
      configured: !!dir && !!process.env.BACKUP_AGE_RECIPIENT_FILE,
      date: dir ? newestBackupDate(dir) : null,
      error: errors().backup,
    },
  };
}
