import { db } from "../db";
import {
  deals,
  shows,
  settlements,
  expenses,
  type Deal,
} from "../db/schema";
import { and, eq, lte } from "drizzle-orm";
import { generateAndPersistGuarantee, getGuaranteeForShow } from "./smartGuarantee";

const DEFAULT_EXPENSE_CAP_BY_BUCKET: Record<string, number> = {
  "$0–1K": 800,
  "$1–5K": 1500,
  "$5–15K": 3500,
  "$15K+": 7500,
  "Uncapped %": 1500,
};

const DEFAULT_HOSPITALITY_CAP_BY_BUCKET: Record<string, number> = {
  "$0–1K": 250,
  "$1–5K": 500,
  "$5–15K": 1000,
  "$15K+": 2000,
  "Uncapped %": 500,
};

export type ImprovementKind =
  | "add_expense_cap"
  | "add_hospitality_cap"
  | "convert_to_flat";

export type ImprovementRiskFor = "booker" | "artist" | "both";

export interface DealImprovement {
  kind: ImprovementKind;
  title: string;
  rationale: string;
  currentValue: string;
  proposedValue: string;
  proposedNumber: number | null;
  protects: ImprovementRiskFor;
  simplifies: boolean;
}

export interface ImprovementsContextStats {
  bucket: string;
  dealType: string;
  comparableSettlements: number;
  comparableDisputes: number;
  disputeRate: number;
  medianExpenses: number | null;
  medianHospitalityOverage: number | null;
}

export interface DealImprovementsPayload {
  showId: string;
  dealId: string | null;
  improvements: DealImprovement[];
  context: ImprovementsContextStats;
}

