import { db } from "../db";
import {
  shows, artists, agents, agencies, deals, ticketSales, comps, expenses,
  settlements, venues, type Recoup,
} from "../db/schema";
import { desc, asc, eq, sql, lte } from "drizzle-orm";

function todayDateString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

const UNSUPPORTED_DEAL_TYPES = new Set(["percentage_of_net", "vs", "door"]);

export function parseRecoups(recoupsJson: string | null): Recoup[] {
  if (!recoupsJson) return [];
  try {
    const parsed = JSON.parse(recoupsJson);
    return Array.isArray(parsed) ? (parsed as Recoup[]) : [];
  } catch {
    return [];
  }
}

export function isUnsupportedDeal(
  deal: typeof deals.$inferSelect | null,
): boolean {
  return !!deal && UNSUPPORTED_DEAL_TYPES.has(deal.dealType);
}

export function isDisputedSettlement(
  settlement: typeof settlements.$inferSelect | null,
): boolean {
  if (!settlement) return false;
  if (settlement.status === "disputed") return true;
  return parseRecoups(settlement.recoupsJson).some(
    (r) => r?.status === "disputed",
  );
}

export async function getAllShows() {
  const rows = await db
    .select({
      show: shows, artist: artists, agent: agents, deal: deals, settlement: settlements,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .where(lte(shows.date, todayDateString()))
    .orderBy(asc(shows.date));

  return rows.map((r) => ({
    ...r,
    isUnsupportedDeal: isUnsupportedDeal(r.deal),
    isDisputed: isDisputedSettlement(r.settlement),
  }));
}

export async function getShowById(id: string) {
  const rows = await db
    .select({
      show: shows, artist: artists, agent: agents, agency: agencies,
      deal: deals, settlement: settlements, venue: venues,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(agencies, eq(agents.agencyId, agencies.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .leftJoin(venues, eq(shows.venueId, venues.id))
    .where(eq(shows.id, id));

  if (rows.length === 0) return null;
  const row = rows[0];

  const [showTicketSales, showExpenses, showComps] = await Promise.all([
    db.select().from(ticketSales).where(eq(ticketSales.showId, id))
      .orderBy(desc(ticketSales.capturedAt)),
    db.select().from(expenses).where(eq(expenses.showId, id))
      .orderBy(asc(expenses.enteredAt)),
    db.select().from(comps).where(eq(comps.showId, id)),
  ]);

  const recoups = parseRecoups(row.settlement?.recoupsJson ?? null);

  return {
    ...row,
    ticketSales: showTicketSales,
    expenses: showExpenses,
    comps: showComps,
    recoups,
    isUnsupportedDeal: isUnsupportedDeal(row.deal),
    isDisputed: isDisputedSettlement(row.settlement),
  };
}

export async function getAllArtists() {
  return db
    .select({
      artist: artists, agent: agents, agency: agencies,
      showCount: sql<number>`count(${shows.id})`.as("show_count"),
      lastShowDate: sql<string | null>`max(${shows.date})`.as("last_show_date"),
    })
    .from(artists)
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(agencies, eq(agents.agencyId, agencies.id))
    .leftJoin(shows, eq(shows.artistId, artists.id))
    .groupBy(artists.id, agents.id, agencies.id)
    .orderBy(desc(sql`count(${shows.id})`), asc(artists.name));
}

type ComplexityBucket = "simple" | "medium" | "complex";

function classifyComplexity(d: typeof deals.$inferSelect): ComplexityBucket {
  const hasBonuses = !!d.bonusesJson && d.bonusesJson !== "[]" && d.bonusesJson !== "null";
  const hasNotes = !!d.dealNotesFreetext && d.dealNotesFreetext.trim().length > 0;
  if (
    d.dealType === "vs" ||
    d.dealType === "door" ||
    d.dealType === "percentage_of_net" ||
    hasBonuses ||
    hasNotes
  ) {
    return "complex";
  }
  if (
    d.dealType === "percentage_of_gross" ||
    d.expenseCap != null ||
    d.hospitalityCap != null
  ) {
    return "medium";
  }
  return "simple";
}

function classifySizeBucket(d: typeof deals.$inferSelect): string {
  if (d.guaranteeAmount == null || d.guaranteeAmount === 0) {
    if (d.percentage != null) return "Uncapped %";
    return "$0–1K";
  }
  const g = d.guaranteeAmount;
  if (g < 1000) return "$0–1K";
  if (g < 5000) return "$1–5K";
  if (g < 15000) return "$5–15K";
  return "$15K+";
}

const SIZE_ORDER = ["$0–1K", "$1–5K", "$5–15K", "$15K+", "Uncapped %"];

export async function getDealAnalysis() {
  const today = todayDateString();
  const allShowsRows = await db.select().from(shows);
  const pastShowIds = new Set(
    allShowsRows.filter((s) => s.date <= today).map((s) => s.id),
  );
  const showDateById = new Map(allShowsRows.map((s) => [s.id, s.date]));

  const allDealsRows = await db.select().from(deals);
  const pastDeals = allDealsRows.filter((d) => pastShowIds.has(d.showId));
  const allSettlementsRows = await db.select().from(settlements);
  const pastSettlements = allSettlementsRows.filter((s) =>
    pastShowIds.has(s.showId),
  );
  const settlementByShowId = new Map(
    pastSettlements.map((s) => [s.showId, s]),
  );
  const allExpensesRows = await db.select().from(expenses);
  const pastExpenses = allExpensesRows.filter((e) => pastShowIds.has(e.showId));

  const supportedTypes = new Set(["flat", "percentage_of_gross"]);
  const totalDeals = pastDeals.length;

  const complexityAcc: Record<
    ComplexityBucket,
    { count: number; payoutSum: number; payoutN: number; inTool: number; spreadsheet: number }
  > = {
    simple: { count: 0, payoutSum: 0, payoutN: 0, inTool: 0, spreadsheet: 0 },
    medium: { count: 0, payoutSum: 0, payoutN: 0, inTool: 0, spreadsheet: 0 },
    complex: { count: 0, payoutSum: 0, payoutN: 0, inTool: 0, spreadsheet: 0 },
  };

  const sizeAcc: Record<
    string,
    { count: number; grossSum: number; grossN: number; artistSum: number; artistN: number; disputed: number; settledN: number }
  > = {};
  for (const k of SIZE_ORDER) {
    sizeAcc[k] = { count: 0, grossSum: 0, grossN: 0, artistSum: 0, artistN: 0, disputed: 0, settledN: 0 };
  }

  for (const d of pastDeals) {
    const c = classifyComplexity(d);
    const s = settlementByShowId.get(d.showId);
    complexityAcc[c].count++;
    if (supportedTypes.has(d.dealType)) complexityAcc[c].inTool++;
    else complexityAcc[c].spreadsheet++;
    if (s?.totalToArtist != null) {
      complexityAcc[c].payoutSum += s.totalToArtist;
      complexityAcc[c].payoutN++;
    }

    const bucket = classifySizeBucket(d);
    sizeAcc[bucket].count++;
    if (s) {
      sizeAcc[bucket].settledN++;
      if (isDisputedSettlement(s)) sizeAcc[bucket].disputed++;
      if (s.grossBoxOffice != null) {
        sizeAcc[bucket].grossSum += s.grossBoxOffice;
        sizeAcc[bucket].grossN++;
      }
      if (s.totalToArtist != null) {
        sizeAcc[bucket].artistSum += s.totalToArtist;
        sizeAcc[bucket].artistN++;
      }
    }
  }

  const byComplexity = (Object.keys(complexityAcc) as ComplexityBucket[]).map((k) => {
    const a = complexityAcc[k];
    return {
      bucket: k,
      count: a.count,
      pct: totalDeals > 0 ? a.count / totalDeals : 0,
      avgPayout: a.payoutN > 0 ? a.payoutSum / a.payoutN : 0,
      inToolCount: a.inTool,
      spreadsheetCount: a.spreadsheet,
    };
  });

  const bySize = SIZE_ORDER.map((bucket) => {
    const a = sizeAcc[bucket];
    return {
      bucket,
      count: a.count,
      pct: totalDeals > 0 ? a.count / totalDeals : 0,
      avgGross: a.grossN > 0 ? a.grossSum / a.grossN : 0,
      avgToArtist: a.artistN > 0 ? a.artistSum / a.artistN : 0,
      disputeRate: a.settledN > 0 ? a.disputed / a.settledN : 0,
    };
  });

  // Costs
  const expensesByCategory: Record<string, number> = {};
  let totalExpenses = 0;
  for (const e of pastExpenses) {
    expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amount;
    totalExpenses += e.amount;
  }

  const recoupsByCategory: Record<string, { amount: number; disputedAmount: number }> = {};
  let totalRecoups = 0;
  let disputedRecoupValue = 0;
  for (const s of pastSettlements) {
    for (const r of parseRecoups(s.recoupsJson)) {
      const slot = recoupsByCategory[r.category] ?? { amount: 0, disputedAmount: 0 };
      slot.amount += r.amount;
      if (r.status === "disputed") slot.disputedAmount += r.amount;
      recoupsByCategory[r.category] = slot;
      totalRecoups += r.amount;
      if (r.status === "disputed") disputedRecoupValue += r.amount;
    }
  }

  // Revenue by deal type
  const dealTypeByShowId = new Map(pastDeals.map((d) => [d.showId, d.dealType]));
  const expensesByShowId: Map<string, number> = new Map();
  for (const e of pastExpenses) {
    expensesByShowId.set(e.showId, (expensesByShowId.get(e.showId) ?? 0) + e.amount);
  }

  type RevAcc = { gross: number; netToVenue: number; toArtist: number; count: number };
  const byDealType: Record<string, RevAcc> = {};
  const monthAcc: Map<string, { gross: number; netToVenue: number; toArtist: number; byType: Record<string, number> }> = new Map();

  // last 24 months window
  const now = new Date();
  const horizon = new Date(now.getFullYear(), now.getMonth() - 23, 1);

  for (const s of pastSettlements) {
    const dealType = dealTypeByShowId.get(s.showId);
    if (!dealType) continue;
    const date = showDateById.get(s.showId);
    if (!date) continue;
    const showDate = new Date(date);
    if (showDate < horizon) continue;

    const gross = s.grossBoxOffice ?? 0;
    const toArtist = s.totalToArtist ?? 0;
    const exp = expensesByShowId.get(s.showId) ?? 0;
    const netToVenue = gross - toArtist - exp;

    if (!byDealType[dealType]) byDealType[dealType] = { gross: 0, netToVenue: 0, toArtist: 0, count: 0 };
    const dt = byDealType[dealType];
    dt.gross += gross;
    dt.netToVenue += netToVenue;
    dt.toArtist += toArtist;
    dt.count++;

    const monthKey = `${showDate.getFullYear()}-${String(showDate.getMonth() + 1).padStart(2, "0")}`;
    if (!monthAcc.has(monthKey)) {
      monthAcc.set(monthKey, { gross: 0, netToVenue: 0, toArtist: 0, byType: {} });
    }
    const m = monthAcc.get(monthKey)!;
    m.gross += gross;
    m.netToVenue += netToVenue;
    m.toArtist += toArtist;
    m.byType[dealType] = (m.byType[dealType] ?? 0) + gross;
  }

  // build full month list (last 24)
  const months: { month: string; label: string; gross: number; netToVenue: number; toArtist: number; byType: Record<string, number> }[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    const m = monthAcc.get(key) ?? { gross: 0, netToVenue: 0, toArtist: 0, byType: {} };
    months.push({ month: key, label, ...m });
  }

  return {
    totalDeals,
    byComplexity,
    bySize,
    costs: {
      totalExpenses,
      expensesByCategory,
      totalRecoups,
      disputedRecoupValue,
      recoupsByCategory,
    },
    revenue: {
      byDealType,
      months,
    },
  };
}

export async function getReports() {
  const today = todayDateString();
  const allShowsRows = await db.select().from(shows);
  const pastShowIds = new Set(
    allShowsRows.filter((s) => s.date <= today).map((s) => s.id),
  );
  const allDealsRows = await db.select().from(deals);
  const pastDeals = allDealsRows.filter((d) => pastShowIds.has(d.showId));
  const allSettlementsRows = await db.select().from(settlements);
  const pastSettlements = allSettlementsRows.filter((s) =>
    pastShowIds.has(s.showId),
  );
  const allCompsRows = await db.select().from(comps);
  const pastComps = allCompsRows.filter((c) => pastShowIds.has(c.showId));

  const dealTypeCounts: Record<string, number> = {};
  for (const d of pastDeals) {
    dealTypeCounts[d.dealType] = (dealTypeCounts[d.dealType] ?? 0) + 1;
  }

  const totalDeals = pastDeals.length;
  const supportedTypes = ["flat", "percentage_of_gross"];
  const supportedCount = pastDeals.filter((d) =>
    supportedTypes.includes(d.dealType),
  ).length;
  const inAppToolUsageRate = totalDeals > 0 ? supportedCount / totalDeals : 0;

  const settlementStatus: Record<string, number> = {};
  for (const s of pastSettlements) {
    settlementStatus[s.status] = (settlementStatus[s.status] ?? 0) + 1;
  }

  const totalSettlements = pastSettlements.length;
  const disputedRate = totalSettlements > 0
    ? (settlementStatus.disputed ?? 0) / totalSettlements : 0;

  const totalGross = pastSettlements.reduce(
    (sum, s) => sum + (s.grossBoxOffice ?? 0), 0);
  const totalToArtists = pastSettlements.reduce(
    (sum, s) => sum + (s.totalToArtist ?? 0), 0);

  const showCount = pastShowIds.size;
  const settledCount = pastShowIds.size;
  const dealsWithBonuses = pastDeals.filter((d) => d.bonusesJson).length;

  let totalRecoupValue = 0;
  let disputedRecoupValue = 0;
  let settlementsWithRecoups = 0;
  for (const s of pastSettlements) {
    if (!s.recoupsJson) continue;
    try {
      const recoups = JSON.parse(s.recoupsJson) as Recoup[];
      if (!Array.isArray(recoups) || recoups.length === 0) continue;
      settlementsWithRecoups++;
      for (const r of recoups) {
        totalRecoupValue += r.amount;
        if (r.status === "disputed") disputedRecoupValue += r.amount;
      }
    } catch {}
  }

  const totalCompTickets = pastComps.reduce((s, c) => s + c.count, 0);
  const totalCompFaceValue = pastComps.reduce(
    (s, c) => s + c.count * c.faceValue, 0);
  const compsByCategory: Record<string, number> = {};
  for (const c of pastComps) {
    compsByCategory[c.category] = (compsByCategory[c.category] ?? 0) + c.count;
  }

  return {
    dealTypeCounts, totalDeals, inAppToolUsageRate,
    settlementStatus, totalSettlements, disputedRate,
    totalGross, totalToArtists, showCount, settledCount,
    dealsWithBonuses, totalRecoupValue, disputedRecoupValue,
    settlementsWithRecoups, totalCompTickets, totalCompFaceValue,
    compsByCategory,
  };
}
