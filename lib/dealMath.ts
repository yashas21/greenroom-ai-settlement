/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * IMPORTANT — DELIBERATELY INCOMPLETE.
 *
 * This is the existing Greenroom settlement engine. It was built early in
 * the company's life, when most deals were flat guarantees. It currently
 * handles two deal types end-to-end:
 *
 *   1. flat                 — $X guaranteed, optional sellout bonus
 *   2. percentage_of_gross  — X% of gross, no expense deductions, optional sellout bonus
 *
 * For both, it reads `bonusesJson` and applies bonuses where it can — but
 * only the structured ones. Bonuses that exist only in `dealNotesFreetext`
 * are invisible to this engine.
 *
 * It does NOT handle:
 *
 *   - vs deals (guarantee vs % of net, whichever greater)
 *   - percentage_of_net deals (with expense deductions)
 *   - door deals
 *   - recoups (those flow separately through the settlement record)
 *   - tier ratchets (would need vs-deal support first)
 *   - comps that count toward gross
 *
 * For unsupported deals, the tool returns { supported: false } and the UI
 * shows the "this deal type isn't yet supported" empty state. About 82% of
 * Greenroom's customers default to spreadsheets because of this.
 */

import type { Deal, Expense, TicketSale, Bonus } from "@/db/schema";

export type SettlementCalculation =
  | {
      supported: true;
      grossBoxOffice: number;
      netBoxOffice: number;
      totalExpenses: number;
      totalToArtist: number;
      steps: { label: string; value: number; note?: string }[];
      finalFormula: string;
      // Bonuses that were applied. Empty array if no bonuses on the deal,
      // or if no bonuses triggered.
      bonusesApplied: { label: string; amount: number; reason: string }[];
      // Bonuses that exist on the deal but didn't trigger (helpful context).
      bonusesNotTriggered: { label: string; amount: number; reason: string }[];
    }
  | {
      supported: false;
      reason: string;
      dealType: Deal["dealType"];
    };

interface CalcInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  // Capacity is needed to evaluate sellout bonuses. Optional — if omitted,
  // sellout bonuses are reported as "can't determine".
  venueCapacity?: number;
  ticketsSold?: number;
}

