/**
 * Export the demo additions (rows that this fork adds on top of the upstream
 * `samay-cbh/greenroom-starter` dataset) as JSON, plus a byte-for-byte copy
 * of the live SQLite database. Output goes to
 * `artifacts/api-server/data/seeds/`.
 *
 * Safe to re-run. Idempotent. Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/exportSeedsSnapshot.ts
 */
import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(HERE, "..", "data", "greenroom.db");
const OUT_DIR = join(HERE, "..", "data", "seeds");

// Demo additions added on top of the upstream starter dataset come from two
// seed scripts that use different ID prefixes: `seedSmartSwitchDemo.ts`
// (`artist_demo_` / `show_demo_`) and `seedNewDemoProposals.ts`
// (`artist_newdemo_` / `show_newdemo_`). Both are exported.
const ART_PREFIXES = ["artist_demo_", "artist_newdemo_"] as const;
const SHOW_PREFIXES = ["show_demo_", "show_newdemo_"] as const;

const orLike = (col: string, prefixes: readonly string[]): string =>
  prefixes.map((p) => `${col} LIKE '${p}%'`).join(" OR ");

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const c = createClient({ url: `file:${DB_PATH}` });

  const pick = async (
    table: string,
    where: string,
  ): Promise<Record<string, unknown>[]> => {
    const r = await c.execute({
      sql: `SELECT * FROM ${table} WHERE ${where} ORDER BY 1`,
      args: [],
    });
    return r.rows.map((row) => {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(row)) o[k] = (row as Record<string, unknown>)[k];
      return o;
    });
  };

  const demoArtists = await pick("artists", orLike("id", ART_PREFIXES));
  const demoShows = await pick(
    "shows",
    `(${orLike("id", SHOW_PREFIXES)}) OR (${orLike("artist_id", ART_PREFIXES)})`,
  );
  const showIds = demoShows.map((s) => `'${s.id}'`).join(",");
  const demoDeals = showIds ? await pick("deals", `show_id IN (${showIds})`) : [];
  const demoSettle = showIds ? await pick("settlements", `show_id IN (${showIds})`) : [];
  const demoSwitch = showIds ? await pick("switch_suggestions", `show_id IN (${showIds})`) : [];
  const demoGuar = showIds ? await pick("guarantee_suggestions", `show_id IN (${showIds})`) : [];

  const write = (name: string, data: unknown): void => {
    writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2));
  };
  write("artists.json", demoArtists);
  write("shows.json", demoShows);
  write("deals.json", demoDeals);
  write("settlements.json", demoSettle);
  write("switch_suggestions.json", demoSwitch);
  write("guarantee_suggestions.json", demoGuar);

  copyFileSync(DB_PATH, join(OUT_DIR, "greenroom.db"));

  console.log("Exported snapshot to", OUT_DIR);
  console.log("  artists  :", demoArtists.length);
  console.log("  shows    :", demoShows.length);
  console.log("  deals    :", demoDeals.length);
  console.log("  settle   :", demoSettle.length);
  console.log("  switch   :", demoSwitch.length);
  console.log("  guarantee:", demoGuar.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
