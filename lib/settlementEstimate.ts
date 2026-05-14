/**
 * Settlement payout estimate from live show data (deal, tickets, expenses).
 * Used for the estimate card and booker-facing share view — can extend beyond
 * what calculateSettlement supports for the legacy worksheet.
 */

import type { Deal, Expense, TicketSale } from "@/db/schema";
import {
  calculateSettlement,
  parseBonuses,
  applyDealBonuses,
} from "@/lib/dealMath";

export type EstimateExpenseLine = {
  id: string;
  category: string;
  description: string | null;
  amount: number;
};

export type EstimateConfidence = {
  label: string;
  variant: "brand" | "amber" | "sky";
};

export type SettlementEstimateResult = {
  totalToArtist: number;
  confidence: EstimateConfidence;
  steps: { label: string; value: number; note?: string }[];
  expenseLines: EstimateExpenseLine[];
  passThroughSubtotal: number;
  cappedPassThrough: number;
  flags: { title: string; detail: string }[];
  /** True when estimate used the same path as the in-app worksheet. */
  matchesLegacyWorksheet: boolean;
};

const EXPENSE_LABELS: Record<string, string> = {
  production: "Production",
  sound: "Sound",
  lights: "Lights",
  hospitality: "Hospitality",
  marketing: "Marketing",
  backline: "Backline",
  security: "Security",
  other: "Other",
};

export interface SettlementEstimateInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  venueCapacity?: number;
}

