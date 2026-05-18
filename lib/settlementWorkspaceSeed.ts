/**
 * Builds initial worksheet rows from persisted show / deal / ticketing / expense data.
 */

import type { Deal, Expense } from "@/db/schema";
import type { ShowWithRelations } from "@/lib/queries";
import { parseReadinessAnswersJson } from "@/lib/readinessAnswers";
import { applyReadinessAnswersToWorkspaceSeed } from "@/lib/readinessWorkspaceApply";
import { formatMoney } from "@/lib/format";
import { format } from "date-fns";

export type WorkspaceRevenueBucket = "gross" | "fees";

export type WorkspaceRevenueLineSeed = {
  id: string;
  label: string;
  amount: string;
  helper?: string;
  bucket: WorkspaceRevenueBucket;
};

/** Matches `expenses.category` in the database. */
export type WorkspaceExpenseCategory = Expense["category"];

export type WorkspaceExpenseLineSeed = {
  id: string;
  /** Short description (e.g. "Flyers · radio"). */
  label: string;
  category: WorkspaceExpenseCategory;
  actual: string;
  /** Venue pays — does not reduce artist net in this worksheet. */
  venueAbsorbed: boolean;
  helper?: string;
};

export type WorkspaceLogicSeed = {
  dealBasis: string;
  artistPercentage: string;
  guarantee: string;
  /** Deal expense cap — max total deductible (all lines) in the workspace. */
  expenseCap: string;
  /** Deal hospitality cap — applied across hospitality lines. */
  hospitalityCap: string;
};

export type WorkspacePayoutNotesSeed = {
  guaranteeApplied: string;
  walkoutNote: string;
};

export type SettlementWorkspaceSeed = {
  /** From deal — drives vs guarantee vs percentage rule. */
  dealType: Deal["dealType"] | null;
  initialRevenue: WorkspaceRevenueLineSeed[];
  initialExpenses: WorkspaceExpenseLineSeed[];
  initialLogic: WorkspaceLogicSeed;
  initialPayoutNotes: WorkspacePayoutNotesSeed;
};

function formatCaptureAt(capturedAt: Date): string {
  return format(capturedAt, "MMM d, h:mm a");
}

function expenseLabel(e: Expense): string {
  const words = e.category.replace(/_/g, " ");
  const cap = words.charAt(0).toUpperCase() + words.slice(1);
  return e.description?.trim() ? `${cap} · ${e.description.trim()}` : cap;
}

function expenseHelper(
  e: Expense,
  deal: ShowWithRelations["deal"]
): string | undefined {
  if (e.absorbedByVenue) {
    return "Marked venue-absorbed in Greenroom — not in artist split.";
  }
  if (e.category === "hospitality" && deal?.hospitalityCap != null) {
    return `Negotiated hospitality cap in deal: ${formatMoney(deal.hospitalityCap)}`;
  }
  if (e.category === "marketing" && deal?.expenseCap != null) {
    return `Deal expense cap (max total deductible in workspace): ${formatMoney(deal.expenseCap)}`;
  }
  if (e.category === "marketing") {
    return "When an expense cap is set on the deal, total deductible expenses cannot exceed it.";
  }
  return undefined;
}

function dealBasisFromDeal(deal: ShowWithRelations["deal"]): string {
  if (!deal) return "net_after_deductions";
  switch (deal.dealType) {
    case "percentage_of_gross":
      return "gross_before_expenses";
    case "door":
      return "door_net";
    default:
      return "net_after_deductions";
  }
}

function buildGuaranteeNote(
  deal: ShowWithRelations["deal"],
  settlement: ShowWithRelations["settlement"]
): string {
  if (!deal) return "No deal on file — add deal terms on the show record.";
  const parts: string[] = [`Deal type: ${deal.dealType.replace(/_/g, " ")}`];
  if (deal.guaranteeAmount != null) {
    parts.push(`guarantee ${formatMoney(deal.guaranteeAmount)}`);
  }
  if (deal.percentage != null) {
    parts.push(
      `${(deal.percentage * 100).toFixed(0)}%${deal.percentageBasis ? ` of ${deal.percentageBasis}` : ""}`
    );
  }
  if (deal.expenseCap != null) {
    parts.push(`expense cap ${formatMoney(deal.expenseCap)}`);
  }
  const base = parts.join(" · ");
  if (settlement?.notes?.trim()) {
    const sn = settlement.notes.trim();
    const clipped = sn.length > 280 ? `${sn.slice(0, 280)}…` : sn;
    return `${base} · Settlement notes: ${clipped}`;
  }
  return base;
}

function buildWalkoutNote(deal: ShowWithRelations["deal"]): string {
  if (deal?.dealNotesFreetext?.trim()) {
    return deal.dealNotesFreetext.trim().slice(0, 400);
  }
  return "";
}

function buildRevenueLines(
  ticketSales: ShowWithRelations["ticketSales"]
): WorkspaceRevenueLineSeed[] {
  if (ticketSales.length === 0) {
    return [
      {
        id: "gross-empty",
        label: "Box office gross",
        amount: "0",
        bucket: "gross",
        helper: "No ticket_sales rows for this show yet.",
      },
      {
        id: "fees-empty",
        label: "Ticketing & platform fees",
        amount: "0",
        bucket: "fees",
      },
    ];
  }
  const sorted = [...ticketSales].sort(
    (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()
  );
  const rows: WorkspaceRevenueLineSeed[] = [];
  for (const t of sorted) {
    const when = formatCaptureAt(t.capturedAt);
    rows.push({
      id: `gross-${t.id}`,
      label: `Gross · ${when}`,
      amount: String(t.gross),
      bucket: "gross",
    });
    rows.push({
      id: `fees-${t.id}`,
      label: `Fees · ${when}`,
      amount: String(t.fees),
      bucket: "fees",
      helper: "From integrated ticketing (`ticket_sales`).",
    });
  }
  return rows;
}

function buildExpenseLines(
  expenses: ShowWithRelations["expenses"],
  deal: ShowWithRelations["deal"]
): WorkspaceExpenseLineSeed[] {
  if (expenses.length === 0) {
    return [];
  }
  return expenses.map((e) => ({
    id: e.id,
    label: expenseLabel(e),
    category: e.category,
    actual: String(e.amount),
    venueAbsorbed: e.absorbedByVenue,
    helper: expenseHelper(e, deal),
  }));
}

export function buildSettlementWorkspaceSeed(
  data: ShowWithRelations
): SettlementWorkspaceSeed {
  const { ticketSales, expenses, deal, settlement, show } = data;

  const base: SettlementWorkspaceSeed = {
    dealType: deal?.dealType ?? null,
    initialRevenue: buildRevenueLines(ticketSales),
    initialExpenses: buildExpenseLines(expenses, deal),
    initialLogic: {
      dealBasis: dealBasisFromDeal(deal),
      artistPercentage:
        deal?.percentage != null
          ? String(Math.round(deal.percentage * 10000) / 100)
          : "",
      guarantee:
        deal?.guaranteeAmount != null ? String(deal.guaranteeAmount) : "",
      expenseCap: deal?.expenseCap != null ? String(deal.expenseCap) : "",
      hospitalityCap:
        deal?.hospitalityCap != null ? String(deal.hospitalityCap) : "",
    },
    initialPayoutNotes: {
      guaranteeApplied: buildGuaranteeNote(deal, settlement),
      walkoutNote: buildWalkoutNote(deal),
    },
  };

  const answers = parseReadinessAnswersJson(show.readinessAnswersJson);
  return applyReadinessAnswersToWorkspaceSeed(base, answers);
}
