export type SettlementRiskResult = {
  riskLevel: "Low" | "Medium" | "High";
  score: number;
  flags: string[];
  summary: string;
};

export function analyzeSettlementRisk(data: {
  dealNotes?: string | null;
  bonusesCount?: number;
  hospitalityCap?: number | null;
  hospitalityExpense?: number;
  settlementStatus?: string;
}): SettlementRiskResult {

  let score = 0;
  const flags: string[] = [];

  const notes = data.dealNotes?.toLowerCase() ?? "";

  // Detect escalator / ratchet language
  if (
    notes.includes("ratchet") ||
    notes.includes("escalator") ||
    notes.includes("95%")
  ) {
    score += 35;
    flags.push(
      "Escalator or ratchet language found in free-text notes."
    );
  }

  // Structured bonus mismatch risk
  if ((data.bonusesCount ?? 0) === 0 && notes.includes("%")) {
    score += 20;
    flags.push(
      "Percentage-based payout terms may not be fully structured."
    );
  }

  // Hospitality near cap
  if (
    data.hospitalityCap &&
    data.hospitalityExpense &&
    data.hospitalityExpense >= data.hospitalityCap * 0.9
  ) {
    score += 15;
    flags.push(
      "Hospitality spend is nearing negotiated cap."
    );
  }

  // Existing dispute
  if (data.settlementStatus === "disputed") {
    score += 30;
    flags.push(
      "Settlement already marked disputed."
    );
  }

  let riskLevel: "Low" | "Medium" | "High" = "Low";

  if (score >= 60) riskLevel = "High";
  else if (score >= 30) riskLevel = "Medium";

  return {
    riskLevel,
    score,
    flags,
    summary:
      flags.length > 0
        ? "This settlement contains signals that may require manual review before final approval."
        : "No major operational settlement risks detected.",
  };
}