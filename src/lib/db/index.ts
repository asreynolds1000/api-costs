import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "path";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), "data", "costs.sqlite");

// globalThis singleton prevents HMR from opening multiple connections
const globalForDb = globalThis as unknown as { __db?: Database.Database };

function getDatabase() {
  if (!globalForDb.__db) {
    const sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    // busy_timeout prevents SQLITE_BUSY during build (multiple workers)
    sqlite.pragma("busy_timeout = 5000");
    globalForDb.__db = sqlite;
  }
  return globalForDb.__db;
}

export const db = drizzle(getDatabase(), { schema });
export { schema };
