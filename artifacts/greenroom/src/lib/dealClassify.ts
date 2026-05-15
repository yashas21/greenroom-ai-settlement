import type { Deal } from "./types";

export type ComplexityBucket = "simple" | "medium" | "complex";

export function classifyComplexity(d: Deal): ComplexityBucket {
  const hasBonuses =
    !!d.bonusesJson && d.bonusesJson !== "[]" && d.bonusesJson !== "null";
  const hasNotes =
    !!d.dealNotesFreetext && d.dealNotesFreetext.trim().length > 0;
  if (
    d.dealType === "vs" ||
    d.dealType === "door" ||
    d.dealType === "percentage_of_net" ||
    hasBonuses ||
    hasNotes
  ) {
    return "complex";
  }
  if (
    d.dealType === "percentage_of_gross" ||
    d.expenseCap != null ||
    d.hospitalityCap != null
  ) {
    return "medium";
  }
  return "simple";
}

export const SIZE_BUCKETS = [
  "$0–1K",
  "$1–5K",
  "$5–15K",
  "$15K+",
  "Uncapped %",
] as const;

export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export function classifySizeBucket(d: Deal): SizeBucket {
  if (d.guaranteeAmount == null || d.guaranteeAmount === 0) {
    if (d.percentage != null) return "Uncapped %";
    return "$0–1K";
  }
  const g = d.guaranteeAmount;
  if (g < 1000) return "$0–1K";
  if (g < 5000) return "$1–5K";
  if (g < 15000) return "$5–15K";
  return "$15K+";
}