export function parseBonuses(deal: Deal): Bonus[] {
  if (!deal.bonusesJson) return [];
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, ticketSales, expenses, venueCapacity, ticketsSold } = input;

  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);

  const tickets =
    ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);

  // ---------- flat guarantee ----------
  if (deal.dealType === "flat") {
    if (deal.guaranteeAmount == null) {
      return {
        supported: false,
        reason: "Flat deal is missing a guarantee amount.",
        dealType: deal.dealType,
      };
    }
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: deal.guaranteeAmount + bonusResult.totalApplied,
      steps: [
        {
          label: "Flat guarantee",
          value: deal.guaranteeAmount,
          note: "No expense deductions. The guarantee is the floor.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `flat ${deal.guaranteeAmount} + bonuses ${bonusResult.totalApplied} = ${(deal.guaranteeAmount + bonusResult.totalApplied).toFixed(2)}`
        : `flat guarantee = ${deal.guaranteeAmount}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ---------- percentage of gross ----------
  if (deal.dealType === "percentage_of_gross") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-gross deal is missing a percentage.",
        dealType: deal.dealType,
      };
    }
    const payout = grossBoxOffice * deal.percentage;
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: payout + bonusResult.totalApplied,
      steps: [
        { label: "Gross box office", value: grossBoxOffice },
        {
          label: `× ${(deal.percentage * 100).toFixed(0)}%`,
          value: payout,
          note: "Percentage of gross — no expense deductions.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `gross × ${deal.percentage} + bonuses = ${(payout + bonusResult.totalApplied).toFixed(2)}`
        : `gross × ${deal.percentage} = ${payout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ---------- percentage of net ----------
  if (deal.dealType === "percentage_of_net") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-net deal is missing a percentage.",
        dealType: deal.dealType,
      };
    }
    
    const allowedExpenses = deal.expenseCap != null 
      ? Math.min(totalExpenses, deal.expenseCap) 
      : totalExpenses;
      
    const netProfit = Math.max(0, netBoxOffice - allowedExpenses);
    const payout = netProfit * deal.percentage;
    
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });
    
    const steps: SettlementCalculation["steps"] = [
      { label: "Net box office", value: netBoxOffice },
      { label: "Total expenses submitted", value: totalExpenses },
    ];
    
    if (deal.expenseCap != null) {
      steps.push({ label: "Expense cap applied", value: deal.expenseCap });
    }
    
    steps.push({ 
      label: "Deductible expenses", 
      value: allowedExpenses,
      note: deal.expenseCap != null && totalExpenses > deal.expenseCap 
        ? "Capped at expense limit" 
        : undefined
    });
    
    steps.push({ 
      label: "Net after expenses", 
      value: netProfit, 
      note: netBoxOffice - allowedExpenses < 0 ? "Losses not shared (floored at $0)" : undefined 
    });
    
    steps.push({ 
      label: `Artist share (${(deal.percentage * 100).toFixed(0)}%)`, 
      value: payout, 
      note: "Artist percentage of net profit" 
    });
    
    bonusResult.applied.forEach(b => {
      steps.push({ label: `Bonus: ${b.label}`, value: b.amount, note: b.reason });
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: payout + bonusResult.totalApplied,
      steps,
      finalFormula: bonusResult.applied.length
        ? `net profit × ${deal.percentage} + bonuses = ${(payout + bonusResult.totalApplied).toFixed(2)}`
        : `net profit × ${deal.percentage} = ${payout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ---------- vs (guarantee vs percentage) ----------
  if (deal.dealType === "vs") {
    if (deal.guaranteeAmount == null || deal.percentage == null) {
      return {
        supported: false,
        reason: "Vs deal is missing guarantee or percentage.",
        dealType: deal.dealType,
      };
    }

    const basis = deal.percentageBasis ?? "net";
    
    const allowedExpenses = deal.expenseCap != null 
      ? Math.min(totalExpenses, deal.expenseCap) 
      : totalExpenses;
      
    const netProfit = Math.max(0, netBoxOffice - allowedExpenses);
    
    let percentagePayout = 0;
    if (basis === "gross") {
      percentagePayout = grossBoxOffice * deal.percentage;
    } else {
      percentagePayout = netProfit * deal.percentage;
    }

    const guaranteePayout = deal.guaranteeAmount;
    
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    const isGuaranteeWinner = guaranteePayout >= percentagePayout;
    const basePayout = isGuaranteeWinner ? guaranteePayout : percentagePayout;

    const steps: SettlementCalculation["steps"] = [];
    
    steps.push({ label: "Gross box office", value: grossBoxOffice });
    if (basis === "net") {
      steps.push({ label: "Net box office", value: netBoxOffice });
      steps.push({ label: "Total expenses submitted", value: totalExpenses });
      if (deal.expenseCap != null) {
        steps.push({ label: "Expense cap applied", value: deal.expenseCap });
      }
      steps.push({ 
        label: "Deductible expenses", 
        value: allowedExpenses,
        note: deal.expenseCap != null && totalExpenses > deal.expenseCap 
          ? "Capped at expense limit" 
          : undefined
      });
      steps.push({ 
        label: "Net after expenses", 
        value: netProfit, 
        note: netBoxOffice - allowedExpenses < 0 ? "Losses not shared (floored at $0)" : undefined 
      });
    }

    steps.push({ 
      label: "Guarantee floor", 
      value: guaranteePayout 
    });

    const pctLabel = `${(deal.percentage * 100).toFixed(0)}% of ${basis}`;
    steps.push({ 
      label: pctLabel, 
      value: percentagePayout,
      note: deal.percentageBasis == null ? "Warning: percentage basis was missing, defaulted to net." : undefined
    });

    steps.push({
      label: "Vs comparison winner",
      value: basePayout,
      note: isGuaranteeWinner 
        ? "Guarantee is greater than or equal to percentage." 
        : "Percentage payout is greater than guarantee."
    });

    bonusResult.applied.forEach(b => {
      steps.push({ label: `Bonus: ${b.label}`, value: b.amount, note: b.reason });
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: basePayout + bonusResult.totalApplied,
      steps,
      finalFormula: isGuaranteeWinner
        ? `guarantee ${guaranteePayout} + bonuses = ${(basePayout + bonusResult.totalApplied).toFixed(2)}`
        : `${basis} × ${deal.percentage} + bonuses = ${(basePayout + bonusResult.totalApplied).toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ---------- everything else: not supported ----------
  const friendlyName: Record<Deal["dealType"], string> = {
    flat: "Flat guarantee",
    percentage_of_gross: "Percentage of gross",
    percentage_of_net: "Percentage of net",
    vs: "Vs deal (guarantee vs %)",
    door: "Door deal",
  };

  return {
    supported: false,
    dealType: deal.dealType,
    reason:
      `${friendlyName[deal.dealType]} deals aren't supported in the in-app tool yet. ` +
      `Power users at venues like The Crescent default to spreadsheets for these.`,
  };
}

/** Evaluate a list of bonuses against the show's actual numbers. */
function applyBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
) {
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      if (ctx.gross >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} ≥ ${b.threshold.toLocaleString()}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} < ${b.threshold.toLocaleString()}`,
        });
      }
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} of ${ctx.capacity} sold`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason:
            ctx.capacity != null
              ? `${ctx.tickets} of ${ctx.capacity} sold (sellout = ≥95%)`
              : `Capacity unknown — can't evaluate`,
        });
      }
    } else if (b.type === "attendance_threshold") {
      if (ctx.tickets >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} ≥ ${b.threshold}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} < ${b.threshold}`,
        });
      }
    } else if (b.type === "tier_ratchet") {
      // Tier ratchets fundamentally change the percentage structure. The
      // current engine only supports flat % of gross — we can't apply a
      // ratcheting structure on top of it without knowing which deal type
      // it's modifying. Report as not-applicable.
      notTriggered.push({
        label: b.label,
        amount: 0,
        reason: "Tier ratchets need vs-deal or % of net support — not yet handled",
      });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((s, b) => s + b.amount, 0),
  };
}
