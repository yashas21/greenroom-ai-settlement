import { SettlementCalculation } from "./dealMath";
import { Deal } from "@/db/schema";
import { formatMoney } from "./format";

export interface NarrativeData {
  summary: string;
  bullets: string[];
  warnings: string[];
  copyableText: string;
}

export function generateSettlementNarrative(
  calc: Extract<SettlementCalculation, { supported: true }>,
  deal: Deal
): NarrativeData {
  const warnings: string[] = [];
  const bullets: string[] = [];

  if (deal.dealNotesFreetext) {
    warnings.push(
      "Deal terms should be checked against free-text notes because Mariana treats notes as the source of truth."
    );
  }

  let summary = "";
  let copyableText = "";

  const gross = formatMoney(calc.grossBoxOffice);
  const net = formatMoney(calc.netBoxOffice);
  const submittedExp = formatMoney(calc.totalExpenses);
  const totalArtist = formatMoney(calc.totalToArtist);

  if (deal.dealType === "percentage_of_net") {
    warnings.push(
      "This calculation depends on correctly interpreting deductible expenses."
    );

    const pct = deal.percentage ? (deal.percentage * 100).toFixed(0) : "0";

    const expenseCap = deal.expenseCap;
    let allowedExpenses = calc.totalExpenses;

    if (expenseCap != null && calc.totalExpenses > expenseCap) {
      warnings.push(
        "Expenses exceeded the negotiated cap; only the capped amount was deducted."
      );
      allowedExpenses = expenseCap;
    }

    const netAfterExpenses = Math.max(0, calc.netBoxOffice - allowedExpenses);
    const artistShare = netAfterExpenses * (deal.percentage ?? 0);

    const allowedExpStr = formatMoney(allowedExpenses);
    const netAfterExpStr = formatMoney(netAfterExpenses);
    const artistShareStr = formatMoney(artistShare);

    summary = `This show settled as an ${pct}% of net deal.`;

    bullets.push(`Gross box office was ${gross}.`);
    bullets.push(`After ticketing fees, net box office was ${net}.`);

    if (expenseCap != null && calc.totalExpenses > expenseCap) {
      const expSentence = `The venue submitted ${submittedExp} in expenses, but the deal capped deductible expenses at ${formatMoney(
        expenseCap
      )}, so only ${allowedExpStr} reduced the artist share.`;
      bullets.push(expSentence);
      copyableText = `This show settled as an ${pct}% of net deal. Gross box office was ${gross}. After ticketing fees, net box office was ${net}. ${expSentence} Net after expenses was ${netAfterExpStr}. The artist share was ${pct}% × ${netAfterExpStr} = ${artistShareStr}. Final total to artist: ${totalArtist}.`;
    } else {
      const expSentence = `The venue submitted ${submittedExp} in expenses, which were deducted from the net box office.`;
      bullets.push(expSentence);
      copyableText = `This show settled as an ${pct}% of net deal. Gross box office was ${gross}. After ticketing fees, net box office was ${net}. ${expSentence} Net after expenses was ${netAfterExpStr}. The artist share was ${pct}% × ${netAfterExpStr} = ${artistShareStr}. Final total to artist: ${totalArtist}.`;
    }

    bullets.push(`Net after expenses was ${netAfterExpStr}.`);
    bullets.push(
      `The artist share was ${pct}% × ${netAfterExpStr} = ${artistShareStr}.`
    );

    if (calc.bonusesApplied.length > 0) {
      calc.bonusesApplied.forEach((b) => {
        bullets.push(`A bonus of ${formatMoney(b.amount)} was applied (${b.label}).`);
      });
    }

    bullets.push(`Final total to artist: ${totalArtist}.`);
  } else if (deal.dealType === "percentage_of_gross") {
    const pct = deal.percentage ? (deal.percentage * 100).toFixed(0) : "0";
    const payout = calc.grossBoxOffice * (deal.percentage ?? 0);
    summary = `This show settled as an ${pct}% of gross deal.`;
    bullets.push(`Gross box office was ${gross}.`);
    bullets.push(`No expenses were deducted from the gross.`);
    bullets.push(`The artist share was ${pct}% × ${gross} = ${formatMoney(payout)}.`);

    if (calc.bonusesApplied.length > 0) {
      calc.bonusesApplied.forEach((b) => {
        bullets.push(`A bonus of ${formatMoney(b.amount)} was applied (${b.label}).`);
      });
    }
    bullets.push(`Final total to artist: ${totalArtist}.`);
    copyableText = `This show settled as an ${pct}% of gross deal. Gross box office was ${gross}. The artist share was ${pct}% × ${gross} = ${formatMoney(
      payout
    )}. Final total to artist: ${totalArtist}.`;
  } else if (deal.dealType === "flat") {
    summary = `This show settled as a flat guarantee deal.`;
    bullets.push(`The base guarantee was ${formatMoney(deal.guaranteeAmount ?? 0)}.`);
    if (calc.bonusesApplied.length > 0) {
      calc.bonusesApplied.forEach((b) => {
        bullets.push(`A bonus of ${formatMoney(b.amount)} was applied (${b.label}).`);
      });
    }
    bullets.push(`Final total to artist: ${totalArtist}.`);
    copyableText = `This show settled as a flat guarantee of ${formatMoney(
      deal.guaranteeAmount ?? 0
    )}. Final total to artist: ${totalArtist}.`;
  } else if (deal.dealType === "vs") {
    const pct = deal.percentage ? (deal.percentage * 100).toFixed(0) : "0";
    const basis = deal.percentageBasis ?? "net";
    const guarantee = formatMoney(deal.guaranteeAmount ?? 0);
    
    if (deal.percentageBasis == null) {
      warnings.push("Percentage basis was missing, defaulted to net.");
    }
    
    const allowedExpenses = deal.expenseCap != null && calc.totalExpenses > deal.expenseCap
      ? deal.expenseCap
      : calc.totalExpenses;
    
    const netAfterExpenses = Math.max(0, calc.netBoxOffice - allowedExpenses);
    
    let percentagePayout = 0;
    if (basis === "gross") {
      percentagePayout = calc.grossBoxOffice * (deal.percentage ?? 0);
    } else {
      percentagePayout = netAfterExpenses * (deal.percentage ?? 0);
    }
    
    const guaranteePayout = deal.guaranteeAmount ?? 0;
    const isGuaranteeWinner = guaranteePayout >= percentagePayout;
    
    summary = `This show settled as a Vs deal (${guarantee} vs ${pct}% of ${basis}).`;
    
    bullets.push(`Gross box office was ${gross}.`);
    if (basis === "net") {
      bullets.push(`After ticketing fees, net box office was ${net}.`);
      if (deal.expenseCap != null && calc.totalExpenses > deal.expenseCap) {
        bullets.push(`The venue submitted ${submittedExp} in expenses, but the deal capped deductible expenses at ${formatMoney(deal.expenseCap)}, so only ${formatMoney(allowedExpenses)} reduced the artist share.`);
      } else {
        bullets.push(`The venue submitted ${submittedExp} in expenses, which were deducted from the net box office.`);
      }
      bullets.push(`Net after expenses was ${formatMoney(netAfterExpenses)}.`);
    }
    
    bullets.push(`The guarantee was ${guarantee}.`);
    bullets.push(`The ${pct}% of ${basis} share calculated to ${formatMoney(percentagePayout)}.`);
    
    if (isGuaranteeWinner) {
      bullets.push(`Since the guarantee was greater, the base payout is ${guarantee}.`);
      copyableText = `This show settled as a Vs deal (${guarantee} vs ${pct}% of ${basis}). The percentage share was ${formatMoney(percentagePayout)}. The guarantee was greater, so the base payout is ${guarantee}. Final total to artist: ${totalArtist}.`;
    } else {
      bullets.push(`Since the percentage share was greater, the base payout is ${formatMoney(percentagePayout)}.`);
      copyableText = `This show settled as a Vs deal (${guarantee} vs ${pct}% of ${basis}). The percentage share was greater, so the base payout is ${formatMoney(percentagePayout)}. Final total to artist: ${totalArtist}.`;
    }
    
    if (calc.bonusesApplied.length > 0) {
      calc.bonusesApplied.forEach((b) => {
        bullets.push(`A bonus of ${formatMoney(b.amount)} was applied (${b.label}).`);
      });
    }
    
    bullets.push(`Final total to artist: ${totalArtist}.`);
  }

  return { summary, bullets, warnings, copyableText };
}
