import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const dbPath = path.resolve(process.cwd(), "data", "greenroom.db");
const envUrl = process.env.DATABASE_URL;
const dbUrl = envUrl && envUrl.startsWith("file:") ? envUrl : `file:${dbPath}`;

export const client = createClient({ url: dbUrl });
export const db = drizzle(client, { schema });

export type DB = typeof db;

async function ensureColumn(table: string, column: string, decl: string) {
  const cols = await client.execute(`PRAGMA table_info(${table})`);
  const has = cols.rows.some((r) => (r as Record<string, unknown>).name === column);
  if (!has) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

export const migrationsReady = (async () => {
  await ensureColumn("settlements", "positive_summary", "TEXT");
  await ensureColumn("settlements", "negative_summary", "TEXT");
  await client.execute(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
  );
  await client.execute(`
    CREATE TABLE IF NOT EXISTS switch_suggestions (
      id TEXT PRIMARY KEY,
      show_id TEXT NOT NULL UNIQUE REFERENCES shows(id),
      deal_id TEXT NOT NULL REFERENCES deals(id),
      suggested_at INTEGER NOT NULL,
      deal_type_from TEXT NOT NULL,
      shape TEXT NOT NULL,
      suggested_flat REAL,
      door_floor REAL,
      door_split_pct REAL,
      door_expense_cap REAL,
      confidence_tier TEXT NOT NULL,
      band_low REAL,
      band_high REAL,
      sample_size INTEGER NOT NULL,
      basis TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'suggested',
      decided_at INTEGER
    )
  `);
})();