function classifyBucket(deal: Deal): string {
  if (deal.percentage != null && (deal.guaranteeAmount == null || deal.guaranteeAmount === 0)) {
    return "Uncapped %";
  }
  const g = deal.guaranteeAmount ?? 0;
  if (g < 1000) return "$0–1K";
  if (g < 5000) return "$1–5K";
  if (g < 15000) return "$5–15K";
  return "$15K+";
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function loadComparables(deal: Deal, bucket: string) {
  const today = todayISO();
  const [allShows, allDeals, allSettlements, allExpenses] = await Promise.all([
    db.select().from(shows).where(lte(shows.date, today)),
    db.select().from(deals),
    db.select().from(settlements),
    db.select().from(expenses),
  ]);

  const dealByShow = new Map(allDeals.map((d) => [d.showId, d]));
  const expensesByShow = new Map<string, typeof allExpenses>();
  for (const e of allExpenses) {
    const arr = expensesByShow.get(e.showId) ?? [];
    arr.push(e);
    expensesByShow.set(e.showId, arr);
  }

  const matchingShowIds = new Set<string>();
  for (const s of allShows) {
    const d = dealByShow.get(s.id);
    if (!d) continue;
    if (d.dealType !== deal.dealType) continue;
    if (classifyBucket(d) !== bucket) continue;
    matchingShowIds.add(s.id);
  }

  let disputed = 0;
  let settledN = 0;
  for (const s of allSettlements) {
    if (!matchingShowIds.has(s.showId)) continue;
    settledN++;
    let isDisputed = s.status === "disputed";
    if (!isDisputed) {
      try {
        const recs = JSON.parse(s.recoupsJson ?? "[]") as Array<{ status?: string }>;
        if (recs.some((r) => r.status === "disputed")) isDisputed = true;
      } catch { /* noop */ }
    }
    if (isDisputed) disputed++;
  }

  const expenseTotalsPerShow: number[] = [];
  const hospOveragePerShow: number[] = [];
  for (const showId of matchingShowIds) {
    const exs = expensesByShow.get(showId) ?? [];
    const billed = exs.filter((e) => !e.absorbedByVenue);
    if (billed.length > 0) {
      expenseTotalsPerShow.push(billed.reduce((sum, e) => sum + e.amount, 0));
    }
    const hosp = billed.filter((e) => e.category === "hospitality");
    if (hosp.length > 0) {
      hospOveragePerShow.push(hosp.reduce((sum, e) => sum + e.amount, 0));
    }
  }

  return {
    comparableSettlements: settledN,
    comparableDisputes: disputed,
    disputeRate: settledN > 0 ? disputed / settledN : 0,
    medianExpenses: median(expenseTotalsPerShow),
    medianHospitalityOverage: median(hospOveragePerShow),
  };
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}

function pctText(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export async function getDealImprovements(showId: string): Promise<DealImprovementsPayload> {
  const [showRow] = await db.select().from(shows).where(eq(shows.id, showId));
  if (!showRow) throw new Error("show_not_found");
  const [dealRow] = await db.select().from(deals).where(eq(deals.showId, showId));
  if (!dealRow) {
    return {
      showId,
      dealId: null,
      improvements: [],
      context: {
        bucket: "—",
        dealType: "—",
        comparableSettlements: 0,
        comparableDisputes: 0,
        disputeRate: 0,
        medianExpenses: null,
        medianHospitalityOverage: null,
      },
    };
  }

  const bucket = classifyBucket(dealRow);
  const ctx = await loadComparables(dealRow, bucket);

  // Make sure there's a fresh SGP suggestion to anchor the convert-to-flat improvement.
  let sug = await getGuaranteeForShow(showId);
  if (!sug && dealRow.dealType !== "flat") {
    try {
      const out = await generateAndPersistGuarantee(showId);
      sug = out.suggestion;
    } catch { /* noop */ }
  }

  const improvements: DealImprovement[] = [];

  // 1) Add expense cap if missing — applies to vs / % of net / door (deals where expenses
  //    eat into the artist's percentage payout). Skip for flat & % of gross.
  if (
    dealRow.expenseCap == null &&
    (dealRow.dealType === "vs" || dealRow.dealType === "percentage_of_net" || dealRow.dealType === "door")
  ) {
    const proposed = DEFAULT_EXPENSE_CAP_BY_BUCKET[bucket] ?? 1500;
    const medianCopy = ctx.medianExpenses != null
      ? `Past ${dealRow.dealType.replace(/_/g, " ")} deals in the ${bucket} bucket spent a median of ${fmtMoney(Math.round(ctx.medianExpenses))} on billable expenses (n=${ctx.comparableSettlements}).`
      : `No comparable history yet — the proposed cap matches the venue's bucket default.`;
    improvements.push({
      kind: "add_expense_cap",
      title: `Add a ${fmtMoney(proposed)} expense cap`,
      rationale: `${medianCopy} A written cap stops settlement-time arguments about which line items count.`,
      currentValue: "No cap",
      proposedValue: fmtMoney(proposed),
      proposedNumber: proposed,
      protects: "artist",
      simplifies: true,
    });
  }

  // 2) Add hospitality cap if missing — applies to any non-flat deal.
  if (dealRow.hospitalityCap == null && dealRow.dealType !== "flat") {
    const proposed = DEFAULT_HOSPITALITY_CAP_BY_BUCKET[bucket] ?? 500;
    const medianCopy = ctx.medianHospitalityOverage != null
      ? `Past comparable shows ran a median of ${fmtMoney(Math.round(ctx.medianHospitalityOverage))} in hospitality spend.`
      : `Sets a clear ceiling on rider asks before settlement.`;
    improvements.push({
      kind: "add_hospitality_cap",
      title: `Add a ${fmtMoney(proposed)} hospitality cap`,
      rationale: `${medianCopy} Caps the rider so neither side argues over a $200 deli platter on settlement night.`,
      currentValue: "No cap",
      proposedValue: fmtMoney(proposed),
      proposedNumber: proposed,
      protects: "both",
      simplifies: true,
    });
  }

  // 3) Convert to flat — only for non-flat deals with a high-confidence SGP suggestion.
  //    This is the biggest simplifier: settles in the wizard, no math at the door.
  if (
    dealRow.dealType !== "flat" &&
    sug &&
    (sug.confidenceTier === "A" || sug.confidenceTier === "B")
  ) {
    const disputeCopy = ctx.comparableSettlements >= 3
      ? `${pctText(ctx.disputeRate)} of past ${dealRow.dealType.replace(/_/g, " ")} deals in this bucket ended disputed (n=${ctx.comparableSettlements}).`
      : `Removes settlement-time math entirely.`;
    improvements.push({
      kind: "convert_to_flat",
      title: `Convert to a flat ${fmtMoney(sug.suggestedPrice)} guarantee`,
      rationale: `${disputeCopy} A flat number means both sides know the payout the moment the contract is signed — no settlement disputes, no door-count arguments. Confidence ${sug.confidenceTier} (${sug.artistShowCount} prior show${sug.artistShowCount === 1 ? "" : "s"} with this artist).`,
      currentValue: `${dealRow.dealType.replace(/_/g, " ")} deal`,
      proposedValue: `Flat ${fmtMoney(sug.suggestedPrice)}`,
      proposedNumber: sug.suggestedPrice,
      protects: "both",
      simplifies: true,
    });
  }

  return {
    showId,
    dealId: dealRow.id,
    improvements,
    context: {
      bucket,
      dealType: dealRow.dealType,
      comparableSettlements: ctx.comparableSettlements,
      comparableDisputes: ctx.comparableDisputes,
      disputeRate: ctx.disputeRate,
      medianExpenses: ctx.medianExpenses,
      medianHospitalityOverage: ctx.medianHospitalityOverage,
    },
  };
}

export async function applyDealImprovements(
  showId: string,
  kinds: ImprovementKind[],
): Promise<{ ok: true; appliedKinds: ImprovementKind[]; dealId: string }> {
  const [dealRow] = await db.select().from(deals).where(eq(deals.showId, showId));
  if (!dealRow) throw new Error("no_deal");

  const payload = await getDealImprovements(showId);
  const byKind = new Map(payload.improvements.map((i) => [i.kind, i]));

  const update: Partial<typeof deals.$inferInsert> = {};
  const applied: ImprovementKind[] = [];

  for (const kind of kinds) {
    const imp = byKind.get(kind);
    if (!imp || imp.proposedNumber == null) continue;
    if (kind === "add_expense_cap") {
      update.expenseCap = imp.proposedNumber;
      applied.push(kind);
    } else if (kind === "add_hospitality_cap") {
      update.hospitalityCap = imp.proposedNumber;
      applied.push(kind);
    } else if (kind === "convert_to_flat") {
      update.dealType = "flat";
      update.guaranteeAmount = imp.proposedNumber;
      update.percentage = null;
      update.percentageBasis = null;
      applied.push(kind);
    }
  }

  if (Object.keys(update).length === 0) {
    return { ok: true, appliedKinds: [], dealId: dealRow.id };
  }

  await db.update(deals).set(update).where(eq(deals.id, dealRow.id));
  return { ok: true, appliedKinds: applied, dealId: dealRow.id };
}
