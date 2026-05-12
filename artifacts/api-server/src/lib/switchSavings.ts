import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import {
  shows, artists, deals, settlements, expenses, type Deal,
} from "../db/schema";
import { parseRecoups } from "./queries";
import { generateSuggestion, type ConfidenceTier } from "./smartSwitch";

export type SavingsItem = {
  showId: string;
  date: string;
  artistName: string | null;
  dealType: Deal["dealType"];
  switchShape: "flat" | "door_hybrid";
  confidenceTier: ConfidenceTier;
  actualToArtist: number;
  counterfactualToArtist: number;
  moneySavedToVenue: number;
  estimatedMinutesSpent: number;
  estimatedMinutesUnderSwitch: number;
  minutesSaved: number;
  hadDispute: boolean;
  disputedRecoupCount: number;
  notesParagraphs: number;
  signoffParagraphs: number;
  totalRecoups: number;
  grossBoxOffice: number;
  totalExpenses: number;
  breakdown: {
    actual: {
      gross: number;
      expenses: number;
      recoupTotal: number;
      recoupLines: { label: string; amount: number; status: string }[];
      payout: number;
      settlementStatus: string;
    };
    counterfactual: {
      shape: "flat" | "door_hybrid";
      flat: number | null;
      doorFloor: number | null;
      doorSplitPct: number | null;
      doorExpenseCap: number | null;
      projectedPayout: number;
      basis: string;
    };
    timeSavedRationale: string;
    moneyRationale: string;
  };
};

export type SavingsPayload = {
  generatedAt: string;
  windowMonths: number;
  totalCandidates: number;
  totalMoneySavedToVenue: number;
  totalMinutesSaved: number;
  items: SavingsItem[];
};

const MINUTES = {
  base: 30,            // baseline settlement-night work for any deal
  perDisputedRecoup: 25,
  perParagraph: 5,     // back-and-forth scaled by notes/signoff verbosity
  disputeStatusBonus: 60,
  switchFlat: 10,      // smart switch flat handshake
  switchDoor: 15,      // door hybrid: still need door count + cap arithmetic
};

function paragraphCount(text: string | null): number {
  if (!text) return 0;
  const blocks = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return blocks.length;
}

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

const SETTLED_STATUSES = new Set(["signed", "finalized", "paid", "disputed"]);

