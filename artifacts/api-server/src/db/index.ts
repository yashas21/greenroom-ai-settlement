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
