import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { shows, artists, deals, settlements, type Deal } from "../db/schema";
import { generateGuarantee, type ConfidenceTier } from "./smartGuarantee";

export type Direction = "money_protected" | "money_overpaid" | "even";

export type BacktestSteps = {
  step1_expectedGross: { value: number; source: string; sampleSize: number };
  step2_ticketingFees: { rate: number; value: number };
  step3_netAfterFees: number;
  step4_expense: {
    raw: number;
    source: string;
    sampleSize: number;
    defaultCap: number;
    dealExpenseCap: number | null;
    effectiveCap: number;
    cappedValue: number;
  };
  step5_netBase: number;
  step6_percentagePayout: { pct: number; basis: number; value: number };
  step7_winner: {
    winner: "guarantee" | "percentage" | "tie";
    winnerValue: number;
    suggestedPrice: number;
    breakevenGross: number;
  };
};

export type GuaranteeBacktestItem = {
  showId: string;
  date: string;
  artistName: string | null;
  dealType: Deal["dealType"];
  agentGuarantee: number;
  actualToArtist: number;
  grossBoxOffice: number;
  sgpSuggestedPrice: number;
  deltaSgpVsActual: number;
  deltaSgpVsAgent: number;
  absDeltaActual: number;
  direction: Direction;
  confidenceTier: ConfidenceTier;
  insuranceTier: number;
  basis: string;
  steps: BacktestSteps;
};

export type GuaranteeBacktestPayload = {
  generatedAt: string;
  windowMonths: number;
  totalCandidates: number;
  totalScored: number;
  moneyProtected: number;
  moneyOverpaid: number;
  netDelta: number;
  items: GuaranteeBacktestItem[];
};

const SETTLED_STATUSES = new Set(["signed", "finalized", "paid", "disputed"]);
const NON_FLAT: Deal["dealType"][] = [
  "vs",
  "percentage_of_net",
  "door",
  "percentage_of_gross",
];

function todayDateString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function monthsAgoString(months: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export async function getGuaranteeBacktest(
  opts: { months?: number; topN?: number } = {},
): Promise<GuaranteeBacktestPayload> {
  const months = opts.months ?? 12;
  const topN = opts.topN ?? 10;
  const today = todayDateString();
  const since = monthsAgoString(months);

  const rows = await db
    .select({
      show: shows,
      artist: artists,
      deal: deals,
      settlement: settlements,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .where(and(gte(shows.date, since), lte(shows.date, today)));

  const candidates = rows.filter((r) => {
    if (!r.deal || !r.settlement) return false;
    if (r.settlement.totalToArtist == null) return false;
    if (!SETTLED_STATUSES.has(r.settlement.status)) return false;
    return (NON_FLAT as readonly string[]).includes(r.deal.dealType);
  });

  const items: GuaranteeBacktestItem[] = [];
  for (const r of candidates) {
    const out = await generateGuarantee(r.show.id, { allowPast: true });
    if (!out.suggestion) continue;
    const s = out.suggestion;
    const audit = JSON.parse(s.auditJson) as BacktestSteps;
    const actualToArtist = Math.round(r.settlement!.totalToArtist!);
    const agentGuarantee = Math.round(s.agentGuarantee ?? 0);
    const sgp = Math.round(s.suggestedPrice);
    const deltaSgpVsActual = sgp - actualToArtist;
    const deltaSgpVsAgent = sgp - agentGuarantee;
    const absDeltaActual = Math.abs(deltaSgpVsActual);
    const direction: Direction =
      deltaSgpVsActual < 0
        ? "money_protected"
        : deltaSgpVsActual > 0
          ? "money_overpaid"
          : "even";

    items.push({
      showId: r.show.id,
      date: r.show.date,
      artistName: r.artist?.name ?? null,
      dealType: r.deal!.dealType,
      agentGuarantee,
      actualToArtist,
      grossBoxOffice: Math.round(r.settlement!.grossBoxOffice ?? 0),
      sgpSuggestedPrice: sgp,
      deltaSgpVsActual,
      deltaSgpVsAgent,
      absDeltaActual,
      direction,
      confidenceTier: s.confidenceTier,
      insuranceTier: s.insuranceTier,
      basis: s.basis,
      steps: audit,
    });
  }

  // Aggregate across the FULL scored set (not just the top N).
  let moneyProtected = 0;
  let moneyOverpaid = 0;
  for (const it of items) {
    if (it.deltaSgpVsActual < 0) moneyProtected += -it.deltaSgpVsActual;
    else if (it.deltaSgpVsActual > 0) moneyOverpaid += it.deltaSgpVsActual;
  }

  // Sort by absolute SGP-vs-actual divergence descending, keep top N.
  items.sort((a, b) => b.absDeltaActual - a.absDeltaActual);
  const trimmed = items.slice(0, topN);

  return {
    generatedAt: new Date().toISOString(),
    windowMonths: months,
    totalCandidates: candidates.length,
    totalScored: items.length,
    moneyProtected: Math.round(moneyProtected),
    moneyOverpaid: Math.round(moneyOverpaid),
    netDelta: Math.round(moneyProtected - moneyOverpaid),
    items: trimmed,
  };
}
