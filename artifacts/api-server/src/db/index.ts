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
})();
