import path from "node:path";
import fs from "node:fs/promises";
import { db, migrationsReady } from "../src/db/index.js";
import { getAllShows, getAllArtists } from "../src/lib/queries.js";
import {
  artists,
  shows,
  deals,
  settlements,
  agents,
  agencies,
} from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const OUT_DIR = path.resolve(process.cwd(), "..", "..", "code-review", "data");

async function main() {
  await migrationsReady;
  await fs.mkdir(OUT_DIR, { recursive: true });

  const showsList = await getAllShows();
  const artistsList = await getAllArtists();

  const settlementRows = await db
    .select({
      settlementId: settlements.id,
      showId: settlements.showId,
      status: settlements.status,
      grossBoxOffice: settlements.grossBoxOffice,
      totalToArtist: settlements.totalToArtist,
      totalExpenses: settlements.totalExpenses,
      recoupsJson: settlements.recoupsJson,
      notes: settlements.notes,
      signoffText: settlements.signoffText,
      positiveSummary: settlements.positiveSummary,
      negativeSummary: settlements.negativeSummary,
      showDate: shows.date,
      showStatus: shows.status,
      artistId: artists.id,
      artistName: artists.name,
      genre: artists.genre,
      dealId: deals.id,
      dealType: deals.dealType,
      guaranteeAmount: deals.guaranteeAmount,
      percentage: deals.percentage,
      percentageBasis: deals.percentageBasis,
      expenseCap: deals.expenseCap,
      hospitalityCap: deals.hospitalityCap,
      bonusesJson: deals.bonusesJson,
      dealNotesFreetext: deals.dealNotesFreetext,
      agentId: agents.id,
      agentName: agents.name,
      agencyId: agencies.id,
      agencyName: agencies.name,
    })
    .from(settlements)
    .innerJoin(shows, eq(shows.id, settlements.showId))
    .innerJoin(artists, eq(artists.id, shows.artistId))
    .innerJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(agents, eq(agents.id, artists.agentId))
    .leftJoin(agencies, eq(agencies.id, agents.agencyId));

  const insightsPerDeal = settlementRows.map((r) => ({
    settlementId: r.settlementId,
    showId: r.showId,
    showDate: r.showDate,
    showStatus: r.showStatus,
    settlementStatus: r.status,
    artist: { id: r.artistId, name: r.artistName, genre: r.genre },
    agent: r.agentId
      ? { id: r.agentId, name: r.agentName, agency: r.agencyName }
      : null,
    deal: {
      id: r.dealId,
      dealType: r.dealType,
      guaranteeAmount: r.guaranteeAmount,
      percentage: r.percentage,
      percentageBasis: r.percentageBasis,
      expenseCap: r.expenseCap,
      hospitalityCap: r.hospitalityCap,
      bonuses: r.bonusesJson ? JSON.parse(r.bonusesJson) : null,
      notes: r.dealNotesFreetext,
    },
    settlementFinancials: {
      grossBoxOffice: r.grossBoxOffice,
      totalToArtist: r.totalToArtist,
      totalExpenses: r.totalExpenses,
      recoups: r.recoupsJson ? JSON.parse(r.recoupsJson) : [],
    },
    rawText: { notes: r.notes, signoffText: r.signoffText },
    extractedInsight: {
      positiveSummary: r.positiveSummary,
      negativeSummary: r.negativeSummary,
      hasSummary: Boolean(r.positiveSummary || r.negativeSummary),
    },
  }));

  const enrichedCount = insightsPerDeal.filter(
    (x) => x.extractedInsight.hasSummary
  ).length;

  const meta = {
    generatedAt: new Date().toISOString(),
    counts: {
      shows: showsList.length,
      artists: artistsList.length,
      settlementsWithDealContext: insightsPerDeal.length,
      settlementsWithLlmSummary: enrichedCount,
    },
  };

  await Promise.all([
    fs.writeFile(
      path.join(OUT_DIR, "shows.json"),
      JSON.stringify(showsList, null, 2)
    ),
    fs.writeFile(
      path.join(OUT_DIR, "artists.json"),
      JSON.stringify(artistsList, null, 2)
    ),
    fs.writeFile(
      path.join(OUT_DIR, "insights-per-deal.json"),
      JSON.stringify(insightsPerDeal, null, 2)
    ),
    fs.writeFile(
      path.join(OUT_DIR, "_meta.json"),
      JSON.stringify(meta, null, 2)
    ),
  ]);

  console.log("Wrote:", OUT_DIR);
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
