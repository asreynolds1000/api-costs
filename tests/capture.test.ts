// Mac Mini log copy (mini-mirror.ts) and the daily database backup (backup.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastMirrorAt, mirrorMini, MINI_DIRS, type Runner } from "../src/lib/activity/mini-mirror.ts";
import { backupDaily, newestBackupDate, pruneBackups } from "../src/lib/db/backup.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "api-costs-test-"));

// --- mini-mirror -----------------------------------------------------------------------------

test("mirror: copies every folder without --delete and records the success time", async () => {
  const dir = tmp();
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => (calls.push(args), { code: 0, stderr: "" });
  const r = await mirrorMini(run, dir);
  assert.equal(r.ok, true);
  assert.equal(calls.length, MINI_DIRS.length);
  assert.ok(calls.every((a) => !a.some((x) => x.startsWith("--delete"))), "the copy must never delete");
  assert.ok(lastMirrorAt(dir));
});

test("mirror: rsync exit 24 (files vanished mid-copy) counts as success", async () => {
  const dir = tmp();
  const r = await mirrorMini(async () => ({ code: 24, stderr: "some files vanished" }), dir);
  assert.equal(r.ok, true);
});

test("mirror: any other failure is reported, keeps going, and leaves the last success time alone", async () => {
  const dir = tmp();
  let n = 0;
  const run: Runner = async () => (n++ === 1 ? { code: 255, stderr: "ssh: connect to host mac-mini: timed out" } : { code: 0, stderr: "" });
  const r = await mirrorMini(run, dir);
  assert.equal(r.ok, false);
  assert.equal(n, MINI_DIRS.length, "a failed folder must not stop the others");
  assert.match(r.errors[0], /exit 255: ssh: connect/);
  assert.equal(lastMirrorAt(dir), null);
});

// --- backup ----------------------------------------------------------------------------------

const fakeDeps = (dir: string, today: string) => ({
  dir,
  today,
  snapshot: async (dest: string) => writeFileSync(dest, "db"),
  encrypt: async (src: string, dest: string) => writeFileSync(dest, `enc(${src})`.padEnd(2048, ".")),
});

test("backup: writes today's encrypted copy, then skips when it already exists", async () => {
  const dir = join(tmp(), "api-costs");
  const first = await backupDaily(fakeDeps(dir, "2026-11-17"));
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);
  assert.deepEqual(readdirSync(dir), ["costs-2026-11-17.sqlite.age"]);
  const again = await backupDaily(fakeDeps(dir, "2026-11-17"));
  assert.equal(again.skipped, true);
  assert.equal(await newestBackupDate(dir), "2026-11-17");
});

test("backup: clears a .partial left by a crash, and an old plaintext snapshot in the work folder", async () => {
  const root = tmp();
  const dir = join(root, "api-costs");
  const work = join(root, "work");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(work, "api-costs-backup-stale"), { recursive: true });
  writeFileSync(join(work, "api-costs-backup-stale", "costs.sqlite"), "plaintext");
  const old = new Date(Date.now() - 2 * 60 * 60_000);
  utimesSync(join(work, "api-costs-backup-stale"), old, old);
  writeFileSync(join(dir, "costs-2026-11-16.sqlite.age.partial"), "half");
  const r = await backupDaily({ ...fakeDeps(dir, "2026-11-17"), workRoot: work });
  assert.equal(r.ok, true);
  assert.deepEqual(readdirSync(dir), ["costs-2026-11-17.sqlite.age"]);
  assert.deepEqual(readdirSync(work), [], "stale snapshot and this run's work folder are both gone");
});

test("backup: a stub left where today's copy should be is replaced, not trusted", async () => {
  const dir = join(tmp(), "api-costs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "costs-2026-11-17.sqlite.age"), "");
  const big = "x".repeat(4096);
  const r = await backupDaily({ ...fakeDeps(dir, "2026-11-17"), encrypt: async (_s: string, dest: string) => writeFileSync(dest, big) });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, false);
  assert.equal(readFileSync(join(dir, "costs-2026-11-17.sqlite.age"), "utf8").length, 4096);
});

test("backup: a missing parent folder (Drive not mounted) is an error, and nothing is created", async () => {
  const dir = join(tmp(), "no-such-drive", "api-costs");
  const r = await backupDaily(fakeDeps(dir, "2026-11-17"));
  assert.equal(r.ok, false);
  assert.match(r.error!, /missing folder/);
  assert.equal(existsSync(dir), false);
});

test("backup: a failed encrypt leaves no file behind, so the next run retries", async () => {
  const dir = join(tmp(), "api-costs");
  const r = await backupDaily({
    ...fakeDeps(dir, "2026-11-17"),
    encrypt: async (_s: string, dest: string) => {
      writeFileSync(dest, "half");
      throw new Error("age failed: no recipients");
    },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(readdirSync(dir), []);
});

test("backup: pruning keeps the newest 14 plus the oldest copy of each earlier month", async () => {
  const dir = tmp();
  mkdirSync(dir, { recursive: true });
  const days: string[] = [];
  for (let d = new Date("2026-09-20T12:00:00Z"); d <= new Date("2026-11-17T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  for (const day of days) writeFileSync(join(dir, `costs-${day}.sqlite.age`), "x");
  writeFileSync(join(dir, "notes.txt"), "not a backup");
  await pruneBackups(dir, 14);
  const left = readdirSync(dir).filter((f) => f.endsWith(".age")).map((f) => f.slice(6, 16)).sort();
  assert.deepEqual(left, ["2026-09-20", "2026-10-01", "2026-11-01", ...days.slice(-14)]);
  assert.ok(existsSync(join(dir, "notes.txt")), "other files are left alone");
});
