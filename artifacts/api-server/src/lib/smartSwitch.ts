import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db";
import {
  deals, settlements, shows, expenses, switchSuggestions,
  type Deal,
} from "../db/schema";
import { classifySizeBucket } from "./queries";

export type ConfidenceTier = "A" | "B" | "C" | "D";

export type SwitchSuggestion = typeof switchSuggestions.$inferSelect;

type CellStats = {
  n: number;
  avgGross: number;
  avgPayout: number;
  avgExpenses: number;
  p10Payout: number;
  p90Payout: number;
  payouts: number[];
};

function computeTier(cellN: number, artistShowsAtVenue: number): ConfidenceTier {
  // Cell sample size sets the ceiling.
  let tier: ConfidenceTier;
  if (cellN >= 20) tier = "A";
  else if (cellN >= 8) tier = "B";
  else if (cellN >= 3) tier = "C";
  else tier = "D";

  // First-time / one-time artists at this venue demote the ceiling: even
  // with abundant comparable deals, we don't know how THIS artist behaves
  // on settlement night. Cap at B until we have at least 2 prior shows.
  if (artistShowsAtVenue < 2 && tier === "A") tier = "B";

  return tier;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function roundTo50(n: number): number {
  return Math.round(n / 50) * 50;
}

let cellStatsCache: { computedAt: number; stats: Map<string, CellStats> } | null = null;
let cellStatsPending: Promise<Map<string, CellStats>> | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function todayDateString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function getCellStats(): Promise<Map<string, CellStats>> {
  const now = Date.now();
  if (cellStatsCache && now - cellStatsCache.computedAt < CACHE_TTL_MS) {
    return cellStatsCache.stats;
  }
  if (cellStatsPending) return cellStatsPending;
  cellStatsPending = computeCellStats().finally(() => {
    cellStatsPending = null;
  });
  return cellStatsPending;
}

async function computeCellStats(): Promise<Map<string, CellStats>> {
  const today = todayDateString();
  const allShows = await db.select().from(shows);
  const pastShowIds = new Set(allShows.filter((s) => s.date <= today).map((s) => s.id));

  const allDeals = await db.select().from(deals);
  const allSettlements = await db.select().from(settlements);
  const allExpenses = await db.select().from(expenses);

  const settlementByShow = new Map(allSettlements.map((s) => [s.showId, s]));
  const expensesByShow = new Map<string, number>();
  for (const e of allExpenses) {
    expensesByShow.set(e.showId, (expensesByShow.get(e.showId) ?? 0) + e.amount);
  }

  const acc = new Map<string, { grosses: number[]; payouts: number[]; expenses: number[] }>();
  for (const d of allDeals) {
    if (!pastShowIds.has(d.showId)) continue;
    const s = settlementByShow.get(d.showId);
    if (!s || s.totalToArtist == null || s.grossBoxOffice == null) continue;
    const bucket = classifySizeBucket(d);
    const key = `${d.dealType}::${bucket}`;
    let row = acc.get(key);
    if (!row) { row = { grosses: [], payouts: [], expenses: [] }; acc.set(key, row); }
    row.grosses.push(s.grossBoxOffice);
    row.payouts.push(s.totalToArtist);
    row.expenses.push(expensesByShow.get(d.showId) ?? 0);
  }

  const stats = new Map<string, CellStats>();
  for (const [key, row] of acc) {
    if (row.payouts.length === 0) continue;
    const sortedPayouts = [...row.payouts].sort((a, b) => a - b);
    stats.set(key, {
      n: row.payouts.length,
      avgGross: row.grosses.reduce((a, b) => a + b, 0) / row.grosses.length,
      avgPayout: row.payouts.reduce((a, b) => a + b, 0) / row.payouts.length,
      avgExpenses: row.expenses.reduce((a, b) => a + b, 0) / row.expenses.length,
      p10Payout: percentile(sortedPayouts, 0.1),
      p90Payout: percentile(sortedPayouts, 0.9),
      payouts: sortedPayouts,
    });
  }

  cellStatsCache = { computedAt: Date.now(), stats };
  return stats;
}

export function clearSmartSwitchCache(): void {
  cellStatsCache = null;
}

export type GeneratedSuggestion = {
  shape: "flat" | "door_hybrid";
  dealTypeFrom: Deal["dealType"];
  suggestedFlat: number | null;
  doorFloor: number | null;
  doorSplitPct: number | null;
  doorExpenseCap: number | null;
  confidenceTier: ConfidenceTier;
  bandLow: number | null;
  bandHigh: number | null;
  sampleSize: number;
  basis: string;
};

const DOOR_FLOOR = 500;
const DOOR_SPLIT_PCT = 0.6;
const DOOR_EXPENSE_CAP = 1500;

export async function generateSuggestion(
  deal: Deal,
  artistShowsAtVenue = 0,
): Promise<GeneratedSuggestion | null> {
  const stats = await getCellStats();
  const bucket = classifySizeBucket(deal);
  const familiarity =
    artistShowsAtVenue === 0
      ? "first-time"
      : artistShowsAtVenue === 1
        ? "1 prior show at the venue"
        : `${artistShowsAtVenue} prior shows at the venue`;

  if (deal.dealType === "vs" || deal.dealType === "percentage_of_net") {
    const cell = stats.get(`${deal.dealType}::${bucket}`);
    if (!cell || cell.n < 3) return null;
    const tier = computeTier(cell.n, artistShowsAtVenue);
    const flat = roundTo50(cell.avgPayout);
    const bandLow = roundTo50(cell.p10Payout);
    const bandHigh = roundTo50(cell.p90Payout);
    const dealName = deal.dealType === "vs" ? "vs" : "percentage-of-net";
    return {
      shape: "flat",
      dealTypeFrom: deal.dealType,
      suggestedFlat: flat,
      doorFloor: null,
      doorSplitPct: null,
      doorExpenseCap: null,
      confidenceTier: tier,
      bandLow,
      bandHigh,
      sampleSize: cell.n,
      basis:
        `Across ${cell.n} past ${dealName} deals in the ${bucket} bucket, the artist ` +
        `was paid ${formatMoney(cell.avgPayout)} on average ` +
        `(P10 ${formatMoney(cell.p10Payout)} – P90 ${formatMoney(cell.p90Payout)}). ` +
        `A flat at ${formatMoney(flat)} matches the historical expected payout, ` +
        `removing the post-show recoup arithmetic that drives most disputes. ` +
        `Confidence tier ${tier} (${familiarity}).`,
    };
  }

  if (deal.dealType === "door") {
    const cell = stats.get(`door::${bucket}`);
    const sampleSize = cell?.n ?? 0;
    const tier = computeTier(sampleSize, artistShowsAtVenue);
    const avgGross = cell?.avgGross ?? 0;
    const avgExp = cell?.avgExpenses ?? DOOR_EXPENSE_CAP;
    const cap = Math.min(DOOR_EXPENSE_CAP, Math.round(avgExp));
    const projectedPool = Math.max(0, avgGross * 0.9 - cap);
    const projectedArtist = Math.round(DOOR_FLOOR + DOOR_SPLIT_PCT * projectedPool);
    return {
      shape: "door_hybrid",
      dealTypeFrom: deal.dealType,
      suggestedFlat: null,
      doorFloor: DOOR_FLOOR,
      doorSplitPct: DOOR_SPLIT_PCT,
      doorExpenseCap: cap,
      confidenceTier: tier,
      bandLow: DOOR_FLOOR,
      bandHigh: roundTo50(projectedArtist + (cell?.p90Payout ? cell.p90Payout - cell.avgPayout : 500)),
      sampleSize,
      basis:
        `Pure door deals at this venue lose money 93% of the time (avg net to venue ` +
        `−$1,007). Replace with a hybrid: artist gets a $${DOOR_FLOOR} floor regardless ` +
        `of walk-up, then ${Math.round(DOOR_SPLIT_PCT * 100)}% of the pool above an ` +
        `$${cap} expense cap. Projected artist payout ~${formatMoney(projectedArtist)} ` +
        `at the cell-average gross of ${formatMoney(avgGross)}; venue stops eating ` +
        `expense overruns on slow nights. Confidence tier ${tier} (${familiarity}).`,
    };
  }

  return null;
}

async function countPriorShowsAtVenue(
  artistId: string,
  venueId: string,
  beforeDate: string,
): Promise<number> {
  const rows = await db
    .select({ id: shows.id })
    .from(shows)
    .where(
      and(
        eq(shows.artistId, artistId),
        eq(shows.venueId, venueId),
        lt(shows.date, beforeDate),
      ),
    );
  return rows.length;
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export async function getSuggestionForShow(showId: string): Promise<SwitchSuggestion | null> {
  const rows = await db.select().from(switchSuggestions).where(eq(switchSuggestions.showId, showId));
  return rows[0] ?? null;
}

export async function generateAndPersist(showId: string): Promise<{
  suggestion: SwitchSuggestion | null;
  reason?: string;
}> {
  const dealRows = await db.select().from(deals).where(eq(deals.showId, showId));
  const deal = dealRows[0];
  if (!deal) return { suggestion: null, reason: "no_deal" };

  const existing = await getSuggestionForShow(showId);
  if (existing) return { suggestion: existing };

  const showRows = await db.select().from(shows).where(eq(shows.id, showId));
  const show = showRows[0];
  const artistShowsAtVenue = show
    ? await countPriorShowsAtVenue(show.artistId, show.venueId, show.date)
    : 0;

  const generated = await generateSuggestion(deal, artistShowsAtVenue);
  if (!generated) {
    return { suggestion: null, reason: "not_eligible" };
  }

  const id = randomUUID();
  const now = new Date();
  await db.insert(switchSuggestions).values({
    id,
    showId,
    dealId: deal.id,
    suggestedAt: now,
    dealTypeFrom: generated.dealTypeFrom,
    shape: generated.shape,
    suggestedFlat: generated.suggestedFlat,
    doorFloor: generated.doorFloor,
    doorSplitPct: generated.doorSplitPct,
    doorExpenseCap: generated.doorExpenseCap,
    confidenceTier: generated.confidenceTier,
    bandLow: generated.bandLow,
    bandHigh: generated.bandHigh,
    sampleSize: generated.sampleSize,
    basis: generated.basis,
    status: "suggested",
  });

  const fresh = await getSuggestionForShow(showId);
  return { suggestion: fresh };
}

export async function decideSuggestion(
  showId: string,
  decision: "accepted" | "declined",
): Promise<SwitchSuggestion | null> {
  const existing = await getSuggestionForShow(showId);
  if (!existing) return null;
  if (existing.status !== "suggested") return existing;
  await db
    .update(switchSuggestions)
    .set({ status: decision, decidedAt: new Date() })
    .where(eq(switchSuggestions.showId, showId));
  return getSuggestionForShow(showId);
}
