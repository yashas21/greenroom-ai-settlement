/**
 * Applies persisted readiness clarification answers to the settlement workspace seed.
 * Matching is intentionally heuristic (question id + option text keywords).
 */

import type { ReadinessAnswersMap } from "@/lib/readinessAnswers";
import { answerAsString } from "@/lib/readinessAnswers";
import type { SettlementWorkspaceSeed, WorkspaceExpenseLineSeed } from "@/lib/settlementWorkspaceSeed";

function lower(s: string): string {
  return s.toLowerCase();
}

function flattenAnswers(answers: ReadinessAnswersMap): { key: string; val: string }[] {
  const rows: { key: string; val: string }[] = [];
  for (const [k, v] of Object.entries(answers)) {
    rows.push({ key: k, val: answerAsString(v) });
  }
  return rows;
}

/** Venue-side marketing — not charged to artist in this worksheet. */
function marketingVenueAbsorbedFromAnswers(answers: ReadinessAnswersMap): boolean {
  for (const { key, val } of flattenAnswers(answers)) {
    const K = lower(key);
    const V = lower(val);
    const aboutMarketing =
      K.includes("marketing") ||
      K.includes("recoup") ||
      V.includes("marketing") ||
      V.includes("recoup");
    if (!aboutMarketing) continue;
    if (
      V.includes("venue") ||
      V.includes("absorb") ||
      V.includes("venue absorbed")
    ) {
      return true;
    }
  }
  return false;
}

function walkoutNoteSuffix(answers: ReadinessAnswersMap): string | null {
  for (const { key, val } of flattenAnswers(answers)) {
    const K = lower(key);
    if (!K.includes("walkout")) continue;
    return `Readiness (${key}): ${val.trim()}`;
  }
  return null;
}

function dealBasisOverride(answers: ReadinessAnswersMap): string | null {
  for (const { key, val } of flattenAnswers(answers)) {
    const blob = `${lower(key)} ${lower(val)}`;
    if (blob.includes("gross") && blob.includes("net") && blob.includes("before"))
      return "gross_before_expenses";
    if (blob.includes("net") && blob.includes("after") && blob.includes("deduct"))
      return "net_after_deductions";
  }
  return null;
}

function marketingHelperFromReadiness(
  row: WorkspaceExpenseLineSeed,
  venueAbsorbed: boolean
): string | undefined {
  if (venueAbsorbed) {
    return "Per readiness answer: treat as venue-side / not in artist split.";
  }
  const base = row.helper;
  const add = "Per readiness answer: confirm timing vs split with deal memo.";
  return base ? `${base} ${add}` : add;
}

export function applyReadinessAnswersToWorkspaceSeed(
  seed: SettlementWorkspaceSeed,
  answers: ReadinessAnswersMap
): SettlementWorkspaceSeed {
  if (Object.keys(answers).length === 0) return seed;

  const venueMkt = marketingVenueAbsorbedFromAnswers(answers);
  const expenses: WorkspaceExpenseLineSeed[] = seed.initialExpenses.map((row) => {
    if (row.category !== "marketing") return row;
    if (!venueMkt) return row;
    return {
      ...row,
      venueAbsorbed: true,
      helper: marketingHelperFromReadiness(row, true),
    };
  });

  const walk = walkoutNoteSuffix(answers);
  const payoutNotes = { ...seed.initialPayoutNotes };
  if (walk) {
    payoutNotes.walkoutNote = [payoutNotes.walkoutNote, walk]
      .filter(Boolean)
      .join("\n")
      .slice(0, 800);
  }

  const basis = dealBasisOverride(answers);
  const logic = { ...seed.initialLogic };
  if (basis) logic.dealBasis = basis;

  return {
    ...seed,
    initialExpenses: expenses,
    initialPayoutNotes: payoutNotes,
    initialLogic: logic,
  };
}
