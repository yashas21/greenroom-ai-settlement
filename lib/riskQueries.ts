/**
 * Aggregate parse over all shows. Used by the Wednesday risk view.
 *
 * Note: 24-month seed data is a bounded set, so this runs fast (sub-100ms
 * for ~540 shows). At venue scale (~250 shows/yr) this is trivial. At
 * platform scale (~10K venues) we'd cache by `(deal_id, deal_updated_at)`.
 */

import { db } from "@/db";
import { shows, artists, agents, deals, settlements, ticketSales, expenses } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { parseDeal, type Flag } from "@/lib/dealParser";
import { getAllClarifications } from "@/lib/clarifications";

export type WednesdayRow = {
  showId: string;
  date: string;
  artistName: string;
  agentName: string | null;
  agencyId: string | null;
  dealType: string;
  settlementStatus: string | null;
  openFlags: Flag[];
  highOpenCount: number;
  totalFlagCount: number;
  signoffText: string | null;
  signoffMismatch: boolean; // disputed status + positive sign-off (the brief's breadcrumb)
};

export async function getRiskRows(opts: {
  pastOnly?: boolean;
} = {}): Promise<WednesdayRow[]> {
  const { pastOnly = false } = opts;
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      show: shows,
      artist: artists,
      agent: agents,
      deal: deals,
      settlement: settlements,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .orderBy(asc(shows.date));

  const allClarifications = await getAllClarifications();
  const positiveSignoffPattern =
    /\b(looks\s*good|all\s*good|approved|confirmed|signed|agreed|ok\b|good\s*night)\b/i;

  const results: WednesdayRow[] = [];
  for (const r of rows) {
    if (!r.deal || !r.artist) continue;
    if (pastOnly && r.show.date > today) continue;

    const { flags } = parseDeal(r.deal);
    const openFlags = flags.filter((f) => !allClarifications[f.id]);
    const highOpenCount = openFlags.filter((f) => f.severity === "high").length;

    const signoffText = r.settlement?.signoffText ?? null;
    const signoffMismatch =
      r.settlement?.status === "disputed" &&
      signoffText != null &&
      positiveSignoffPattern.test(signoffText);

    results.push({
      showId: r.show.id,
      date: r.show.date,
      artistName: r.artist.name,
      agentName: r.agent?.name ?? null,
      agencyId: r.agent?.agencyId ?? null,
      dealType: r.deal.dealType,
      settlementStatus: r.settlement?.status ?? null,
      openFlags,
      highOpenCount,
      totalFlagCount: flags.length,
      signoffText,
      signoffMismatch,
    });
  }

  return results;
}

export type RiskSummary = {
  totalShows: number;
  showsWithFlags: number;
  showsWithHighFlags: number;
  totalOpenFlags: number;
  signoffMismatches: number;
  byKind: Record<string, number>;
};

export function summarize(rows: WednesdayRow[]): RiskSummary {
  const summary: RiskSummary = {
    totalShows: rows.length,
    showsWithFlags: 0,
    showsWithHighFlags: 0,
    totalOpenFlags: 0,
    signoffMismatches: 0,
    byKind: {},
  };
  for (const r of rows) {
    if (r.openFlags.length > 0) summary.showsWithFlags++;
    if (r.highOpenCount > 0) summary.showsWithHighFlags++;
    summary.totalOpenFlags += r.openFlags.length;
    if (r.signoffMismatch) summary.signoffMismatches++;
    for (const f of r.openFlags) {
      summary.byKind[f.kind] = (summary.byKind[f.kind] ?? 0) + 1;
    }
  }
  return summary;
}