function aggregateTickets(input: SettlementEstimateInput) {
  const grossBoxOffice = input.ticketSales.reduce((s, t) => s + t.gross, 0);
  const totalFees = input.ticketSales.reduce((s, t) => s + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;
  const tickets =
    input.ticketSales.reduce((s, t) => s + (t.qty ?? 0), 0) || 0;
  return { grossBoxOffice, totalFees, netBoxOffice, tickets };
}

function passThroughExpenseLines(expenses: Expense[]): EstimateExpenseLine[] {
  return expenses
    .filter((e) => !e.absorbedByVenue)
    .map((e) => ({
      id: e.id,
      category: EXPENSE_LABELS[e.category] ?? e.category,
      description: e.description,
      amount: e.amount,
    }));
}

function cappedPassThrough(
  passThruTotal: number,
  expenseCap: number | null | undefined,
): number {
  if (expenseCap == null || Number.isNaN(expenseCap)) {
    return passThruTotal;
  }
  return Math.min(passThruTotal, expenseCap);
}

function deriveFlags(
  input: SettlementEstimateInput,
  ctx: {
    grossBoxOffice: number;
    cappedPass: number;
    passThruTotal: number;
  },
): { title: string; detail: string }[] {
  const flags: { title: string; detail: string }[] = [];
  const { deal, expenses } = input;

  if (deal.dealNotesFreetext?.trim()) {
    flags.push({
      title: "Deal notes present",
      detail:
        "Structured fields may not match prose the agent relies on — align before settlement.",
    });
  }

  const pending = expenses.filter(
    (e) => !e.absorbedByVenue && !e.approved,
  ).length;
  if (pending > 0) {
    flags.push({
      title: "Unapproved pass-through expenses",
      detail: `${pending} line item(s) are not approved yet; totals may change.`,
    });
  }

  if (
    (deal.dealType === "percentage_of_net" ||
      deal.dealType === "vs" ||
      deal.dealType === "door") &&
    ctx.passThruTotal > 0 &&
    ctx.cappedPass < ctx.passThruTotal &&
    deal.expenseCap == null
  ) {
    flags.push({
      title: "No expense cap on deal",
      detail:
        "Pass-through is uncapped in the estimate; confirm whether the contract caps artist-borne expenses.",
    });
  }

  if (ctx.grossBoxOffice === 0 && deal.dealType !== "flat") {
    flags.push({
      title: "No box office yet",
      detail:
        "Ticket sales are empty or zero — this is a pre-show projection until numbers land.",
    });
  }

  return flags.slice(0, 5);
}

function deriveConfidence(
  input: SettlementEstimateInput,
  ctx: { grossBoxOffice: number },
): EstimateConfidence {
  const { deal } = input;
  if (
    deal.percentage == null &&
    deal.dealType !== "flat" &&
    deal.dealType !== "door"
  ) {
    return { label: "Low — missing %", variant: "sky" };
  }
  if (deal.dealType === "flat" && deal.guaranteeAmount == null) {
    return { label: "Low — missing guarantee", variant: "sky" };
  }
  if (ctx.grossBoxOffice === 0 && deal.dealType !== "flat") {
    return { label: "Medium — no gross yet", variant: "amber" };
  }
  const bonuses = parseBonuses(deal);
  if (
    bonuses.some((b) => b.type === "sellout") &&
    input.venueCapacity == null
  ) {
    return { label: "Medium — sellout bonus unclear", variant: "amber" };
  }
  if (deal.dealNotesFreetext?.trim()) {
    return { label: "Medium — review deal notes", variant: "amber" };
  }
  return { label: "High — inputs complete", variant: "brand" };
}

export function buildSettlementEstimate(
  input: SettlementEstimateInput,
): SettlementEstimateResult {
  const { deal, ticketSales, expenses, venueCapacity } = input;
  const { grossBoxOffice, totalFees, netBoxOffice, tickets } =
    aggregateTickets(input);
  const expenseLines = passThroughExpenseLines(expenses);
  const passThruTotal = expenseLines.reduce((s, e) => s + e.amount, 0);
  const cap = deal.expenseCap ?? undefined;
  const cappedPass = cappedPassThrough(passThruTotal, cap);

  const bonusCtx = {
    gross: grossBoxOffice,
    tickets,
    capacity: venueCapacity,
  };

  // ----- percentage_of_gross on net basis (stored as gross type + basis net) -----
  if (deal.dealType === "percentage_of_gross" && deal.percentageBasis === "net") {
    if (deal.percentage == null) {
      return emptyEstimate(
        input,
        passThruTotal,
        cappedPass,
        expenseLines,
        {
          label: "Low — missing %",
          variant: "sky",
        },
      );
    }
    const payout = netBoxOffice * deal.percentage;
    const bonusResult = applyDealBonuses(parseBonuses(deal), bonusCtx);
    const totalToArtist = payout + bonusResult.totalApplied;
    const steps: SettlementEstimateResult["steps"] = [
      { label: "Net box office (after fees)", value: netBoxOffice },
      {
        label: `× ${(deal.percentage * 100).toFixed(1)}% of net`,
        value: payout,
        note: "Percentage applies to net, not gross.",
      },
      ...bonusResult.applied.map((b) => ({
        label: b.label,
        value: b.amount,
        note: b.reason,
      })),
    ];
    return {
      totalToArtist,
      confidence: deriveConfidence(input, { grossBoxOffice }),
      steps,
      expenseLines,
      passThroughSubtotal: passThruTotal,
      cappedPassThrough: cappedPass,
      flags: deriveFlags(input, { grossBoxOffice, cappedPass, passThruTotal }),
      matchesLegacyWorksheet: false,
    };
  }

  // ----- Legacy-supported types: delegate to calculateSettlement -----
  const legacy = calculateSettlement({
    deal,
    ticketSales,
    expenses,
    venueCapacity,
  });
  if (legacy.supported) {
    return {
      totalToArtist: legacy.totalToArtist,
      confidence: deriveConfidence(input, { grossBoxOffice }),
      steps: legacy.steps,
      expenseLines,
      passThroughSubtotal: passThruTotal,
      cappedPassThrough: cappedPass,
      flags: deriveFlags(input, { grossBoxOffice, cappedPass, passThruTotal }),
      matchesLegacyWorksheet: true,
    };
  }

  // ----- percentage_of_net -----
  if (deal.dealType === "percentage_of_net") {
    if (deal.percentage == null) {
      return emptyEstimate(
        input,
        passThruTotal,
        cappedPass,
        expenseLines,
        {
          label: "Low — missing %",
          variant: "sky",
        },
      );
    }
    const pctOnGross = deal.percentageBasis === "gross";
    if (pctOnGross) {
      const payout = grossBoxOffice * deal.percentage;
      const steps: SettlementEstimateResult["steps"] = [
        { label: "Gross box office", value: grossBoxOffice },
        {
          label: `× ${(deal.percentage * 100).toFixed(1)}% (on gross)`,
          value: payout,
          note: "Percentage applies to gross before ticket fees or pass-through.",
        },
      ];
      return {
        totalToArtist: payout,
        confidence: deriveConfidence(input, { grossBoxOffice }),
        steps,
        expenseLines,
        passThroughSubtotal: passThruTotal,
        cappedPassThrough: cappedPass,
        flags: deriveFlags(input, { grossBoxOffice, cappedPass, passThruTotal }),
        matchesLegacyWorksheet: false,
      };
    }

    const netAfter = Math.max(0, netBoxOffice - cappedPass);
    const payout = netAfter * deal.percentage;
    const steps: SettlementEstimateResult["steps"] = [
      { label: "Gross box office", value: grossBoxOffice },
      { label: "Less fees", value: -totalFees, note: "Ticket fees" },
      { label: "Net box office", value: netBoxOffice },
      {
        label: "Less pass-through (capped)",
        value: -cappedPass,
        note:
          cap != null
            ? `Capped at ${cap.toLocaleString()} vs ${passThruTotal.toLocaleString()} expenses`
            : `Full pass-through ${passThruTotal.toLocaleString()}`,
      },
      { label: "Net after expenses", value: netAfter },
      {
        label: `× ${(deal.percentage * 100).toFixed(1)}% (on net after expenses)`,
        value: payout,
        note: "Default % of net — after fees and capped pass-through.",
      },
    ];
    return {
      totalToArtist: payout,
      confidence: deriveConfidence(input, { grossBoxOffice }),
      steps,
      expenseLines,
      passThroughSubtotal: passThruTotal,
      cappedPassThrough: cappedPass,
      flags: deriveFlags(input, { grossBoxOffice, cappedPass, passThruTotal }),
      matchesLegacyWorksheet: false,
    };
  }

  // ----- vs -----
  if (deal.dealType === "vs") {
    if (deal.percentage == null || deal.guaranteeAmount == null) {
      return emptyEstimate(
        input,
        passThruTotal,
        cappedPass,
        expenseLines,
        {
          label: "Low — missing fields",
          variant: "sky",
        },
      );
    }
    const guarantee = deal.guaranteeAmount;
    const pctOnGross = deal.percentageBasis === "gross";

    let pctPayout: number;
    let steps: SettlementEstimateResult["steps"];

    if (pctOnGross) {
      pctPayout = grossBoxOffice * deal.percentage;
      steps = [
        { label: "Gross box office", value: grossBoxOffice },
        {
          label: `% of gross (${(deal.percentage * 100).toFixed(1)}%)`,
          value: pctPayout,
          note: "Percentage side runs on gross — not net after fees/expenses.",
        },
        { label: "Guarantee", value: guarantee },
        {
          label: "Greater of guarantee vs %",
          value: Math.max(guarantee, pctPayout),
          note: "Vs base before gross-threshold bonuses",
        },
      ];
    } else {
      const netAfter = Math.max(0, netBoxOffice - cappedPass);
      pctPayout = netAfter * deal.percentage;
      steps = [
        { label: "Gross box office", value: grossBoxOffice },
        { label: "Less fees", value: -totalFees },
        { label: "Net box office", value: netBoxOffice },
        {
          label: "Less pass-through (capped)",
          value: -cappedPass,
          note:
            cap != null
              ? `Expense cap ${cap.toLocaleString()}`
              : "No expense cap",
        },
        { label: "Net after expenses", value: netAfter },
        {
          label: `% of net (${(deal.percentage * 100).toFixed(1)}%)`,
          value: pctPayout,
        },
        { label: "Guarantee", value: guarantee },
        {
          label: "Greater of guarantee vs %",
          value: Math.max(guarantee, pctPayout),
          note: "Vs base before gross-threshold bonuses",
        },
      ];
    }

    const base = Math.max(guarantee, pctPayout);
    const bonusPayout = parseBonuses(deal)
      .filter((b) => b.type === "gross_threshold")
      .filter((b) => grossBoxOffice >= b.threshold)
      .reduce((s, b) => s + b.amount, 0);
    const overrideGuarantee = pctPayout >= guarantee;
    const totalToArtist = base + (overrideGuarantee ? bonusPayout : 0);

    if (overrideGuarantee && bonusPayout > 0) {
      steps.push({
        label: "Gross-threshold bonuses (structured)",
        value: bonusPayout,
        note: "Applied when the % side clears the guarantee (seed-aligned rule)",
      });
    }

    return {
      totalToArtist,
      confidence: deriveConfidence(input, { grossBoxOffice }),
      steps,
      expenseLines,
      passThroughSubtotal: passThruTotal,
      cappedPassThrough: cappedPass,
      flags: deriveFlags(input, { grossBoxOffice, cappedPass, passThruTotal }),
      matchesLegacyWorksheet: false,
    };
  }

  // ----- door -----
  if (deal.dealType === "door") {
    const netAfter = Math.max(0, grossBoxOffice - cappedPass);
    const steps: SettlementEstimateResult["steps"] = [
      { label: "Gross box office", value: grossBoxOffice },
      {
        label: "Less pass-through (capped)",
        value: -cappedPass,
        note: "Door-style: gross less capped pass-through expenses",
      },
      { label: "Estimated to artist", value: netAfter },
    ];
    return {
      totalToArtist: netAfter,
      confidence: deriveConfidence(input, { grossBoxOffice }),
      steps,
      expenseLines,
      passThroughSubtotal: passThruTotal,
      cappedPassThrough: cappedPass,
      flags: deriveFlags(input, { grossBoxOffice, cappedPass, passThruTotal }),
      matchesLegacyWorksheet: false,
    };
  }

  // Fallback (should not hit)
  return emptyEstimate(input, passThruTotal, cappedPass, expenseLines, {
    label: "Low",
    variant: "sky",
  });
}

function emptyEstimate(
  input: SettlementEstimateInput,
  passThruTotal: number,
  cappedPass: number,
  expenseLines: EstimateExpenseLine[],
  confidence: EstimateConfidence,
): SettlementEstimateResult {
  const { grossBoxOffice } = aggregateTickets(input);
  return {
    totalToArtist: 0,
    confidence,
    steps: [],
    expenseLines,
    passThroughSubtotal: passThruTotal,
    cappedPassThrough: cappedPass,
    flags: deriveFlags(input, { grossBoxOffice, cappedPass, passThruTotal }),
    matchesLegacyWorksheet: false,
  };
}