async function buildPriorShowIndex(): Promise<Map<string, string[]>> {
  // One pass over `shows`. Index by `${artistId}::${venueId}` → sorted ascending dates.
  const rows = await db.select().from(shows);
  const idx = new Map<string, string[]>();
  for (const s of rows) {
    const k = `${s.artistId}::${s.venueId}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k)!.push(s.date);
  }
  for (const arr of idx.values()) arr.sort();
  return idx;
}

function countPriorBefore(dates: string[] | undefined, beforeDate: string): number {
  if (!dates) return 0;
  // Binary search for the first date >= beforeDate.
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid] < beforeDate) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export async function getSwitchSavings(opts: { months?: number; topN?: number } = {}): Promise<SavingsPayload> {
  const months = opts.months ?? 3;
  const topN = opts.topN ?? 10;
  const today = todayDateString();
  const since = monthsAgoString(months);

  const rows = await db
    .select({ show: shows, artist: artists, deal: deals, settlement: settlements })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .where(and(gte(shows.date, since), lte(shows.date, today)));

  const candidates = rows.filter((r) => {
    if (!r.deal || !r.settlement) return false;
    if (r.settlement.totalToArtist == null || r.settlement.grossBoxOffice == null) return false;
    if (!SETTLED_STATUSES.has(r.settlement.status)) return false;
    return r.deal.dealType === "vs" || r.deal.dealType === "percentage_of_net" || r.deal.dealType === "door";
  });

  // Pre-fetch expenses + prior-show index in parallel (no per-candidate queries).
  const [allExpenses, priorIndex] = await Promise.all([
    db.select().from(expenses),
    buildPriorShowIndex(),
  ]);
  const expByShow = new Map<string, number>();
  for (const e of allExpenses) {
    expByShow.set(e.showId, (expByShow.get(e.showId) ?? 0) + e.amount);
  }

  const items: SavingsItem[] = [];
  for (const r of candidates) {
    const deal = r.deal!;
    const settlement = r.settlement!;
    const show = r.show;
    const artistN = countPriorBefore(
      priorIndex.get(`${show.artistId}::${show.venueId}`),
      show.date,
    );
    const generated = await generateSuggestion(deal, artistN);
    if (!generated) continue;

    const actualPayout = settlement.totalToArtist!;
    const gross = settlement.grossBoxOffice!;
    const totalExp = expByShow.get(show.id) ?? settlement.totalExpenses ?? 0;
    const recoups = parseRecoups(settlement.recoupsJson);
    const recoupTotal = recoups.reduce((a, b) => a + (b.amount ?? 0), 0);
    const disputedRecoupCount = recoups.filter((x) => x.status === "disputed").length;
    const hadDispute = settlement.status === "disputed" || disputedRecoupCount > 0;

    let counterfactual: number;
    if (generated.shape === "flat") {
      counterfactual = generated.suggestedFlat ?? 0;
    } else {
      const cap = generated.doorExpenseCap ?? 1500;
      const pool = Math.max(0, gross * 0.9 - cap);
      counterfactual = Math.round((generated.doorFloor ?? 0) + (generated.doorSplitPct ?? 0) * pool);
    }

    const notesP = paragraphCount(settlement.notes);
    const signoffP = paragraphCount(settlement.signoffText);
    const minutesSpent =
      MINUTES.base +
      disputedRecoupCount * MINUTES.perDisputedRecoup +
      (notesP + signoffP) * MINUTES.perParagraph +
      (settlement.status === "disputed" ? MINUTES.disputeStatusBonus : 0);
    const minutesUnderSwitch =
      generated.shape === "flat" ? MINUTES.switchFlat : MINUTES.switchDoor;
    const minutesSaved = Math.max(0, minutesSpent - minutesUnderSwitch);

    const moneySaved = Math.round(actualPayout - counterfactual);

    const moneyRationale = `Venue actually paid the artist $${Math.round(actualPayout).toLocaleString()} after applying ${recoups.length} recoup line${recoups.length === 1 ? "" : "s"} (${disputedRecoupCount} disputed, total $${Math.round(recoupTotal).toLocaleString()}) against $${Math.round(gross).toLocaleString()} gross. Smart Switch ${generated.shape === "flat" ? `flat at $${(generated.suggestedFlat ?? 0).toLocaleString()}` : `hybrid ($${generated.doorFloor} floor + ${Math.round((generated.doorSplitPct ?? 0) * 100)}% above $${generated.doorExpenseCap})`} would have settled at $${counterfactual.toLocaleString()} — a ${moneySaved >= 0 ? "saving" : "premium"} of $${Math.abs(moneySaved).toLocaleString()} for the venue.`;

    const timeSavedRationale = `Estimated ~${minutesSpent} min of settlement-night work: ${MINUTES.base} min baseline + ${disputedRecoupCount} disputed recoup${disputedRecoupCount === 1 ? "" : "s"} × ${MINUTES.perDisputedRecoup} min + ${notesP + signoffP} paragraph${notesP + signoffP === 1 ? "" : "s"} of notes/sign-off thread × ${MINUTES.perParagraph} min${settlement.status === "disputed" ? ` + ${MINUTES.disputeStatusBonus} min for the formal dispute` : ""}. Smart Switch ${generated.shape === "flat" ? "flat" : "hybrid"} replaces this with a ~${minutesUnderSwitch}-min ${generated.shape === "flat" ? "handshake — no recoup arithmetic" : "door count and cap check"}.`;

    items.push({
      showId: show.id,
      date: show.date,
      artistName: r.artist?.name ?? null,
      dealType: deal.dealType,
      switchShape: generated.shape,
      confidenceTier: generated.confidenceTier,
      actualToArtist: Math.round(actualPayout),
      counterfactualToArtist: counterfactual,
      moneySavedToVenue: moneySaved,
      estimatedMinutesSpent: minutesSpent,
      estimatedMinutesUnderSwitch: minutesUnderSwitch,
      minutesSaved,
      hadDispute,
      disputedRecoupCount,
      notesParagraphs: notesP,
      signoffParagraphs: signoffP,
      totalRecoups: recoups.length,
      grossBoxOffice: Math.round(gross),
      totalExpenses: Math.round(totalExp),
      breakdown: {
        actual: {
          gross: Math.round(gross),
          expenses: Math.round(totalExp),
          recoupTotal: Math.round(recoupTotal),
          recoupLines: recoups.map((rc) => ({
            label: rc.label,
            amount: Math.round(rc.amount ?? 0),
            status: rc.status,
          })),
          payout: Math.round(actualPayout),
          settlementStatus: settlement.status,
        },
        counterfactual: {
          shape: generated.shape,
          flat: generated.suggestedFlat,
          doorFloor: generated.doorFloor,
          doorSplitPct: generated.doorSplitPct,
          doorExpenseCap: generated.doorExpenseCap,
          projectedPayout: counterfactual,
          basis: generated.basis,
        },
        timeSavedRationale,
        moneyRationale,
      },
    });
  }

  // Sort by money saved desc, then by time saved desc, keep top N
  items.sort((a, b) => b.moneySavedToVenue - a.moneySavedToVenue || b.minutesSaved - a.minutesSaved);
  const trimmed = items.slice(0, topN);

  const totalMoney = trimmed.reduce((a, b) => a + b.moneySavedToVenue, 0);
  const totalMinutes = trimmed.reduce((a, b) => a + b.minutesSaved, 0);

  return {
    generatedAt: new Date().toISOString(),
    windowMonths: months,
    totalCandidates: items.length,
    totalMoneySavedToVenue: totalMoney,
    totalMinutesSaved: totalMinutes,
    items: trimmed,
  };
}
