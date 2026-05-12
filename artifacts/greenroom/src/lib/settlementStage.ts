import type { Settlement, SettlementStage } from "./types";

export const STAGE_LABELS: Record<SettlementStage, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  signed: "Signed",
  disputed: "Disputed",
  revised: "Revised",
  finalized: "Finalized",
  paid: "Paid",
  voided: "Voided",
};

export function stageHistory(s: Settlement) {
  const history: { stage: SettlementStage; at: Date }[] = [];
  if (s.draftedAt) history.push({ stage: "draft", at: new Date(s.draftedAt) });
  if (s.submittedAt) history.push({ stage: "submitted", at: new Date(s.submittedAt) });
  if (s.reviewStartedAt) history.push({ stage: "in_review", at: new Date(s.reviewStartedAt) });
  if (s.disputedAt) history.push({ stage: "disputed", at: new Date(s.disputedAt) });
  if (s.revisedAt) history.push({ stage: "revised", at: new Date(s.revisedAt) });
  if (s.signedAt) history.push({ stage: "signed", at: new Date(s.signedAt) });
  if (s.finalizedAt) history.push({ stage: "finalized", at: new Date(s.finalizedAt) });
  if (s.paidAt) history.push({ stage: "paid", at: new Date(s.paidAt) });
  return history.sort((a, b) => a.at.getTime() - b.at.getTime());
}
